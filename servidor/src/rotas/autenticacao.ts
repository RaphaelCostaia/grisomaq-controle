import { setTimeout as esperar } from 'node:timers/promises'
import type { FastifyInstance } from 'fastify'
import { comoServico, type Consultavel, type Identidade } from '../banco.ts'
import {
  assinarAcesso,
  hashDeRefresh,
  novoRefresh,
  registrarSessao,
  revogarSessoesDoFuncionario,
  rotacionarSessao,
  trocarRefresh,
} from '../jwt.ts'
import { config } from '../config.ts'

interface FuncionarioLogin {
  id: string
  codigo: string
  nome: string
  papel: Identidade['papel']
  frente_padrao_id: string | null
  ativo: boolean
  pin_definido: boolean
  pin_trocar: boolean
  bloqueado_ate: string | null
}

/** Atraso constante para o tempo de resposta não denunciar se o código existe. */
const ATRASO_CREDENCIAL_MS = 400

export async function rotasDeAutenticacao(app: FastifyInstance): Promise<void> {
  /**
   * Entrada de campo: código do funcionário + PIN de 4 dígitos.
   *
   * O PIN não é comparado aqui. Vai para `fn_verificar_pin`, que confere dentro
   * do Postgres e devolve apenas verdadeiro ou falso — o hash não sai do banco,
   * então nem um log desta rota nem uma resposta interceptada entregam material
   * para ataque offline.
   */
  app.post('/auth/login-campo', {
    config: { rateLimit: { max: config.rateLimiteLogin, timeWindow: '1 minute' } },
    handler: async (requisicao, resposta) => {
      const corpo = requisicao.body as {
        codigo?: string
        pin?: string
        dispositivo_id?: string
        app_versao?: string
      }

      const codigo = String(corpo?.codigo ?? '').trim()
      const pin = String(corpo?.pin ?? '')

      if (!/^[0-9]{1,8}$/.test(codigo) || !/^[0-9]{4}$/.test(pin)) {
        await esperar(ATRASO_CREDENCIAL_MS)
        return resposta.code(401).send({ erro: 'CREDENCIAL' })
      }

      return comoServico(async (cliente) => {
        const { rows } = await cliente.query<FuncionarioLogin>(
          'select * from public.fn_funcionario_para_login($1)',
          [codigo],
        )
        const funcionario = rows[0]

        // Código inexistente responde igual a PIN errado, e com o mesmo atraso:
        // distinguir os dois entregaria a lista de códigos válidos a quem
        // estivesse tentando adivinhar.
        if (!funcionario) {
          await esperar(ATRASO_CREDENCIAL_MS)
          return resposta.code(401).send({ erro: 'CREDENCIAL' })
        }

        if (!funcionario.ativo) return resposta.code(403).send({ erro: 'INATIVO' })

        if (funcionario.bloqueado_ate && new Date(funcionario.bloqueado_ate) > new Date()) {
          return resposta.code(429).send({ erro: 'BLOQUEADO' })
        }

        if (!funcionario.pin_definido) {
          return resposta.code(403).send({ erro: 'NAO_PROVISIONADO' })
        }

        const { rows: conferencia } = await cliente.query<{ fn_verificar_pin: boolean }>(
          'select public.fn_verificar_pin($1, $2)',
          [funcionario.id, pin],
        )

        if (!conferencia[0]?.fn_verificar_pin) {
          // O contador de tentativas vive no servidor: bloqueio guardado no
          // celular se resolve reinstalando o app.
          await cliente.query('select public.fn_registrar_falha_pin($1)', [funcionario.id])
          await esperar(ATRASO_CREDENCIAL_MS)
          return resposta.code(401).send({ erro: 'CREDENCIAL' })
        }

        await cliente.query('select public.fn_zerar_falhas_pin($1)', [funcionario.id])

        const identidade = identidadeDe(funcionario)
        const sessao = await emitirSessao(cliente, identidade, corpo?.dispositivo_id ?? null)

        await registrarDispositivo(
          cliente,
          corpo?.dispositivo_id ?? null,
          funcionario.id,
          corpo?.app_versao ?? null,
          requisicao.headers['user-agent'] ?? null,
        )

        return {
          ...sessao,
          funcionario: {
            funcionario_id: funcionario.id,
            codigo: funcionario.codigo,
            nome: funcionario.nome,
            papel: funcionario.papel,
            frente_padrao_id: funcionario.frente_padrao_id,
            trocar_pin: funcionario.pin_trocar,
          },
        }
      })
    },
  })

  /**
   * Renova a sessão. É o que faz o celular sobreviver a dias offline sem pedir
   * o PIN de novo — o app só precisa de sessão válida no momento do envio.
   */
  app.post('/auth/renovar', {
    config: { rateLimit: { max: config.rateLimiteGeral, timeWindow: '1 minute' } },
    handler: async (requisicao, resposta) => {
      const corpo = requisicao.body as { refresh_token?: string }
      const token = String(corpo?.refresh_token ?? '')
      if (!token) return resposta.code(400).send({ erro: 'CORPO_INVALIDO' })

      return comoServico(async (cliente) => {
        const sessao = await trocarRefresh(cliente, token)
        if (!sessao) return resposta.code(401).send({ erro: 'SESSAO_INVALIDA' })

        const { rows } = await cliente.query<FuncionarioLogin>(
          `select f.id, f.codigo, f.nome, f.papel, f.frente_padrao_id, f.ativo,
                  f.pin_hash is not null as pin_definido,
                  f.pin_trocar_no_proximo_acesso as pin_trocar,
                  f.pin_bloqueado_ate as bloqueado_ate
             from public.funcionarios f where f.id = $1`,
          [sessao.funcionario_id],
        )
        const funcionario = rows[0]
        if (!funcionario?.ativo) return resposta.code(403).send({ erro: 'INATIVO' })

        const proximo = novoRefresh()
        await rotacionarSessao(cliente, sessao.id, proximo.hash, hashDeRefresh(token))

        return {
          access_token: await assinarAcesso(identidadeDe(funcionario)),
          refresh_token: proximo.token,
          expira_em_segundos: config.jwtMinutos * 60,
        }
      })
    },
  })

  /**
   * Troca do PIN pelo próprio funcionário. Exige o PIN atual mesmo já havendo
   * sessão: o celular fica largado no comboio, e sessão aberta não deve bastar
   * para trocar a credencial que vale como assinatura de outra pessoa.
   */
  app.post('/auth/trocar-pin', {
    config: { rateLimit: { max: config.rateLimiteLogin, timeWindow: '1 minute' } },
    handler: async (requisicao, resposta) => {
      const identidade = requisicao.identidade
      if (!identidade) return resposta.code(401).send({ erro: 'SEM_SESSAO' })

      const corpo = requisicao.body as {
        pin_atual?: string
        pin_novo?: string
        verificador_offline?: unknown
      }
      const pinAtual = String(corpo?.pin_atual ?? '')
      const pinNovo = String(corpo?.pin_novo ?? '')

      if (!/^[0-9]{4}$/.test(pinNovo)) return resposta.code(400).send({ erro: 'PIN_FORMATO' })
      if (pinAtual === pinNovo) return resposta.code(400).send({ erro: 'PIN_REPETIDO' })

      return comoServico(async (cliente) => {
        const { rows } = await cliente.query<{ fn_verificar_pin: boolean }>(
          'select public.fn_verificar_pin($1, $2)',
          [identidade.funcionario_id, pinAtual],
        )

        if (!rows[0]?.fn_verificar_pin) {
          await cliente.query('select public.fn_registrar_falha_pin($1)', [identidade.funcionario_id])
          await esperar(ATRASO_CREDENCIAL_MS)
          return resposta.code(401).send({ erro: 'CREDENCIAL' })
        }

        try {
          await cliente.query('select public.fn_definir_pin($1, $2, $3, false)', [
            identidade.funcionario_id,
            pinNovo,
            corpo?.verificador_offline ? JSON.stringify(corpo.verificador_offline) : null,
          ])
        } catch (erro) {
          const mensagem = erro instanceof Error ? erro.message : ''
          if (mensagem.includes('PIN_FRACO')) return resposta.code(400).send({ erro: 'PIN_FRACO' })
          throw erro
        }

        // Trocar o PIN encerra as outras sessões. Se a troca aconteceu porque o
        // PIN vazou, manter as sessões antigas vivas anularia o efeito dela.
        await revogarSessoesDoFuncionario(cliente, identidade.funcionario_id)
        const sessao = await emitirSessao(cliente, identidade, null)

        return { ok: true, ...sessao }
      })
    },
  })

  app.post('/auth/sair', async (requisicao) => {
    const corpo = requisicao.body as { refresh_token?: string }
    if (!corpo?.refresh_token) return { ok: true }

    await comoServico((cliente) =>
      cliente.query(
        'update public.sessoes set revogada_em = now() where refresh_hash = $1 and revogada_em is null',
        [hashDeRefresh(corpo.refresh_token!)],
      ),
    )
    return { ok: true }
  })
}

function identidadeDe(funcionario: FuncionarioLogin): Identidade {
  return {
    funcionario_id: funcionario.id,
    codigo: funcionario.codigo,
    papel: funcionario.papel,
    frente_padrao_id: funcionario.frente_padrao_id,
  }
}

async function emitirSessao(
  cliente: Consultavel,
  identidade: Identidade,
  dispositivoId: string | null,
) {
  const refresh = novoRefresh()
  await registrarSessao(cliente, identidade.funcionario_id, refresh.hash, dispositivoId)
  return {
    access_token: await assinarAcesso(identidade),
    refresh_token: refresh.token,
    expira_em_segundos: config.jwtMinutos * 60,
  }
}

async function registrarDispositivo(
  cliente: Consultavel,
  dispositivoId: string | null,
  funcionarioId: string,
  appVersao: string | null,
  userAgent: string | null,
): Promise<void> {
  if (!dispositivoId) return
  await cliente.query(
    `insert into public.dispositivos (id, funcionario_id, app_versao, user_agent)
     values ($1, $2, $3, $4)
     on conflict (id) do update
       set funcionario_id = excluded.funcionario_id,
           app_versao = excluded.app_versao,
           user_agent = excluded.user_agent`,
    [dispositivoId, funcionarioId, appVersao, userAgent],
  )
}

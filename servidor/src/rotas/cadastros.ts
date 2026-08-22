import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { comoFuncionario, type Identidade } from '../banco.ts'

/**
 * Cadastros mestres do escritório.
 *
 * Uma rota genérica em vez de sete pares quase idênticos — mas genérica com
 * mapa fechado, nunca com nome de tabela ou coluna vindo do cliente. O identificador
 * SQL sai SEMPRE deste arquivo; do corpo da requisição vêm apenas valores, e
 * valores vão parametrizados. É essa separação que impede a rota de virar
 * injeção de SQL.
 */
interface Definicao {
  tabela: string
  colunas: string[]
  obrigatorias: string[]
  ordem: string
}

const CADASTROS: Record<string, Definicao> = {
  fazendas: {
    tabela: 'fazendas',
    colunas: ['codigo', 'nome', 'municipio', 'ativo'],
    obrigatorias: ['codigo', 'nome'],
    ordem: 'codigo',
  },
  frentes: {
    tabela: 'frentes',
    colunas: ['codigo', 'nome', 'fazenda_id', 'escala', 'ativo'],
    obrigatorias: ['codigo', 'nome'],
    ordem: 'codigo',
  },
  turnos: {
    tabela: 'turnos',
    colunas: ['codigo', 'nome', 'escala', 'hora_inicio', 'hora_fim', 'duracao_horas', 'vira_dia', 'ativo'],
    obrigatorias: ['codigo', 'nome', 'escala', 'hora_inicio', 'hora_fim', 'duracao_horas'],
    ordem: 'escala, codigo',
  },
  frotas: {
    tabela: 'frotas',
    colunas: [
      'numero',
      'descricao',
      'tipo',
      'tem_odometro',
      'tem_horimetro_motor',
      'tem_horimetro_elevador',
      'capacidade_tanque_litros',
      'consumo_esperado_litros_hora',
      'consumo_esperado_km_litro',
      'frente_id',
      'ativo',
    ],
    obrigatorias: ['numero', 'descricao', 'tipo'],
    ordem: 'numero',
  },
  veiculos: {
    tabela: 'veiculos_transporte',
    colunas: ['numero', 'tipo', 'placa', 'transportadora', 'ativo'],
    obrigatorias: ['numero', 'tipo'],
    ordem: 'tipo, numero',
  },
  lideres: {
    tabela: 'lideres',
    colunas: ['codigo', 'nome', 'funcionario_id', 'ativo'],
    obrigatorias: ['nome'],
    ordem: 'nome',
  },
  blocos: {
    tabela: 'blocos_abastecimento',
    colunas: ['numero_inicial', 'numero_final', 'funcionario_id', 'dispositivo_id', 'comboio_frota_id', 'ativo'],
    obrigatorias: ['numero_inicial', 'numero_final'],
    ordem: 'numero_inicial',
  },
  parametros: {
    tabela: 'parametros',
    colunas: ['valor'],
    obrigatorias: ['valor'],
    ordem: 'chave',
  },
}

/** Erros do banco que o escritório precisa entender, não "falha interna". */
function traduzirErroDeBanco(mensagem: string): string | null {
  if (mensagem.includes('blocos_sem_sobreposicao')) return 'FAIXA_SOBREPOSTA'
  if (mensagem.includes('blocos_faixa_valida')) return 'FAIXA_INVALIDA'
  if (/_uk\b|duplicate key/.test(mensagem)) return 'JA_EXISTE'
  if (mensagem.includes('turnos_duracao_valida')) return 'DURACAO_INVALIDA'
  if (mensagem.includes('violates foreign key')) return 'VINCULO_INEXISTENTE'
  return null
}

export async function rotasDeCadastros(app: FastifyInstance): Promise<void> {
  const exigirAdmin = (requisicao: FastifyRequest, resposta: FastifyReply): Identidade | null => {
    const identidade = requisicao.identidade
    if (!identidade) {
      void resposta.code(401).send({ erro: 'SEM_SESSAO' })
      return null
    }
    if (identidade.papel !== 'admin') {
      void resposta.code(403).send({ erro: 'SEM_PERMISSAO' })
      return null
    }
    return identidade
  }

  app.post('/painel/cadastros/listar', async (requisicao, resposta) => {
    const identidade = exigirAdmin(requisicao, resposta)
    if (!identidade) return

    const corpo = requisicao.body as { cadastro?: string }
    const definicao = CADASTROS[corpo?.cadastro ?? '']
    if (!definicao) return resposta.code(400).send({ erro: 'CADASTRO_INVALIDO' })

    return comoFuncionario(identidade, async (cliente) => {
      const { rows } = await cliente.query(
        // Identificadores vêm da definição acima, nunca do corpo da requisição.
        `select * from public.${definicao.tabela} order by ${definicao.ordem}`,
      )
      return { registros: rows }
    })
  })

  app.post('/painel/cadastros/salvar', async (requisicao, resposta) => {
    const identidade = exigirAdmin(requisicao, resposta)
    if (!identidade) return

    const corpo = requisicao.body as { cadastro?: string; id?: string; registro?: Record<string, unknown> }
    const definicao = CADASTROS[corpo?.cadastro ?? '']
    if (!definicao) return resposta.code(400).send({ erro: 'CADASTRO_INVALIDO' })

    const registro = corpo?.registro ?? {}

    // Só as colunas declaradas passam. Uma chave a mais no corpo é ignorada em
    // silêncio — o cliente não escolhe o que gravar, a definição escolhe.
    const colunas = definicao.colunas.filter((c) => c in registro)
    if (colunas.length === 0) return resposta.code(400).send({ erro: 'NADA_A_GRAVAR' })

    const faltando = definicao.obrigatorias.filter(
      (c) => !corpo.id && (registro[c] === undefined || registro[c] === null || registro[c] === ''),
    )
    if (faltando.length > 0) {
      return resposta.code(400).send({ erro: 'CAMPOS_OBRIGATORIOS', campos: faltando })
    }

    const valores = colunas.map((c) => registro[c])

    try {
      return await comoFuncionario(identidade, async (cliente) => {
        if (corpo.id) {
          const sets = colunas.map((c, i) => `${c} = $${i + 2}`).join(', ')
          const { rows } = await cliente.query(
            `update public.${definicao.tabela} set ${sets} where id = $1 returning *`,
            [corpo.id, ...valores],
          )
          if (rows.length === 0) return resposta.code(404).send({ erro: 'NAO_ENCONTRADO' })
          return { registro: rows[0] }
        }

        const marcadores = colunas.map((_, i) => `$${i + 1}`).join(', ')
        const { rows } = await cliente.query(
          `insert into public.${definicao.tabela} (id, ${colunas.join(', ')})
           values (gen_random_uuid(), ${marcadores})
           returning *`,
          valores,
        )
        return { registro: rows[0] }
      })
    } catch (erro) {
      const mensagem = erro instanceof Error ? erro.message : ''
      const traduzido = traduzirErroDeBanco(mensagem)
      if (traduzido) return resposta.code(409).send({ erro: traduzido })
      throw erro
    }
  })

  /**
   * Parâmetros usam chave textual em vez de uuid, então têm rota própria.
   * São os limiares das validações — o escritório ajusta sem deploy.
   */
  app.post('/painel/parametros/salvar', async (requisicao, resposta) => {
    const identidade = exigirAdmin(requisicao, resposta)
    if (!identidade) return

    const corpo = requisicao.body as { chave?: string; valor?: unknown }
    if (!corpo?.chave || corpo.valor === undefined) {
      return resposta.code(400).send({ erro: 'CORPO_INVALIDO' })
    }

    return comoFuncionario(identidade, async (cliente) => {
      const { rows } = await cliente.query(
        `update public.parametros set valor = $2::jsonb, atualizado_em = now()
          where chave = $1 returning chave, valor`,
        [corpo.chave, JSON.stringify(corpo.valor)],
      )
      if (rows.length === 0) return resposta.code(404).send({ erro: 'PARAMETRO_INEXISTENTE' })
      return { parametro: rows[0] }
    })
  })
}

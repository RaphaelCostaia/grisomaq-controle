import type { FastifyInstance } from 'fastify'
import { comoFuncionario } from '../banco.ts'

/**
 * As duas rotas que o app de campo realmente usa em regime.
 *
 * Elas são finas de propósito: toda a lógica de idempotência, conflito e
 * resolução de versão vive em `sync_push`/`sync_pull`, no Postgres. Duplicá-la
 * aqui criaria duas fontes de verdade que divergiriam na primeira correção.
 *
 * As chamadas passam por `comoFuncionario`, então rodam com a RLS valendo: a
 * API não consegue gravar nem ler nada que aquele funcionário não pudesse.
 */
export async function rotasDeSincronizacao(app: FastifyInstance): Promise<void> {
  app.post('/sync/push', async (requisicao, resposta) => {
    const identidade = requisicao.identidade
    if (!identidade) return resposta.code(401).send({ erro: 'SEM_SESSAO' })

    const corpo = requisicao.body as {
      operacoes?: unknown[]
      dispositivo_id?: string
      app_versao?: string
    }

    const operacoes = Array.isArray(corpo?.operacoes) ? corpo.operacoes : []
    if (operacoes.length === 0) {
      return { servidor_agora: new Date().toISOString(), resultados: [] }
    }

    // Lote grande numa máquina de 1 vCPU trava a fila de todo mundo. O cliente
    // já manda de 25 em 25; este limite é a defesa contra um cliente adulterado.
    if (operacoes.length > 100) {
      return resposta.code(413).send({ erro: 'LOTE_GRANDE' })
    }

    try {
      return await comoFuncionario(identidade, async (cliente) => {
        const { rows } = await cliente.query<{ sync_push: unknown }>(
          'select public.sync_push($1::jsonb, $2, $3) as sync_push',
          [JSON.stringify(operacoes), corpo?.dispositivo_id ?? 'desconhecido', corpo?.app_versao ?? '0.0.0'],
        )
        return rows[0]?.sync_push
      })
    } catch (erro) {
      const mensagem = erro instanceof Error ? erro.message : ''
      // O app trata este código de forma própria: para de tentar e pede
      // atualização, em vez de reenviar em laço um payload que o servidor
      // nunca vai aceitar.
      if (mensagem.includes('VERSAO_OBSOLETA')) {
        return resposta.code(426).send({ erro: 'VERSAO_OBSOLETA' })
      }
      if (mensagem.includes('SEM_IDENTIDADE')) {
        return resposta.code(401).send({ erro: 'SEM_SESSAO' })
      }
      throw erro
    }
  })

  app.post('/sync/pull', async (requisicao, resposta) => {
    const identidade = requisicao.identidade
    if (!identidade) return resposta.code(401).send({ erro: 'SEM_SESSAO' })

    const corpo = requisicao.body as { desde?: string | null }

    return comoFuncionario(identidade, async (cliente) => {
      const { rows } = await cliente.query<{ sync_pull: unknown }>(
        'select public.sync_pull($1::timestamptz) as sync_pull',
        [corpo?.desde ?? null],
      )
      return rows[0]?.sync_pull
    })
  })
}

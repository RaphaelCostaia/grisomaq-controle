import { createHash } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { comoFuncionario } from '../banco.ts'

/**
 * Anexos — hoje só a foto do horímetro no abastecimento.
 *
 * A foto entra como sistema DESACOPLADO do sync: o motor de sync trata os
 * lançamentos, e a foto tem sua própria fila e seu próprio endpoint. Duas
 * consequências desse desenho, ambas propositais:
 *
 *  - Uma falha ao enviar a foto (rede caindo no meio, arquivo corrompido)
 *    não empurra o abastecimento para "conflito". Ele sobe normalmente e a
 *    foto tenta de novo mais tarde.
 *  - O escritório vê o abastecimento antes da foto chegar — o que é o
 *    correto: os números não podem esperar por uma imagem opcional.
 */
export async function rotasDeAnexos(app: FastifyInstance): Promise<void> {
  /**
   * Upload da foto de um abastecimento. Idempotente por hash: o mesmo arquivo
   * chegando duas vezes (retransmissão em rede ruim) gera um anexo só.
   */
  app.put<{ Params: { id: string }; Body: { tipo?: string; dados?: string } }>(
    '/abastecimento/:id/foto',
    {
      // Quota específica: 30 uploads por minuto por dispositivo (chave do
      // rate-limit vem do header `x-dispositivo-id`). Uma foto por lançamento
      // e um lançamento a cada ~5 minutos no ritmo real; 30/min é folga para
      // retentativa em rede ruim sem virar canal para inundação de bytes.
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (requisicao, resposta) => {
      const identidade = requisicao.identidade
      if (!identidade) return resposta.code(401).send({ erro: 'SEM_SESSAO' })

      const { id } = requisicao.params
      const { tipo, dados } = requisicao.body ?? {}

      if (!dados || typeof dados !== 'string') {
        return resposta.code(400).send({ erro: 'DADOS_AUSENTES' })
      }
      // Só JPEG e PNG — os únicos que uma câmera de celular produz depois de
      // recomprimir. Deixar aberto convida arquivo grande de outro app.
      const tipoLimpo = tipo === 'image/png' ? 'image/png' : 'image/jpeg'

      let bytes: Buffer
      try {
        bytes = Buffer.from(dados, 'base64')
      } catch {
        return resposta.code(400).send({ erro: 'BASE64_INVALIDO' })
      }
      if (bytes.length === 0) return resposta.code(400).send({ erro: 'ARQUIVO_VAZIO' })

      // 2 MB parecem muitos para foto de horímetro; num JPEG bem comprimido é
      // folga confortável. Acima disso é bug de compressão no cliente.
      if (bytes.length > 2 * 1024 * 1024) {
        return resposta.code(413).send({ erro: 'ARQUIVO_GRANDE' })
      }

      const hash = createHash('sha256').update(bytes).digest('hex')

      return comoFuncionario(identidade, async (cliente) => {
        // Confere se o abastecimento existe e é acessível ao funcionário — RLS
        // resolve o "acessível". Sem esta checagem, o INSERT em anexos daria
        // um erro de FK que não diz nada ao operador.
        const { rowCount: existe } = await cliente.query(
          'select 1 from public.abastecimentos where id = $1 and not excluido',
          [id],
        )
        if (existe === 0) return resposta.code(404).send({ erro: 'ABASTECIMENTO_INEXISTENTE' })

        // Idempotência por hash: se já existe um anexo com esse conteúdo para
        // esta ficha, devolve o mesmo id em vez de duplicar.
        const { rows: existente } = await cliente.query<{ id: string }>(
          `select id from public.anexos
            where tabela = 'abastecimentos' and registro_id = $1 and hash_sha256 = $2
            limit 1`,
          [id, hash],
        )
        if (existente[0]) return { anexo_id: existente[0].id, duplicada: true }

        const { rows } = await cliente.query<{ id: string }>(
          `insert into public.anexos
             (id, tabela, registro_id, dados, tipo_mime, tamanho_bytes, hash_sha256, criado_por)
           values (gen_random_uuid(), 'abastecimentos', $1, $2, $3, $4, $5,
                   (select public.fn_funcionario_atual()))
           returning id`,
          [id, bytes, tipoLimpo, bytes.length, hash],
        )
        return { anexo_id: rows[0]?.id, duplicada: false }
      })
    },
  )

  /**
   * Serve a foto para o painel. Não usa `/painel/` no prefixo porque o
   * navegador pode abrir a URL direto (em uma aba nova, um `<img src>`), e
   * exigir POST-com-token no `<img>` complica a UI para nada.
   */
  app.get<{ Params: { id: string } }>('/anexos/:id/arquivo', async (requisicao, resposta) => {
    const identidade = requisicao.identidade
    if (!identidade) return resposta.code(401).send({ erro: 'SEM_SESSAO' })

    const { id } = requisicao.params

    return comoFuncionario(identidade, async (cliente) => {
      const { rows } = await cliente.query<{
        dados: Buffer
        tipo_mime: string | null
      }>('select dados, tipo_mime from public.anexos where id = $1', [id])

      const alvo = rows[0]
      if (!alvo || !alvo.dados) return resposta.code(404).send({ erro: 'ANEXO_INEXISTENTE' })

      // Cache curto: o conteúdo é imutável (hash na tabela), mas o vínculo
      // com o operador pode mudar por movimentação no cadastro.
      return resposta
        .header('content-type', alvo.tipo_mime ?? 'application/octet-stream')
        .header('cache-control', 'private, max-age=300')
        .send(alvo.dados)
    })
  })
}

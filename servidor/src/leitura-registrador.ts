import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import * as z from 'zod'
import { config } from './config.ts'

/**
 * Lê o totalizador da registradora da bomba de diesel a partir de uma foto.
 *
 * A registradora tem dois contadores: o visor LITROS (zera a cada
 * abastecimento) e o TOTAL (sete rolos, nunca zera). A ficha usa o TOTAL, e o
 * último rolo é a casa decimal: "2149114" são 214.911,4 litros.
 */
export interface LeituraRegistrador {
  valor: number | null
  confianca: 'alta' | 'media' | 'baixa'
  motivo: string | null
}

export type Leitor = (imagemBase64: string, tipoMime: 'image/jpeg' | 'image/png') => Promise<LeituraRegistrador>

const MODELO = 'claude-haiku-5-5'

/**
 * Rolos do contador TOTAL nas bombas dos comboios. A leitura com outra
 * quantidade é descartada (o comboista digita): no primeiro teste com foto
 * real, a IA devolveu 8 dígitos para um contador de 7, juntando o número
 * cortado que aparece embaixo do último rolo. Número errado no campo é pior
 * que campo vazio.
 */
const ROLOS_DO_TOTAL = 7

const Resposta = z.object({
  legivel: z.boolean(),
  rolos: z.array(z.string()),
  confianca: z.enum(['alta', 'media', 'baixa']),
  motivo: z.string().nullable(),
})

const INSTRUCAO = `A foto mostra a registradora (medidor) de uma bomba de diesel de caminhão comboio.
Ela tem dois contadores:
- LITROS: o visor grande de cima, com a quantidade do abastecimento atual. IGNORE este.
- TOTAL: o contador pequeno de baixo, com ${ROLOS_DO_TOTAL} rolos numerados lado a lado. É ESTE que você deve ler.

Leia o contador TOTAL rolo por rolo, da esquerda para a direita, e devolva em "rolos" uma lista com um item por rolo, cada item com UM único dígito (exemplo: ["2","1","4","9","1","1","4"]).
Cada rolo mostra um dígito grande no centro da janela. Os números pequenos e cortados que aparecem acima ou abaixo desse dígito são parte do giro do mesmo rolo: NÃO são rolos extras e NÃO devem entrar na lista.
Se um rolo estiver girando entre dois números, use o número que ocupa a maior parte da janela e marque a confiança como "baixa".
Se o contador TOTAL não aparecer, estiver cortado, desfocado, com reflexo forte ou ilegível, devolva legivel=false, rolos vazio e explique o motivo em uma frase curta em português.
Confiança: "alta" quando todos os rolos estão nítidos; "media" quando algum exige atenção; "baixa" quando há dúvida em algum dígito.`

let cliente: Anthropic | null = null
let leitorDeTeste: Leitor | null = null

/** Os testes injetam um leitor falso para não chamar a API de verdade. */
export function definirLeitorParaTeste(leitor: Leitor | null): void {
  leitorDeTeste = leitor
}

export function leituraDisponivel(): boolean {
  return leitorDeTeste !== null || config.anthropicApiKey !== ''
}

/**
 * ["2","1","4","9","1","1","4"] → 214911.4. Rolo com mais de um dígito, sem
 * dígito ou quantidade de rolos diferente do contador é leitura ruim.
 */
export function totalParaLitros(rolos: string[]): number | null {
  if (rolos.length !== ROLOS_DO_TOTAL) return null
  if (!rolos.every((rolo) => /^\d$/.test(rolo.trim()))) return null
  return Number(rolos.map((rolo) => rolo.trim()).join('')) / 10
}

export const lerRegistrador: Leitor = async (imagemBase64, tipoMime) => {
  if (leitorDeTeste) return leitorDeTeste(imagemBase64, tipoMime)

  cliente ??= new Anthropic({ apiKey: config.anthropicApiKey, timeout: 15_000, maxRetries: 1 })

  try {
    const resposta = await cliente.messages.parse({
      model: MODELO,
      max_tokens: 2000,
      output_config: { effort: 'low', format: zodOutputFormat(Resposta) },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: tipoMime, data: imagemBase64 } },
            { type: 'text', text: INSTRUCAO },
          ],
        },
      ],
    })

    if (resposta.stop_reason === 'refusal') {
      return { valor: null, confianca: 'baixa', motivo: 'A leitura automática recusou esta foto.' }
    }

    const saida = resposta.parsed_output
    if (!saida || !saida.legivel) {
      return { valor: null, confianca: 'baixa', motivo: saida?.motivo ?? 'Não foi possível ler a registradora.' }
    }

    const valor = totalParaLitros(saida.rolos)
    if (valor === null) {
      return { valor: null, confianca: 'baixa', motivo: 'Não consegui ler todos os rolos do contador TOTAL.' }
    }
    return { valor, confianca: saida.confianca, motivo: null }
  } catch (erro) {
    // A leitura é um atalho: qualquer falha da API vira "digite o número",
    // nunca um erro que trave a ficha.
    if (erro instanceof Anthropic.RateLimitError) {
      return { valor: null, confianca: 'baixa', motivo: 'Leitura automática ocupada. Digite o número.' }
    }
    if (erro instanceof Anthropic.APIError) {
      return { valor: null, confianca: 'baixa', motivo: 'Leitura automática indisponível (' + erro.status + ').' }
    }
    return { valor: null, confianca: 'baixa', motivo: 'Leitura automática indisponível.' }
  }
}

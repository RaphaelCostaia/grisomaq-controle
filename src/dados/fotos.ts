import { db } from './db'
import { chamar } from './api'
import { novoId } from '@/utilitarios/id'
import { blobParaBase64 } from '@/utilitarios/base64'

/**
 * Foto do horímetro — fila desacoplada do sync de lançamentos.
 *
 * A foto NÃO viaja junto com o abastecimento. O que trafega no sync são os
 * números; a imagem tem sua própria fila e seu próprio endpoint. Duas razões:
 *
 *  - Uma foto que falha (rede caindo no meio, arquivo corrompido) não pode
 *    empurrar o abastecimento para "conflito". O escritório precisa dos
 *    números antes de ver a imagem.
 *  - Fotos são pesadas em relação a JSON. Misturar as duas coisas transforma
 *    o push em requisições de 300 KB, e cada retentativa em campo custa o
 *    dobro do tempo.
 */
export type PapelFoto = 'horimetro' | 'registrador_inicio' | 'registrador_fim'

export interface FotoPendente {
  id: string
  abastecimento_id: string
  blob: Blob
  tipo: string
  /** Qual foto da ficha: horímetro ou registradora da bomba (início/fim). */
  papel: PapelFoto
  /**
   * Foto de uma ficha ainda em preenchimento. Fica guardada para sobreviver a
   * um recarregamento da tela, mas não sobe: a ficha ainda não existe no
   * servidor. Vira envio normal quando a ficha é salva.
   */
  rascunho: boolean
  criada_em: string
  tentativas: number
  proxima_tentativa_em: string
  erro: string | null
}

/** Foto de rascunho abandonada (a ficha nunca foi salva) some depois disto. */
const VALIDADE_RASCUNHO_MS = 48 * 60 * 60 * 1000

/**
 * Quantas vezes a foto tenta subir enquanto a ficha ainda não chegou ao
 * servidor. Com o backoff limitado a 15 minutos, cobre uns cinco dias sem a
 * ficha sincronizar antes de desistir.
 */
const MAX_TENTATIVAS_FICHA_AUSENTE = 20

/**
 * Comprime uma imagem para JPEG ~200 KB.
 *
 * Câmera de celular produz JPEGs de 3–5 MB. Sem compressão, cada foto encheria
 * a fila e a rede — e no fim é uma leitura de horímetro, não uma foto de
 * revista. 1600 px no lado maior mantém a leitura nítida e cabe em ~200 KB.
 */
export async function comprimirImagem(entrada: Blob, ladoMax = 1600, qualidade = 0.72): Promise<Blob> {
  const bitmap = await criarBitmap(entrada)
  try {
    const escala = Math.min(1, ladoMax / Math.max(bitmap.width, bitmap.height))
    const w = Math.round(bitmap.width * escala)
    const h = Math.round(bitmap.height * escala)

    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas indisponível neste navegador')
    ctx.drawImage(bitmap, 0, 0, w, h)

    return await new Promise<Blob>((ok, err) =>
      canvas.toBlob(
        (b) => (b ? ok(b) : err(new Error('não consegui gerar o JPEG'))),
        'image/jpeg',
        qualidade,
      ),
    )
  } finally {
    // ImageBitmap fica no heap do navegador até ser fechado explicitamente.
    if ('close' in bitmap) bitmap.close()
  }
}

async function criarBitmap(entrada: Blob): Promise<ImageBitmap | HTMLImageElement> {
  // createImageBitmap respeita a orientação EXIF; sem ela a foto de retrato
  // vira paisagem no canvas, e o horímetro fica deitado no lado errado.
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(entrada, { imageOrientation: 'from-image' } as ImageBitmapOptions)
  }
  const url = URL.createObjectURL(entrada)
  try {
    const img = new Image()
    img.src = url
    await new Promise((ok, err) => {
      img.onload = () => ok(null)
      img.onerror = () => err(new Error('falha ao carregar imagem'))
    })
    return img
  } finally {
    URL.revokeObjectURL(url)
  }
}

function fotosDe(abastecimentoId: string, papel: PapelFoto) {
  return db.foto_pendentes
    .where('abastecimento_id')
    .equals(abastecimentoId)
    .filter((f) => (f.papel ?? 'horimetro') === papel)
}

/** Enfileira uma foto. Cada abastecimento tem NO MÁXIMO UMA foto de cada papel:
 *  se o operador fotografar de novo, a anterior é descartada — o servidor usa
 *  hash para descartar duplicatas, mas essa checagem local evita a viagem
 *  inteira. */
export async function enfileirarFoto(
  abastecimentoId: string,
  blob: Blob,
  papel: PapelFoto = 'horimetro',
  opcoes: { rascunho?: boolean } = {},
): Promise<void> {
  await db.transaction('rw', db.foto_pendentes, async () => {
    await fotosDe(abastecimentoId, papel).delete()
    await db.foto_pendentes.add({
      id: novoId(),
      abastecimento_id: abastecimentoId,
      blob,
      tipo: blob.type || 'image/jpeg',
      papel,
      rascunho: opcoes.rascunho ?? false,
      criada_em: new Date().toISOString(),
      tentativas: 0,
      proxima_tentativa_em: new Date().toISOString(),
      erro: null,
    })
  })
}

export async function fotoDoAbastecimento(
  abastecimentoId: string,
  papel: PapelFoto = 'horimetro',
): Promise<Blob | null> {
  const fila = await fotosDe(abastecimentoId, papel).toArray()
  return fila[0]?.blob ?? null
}

export async function removerFoto(abastecimentoId: string, papel: PapelFoto): Promise<void> {
  await fotosDe(abastecimentoId, papel).delete()
}

/** A ficha foi salva: as fotos do rascunho passam a subir com a fila normal. */
export async function confirmarFotosDoRascunho(abastecimentoId: string): Promise<void> {
  await db.foto_pendentes
    .where('abastecimento_id')
    .equals(abastecimentoId)
    .modify({ rascunho: false, proxima_tentativa_em: new Date().toISOString() })
}

/**
 * Envia as fotos que couberem numa janela de conexão.
 *
 * Roda como parte do motor de sync (depois do push/pull), mas em bloco separado:
 * se todas as fotos falharem, o sync do ciclo em si continua "ok".
 */
export async function enviarFotosPendentes(): Promise<{ enviadas: number; falhas: number }> {
  const agora = Date.now()
  await db.foto_pendentes
    .filter((f) => f.rascunho === true && agora - new Date(f.criada_em).getTime() > VALIDADE_RASCUNHO_MS)
    .delete()

  const pendentes = await db.foto_pendentes
    .filter((f) => !f.rascunho && new Date(f.proxima_tentativa_em).getTime() <= agora)
    .limit(5)
    .toArray()

  let enviadas = 0
  let falhas = 0

  for (const foto of pendentes) {
    try {
      const base64 = await blobParaBase64(foto.blob)
      await chamar<{ anexo_id: string }>('/abastecimento/' + foto.abastecimento_id + '/foto', {
        metodo: 'PUT',
        corpo: { tipo: foto.tipo, dados: base64, papel: foto.papel ?? 'horimetro' },
      })
      await db.foto_pendentes.delete(foto.id)
      enviadas += 1
    } catch (erro) {
      falhas += 1
      const mensagem = erro instanceof Error ? erro.message : String(erro)
      // Arquivo ruim não melhora com retentativa. Já "abastecimento
      // inexistente" quase sempre é a ficha que ainda não subiu neste ciclo
      // (conflito, rede caindo no meio): apagar a foto aqui perderia a prova.
      // Ela espera a ficha chegar, e só desiste depois de muitas tentativas.
      const fichaAusente = /ABASTECIMENTO_INEXISTENTE/.test(mensagem)
      const permanente =
        /ARQUIVO_GRANDE|BASE64_INVALIDO|PAPEL_INVALIDO/.test(mensagem) ||
        (fichaAusente && foto.tentativas + 1 >= MAX_TENTATIVAS_FICHA_AUSENTE)

      if (permanente) {
        await db.foto_pendentes.delete(foto.id)
      } else {
        const tentativas = foto.tentativas + 1
        const espera = Math.min(2 ** tentativas * 5, 15 * 60) * 1000
        await db.foto_pendentes.update(foto.id, {
          tentativas,
          erro: mensagem.slice(0, 200),
          proxima_tentativa_em: new Date(Date.now() + espera).toISOString(),
        })
      }
    }
  }

  return { enviadas, falhas }
}

export async function fotosPendentesDoDispositivo(): Promise<number> {
  return db.foto_pendentes.filter((f) => !f.rascunho).count()
}

export interface LeituraRegistrador {
  valor: number | null
  confianca: 'alta' | 'media' | 'baixa'
  motivo: string | null
}

/**
 * Pede ao servidor a leitura do totalizador na foto da registradora. Só serve
 * com sinal; quem chama trata qualquer erro como "digite o número".
 */
export async function lerRegistradorNaFoto(blob: Blob): Promise<LeituraRegistrador> {
  return chamar<LeituraRegistrador>('/abastecimento/ler-registrador', {
    corpo: { tipo: blob.type || 'image/jpeg', dados: await blobParaBase64(blob) },
    timeoutMs: 20_000,
  })
}

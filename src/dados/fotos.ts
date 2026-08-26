import { db } from './db'
import { chamar } from './api'
import { novoId } from '@/utilitarios/id'

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
export interface FotoPendente {
  id: string
  abastecimento_id: string
  blob: Blob
  tipo: string
  criada_em: string
  tentativas: number
  proxima_tentativa_em: string
  erro: string | null
}

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

/** Enfileira uma foto para envio. Cada abastecimento tem NO MÁXIMO UMA foto
 *  pendente: se o operador fotografar de novo, a anterior é descartada — o
 *  servidor usa hash para descartar duplicatas, mas essa checagem local evita
 *  a viagem inteira. */
export async function enfileirarFoto(abastecimentoId: string, blob: Blob): Promise<void> {
  await db.transaction('rw', db.foto_pendentes, async () => {
    await db.foto_pendentes.where('abastecimento_id').equals(abastecimentoId).delete()
    await db.foto_pendentes.add({
      id: novoId(),
      abastecimento_id: abastecimentoId,
      blob,
      tipo: blob.type || 'image/jpeg',
      criada_em: new Date().toISOString(),
      tentativas: 0,
      proxima_tentativa_em: new Date().toISOString(),
      erro: null,
    })
  })
}

export async function fotoDoAbastecimento(abastecimentoId: string): Promise<Blob | null> {
  const fila = await db.foto_pendentes.where('abastecimento_id').equals(abastecimentoId).toArray()
  return fila[0]?.blob ?? null
}

/**
 * Envia as fotos que couberem numa janela de conexão.
 *
 * Roda como parte do motor de sync (depois do push/pull), mas em bloco separado:
 * se todas as fotos falharem, o sync do ciclo em si continua "ok".
 */
export async function enviarFotosPendentes(): Promise<{ enviadas: number; falhas: number }> {
  const agora = Date.now()
  const pendentes = await db.foto_pendentes
    .filter((f) => new Date(f.proxima_tentativa_em).getTime() <= agora)
    .limit(5)
    .toArray()

  let enviadas = 0
  let falhas = 0

  for (const foto of pendentes) {
    try {
      const base64 = await blobParaBase64(foto.blob)
      await chamar<{ anexo_id: string }>('/abastecimento/' + foto.abastecimento_id + '/foto', {
        metodo: 'PUT',
        corpo: { tipo: foto.tipo, dados: base64 },
      })
      await db.foto_pendentes.delete(foto.id)
      enviadas += 1
    } catch (erro) {
      falhas += 1
      // Erros do próprio negócio (404 no abastecimento) não vão embora com
      // retentativa; expulsa da fila e registra para o escritório ver.
      const mensagem = erro instanceof Error ? erro.message : String(erro)
      const permanente = /ABASTECIMENTO_INEXISTENTE|ARQUIVO_GRANDE|BASE64_INVALIDO/.test(mensagem)

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

async function blobParaBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer()
  // btoa não aceita string com caracteres > 0xFF; monta em pedaços para não
  // estourar a pilha em arquivos maiores.
  const bytes = new Uint8Array(buf)
  const CHUNK = 0x8000
  let binario = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binario += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binario)
}

export async function fotosPendentesDoDispositivo(): Promise<number> {
  return db.foto_pendentes.count()
}

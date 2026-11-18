export async function blobParaBase64(blob: Blob): Promise<string> {
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

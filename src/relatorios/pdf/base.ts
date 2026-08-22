import type { Content, StyleDictionary, TDocumentDefinitions } from 'pdfmake/interfaces'

/**
 * Base dos PDFs.
 *
 * O PDF existe para o que o Excel não faz bem: ser arquivado e enviado como
 * documento. É a via que substitui o papel carbonado no arquivo do escritório,
 * então ela declara na cara o que é e de onde veio.
 */

export const VERDE_ESCURO = '#1F362C'
export const VERDE_CABECALHO = '#648838'
export const CARMIM = '#C8102E'
export const CINZA = '#56605A'
export const BORDA = '#B8C2BC'

export const estilos: StyleDictionary = {
  marca: { fontSize: 16, bold: true, color: VERDE_ESCURO },
  marcaLinha: { fontSize: 6, bold: true, color: CINZA, characterSpacing: 2 },
  titulo: { fontSize: 13, bold: true, color: '#FFFFFF', alignment: 'center' },
  numeroDocumento: { fontSize: 14, bold: true, color: CARMIM, alignment: 'right' },
  rotulo: { fontSize: 7, bold: true, color: CINZA, characterSpacing: 0.8 },
  valor: { fontSize: 9 },
  cabecalhoTabela: { fontSize: 7, bold: true, color: '#FFFFFF', alignment: 'center' },
  celula: { fontSize: 8 },
  celulaNumero: { fontSize: 8, alignment: 'right' },
  celulaDestaque: { fontSize: 8, alignment: 'right', bold: true, color: CARMIM },
  total: { fontSize: 9, bold: true },
  rodape: { fontSize: 6.5, color: CINZA, italics: true },
}

/** Cabeçalho com a marca à esquerda e o título em faixa, como na ficha impressa. */
export function cabecalho(titulo: string, complemento?: string): Content[] {
  return [
    {
      columns: [
        {
          width: 'auto',
          stack: [
            { text: 'GrisoMaq', style: 'marca' },
            { text: 'SERVIÇOS AGRÍCOLAS', style: 'marcaLinha', margin: [1, 1, 0, 0] },
          ],
        },
        { width: '*', text: '' },
        complemento
          ? { width: 'auto', text: complemento, style: 'numeroDocumento', margin: [0, 6, 0, 0] }
          : { width: 'auto', text: '' },
      ],
      margin: [0, 0, 0, 8],
    },
    {
      table: { widths: ['*'], body: [[{ text: titulo, style: 'titulo', fillColor: VERDE_ESCURO, margin: [0, 5, 0, 5] }]] },
      layout: 'noBorders',
      margin: [0, 0, 0, 10],
    },
  ]
}

/**
 * Rodapé de documento eletrônico, em toda página.
 *
 * Quem recebe precisa saber que aquilo saiu de um sistema, quando, e de qual
 * versão — sem isso o PDF seria indistinguível de um documento montado à mão.
 */
export function rodape(versaoApp: string) {
  return (paginaAtual: number, total: number): Content => ({
    columns: [
      {
        width: '*',
        text:
          'Documento gerado eletronicamente pelo GRISOMAQ CONTROLE v' +
          versaoApp +
          ' em ' +
          new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) +
          '. As assinaturas foram registradas por PIN, com trilha de auditoria no sistema.',
        style: 'rodape',
      },
      { width: 'auto', text: paginaAtual + '/' + total, style: 'rodape' },
    ],
    margin: [32, 8, 32, 0],
  })
}

/** Linha de rótulo e valor do cabeçalho do documento. */
export function campo(rotulo: string, valor: string): Content {
  return {
    stack: [
      { text: rotulo.toUpperCase(), style: 'rotulo' },
      { text: valor || '—', style: 'valor', margin: [0, 1, 0, 0] },
    ],
  }
}

/** Traço fino e recessivo: a grade não compete com o número. */
export const layoutGrade = {
  hLineWidth: () => 0.5,
  vLineWidth: () => 0.5,
  hLineColor: () => BORDA,
  vLineColor: () => BORDA,
  paddingTop: () => 3,
  paddingBottom: () => 3,
}

export function documentoBase(
  conteudo: Content[],
  versaoApp: string,
  paisagem = false,
): TDocumentDefinitions {
  return {
    pageSize: 'A4',
    pageOrientation: paisagem ? 'landscape' : 'portrait',
    pageMargins: [32, 32, 32, 40],
    content: conteudo,
    styles: estilos,
    defaultStyle: { fontSize: 9 },
    footer: rodape(versaoApp),
  }
}

/**
 * O pdfmake não tem tipos estáveis para o registro das fontes virtuais, e a
 * forma de registrá-las mudou entre versões: até a 0.2 era atribuir `.vfs`, da
 * 0.3 em diante é `addVirtualFileSystem`. Atribuir `.vfs` numa 0.3 não levanta
 * erro — simplesmente não registra nada, e a falha só aparece na geração, com
 * "Roboto-Medium.ttf not found".
 *
 * Por isso as duas formas ficam declaradas, e o código usa a que existir.
 */
interface PdfMake {
  vfs?: unknown
  addVirtualFileSystem?: (vfs: Record<string, string>) => void
  createPdf(definicao: TDocumentDefinitions): {
    // Até a 0.2 `getBlob` recebia callback; da 0.3 em diante devolve Promise.
    // Passar callback para a versão nova não dá erro: a Promise simplesmente
    // nunca chama de volta, e a geração fica pendurada para sempre.
    getBlob(retorno?: (blob: Blob) => void): Promise<Blob> | void
  }
}

/**
 * Gera o Blob do PDF.
 *
 * O pdfmake e as fontes entram por `import()` dinâmico: são centenas de kB que
 * não podem pesar no carregamento de um app que precisa abrir rápido em 3G.
 */
export async function gerarPdf(definicao: TDocumentDefinitions): Promise<Blob> {
  const [moduloPdf, moduloFontes] = await Promise.all([
    import('pdfmake/build/pdfmake'),
    import('pdfmake/build/vfs_fonts'),
  ])

  const pdfMake = ((moduloPdf as { default?: unknown }).default ?? moduloPdf) as PdfMake

  // O módulo de fontes exporta o mapa `nome do arquivo -> base64` direto; em
  // versões antigas ele vinha aninhado sob `.vfs`.
  const modulo = moduloFontes as unknown as { default?: { vfs?: unknown }; vfs?: unknown }
  const vfs = (modulo.default?.vfs ?? modulo.vfs ?? modulo.default ?? modulo) as Record<string, string>

  if (typeof pdfMake.addVirtualFileSystem === 'function') {
    pdfMake.addVirtualFileSystem(vfs)
  } else {
    pdfMake.vfs = vfs
  }

  const documento = pdfMake.createPdf(definicao)

  return new Promise<Blob>((resolver, rejeitar) => {
    try {
      const talvezPromessa = documento.getBlob((blob) => resolver(blob))
      // Na 0.3 o retorno é a própria Promise, e o callback é ignorado.
      if (talvezPromessa && typeof (talvezPromessa as Promise<Blob>).then === 'function') {
        void (talvezPromessa as Promise<Blob>).then(resolver, rejeitar)
      }
    } catch (erro) {
      rejeitar(erro instanceof Error ? erro : new Error(String(erro)))
    }
  })
}

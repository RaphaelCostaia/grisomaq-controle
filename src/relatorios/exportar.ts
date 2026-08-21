import { db } from '@/dados/db'
import { ciclosConcluidosDoDia, ciclosAbertos } from '@/dados/repositorios/caminhoes'
import { itensDoApontamento } from '@/dados/repositorios/apontamentos'
import type { AssinaturaAceite } from '@/dominio/tipos'
import type { CabecalhoApontamento, LinhaAbastecimento, LinhaApontamento, LinhaCaminhao } from './tipos'
import { dataBr, dataHoraBr, hojeOperacional, horaDe } from '@/utilitarios/datas'
import { versaoDoApp } from '@/utilitarios/dispositivo'

/**
 * Geração dos relatórios a partir do que está no celular.
 *
 * O escritório também exporta pelo painel, mas poder gerar em campo resolve um
 * problema real de sinal intermitente: o responsável fecha o turno na frente de
 * colheita e manda a ficha por WhatsApp na mesma hora, sem esperar a fila subir.
 *
 * O ExcelJS entra por `import()` dinâmico: são centenas de kB que não podem
 * pesar no carregamento de um app que precisa abrir rápido em 3G.
 */

async function novoWorkbook() {
  const ExcelJS = (await import('exceljs')).default
  return new ExcelJS.Workbook()
}

const opcoes = (periodo?: string) => ({ versaoApp: versaoDoApp, ...(periodo ? { periodo } : {}) })

/**
 * Texto que ocupa a coluna de assinatura no lugar da rubrica a caneta.
 *
 * Vem da trilha de aceite, e não da data de criação do lançamento: o que o
 * documento precisa declarar é quando a pessoa confirmou, não quando a linha
 * foi digitada. Quando a revalidação no servidor ainda não aconteceu, isso é
 * dito — uma assinatura só conferida no celular vale menos, e omitir a
 * diferença seria afirmar mais do que se sabe.
 */
function textoAssinatura(assinatura: AssinaturaAceite | undefined): string {
  if (!assinatura) return 'Pendente'

  const quando = dataHoraBr(new Date(assinatura.momento_dispositivo))
  const aparelho = (assinatura.dispositivo_id ?? '').slice(0, 4).toUpperCase()
  const base = 'Assinado por PIN — ' + quando + (aparelho ? ' — disp. ' + aparelho : '')

  if (assinatura.validacao_pin === 'invalida') return base + ' — ASSINATURA CONTESTADA'
  if (assinatura.validacao_pin !== 'validado_servidor') return base + ' — aguardando conferência'
  return base
}

/** Assinaturas de um conjunto de documentos, indexadas pelo id do documento. */
async function assinaturasPorDocumento(
  tipo: AssinaturaAceite['tipo_documento'],
  ids: string[],
): Promise<Map<string, AssinaturaAceite>> {
  const todas = await db.assinaturas_aceite.toArray()
  const alvo = new Set(ids)
  const mapa = new Map<string, AssinaturaAceite>()
  for (const a of todas) {
    if (a.tipo_documento === tipo && alvo.has(a.documento_id)) mapa.set(a.documento_id, a)
  }
  return mapa
}

// --- Ficha 1 -----------------------------------------------------------------

export async function linhasDeCaminhoes(data = hojeOperacional()): Promise<LinhaCaminhao[]> {
  const [concluidos, abertos, veiculos, fazendas, lideres] = await Promise.all([
    ciclosConcluidosDoDia(data),
    ciclosAbertos(),
    db.mestre_veiculos.toArray(),
    db.mestre_fazendas.toArray(),
    db.mestre_lideres.toArray(),
  ])

  const numeroDe = (id: string | null) => veiculos.find((v) => v.id === id)?.numero ?? null

  // Os ciclos ainda abertos entram no relatório com a saída em branco. Omiti-los
  // faria a contagem do dia bater menos que a realidade do pátio.
  const todos = [...concluidos, ...abertos.filter((c) => c.data === data)].sort((a, b) =>
    a.chegada_em.localeCompare(b.chegada_em),
  )

  return todos.map((c) => ({
    data: c.data,
    fazenda_codigo: fazendas.find((f) => f.id === c.fazenda_id)?.codigo ?? null,
    caminhao_numero: numeroDe(c.caminhao_id) ?? '—',
    carreta1_numero: numeroDe(c.carreta1_id),
    carreta2_numero: numeroDe(c.carreta2_id),
    chegada: horaDe(new Date(c.chegada_em)),
    saida: c.saida_em ? horaDe(new Date(c.saida_em)) : null,
    permanencia_minutos: c.saida_em
      ? Math.round((new Date(c.saida_em).getTime() - new Date(c.chegada_em).getTime()) / 60_000)
      : null,
    lider_nome: lideres.find((l) => l.id === c.lider_id)?.nome ?? c.lider_nome_livre,
  }))
}

export async function exportarCaminhoes(data = hojeOperacional()): Promise<Blob> {
  const [wb, linhas, { montarFichaCaminhoes }] = await Promise.all([
    novoWorkbook(),
    linhasDeCaminhoes(data),
    import('./excel/ficha1-caminhoes'),
  ])
  montarFichaCaminhoes(wb, linhas, { ...opcoes(dataBr(data)), safra: data.slice(0, 4) })
  return paraBlob(wb)
}

// --- Ficha 2 -----------------------------------------------------------------

export async function dadosDoApontamento(
  apontamentoId: string,
): Promise<{ cabecalho: CabecalhoApontamento; linhas: LinhaApontamento[] } | null> {
  const ficha = await db.apontamentos.get(apontamentoId)
  if (!ficha) return null

  const [itens, funcionarios, frotas, frentes, turnos] = await Promise.all([
    itensDoApontamento(apontamentoId),
    db.mestre_funcionarios.toArray(),
    db.mestre_frotas.toArray(),
    db.mestre_frentes.toArray(),
    db.mestre_turnos.toArray(),
  ])

  const assinaturas = await assinaturasPorDocumento('apontamento_item', itens.map((i) => i.id))

  return {
    cabecalho: {
      data: ficha.data,
      frente: frentes.find((f) => f.id === ficha.frente_id)?.nome ?? '—',
      turno: turnos.find((t) => t.id === ficha.turno_id)?.nome ?? '—',
      responsavel: funcionarios.find((f) => f.id === ficha.responsavel_funcionario_id)?.nome ?? '—',
      observacao: ficha.observacao,
    },
    linhas: itens.map((i) => {
      const funcionario = funcionarios.find((f) => f.id === i.funcionario_id)
      return {
        seq: i.seq,
        funcionario_codigo: funcionario?.codigo ?? '—',
        funcionario_nome: funcionario?.nome ?? '—',
        frota_numero: frotas.find((f) => f.id === i.frota_id)?.numero ?? '—',
        odometro_inicial: i.odometro_inicial,
        elevador_inicial: i.elevador_inicial,
        odometro_final: i.odometro_final,
        elevador_final: i.elevador_final,
        assinatura: textoAssinatura(assinaturas.get(i.id)),
      }
    }),
  }
}

export async function exportarApontamento(apontamentoId: string): Promise<Blob | null> {
  const dados = await dadosDoApontamento(apontamentoId)
  if (!dados) return null

  const [wb, { montarFichaApontamento }] = await Promise.all([
    novoWorkbook(),
    import('./excel/ficha2-apontamento'),
  ])
  montarFichaApontamento(wb, dados.cabecalho, dados.linhas, opcoes())
  return paraBlob(wb)
}

// --- Ficha 3 -----------------------------------------------------------------

export async function linhasDeAbastecimento(data = hojeOperacional()): Promise<LinhaAbastecimento[]> {
  const [lancamentos, frotas] = await Promise.all([
    db.abastecimentos.where('data').equals(data).toArray(),
    db.mestre_frotas.toArray(),
  ])

  const validos = lancamentos.filter((a) => !a.excluido).sort((a, b) => a.numero_documento - b.numero_documento)
  const assinaturas = await assinaturasPorDocumento('abastecimento', validos.map((a) => a.id))

  return validos
    .map((a) => ({
      numero_documento: a.numero_documento,
      hora: a.hora,
      data: a.data,
      frota_numero: frotas.find((f) => f.id === a.frota_id)?.numero ?? '—',
      horimetro_motor: a.horimetro_motor,
      horimetro_elevador: a.horimetro_elevador,
      odometro: a.odometro,
      registrador_inicio: a.registrador_inicio,
      registrador_fim: a.registrador_fim,
      litros: a.litros,
      divergencia: Number((a.litros - (a.registrador_fim - a.registrador_inicio)).toFixed(2)),
      assinatura: textoAssinatura(assinaturas.get(a.id)),
    }))
}

export async function exportarAbastecimento(data = hojeOperacional()): Promise<Blob> {
  const [wb, linhas, { montarFichaAbastecimento }] = await Promise.all([
    novoWorkbook(),
    linhasDeAbastecimento(data),
    import('./excel/ficha3-abastecimento'),
  ])
  montarFichaAbastecimento(wb, linhas, opcoes(dataBr(data)))
  return paraBlob(wb)
}

// --- Entrega -----------------------------------------------------------------

async function paraBlob(wb: { xlsx: { writeBuffer(): Promise<ArrayBuffer> } }): Promise<Blob> {
  const buffer = await wb.xlsx.writeBuffer()
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

/**
 * Entrega o arquivo pelo caminho que faz sentido no aparelho.
 *
 * No celular, compartilhar é o gesto real: o responsável manda a ficha por
 * WhatsApp para o escritório. O download é o caminho do desktop e o plano B
 * quando o compartilhamento não está disponível.
 */
export async function entregarArquivo(blob: Blob, nome: string): Promise<'compartilhado' | 'baixado'> {
  const arquivo = new File([blob], nome, { type: blob.type })

  if (navigator.canShare?.({ files: [arquivo] })) {
    try {
      await navigator.share({ files: [arquivo], title: nome })
      return 'compartilhado'
    } catch {
      // Compartilhamento cancelado ou indisponível: cai para o download.
    }
  }

  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = nome
  link.click()
  URL.revokeObjectURL(url)
  return 'baixado'
}

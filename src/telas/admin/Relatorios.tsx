import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Download, FileText, Search } from 'lucide-react'
import { carregarLancamentos } from '@/dados/painel'
import { CabecalhoPainel } from '@/componentes/layout/LayoutAdmin'
import { Botao } from '@/componentes/ui/Botao'
import { entregarArquivo } from '@/relatorios/exportar'
import type { LinhaAbastecimento, LinhaCaminhao } from '@/relatorios/tipos'
import { dataBr, duracaoCurta, hojeOperacional, horaDe, somarDias } from '@/utilitarios/datas'
import { formatarLeitura, formatarLitros } from '@/utilitarios/numeros'
import { versaoDoApp } from '@/utilitarios/dispositivo'
import { cls } from '@/utilitarios/classes'

type Linha = Record<string, unknown>

interface Coluna {
  chave: string
  rotulo: string
  formatar?: (linha: Linha) => string
  numerico?: boolean
  /** Destaca a célula quando ela merece conferência. */
  alerta?: (linha: Linha) => boolean
}

interface Ficha {
  chave: string
  titulo: string
  descricao: string
  colunas: Coluna[]
}

const texto = (l: Linha, c: string) => (l[c] === null || l[c] === undefined ? '—' : String(l[c]))
const numero = (l: Linha, c: string) => (l[c] === null || l[c] === undefined ? null : Number(l[c]))

const FICHAS: Ficha[] = [
  {
    chave: 'abastecimentos',
    titulo: 'Abastecimento',
    descricao: 'A diferença destacada é a que denuncia diesel saindo sem lançamento.',
    colunas: [
      { chave: 'numero_documento', rotulo: 'Nº ficha', numerico: true },
      { chave: 'data', rotulo: 'Data', formatar: (l) => dataBr(String(l.data)) },
      { chave: 'hora', rotulo: 'Hora', formatar: (l) => String(l.hora).slice(0, 5) },
      { chave: 'frota_numero', rotulo: 'Frota' },
      { chave: 'horimetro_motor', rotulo: 'Horím. motor', numerico: true, formatar: (l) => formatarLeitura(numero(l, 'horimetro_motor')) },
      { chave: 'registrador_inicio', rotulo: 'Início reg.', numerico: true, formatar: (l) => formatarLeitura(numero(l, 'registrador_inicio')) },
      { chave: 'registrador_fim', rotulo: 'Final reg.', numerico: true, formatar: (l) => formatarLeitura(numero(l, 'registrador_fim')) },
      { chave: 'litros', rotulo: 'Litros', numerico: true, formatar: (l) => formatarLitros(numero(l, 'litros')) },
      {
        chave: 'divergencia_litros',
        rotulo: 'Diferença',
        numerico: true,
        formatar: (l) => formatarLitros(numero(l, 'divergencia_litros') ?? 0),
        alerta: (l) => Math.abs(numero(l, 'divergencia_litros') ?? 0) > 0.5,
      },
    ],
  },
  {
    chave: 'caminhoes',
    titulo: 'Caminhões',
    descricao: 'A permanência é o número que a planilha nunca pôde mostrar.',
    colunas: [
      { chave: 'data', rotulo: 'Data', formatar: (l) => dataBr(String(l.data)) },
      { chave: 'fazenda_codigo', rotulo: 'Fazenda' },
      { chave: 'caminhao_numero', rotulo: 'Caminhão' },
      { chave: 'chegada_em', rotulo: 'Chegada', formatar: (l) => horaDe(new Date(String(l.chegada_em))) },
      {
        chave: 'saida_em',
        rotulo: 'Saída',
        formatar: (l) => (l.saida_em ? horaDe(new Date(String(l.saida_em))) : 'no campo'),
      },
      {
        chave: 'permanencia_minutos',
        rotulo: 'Permanência',
        numerico: true,
        formatar: (l) => (l.permanencia_minutos === null ? '—' : duracaoCurta(Number(l.permanencia_minutos))),
      },
      { chave: 'lider_nome', rotulo: 'Líder' },
    ],
  },
  {
    chave: 'apontamentos',
    titulo: 'Apontamento',
    descricao: 'Uma linha por ficha de turno.',
    colunas: [
      { chave: 'data', rotulo: 'Data', formatar: (l) => dataBr(String(l.data)) },
      { chave: 'frente_nome', rotulo: 'Frente' },
      { chave: 'turno_nome', rotulo: 'Turno' },
      { chave: 'itens', rotulo: 'Funcionários', numerico: true },
      {
        chave: 'status',
        rotulo: 'Situação',
        formatar: (l) => (l.status === 'rascunho' ? 'Aberta' : l.status === 'travado' ? 'Travada' : 'Fechada'),
      },
    ],
  },
]

export function Relatorios() {
  const [ficha, setFicha] = useState(FICHAS[0]!)
  const [de, setDe] = useState(() => somarDias(hojeOperacional(), -30))
  const [ate, setAte] = useState(() => hojeOperacional())
  const [linhas, setLinhas] = useState<Linha[] | null>(null)
  const [buscando, setBuscando] = useState(false)
  const [exportando, setExportando] = useState(false)

  const buscar = useCallback(async () => {
    setBuscando(true)
    try {
      setLinhas(await carregarLancamentos(ficha.chave, de, ate))
    } catch (erro) {
      toast.error(erro instanceof Error ? erro.message : 'Falha na consulta.')
      setLinhas([])
    } finally {
      setBuscando(false)
    }
  }, [ficha.chave, de, ate])

  useEffect(() => {
    void buscar()
  }, [buscar])

  /**
   * Exporta no layout da ficha de papel.
   *
   * Os montadores de planilha são os mesmos que o celular usa — eles recebem
   * linhas já desnormalizadas e não sabem de onde vieram. É o que evita ter dois
   * layouts que divergem na primeira correção.
   */
  async function exportar(formato: 'excel' | 'pdf') {
    if (!linhas || linhas.length === 0) return
    setExportando(true)
    try {
      const periodo = dataBr(de) + ' a ' + dataBr(ate)
      const opcoes = { versaoApp: versaoDoApp, periodo }
      const nome = ficha.titulo.toUpperCase() + ' ' + de + ' a ' + ate

      if (ficha.chave === 'apontamentos') {
        // O layout do apontamento é de 25 linhas por documento, não por
        // período. Gerar um consolidado aqui produziria algo que não é a ficha.
        toast.error('A ficha de apontamento é exportada uma a uma, pela tela do turno.')
        return
      }

      if (formato === 'pdf') {
        if (ficha.chave !== 'abastecimentos') {
          toast.error('Por enquanto só o abastecimento sai em PDF por período.')
          return
        }
        const [{ montarPdfAbastecimento }, { gerarPdf }] = await Promise.all([
          import('@/relatorios/pdf/ficha3-abastecimento'),
          import('@/relatorios/pdf/base'),
        ])
        const blob = await gerarPdf(montarPdfAbastecimento(linhas.map(paraLinhaAbastecimento), opcoes))
        await entregarArquivo(blob, nome + '.pdf')
        toast.success('PDF gerado.')
        return
      }

      const ExcelJS = (await import('exceljs')).default
      const wb = new ExcelJS.Workbook()

      if (ficha.chave === 'abastecimentos') {
        const { montarFichaAbastecimento } = await import('@/relatorios/excel/ficha3-abastecimento')
        montarFichaAbastecimento(wb, linhas.map(paraLinhaAbastecimento), opcoes)
      } else {
        const { montarFichaCaminhoes } = await import('@/relatorios/excel/ficha1-caminhoes')
        montarFichaCaminhoes(wb, linhas.map(paraLinhaCaminhao), { ...opcoes, safra: de.slice(0, 4) })
      }

      const buffer = await wb.xlsx.writeBuffer()
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      await entregarArquivo(blob, nome + '.xlsx')
      toast.success('Planilha gerada.')
    } catch (erro) {
      toast.error(erro instanceof Error ? erro.message : 'Não foi possível gerar.')
    } finally {
      setExportando(false)
    }
  }

  return (
    <>
      <CabecalhoPainel titulo="Relatórios" descricao="Consulta por período e exportação no layout das fichas." />

      <div className="p-8">
        <div className="mb-5 flex flex-wrap items-end gap-3 border-2 border-[var(--cor-borda-forte)] bg-[var(--cor-fundo)] px-4 py-3.5">
          <label className="block">
            <span className="rotulo-campo">Ficha</span>
            <select
              value={ficha.chave}
              onChange={(e) => setFicha(FICHAS.find((f) => f.chave === e.target.value)!)}
              className={filtro}
            >
              {FICHAS.map((f) => (
                <option key={f.chave} value={f.chave}>
                  {f.titulo}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="rotulo-campo">De</span>
            <input type="date" value={de} onChange={(e) => setDe(e.target.value)} className={filtro} />
          </label>

          <label className="block">
            <span className="rotulo-campo">Até</span>
            <input type="date" value={ate} onChange={(e) => setAte(e.target.value)} className={filtro} />
          </label>

          <Botao onClick={() => void buscar()} disabled={buscando} icone={<Search aria-hidden className="size-4" />}>
            {buscando ? 'Buscando…' : 'Buscar'}
          </Botao>

          <Botao
            variante="secundaria"
            onClick={() => void exportar('excel')}
            disabled={exportando || !linhas || linhas.length === 0}
            icone={<Download aria-hidden className="size-4" />}
          >
            {exportando ? 'Gerando…' : 'Planilha'}
          </Botao>

          <Botao
            variante="secundaria"
            onClick={() => void exportar('pdf')}
            disabled={exportando || !linhas || linhas.length === 0}
            icone={<FileText aria-hidden className="size-4" />}
          >
            PDF
          </Botao>
        </div>

        <p className="mb-3 text-sm text-[var(--cor-texto-suave)]">{ficha.descricao}</p>

        {linhas === null ? (
          <p className="text-sm text-[var(--cor-texto-suave)]">Carregando…</p>
        ) : linhas.length === 0 ? (
          <p className="border-2 border-[var(--cor-borda)] bg-[var(--cor-fundo)] px-4 py-4 text-sm text-[var(--cor-texto-suave)]">
            Nenhum lançamento neste período.
          </p>
        ) : (
          <>
            <p className="mb-2 text-sm font-semibold">
              {linhas.length === 1 ? '1 lançamento' : linhas.length + ' lançamentos'}
            </p>
            <div className="overflow-x-auto border-2 border-[var(--cor-borda-forte)]">
              <table className="w-full bg-[var(--cor-fundo)] text-sm">
                <thead>
                  <tr className="border-b-2 border-[var(--cor-borda-forte)] bg-[var(--cor-superficie)] text-left">
                    {ficha.colunas.map((c) => (
                      <th
                        key={c.chave}
                        className={cls(
                          'px-3 py-2.5 text-[0.6875rem] font-bold tracking-[0.1em] text-[var(--cor-texto-suave)] uppercase whitespace-nowrap',
                          c.numerico && 'text-right',
                        )}
                      >
                        {c.rotulo}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {linhas.map((l, i) => (
                    <tr key={String(l.id ?? i)} className="border-b border-[var(--cor-borda)]">
                      {ficha.colunas.map((c) => {
                        const emAlerta = c.alerta?.(l) ?? false
                        return (
                          <td
                            key={c.chave}
                            className={cls(
                              'px-3 py-2.5 whitespace-nowrap',
                              c.numerico && 'numerico text-right',
                              emAlerta && 'bg-carbono-50 font-bold text-carbono-700',
                            )}
                          >
                            {c.formatar ? c.formatar(l) : texto(l, c.chave)}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </>
  )
}

const filtro =
  'mt-1 block border-2 border-[var(--cor-borda-forte)] bg-white px-3 py-2 text-sm outline-none focus:border-marca-600'

function paraLinhaAbastecimento(l: Linha): LinhaAbastecimento {
  return {
    numero_documento: Number(l.numero_documento),
    hora: String(l.hora).slice(0, 5),
    data: String(l.data).slice(0, 10),
    frota_numero: String(l.frota_numero ?? '—'),
    horimetro_motor: numero(l, 'horimetro_motor'),
    horimetro_elevador: numero(l, 'horimetro_elevador'),
    odometro: numero(l, 'odometro'),
    registrador_inicio: numero(l, 'registrador_inicio') ?? 0,
    registrador_fim: numero(l, 'registrador_fim') ?? 0,
    litros: numero(l, 'litros') ?? 0,
    divergencia: numero(l, 'divergencia_litros') ?? 0,
    // O painel exporta o consolidado do período; a trilha de assinatura de cada
    // ficha fica na exportação individual, feita pelo celular que a assinou.
    assinatura: l.status === 'travado' ? 'Período fechado' : 'Assinado por PIN no aplicativo',
  }
}

function paraLinhaCaminhao(l: Linha): LinhaCaminhao {
  return {
    data: String(l.data).slice(0, 10),
    fazenda_codigo: l.fazenda_codigo ? String(l.fazenda_codigo) : null,
    caminhao_numero: String(l.caminhao_numero ?? '—'),
    carreta1_numero: null,
    carreta2_numero: null,
    chegada: horaDe(new Date(String(l.chegada_em))),
    saida: l.saida_em ? horaDe(new Date(String(l.saida_em))) : null,
    permanencia_minutos: l.permanencia_minutos === null ? null : Number(l.permanencia_minutos),
    lider_nome: l.lider_nome ? String(l.lider_nome) : null,
  }
}

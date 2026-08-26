import { chamar } from './api'

/**
 * Acesso do painel do escritório.
 *
 * Diferente do app de campo, aqui NÃO há Dexie: o escritório está numa mesa com
 * internet, e cachear localmente um dado que muda o tempo todo só criaria
 * divergência entre o que a tela mostra e o que está no banco. Toda leitura vai
 * direto à API.
 */

export interface LinhaCaminhaoKpi {
  data: string
  ciclos_concluidos: number
  ciclos_abertos: number
  permanencia_media_min: number | null
  permanencia_p90_min: number | null
}

export interface LinhaAbastecimentoKpi {
  data: string
  frota_numero: string
  abastecimentos: number
  litros: number
  divergencia_total: number
  lancamentos_divergentes: number
}

export interface DispositivoParado {
  id: string
  apelido: string | null
  funcionario_nome: string | null
  app_versao: string | null
  ultimo_sync_em: string | null
  /** NUMERIC do Postgres; o driver converte, mas o tipo admite texto para
   *  que uma origem sem parser não vire travessão em silêncio. */
  horas_sem_sync: number | string | null
  desvio_relogio_ms: number | null
}

export interface ResumoPainel {
  periodo_dias: number
  caminhoes: LinhaCaminhaoKpi[]
  abastecimento: LinhaAbastecimentoKpi[]
  apontamento: Array<{
    data: string
    funcionarios: number
    horas_elevador: number | null
    km_percorridos: number | null
    assinaturas_pendentes: number
  }>
  dispositivos_sem_sync: DispositivoParado[]
  conflitos_pendentes: number
  assinaturas: { total: number; invalidas: number }
  fichas_divergentes: FichaDivergente[]
}

export interface FichaDivergente {
  id: string
  numero_documento: number
  data: string
  hora: string
  litros: number | string
  divergencia_litros: number | string
  justificativa_divergencia: string | null
  frota_numero: string | null
  operador_nome: string | null
  foto_id: string | null
}

export interface Conflito {
  id: string
  tabela: string
  registro_id: string
  tipo: string
  erro_codigo: string | null
  erro_mensagem: string | null
  payload: Record<string, unknown>
  recebido_em: string
  dispositivo_id: string
  funcionario_codigo: string
  funcionario_nome: string
}

export interface FuncionarioPainel {
  id: string
  codigo: string
  nome: string
  funcao: string | null
  papel: 'campo' | 'lider' | 'admin'
  frente_padrao_id: string | null
  ativo: boolean
  pin_provisionado: boolean
  pin_precisa_trocar: boolean
  pin_tentativas_falhas: number
  pin_bloqueado_ate: string | null
  bloqueado: boolean
}

export const carregarResumo = (dias = 30) => chamar<ResumoPainel>('/painel/resumo', { corpo: { dias } })

export const carregarConflitos = () =>
  chamar<{ conflitos: Conflito[] }>('/painel/conflitos').then((r) => r.conflitos)

export const resolverConflito = (operacaoId: string) =>
  chamar<{ resolvido: boolean }>('/painel/conflitos/resolver', { corpo: { operacao_id: operacaoId } })

export const carregarFuncionarios = () =>
  chamar<{ funcionarios: FuncionarioPainel[] }>('/painel/funcionarios').then((r) => r.funcionarios)

export const salvarFuncionario = (dados: Partial<FuncionarioPainel>) =>
  chamar<{ id: string }>('/painel/funcionarios/salvar', { corpo: dados })

export interface PinProvisionado {
  funcionario: { id: string; codigo: string; nome: string }
  pin_inicial: string
  aviso: string
}

export const provisionarPin = (funcionarioId: string) =>
  chamar<PinProvisionado>('/admin/provisionar-funcionario', { corpo: { funcionario_id: funcionarioId } })

/** Destrava quem errou o PIN cinco vezes, mantendo o PIN que ele já sabe. */
export const liberarAcesso = (funcionarioId: string) =>
  chamar<{ liberado: boolean }>('/painel/funcionarios/liberar', { corpo: { id: funcionarioId } })

export const carregarLancamentos = (ficha: string, de: string | null, ate: string | null) =>
  chamar<{ linhas: Array<Record<string, unknown>> }>('/painel/lancamentos', {
    corpo: { ficha, de, ate },
  }).then((r) => r.linhas)

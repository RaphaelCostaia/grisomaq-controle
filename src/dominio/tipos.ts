/* Tipos do dominio. Espelham as tabelas do Postgres em camelo-livre: os nomes
   sao os mesmos do banco (snake_case em portugues) para que payload de sync,
   registro do Dexie e linha da tabela sejam a mesma coisa, sem tradutor no meio. */

export type PapelUsuario = 'campo' | 'lider' | 'admin'
export type TipoFrota = 'colhedora' | 'trator' | 'caminhao' | 'comboio' | 'transbordo' | 'outro'
export type TipoVeiculoTransporte = 'cavalo' | 'carreta'
export type StatusDocumento = 'rascunho' | 'finalizado' | 'travado' | 'cancelado'
export type StatusAssinatura = 'pendente' | 'validado_local' | 'validado_servidor' | 'invalida'
export type TipoLeitura = 'odometro' | 'horimetro_motor' | 'horimetro_elevador'
export type EscalaTurno = '2_turnos' | '3_turnos'

/** Estado de sincronizacao denormalizado em cada registro local. */
export type EstadoSync = 'pendente' | 'enviando' | 'sincronizado' | 'erro' | 'conflito'

/** Campos de auditoria/sync presentes em toda tabela transacional. */
export interface RodapeAuditoria {
  criado_por: string
  criado_em: string
  criado_em_dispositivo: string
  atualizado_por: string | null
  atualizado_em: string
  versao: number
  dispositivo_id: string
  app_versao: string
  excluido: boolean
  excluido_em: string | null
  excluido_por: string | null
}

/** O que o Dexie acrescenta a cada registro local. */
export interface MarcaLocal {
  _sync: EstadoSync
  _erro?: string
}

// --- Mestres ---------------------------------------------------------------

export interface Fazenda {
  id: string
  codigo: string
  nome: string
  municipio: string | null
  ativo: boolean
}

export interface Frente {
  id: string
  codigo: string
  nome: string
  fazenda_id: string | null
  escala: EscalaTurno
  ativo: boolean
}

export interface Turno {
  id: string
  codigo: string
  nome: string
  escala: EscalaTurno
  hora_inicio: string
  hora_fim: string
  duracao_horas: number
  vira_dia: boolean
  ativo: boolean
}

export interface Funcionario {
  id: string
  codigo: string
  nome: string
  funcao: string | null
  papel: PapelUsuario
  frente_padrao_id: string | null
  ativo: boolean
}

export interface Frota {
  id: string
  numero: string
  descricao: string
  tipo: TipoFrota
  tem_odometro: boolean
  tem_horimetro_motor: boolean
  tem_horimetro_elevador: boolean
  capacidade_tanque_litros: number | null
  consumo_esperado_litros_hora: number | null
  consumo_esperado_km_litro: number | null
  frente_id: string | null
  ativo: boolean
}

export interface VeiculoTransporte {
  id: string
  numero: string
  tipo: TipoVeiculoTransporte
  placa: string | null
  transportadora: string | null
  ativo: boolean
}

export interface Lider {
  id: string
  codigo: string | null
  nome: string
  funcionario_id: string | null
  ativo: boolean
}

/** Faixa de numeracao do bloco de papel alocada a um dispositivo. */
export interface BlocoAbastecimento {
  id: string
  numero_inicial: number
  numero_final: number
  funcionario_id: string | null
  dispositivo_id: string | null
  comboio_frota_id: string | null
  ativo: boolean
}

/** Ultima leitura conhecida de cada frota - base das validacoes de aviso. */
export interface UltimaLeitura {
  frota_id: string
  tipo: TipoLeitura
  valor: number
  momento: string
  origem_tabela: string
  origem_id: string
}

// --- Transacionais ---------------------------------------------------------

/** FICHA 1 - um ciclo de rodotrem no campo (chegada -> saida). */
export interface CaminhaoCiclo extends RodapeAuditoria, MarcaLocal {
  id: string
  data: string
  fazenda_id: string | null
  caminhao_id: string
  carreta1_id: string | null
  carreta2_id: string | null
  chegada_em: string
  saida_em: string | null
  lider_id: string | null
  lider_nome_livre: string | null
  frente_id: string | null
  turno_id: string | null
  observacao: string | null
  status: StatusDocumento
  avisos_confirmados: string[] | null
}

/** FICHA 2 - cabecalho do apontamento de turno. */
export interface Apontamento extends RodapeAuditoria, MarcaLocal {
  id: string
  data: string
  frente_id: string
  turno_id: string
  responsavel_funcionario_id: string
  observacao: string | null
  status: StatusDocumento
  finalizado_em: string | null
}

/** FICHA 2 - uma linha da grade de 25. */
export interface ApontamentoItem extends RodapeAuditoria, MarcaLocal {
  id: string
  apontamento_id: string
  seq: number
  funcionario_id: string
  frota_id: string
  odometro_inicial: number | null
  odometro_final: number | null
  elevador_inicial: number | null
  elevador_final: number | null
  justificativa_leitura: string | null
  observacao: string | null
  assinatura_status: StatusAssinatura
  assinado_em: string | null
  avisos_confirmados: string[] | null
}

/** FICHA 3 - um abastecimento de diesel no campo. */
export interface Abastecimento extends RodapeAuditoria, MarcaLocal {
  id: string
  numero_documento: number
  bloco_id: string | null
  data: string
  hora: string
  momento: string
  frota_id: string
  comboio_frota_id: string | null
  horimetro_motor: number | null
  horimetro_elevador: number | null
  odometro: number | null
  registrador_inicio: number
  registrador_fim: number
  litros: number
  operador_funcionario_id: string
  abastecedor_funcionario_id: string | null
  justificativa_leitura: string | null
  justificativa_divergencia: string | null
  observacao: string | null
  status: StatusDocumento
  avisos_confirmados: string[] | null
}

/** Trilha imutavel do aceite por PIN. */
export interface AssinaturaAceite extends MarcaLocal {
  id: string
  tipo_documento: 'apontamento' | 'apontamento_item' | 'abastecimento' | 'caminhao_ciclo'
  documento_id: string
  funcionario_id: string
  metodo: 'PIN'
  texto_aceite: string
  hash_documento: string
  momento_dispositivo: string
  dispositivo_id: string
  app_versao: string
  latitude: number | null
  longitude: number | null
  precisao_metros: number | null
  validacao_pin: StatusAssinatura
}

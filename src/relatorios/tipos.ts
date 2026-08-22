/**
 * Formatos que os exportadores consomem.
 *
 * São linhas já desnormalizadas — número da frota em vez de id, nome em vez de
 * uuid. O exportador não conhece Dexie nem a API: recebe o que vai imprimir
 * e desenha. Isso permite gerar o mesmo arquivo a partir do celular ou do
 * painel do escritório, sem duplicar a montagem do layout.
 */

export interface LinhaCaminhao {
  data: string
  fazenda_codigo: string | null
  caminhao_numero: string
  carreta1_numero: string | null
  carreta2_numero: string | null
  chegada: string
  saida: string | null
  permanencia_minutos: number | null
  lider_nome: string | null
}

export interface LinhaApontamento {
  seq: number
  funcionario_codigo: string
  funcionario_nome: string
  frota_numero: string
  odometro_inicial: number | null
  elevador_inicial: number | null
  odometro_final: number | null
  elevador_final: number | null
  /** Texto que ocupa a coluna de assinatura no lugar da rubrica a caneta. */
  assinatura: string
}

export interface CabecalhoApontamento {
  data: string
  frente: string
  turno: string
  responsavel: string
  observacao: string | null
}

export interface LinhaAbastecimento {
  numero_documento: number
  hora: string
  data: string
  frota_numero: string
  horimetro_motor: number | null
  horimetro_elevador: number | null
  odometro: number | null
  registrador_inicio: number
  registrador_fim: number
  litros: number
  divergencia: number
  assinatura: string
}

export interface OpcoesRelatorio {
  versaoApp: string
  /** Cabeçalho do período, ex.: "01/08/2026 a 21/08/2026". */
  periodo?: string
}

/**
 * As tres severidades de validacao do sistema.
 *
 * A distincao entre elas e a decisao de projeto mais importante do preenchimento
 * em campo. Bloquear tudo que parece estranho faz o operador inventar um numero
 * plausivel para o formulario deixar salvar - e ai o dado fica errado E parece
 * certo. Por isso o caso raro-mas-real tem uma saida propria: escrever o motivo.
 */
export type Severidade =
  /** Erro inequivoco de digitacao. Salvar fica desabilitado. */
  | 'bloqueante'
  /** Raro mas real (painel trocado, horimetro zerado). Salva com justificativa. */
  | 'justificavel'
  /** Suspeito. Salva com um toque em "Confirmo", e o aviso vai junto para o admin. */
  | 'aviso'

export interface Achado {
  codigo: string
  severidade: Severidade
  campo: string
  mensagem: string
  /** Valor que a tela oferece com um toque, quando existe um obvio. */
  sugestao?: { rotulo: string; valor: number | string }
}

export interface Diagnostico {
  achados: Achado[]
  podeSalvar: boolean
  /** Campos de justificativa que precisam estar preenchidos para liberar. */
  justificativasExigidas: string[]
  /** Codigos de aviso que o operador ainda precisa confirmar. */
  avisosPendentes: string[]
}

/**
 * Consolida os achados numa decisao. Recebe o que o operador ja justificou e ja
 * confirmou, para o formulario destravar conforme ele responde.
 */
export function diagnosticar(
  achados: Achado[],
  respondido: { justificativas?: Record<string, string | null>; avisosConfirmados?: string[] } = {},
): Diagnostico {
  const justificativas = respondido.justificativas ?? {}
  const confirmados = new Set(respondido.avisosConfirmados ?? [])

  const bloqueantes = achados.filter((a) => a.severidade === 'bloqueante')

  const justificativasExigidas = achados
    .filter((a) => a.severidade === 'justificavel')
    .map((a) => a.campo)
    .filter((campo) => !(justificativas[campo] ?? '').trim())

  const avisosPendentes = achados
    .filter((a) => a.severidade === 'aviso' && !confirmados.has(a.codigo))
    .map((a) => a.codigo)

  return {
    achados,
    podeSalvar: bloqueantes.length === 0 && justificativasExigidas.length === 0 && avisosPendentes.length === 0,
    justificativasExigidas: [...new Set(justificativasExigidas)],
    avisosPendentes,
  }
}

export const bloqueante = (codigo: string, campo: string, mensagem: string): Achado => ({
  codigo, campo, mensagem, severidade: 'bloqueante',
})

export const justificavel = (codigo: string, campo: string, mensagem: string): Achado => ({
  codigo, campo, mensagem, severidade: 'justificavel',
})

export const aviso = (
  codigo: string,
  campo: string,
  mensagem: string,
  sugestao?: Achado['sugestao'],
): Achado => (sugestao ? { codigo, campo, mensagem, severidade: 'aviso', sugestao } : { codigo, campo, mensagem, severidade: 'aviso' })

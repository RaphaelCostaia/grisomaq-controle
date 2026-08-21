/**
 * Limiares das validacoes. Vivem no banco (tabela `parametros`) porque quem sabe
 * o valor certo e o escritorio, e ele descobre isso durante a safra. Estes
 * defaults sao a rede de seguranca para o primeiro acesso, antes do primeiro
 * pull - nunca a fonte de verdade.
 */
export interface Parametros {
  app_versao_minima: string
  permanencia_min_alerta: number
  permanencia_max_alerta: number
  km_max_turno: number
  horas_elevador_folga: number
  delta_leitura_odometro_aviso: number
  delta_leitura_horimetro_aviso: number
  tolerancia_litros_abs: number
  tolerancia_litros_pct: number
  fator_capacidade_tanque: number
  minutos_min_entre_abastecimentos: number
  desvio_consumo_aviso_pct: number
  blocos_aviso_restante: number
  desvio_relogio_max_min: number
  minutos_tolerancia_futuro: number
  horas_bloqueio_tela: number
}

export const PARAMETROS_PADRAO: Parametros = {
  app_versao_minima: '0.1.0',
  permanencia_min_alerta: 10,
  permanencia_max_alerta: 240,
  km_max_turno: 400,
  horas_elevador_folga: 1,
  delta_leitura_odometro_aviso: 5,
  delta_leitura_horimetro_aviso: 0.5,
  tolerancia_litros_abs: 0.5,
  tolerancia_litros_pct: 0.005,
  fator_capacidade_tanque: 1.15,
  minutos_min_entre_abastecimentos: 30,
  desvio_consumo_aviso_pct: 0.4,
  blocos_aviso_restante: 10,
  desvio_relogio_max_min: 5,
  minutos_tolerancia_futuro: 15,
  horas_bloqueio_tela: 8,
}

/** Mescla o que veio do servidor por cima dos defaults, ignorando chaves novas. */
export function mesclarParametros(doServidor: Array<{ chave: string; valor: unknown }>): Parametros {
  const mesclado = { ...PARAMETROS_PADRAO } as Record<string, unknown>
  for (const { chave, valor } of doServidor) {
    if (chave in mesclado) mesclado[chave] = valor
  }
  return mesclado as unknown as Parametros
}

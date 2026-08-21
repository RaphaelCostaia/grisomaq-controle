import type { Frota, Turno, UltimaLeitura } from '@/dominio/tipos'
import type { Parametros } from '@/dominio/parametros'
import { type Achado, aviso, bloqueante, diagnosticar, justificavel, type Diagnostico } from '@/dominio/severidade'
import { formatarLeitura } from '@/utilitarios/numeros'
import { dataHoraBr, hojeOperacional, somarDias } from '@/utilitarios/datas'

/** Cabeçalho da ficha: um documento por frente, por turno, por dia. */
export interface RascunhoApontamento {
  id: string
  data: string
  frente_id: string | null
  turno_id: string | null
  responsavel_funcionario_id: string | null
  observacao: string | null
}

/** Uma das 25 linhas da grade. */
export interface RascunhoItem {
  id: string
  seq: number
  funcionario_id: string | null
  frota_id: string | null
  odometro_inicial: number | null
  odometro_final: number | null
  elevador_inicial: number | null
  elevador_final: number | null
  justificativa_leitura: string | null
  assinado: boolean
  avisos_confirmados: string[]
}

export interface ContextoApontamento {
  parametros: Parametros
  /** Fichas já existentes no aparelho, para não abrir a mesma duas vezes. */
  existentes: Array<{ id: string; data: string; frente_id: string; turno_id: string }>
}

export interface ContextoItem {
  parametros: Parametros
  frota: Frota | null
  turno: Turno | null
  ultimasLeituras: Partial<Record<UltimaLeitura['tipo'], UltimaLeitura>>
  /** Funcionários já lançados nesta mesma ficha. */
  funcionariosNaFicha: Array<{ itemId: string; funcionario_id: string }>
  /** Frotas já lançadas nesta ficha, para avisar de máquina repetida. */
  frotasNaFicha: Array<{ itemId: string; frota_id: string }>
}

export function validarApontamento(r: RascunhoApontamento, ctx: ContextoApontamento): Diagnostico {
  const a: Achado[] = []
  const hoje = hojeOperacional()

  if (!r.data) {
    a.push(bloqueante('DATA_AUSENTE', 'data', 'Informe a data.'))
  } else if (r.data > hoje) {
    a.push(bloqueante('DATA_FUTURA', 'data', 'A data não pode ser depois de hoje.'))
  } else if (r.data < somarDias(hoje, -1)) {
    a.push(
      bloqueante('DATA_ANTIGA', 'data', 'Só é possível lançar de hoje e de ontem. Peça ao escritório para datas anteriores.'),
    )
  }

  if (!r.frente_id) a.push(bloqueante('FRENTE_AUSENTE', 'frente_id', 'Escolha a frente.'))
  if (!r.turno_id) a.push(bloqueante('TURNO_AUSENTE', 'turno_id', 'Escolha o turno.'))
  if (!r.responsavel_funcionario_id) {
    a.push(bloqueante('RESPONSAVEL_AUSENTE', 'responsavel_funcionario_id', 'Informe o responsável pela ficha.'))
  }

  // Uma ficha por frente por turno por dia. Duas abertas em paralelo dividiriam
  // o mesmo turno em dois documentos e ninguém saberia qual vale.
  if (r.frente_id && r.turno_id) {
    const jaExiste = ctx.existentes.find(
      (e) => e.id !== r.id && e.data === r.data && e.frente_id === r.frente_id && e.turno_id === r.turno_id,
    )
    if (jaExiste) {
      a.push(
        bloqueante(
          'FICHA_JA_EXISTE',
          'turno_id',
          'Já existe uma ficha desta frente para este turno. Abra a que já foi começada.',
        ),
      )
    }
  }

  return diagnosticar(a)
}

export function validarItem(r: RascunhoItem, ctx: ContextoItem): Diagnostico {
  const a: Achado[] = []
  const p = ctx.parametros

  if (!r.funcionario_id) a.push(bloqueante('FUNCIONARIO_AUSENTE', 'funcionario_id', 'Escolha o funcionário.'))
  if (!r.frota_id || !ctx.frota) a.push(bloqueante('FROTA_AUSENTE', 'frota_id', 'Escolha a frota.'))

  // O mesmo funcionário duas vezes na mesma ficha é erro de digitação, não um
  // caso real: ninguém opera duas máquinas no mesmo turno.
  if (r.funcionario_id) {
    const repetido = ctx.funcionariosNaFicha.find(
      (f) => f.itemId !== r.id && f.funcionario_id === r.funcionario_id,
    )
    if (repetido) {
      a.push(bloqueante('FUNCIONARIO_REPETIDO', 'funcionario_id', 'Este funcionário já está nesta ficha.'))
    }
  }

  if (r.frota_id) {
    const mesmaFrota = ctx.frotasNaFicha.find((f) => f.itemId !== r.id && f.frota_id === r.frota_id)
    if (mesmaFrota) {
      a.push(aviso('FROTA_REPETIDA', 'frota_id', 'Esta frota já está em outra linha desta ficha. Houve troca de operador?'))
    }
  }

  // Frota sem elevador não tem leitura de elevador. Os campos aparecem
  // desabilitados na tela; chegar aqui preenchido significa frota errada.
  if (ctx.frota && !ctx.frota.tem_horimetro_elevador) {
    if (r.elevador_inicial !== null || r.elevador_final !== null) {
      a.push(bloqueante('SEM_ELEVADOR', 'elevador_inicial', 'A frota ' + ctx.frota.numero + ' não tem elevador.'))
    }
  }
  if (ctx.frota && !ctx.frota.tem_odometro) {
    if (r.odometro_inicial !== null || r.odometro_final !== null) {
      a.push(bloqueante('SEM_ODOMETRO', 'odometro_inicial', 'A frota ' + ctx.frota.numero + ' não tem hodômetro.'))
    }
  }

  conferirPar(a, 'odometro', r.odometro_inicial, r.odometro_final, 'Hodômetro')
  conferirPar(a, 'elevador', r.elevador_inicial, r.elevador_final, 'Horímetro do elevador')

  conferirInicialContraUltima(
    a,
    'odometro_inicial',
    r.odometro_inicial,
    ctx.ultimasLeituras.odometro,
    p.delta_leitura_odometro_aviso,
    'Hodômetro',
  )
  conferirInicialContraUltima(
    a,
    'elevador_inicial',
    r.elevador_inicial,
    ctx.ultimasLeituras.horimetro_elevador,
    p.delta_leitura_horimetro_aviso,
    'Horímetro do elevador',
  )

  const km = delta(r.odometro_inicial, r.odometro_final)
  if (km !== null && km > p.km_max_turno) {
    a.push(
      aviso('KM_ALTO', 'odometro_final', formatarLeitura(km) + ' km num turno só. Confira as leituras.'),
    )
  }

  const horas = delta(r.elevador_inicial, r.elevador_final)
  if (horas !== null && ctx.turno && horas > ctx.turno.duracao_horas + p.horas_elevador_folga) {
    a.push(
      aviso(
        'ELEVADOR_ALTO',
        'elevador_final',
        formatarLeitura(horas) + ' h de elevador num turno de ' + ctx.turno.duracao_horas + ' h. Confira as leituras.',
      ),
    )
  }

  // Colhedora que rodou quilômetro mas não moveu o elevador não colheu nada —
  // ou uma das duas leituras está errada.
  if (ctx.frota?.tipo === 'colhedora' && horas === 0 && km !== null && km > 0) {
    a.push(
      aviso(
        'ELEVADOR_PARADO',
        'elevador_final',
        'O elevador não rodou nada, mas a máquina andou. A colhedora ficou só em deslocamento?',
      ),
    )
  }

  return diagnosticar(a, {
    justificativas: { justificativa_leitura: r.justificativa_leitura },
    avisosConfirmados: r.avisos_confirmados,
  })
}

/** Itens que ainda impedem o fechamento da ficha. */
export function pendenciasParaFechar(itens: RascunhoItem[]): string[] {
  const pendencias: string[] = []
  if (itens.length === 0) pendencias.push('A ficha não tem nenhum funcionário lançado.')

  const semAssinatura = itens.filter((i) => !i.assinado).length
  if (semAssinatura === 1) pendencias.push('1 funcionário ainda não assinou.')
  if (semAssinatura > 1) pendencias.push(semAssinatura + ' funcionários ainda não assinaram.')

  const incompletos = itens.filter(
    (i) => (i.odometro_inicial !== null && i.odometro_final === null) ||
           (i.elevador_inicial !== null && i.elevador_final === null),
  ).length
  if (incompletos > 0) {
    pendencias.push(
      incompletos === 1
        ? '1 linha está sem a leitura final.'
        : incompletos + ' linhas estão sem a leitura final.',
    )
  }

  return pendencias
}

function delta(inicial: number | null, final: number | null): number | null {
  if (inicial === null || final === null) return null
  return final - inicial
}

/**
 * Leitura final menor que a inicial é rara mas real (painel trocado, horímetro
 * zerado). Exigir o motivo é melhor que bloquear: bloqueado, o operador inventa
 * um número que passe, e aí o dado fica errado parecendo certo.
 */
function conferirPar(
  achados: Achado[],
  prefixo: string,
  inicial: number | null,
  final: number | null,
  rotulo: string,
): void {
  for (const [campo, valor] of [
    [prefixo + '_inicial', inicial],
    [prefixo + '_final', final],
  ] as const) {
    if (valor !== null && valor < 0) {
      achados.push(bloqueante(campo.toUpperCase() + '_NEGATIVO', campo, rotulo + ' não pode ser negativo.'))
    }
  }

  if (inicial !== null && final !== null && final < inicial) {
    achados.push(
      justificavel(
        prefixo.toUpperCase() + '_REGREDIU',
        'justificativa_leitura',
        rotulo + ' final (' + formatarLeitura(final) + ') está menor que o inicial (' + formatarLeitura(inicial) + '). Explique o motivo.',
      ),
    )
  }
}

function conferirInicialContraUltima(
  achados: Achado[],
  campo: string,
  valor: number | null,
  ultima: UltimaLeitura | undefined,
  tolerancia: number,
  rotulo: string,
): void {
  if (valor === null || !ultima) return
  if (Math.abs(valor - ultima.valor) <= tolerancia) return

  achados.push(
    aviso(
      campo.toUpperCase() + '_LONGE_DA_ULTIMA',
      campo,
      rotulo + ' começou em ' + formatarLeitura(valor) + ', mas a última leitura desta frota foi ' +
        formatarLeitura(ultima.valor) + ' em ' + dataHoraBr(new Date(ultima.momento)) + '.',
      { rotulo: 'Usar ' + formatarLeitura(ultima.valor), valor: ultima.valor },
    ),
  )
}

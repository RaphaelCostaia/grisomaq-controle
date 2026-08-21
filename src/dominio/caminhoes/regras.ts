import type { VeiculoTransporte } from '@/dominio/tipos'
import type { Parametros } from '@/dominio/parametros'
import { type Achado, aviso, bloqueante, diagnosticar, type Diagnostico } from '@/dominio/severidade'
import {
  dataOperacional,
  duracaoCurta,
  hojeOperacional,
  instanteDe,
  minutosEntre,
  somarDias,
} from '@/utilitarios/datas'

/**
 * Um ciclo de rodotrem no campo. Diferente das outras fichas, ele não nasce
 * completo: a chegada é registrada quando o caminhão entra e a saída horas
 * depois, muitas vezes por outra pessoa. Por isso `saida` é opcional aqui e a
 * validação precisa fazer sentido nos dois momentos.
 */
export interface RascunhoCiclo {
  id: string
  data: string
  fazenda_id: string | null
  caminhao_id: string | null
  carreta1_id: string | null
  carreta2_id: string | null
  hora_chegada: string
  hora_saida: string | null
  lider_id: string | null
  observacao: string | null
  avisos_confirmados: string[]
}

export interface ContextoCiclo {
  parametros: Parametros
  caminhao: VeiculoTransporte | null
  /** Ciclos ainda abertos, para impedir o mesmo caminhão duas vezes no campo. */
  ciclosAbertos: Array<{ id: string; caminhao_id: string; carreta1_id: string | null; carreta2_id: string | null }>
  agora: Date
}

/**
 * Resolve a saída que atravessou a meia-noite.
 *
 * O turno da noite entra às 22h e sai às 2h. Se a hora de saída for menor que a
 * de chegada, ela pertence ao dia seguinte — mas isso é uma inferência, então a
 * tela pergunta em vez de decidir sozinha.
 */
export function resolverSaidaDoCiclo(
  r: RascunhoCiclo,
): { chegada: Date; saida: Date | null; viraDia: boolean } {
  const chegada = instanteDe(r.data, r.hora_chegada)
  if (!r.hora_saida) return { chegada, saida: null, viraDia: false }

  const { saida, viraDia } = resolverSaidaRelativa(chegada, r.hora_saida)
  return { chegada, saida, viraDia }
}

/**
 * Resolve uma hora de saída contra um instante de chegada conhecido.
 *
 * Duas armadilhas moram aqui. A primeira: saída IGUAL à chegada é permanência
 * zero, não um dia inteiro — o caminhão que entra e sai no mesmo minuto existe.
 * A segunda: a chegada tem segundos, a hora de saída não. Comparar 10:22:00
 * contra uma chegada às 10:22:37 daria "menor", e o ciclo saltaria 24 horas.
 * Por isso a comparação é feita no minuto.
 */
export function resolverSaidaRelativa(
  chegada: Date,
  horaSaida: string,
): { saida: Date; viraDia: boolean } {
  const dataDaChegada = dataOperacional(chegada)
  const chegadaNoMinuto = new Date(Math.floor(chegada.getTime() / 60_000) * 60_000)

  const mesmoDia = instanteDe(dataDaChegada, horaSaida)
  if (mesmoDia >= chegadaNoMinuto) return { saida: mesmoDia, viraDia: false }

  return { saida: instanteDe(somarDias(dataDaChegada, 1), horaSaida), viraDia: true }
}

export function validarCiclo(r: RascunhoCiclo, ctx: ContextoCiclo): Diagnostico {
  const a: Achado[] = []
  const p = ctx.parametros
  const hoje = hojeOperacional()

  // --- Quando --------------------------------------------------------------
  if (!r.data) {
    a.push(bloqueante('DATA_AUSENTE', 'data', 'Informe a data.'))
  } else if (r.data > hoje) {
    a.push(bloqueante('DATA_FUTURA', 'data', 'A data não pode ser depois de hoje.'))
  } else if (r.data < somarDias(hoje, -1)) {
    a.push(
      bloqueante(
        'DATA_ANTIGA',
        'data',
        'Só é possível lançar de hoje e de ontem. Peça ao escritório para lançar datas anteriores.',
      ),
    )
  }

  if (!r.hora_chegada) {
    a.push(bloqueante('CHEGADA_AUSENTE', 'hora_chegada', 'Informe a hora de chegada.'))
  }

  // --- Caminhão ------------------------------------------------------------
  if (!r.caminhao_id || !ctx.caminhao) {
    a.push(bloqueante('CAMINHAO_AUSENTE', 'caminhao_id', 'Escolha o caminhão.'))
  } else if (!ctx.caminhao.ativo) {
    a.push(bloqueante('CAMINHAO_INATIVO', 'caminhao_id', 'Este caminhão está inativo. Procure o escritório.'))
  } else {
    const jaNoCampo = ctx.ciclosAbertos.find((c) => c.caminhao_id === r.caminhao_id && c.id !== r.id)
    if (jaNoCampo) {
      a.push(
        bloqueante(
          'CAMINHAO_JA_NO_CAMPO',
          'caminhao_id',
          'Este caminhão já está no campo, sem saída registrada. Registre a saída dele primeiro.',
        ),
      )
    }
  }

  // --- Carretas ------------------------------------------------------------
  if (r.carreta1_id && r.carreta1_id === r.carreta2_id) {
    a.push(bloqueante('CARRETAS_IGUAIS', 'carreta2_id', 'As duas carretas não podem ser a mesma.'))
  }
  if (r.carreta2_id && !r.carreta1_id) {
    a.push(bloqueante('CARRETA2_SEM_CARRETA1', 'carreta1_id', 'Informe a 1ª carreta antes da 2ª.'))
  }
  if (!r.carreta1_id && !r.carreta2_id) {
    a.push(aviso('CICLO_SEM_CARRETA', 'carreta1_id', 'Este ciclo está sem nenhuma carreta. É isso mesmo?'))
  }

  for (const [campo, carretaId] of [
    ['carreta1_id', r.carreta1_id],
    ['carreta2_id', r.carreta2_id],
  ] as const) {
    if (!carretaId) continue
    const emOutro = ctx.ciclosAbertos.find(
      (c) => c.id !== r.id && (c.carreta1_id === carretaId || c.carreta2_id === carretaId),
    )
    if (emOutro) {
      a.push(
        aviso(
          'CARRETA_EM_OUTRO_CICLO_' + campo.toUpperCase(),
          campo,
          'Esta carreta consta em outro caminhão que ainda está no campo.',
        ),
      )
    }
  }

  // --- Saída ---------------------------------------------------------------
  if (r.hora_saida) {
    const { chegada, saida, viraDia } = resolverSaidaDoCiclo(r)

    if (saida) {
      const permanencia = minutosEntre(chegada, saida)

      // Atravessar a meia-noite é normal no turno da noite; doze horas de
      // permanência não são. Perguntar é melhor que assumir qualquer um dos dois.
      if (viraDia && permanencia > 12 * 60) {
        a.push(
          aviso(
            'SAIDA_NO_DIA_SEGUINTE',
            'hora_saida',
            'A saída ficou ' + duracaoCurta(permanencia) + ' depois da chegada. O caminhão saiu no dia seguinte?',
          ),
        )
      }

      if (permanencia < p.permanencia_min_alerta) {
        a.push(
          aviso(
            'PERMANENCIA_CURTA',
            'hora_saida',
            'Só ' + duracaoCurta(permanencia) + ' no campo. A saída foi registrada por engano?',
          ),
        )
      }

      if (permanencia > p.permanencia_max_alerta) {
        a.push(
          aviso(
            'PERMANENCIA_LONGA',
            'hora_saida',
            duracaoCurta(permanencia) + ' no campo. Esqueceram de registrar a saída antes?',
          ),
        )
      }
    }
  }

  return diagnosticar(a, { avisosConfirmados: r.avisos_confirmados })
}

/** Faixa de cor do cronômetro do pátio, pelos limiares do escritório. */
export function faixaDePermanencia(
  minutos: number,
  p: Parametros,
): 'normal' | 'atencao' | 'critica' {
  if (minutos >= p.permanencia_max_alerta) return 'critica'
  if (minutos >= p.permanencia_max_alerta / 2) return 'atencao'
  return 'normal'
}

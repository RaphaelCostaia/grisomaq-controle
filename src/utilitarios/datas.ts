import { TZDate } from '@date-fns/tz'
import { addDays, differenceInMinutes, format, parse, startOfDay } from 'date-fns'

/**
 * Fuso da operacao. Toda data de negocio ("a data da ficha") e resolvida aqui,
 * nunca no fuso do dispositivo: no turno da noite o celular vira o dia as 21h
 * horario local se alguem viajar de fuso, e a ficha iria para o dia errado.
 */
export const FUSO_OPERACAO = 'America/Sao_Paulo'

/** Instante atual como TZDate no fuso da operacao. */
export function agora(): TZDate {
  return TZDate.tz(FUSO_OPERACAO)
}

/** Data de negocio de um instante, no formato ISO `aaaa-mm-dd`. */
export function dataOperacional(instante: Date = new Date()): string {
  return format(new TZDate(instante, FUSO_OPERACAO), 'yyyy-MM-dd')
}

/** Hoje na operacao, `aaaa-mm-dd`. */
export function hojeOperacional(): string {
  return dataOperacional()
}

/** Soma dias a uma data ISO de negocio, devolvendo outra data ISO. */
export function somarDias(dataIso: string, dias: number): string {
  return format(addDays(parse(dataIso, 'yyyy-MM-dd', new Date()), dias), 'yyyy-MM-dd')
}

/**
 * Combina data (`aaaa-mm-dd`) e hora (`HH:mm`) da ficha num instante absoluto.
 * O par sempre e interpretado no fuso da operacao.
 */
export function instanteDe(dataIso: string, hora: string): Date {
  const [ano, mes, dia] = dataIso.split('-').map(Number) as [number, number, number]
  const [h, m] = hora.split(':').map(Number) as [number, number]
  return new TZDate(ano, mes - 1, dia, h, m, 0, 0, FUSO_OPERACAO)
}

/** `HH:mm` de um instante, no fuso da operacao. */
export function horaDe(instante: Date): string {
  return format(new TZDate(instante, FUSO_OPERACAO), 'HH:mm')
}

/** `dd/MM/aaaa` para exibicao. */
export function dataBr(dataIso: string): string {
  const [ano, mes, dia] = dataIso.split('-')
  return `${dia}/${mes}/${ano}`
}

/** `dd/MM/aaaa HH:mm` para exibicao e para o rodape dos relatorios. */
export function dataHoraBr(instante: Date): string {
  return format(new TZDate(instante, FUSO_OPERACAO), 'dd/MM/yyyy HH:mm')
}

/**
 * Resolve a saida de um ciclo que atravessou a meia-noite.
 * Se a hora de saida e anterior a de chegada, ela pertence ao dia seguinte.
 * Devolve tambem `viraDia` para a tela poder pedir confirmacao explicita ao
 * operador em vez de decidir sozinha.
 */
export function resolverSaida(
  chegada: Date,
  dataIso: string,
  horaSaida: string,
): { saida: Date; viraDia: boolean } {
  const mesmoDia = instanteDe(dataIso, horaSaida)
  if (mesmoDia > chegada) return { saida: mesmoDia, viraDia: false }
  return { saida: instanteDe(somarDias(dataIso, 1), horaSaida), viraDia: true }
}

/** Permanencia em minutos inteiros. */
export function minutosEntre(inicio: Date, fim: Date): number {
  return differenceInMinutes(fim, inicio)
}

/** `2h 14min` / `43min` - formato curto para o cronometro do patio. */
export function duracaoCurta(minutos: number): string {
  const m = Math.max(0, Math.trunc(minutos))
  const h = Math.floor(m / 60)
  return h > 0 ? `${h}h ${String(m % 60).padStart(2, '0')}min` : `${m}min`
}

/** Inicio do dia operacional, util para consultas por periodo. */
export function inicioDoDia(dataIso: string): Date {
  return startOfDay(instanteDe(dataIso, '00:00'))
}

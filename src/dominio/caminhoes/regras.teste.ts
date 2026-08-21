import { describe, expect, it } from 'vitest'
import {
  faixaDePermanencia,
  resolverSaidaDoCiclo,
  resolverSaidaRelativa,
  validarCiclo,
  type ContextoCiclo,
  type RascunhoCiclo,
} from './regras'
import { PARAMETROS_PADRAO } from '@/dominio/parametros'
import type { VeiculoTransporte } from '@/dominio/tipos'
import { hojeOperacional, instanteDe, minutosEntre, somarDias } from '@/utilitarios/datas'

const HOJE = hojeOperacional()
const AGORA = instanteDe(HOJE, '15:00')

const cavalo: VeiculoTransporte = {
  id: 'v-77',
  numero: '77',
  tipo: 'cavalo',
  placa: null,
  transportadora: 'Transcana',
  ativo: true,
}

function contexto(sobrescreve: Partial<ContextoCiclo> = {}): ContextoCiclo {
  return {
    parametros: PARAMETROS_PADRAO,
    caminhao: cavalo,
    ciclosAbertos: [],
    agora: AGORA,
    ...sobrescreve,
  }
}

function rascunho(sobrescreve: Partial<RascunhoCiclo> = {}): RascunhoCiclo {
  return {
    id: 'c-1',
    data: HOJE,
    fazenda_id: 'fz-1',
    caminhao_id: 'v-77',
    carreta1_id: 'v-101',
    carreta2_id: 'v-102',
    hora_chegada: '13:00',
    hora_saida: null,
    lider_id: 'l-1',
    observacao: null,
    avisos_confirmados: [],
    ...sobrescreve,
  }
}

const codigos = (r: ReturnType<typeof validarCiclo>) => r.achados.map((a) => a.codigo)

describe('chegada', () => {
  it('aceita uma chegada completa', () => {
    const r = validarCiclo(rascunho(), contexto())
    expect(codigos(r)).toEqual([])
    expect(r.podeSalvar).toBe(true)
  })

  it('bloqueia o mesmo caminhão entrando duas vezes sem ter saído', () => {
    const r = validarCiclo(
      rascunho({ id: 'c-2' }),
      contexto({ ciclosAbertos: [{ id: 'c-1', caminhao_id: 'v-77', carreta1_id: null, carreta2_id: null }] }),
    )
    expect(codigos(r)).toContain('CAMINHAO_JA_NO_CAMPO')
    expect(r.podeSalvar).toBe(false)
  })

  it('não se acusa de duplicar quando é o próprio ciclo sendo editado', () => {
    const r = validarCiclo(
      rascunho(),
      contexto({ ciclosAbertos: [{ id: 'c-1', caminhao_id: 'v-77', carreta1_id: null, carreta2_id: null }] }),
    )
    expect(codigos(r)).not.toContain('CAMINHAO_JA_NO_CAMPO')
  })

  it('bloqueia carretas repetidas no mesmo rodotrem', () => {
    const r = validarCiclo(rascunho({ carreta2_id: 'v-101' }), contexto())
    expect(codigos(r)).toContain('CARRETAS_IGUAIS')
  })

  it('bloqueia a 2ª carreta sem a 1ª', () => {
    const r = validarCiclo(rascunho({ carreta1_id: null }), contexto())
    expect(codigos(r)).toContain('CARRETA2_SEM_CARRETA1')
  })

  it('avisa quando a carreta já está com outro caminhão no campo', () => {
    const r = validarCiclo(
      rascunho(),
      contexto({ ciclosAbertos: [{ id: 'c-9', caminhao_id: 'v-88', carreta1_id: 'v-101', carreta2_id: null }] }),
    )
    expect(codigos(r)).toContain('CARRETA_EM_OUTRO_CICLO_CARRETA1_ID')
  })

  it('bloqueia data futura e data antiga demais', () => {
    expect(codigos(validarCiclo(rascunho({ data: somarDias(HOJE, 1) }), contexto()))).toContain('DATA_FUTURA')
    expect(codigos(validarCiclo(rascunho({ data: somarDias(HOJE, -5) }), contexto()))).toContain('DATA_ANTIGA')
  })

  it('aceita ontem, porque o turno da noite fecha na manhã seguinte', () => {
    const r = validarCiclo(rascunho({ data: somarDias(HOJE, -1) }), contexto())
    expect(codigos(r)).not.toContain('DATA_ANTIGA')
  })
})

describe('saída e virada de meia-noite', () => {
  it('calcula a permanência no mesmo dia', () => {
    const { chegada, saida, viraDia } = resolverSaidaDoCiclo(rascunho({ hora_chegada: '13:00', hora_saida: '14:30' }))
    expect(viraDia).toBe(false)
    expect(minutosEntre(chegada, saida!)).toBe(90)
  })

  // Turno da noite: entra 22h, sai 2h. A saída pertence ao dia seguinte.
  it('joga a saída para o dia seguinte quando ela é menor que a chegada', () => {
    const { chegada, saida, viraDia } = resolverSaidaDoCiclo(rascunho({ hora_chegada: '22:40', hora_saida: '01:10' }))
    expect(viraDia).toBe(true)
    expect(minutosEntre(chegada, saida!)).toBe(150)
  })

  it('pergunta quando a virada de dia resulta em permanência absurda', () => {
    const r = validarCiclo(rascunho({ hora_chegada: '08:00', hora_saida: '07:00' }), contexto())
    expect(codigos(r)).toContain('SAIDA_NO_DIA_SEGUINTE')
  })

  it('avisa permanência curta demais', () => {
    const r = validarCiclo(rascunho({ hora_chegada: '13:00', hora_saida: '13:05' }), contexto())
    expect(codigos(r)).toContain('PERMANENCIA_CURTA')
  })

  it('avisa permanência longa demais', () => {
    const r = validarCiclo(rascunho({ hora_chegada: '08:00', hora_saida: '13:00' }), contexto())
    expect(codigos(r)).toContain('PERMANENCIA_LONGA')
  })

  it('libera depois que o operador confirma o aviso', () => {
    const r = validarCiclo(
      rascunho({ hora_chegada: '13:00', hora_saida: '13:05', avisos_confirmados: ['PERMANENCIA_CURTA'] }),
      contexto(),
    )
    expect(r.podeSalvar).toBe(true)
  })
})

describe('saída resolvida contra a chegada real', () => {
  // O caminhão que entra e sai no mesmo minuto existe (e o operador testando o
  // app também). Isso é permanência zero, não um dia inteiro.
  it('trata saída igual à chegada como permanência zero', () => {
    const chegada = instanteDe(HOJE, '10:22')
    const { saida, viraDia } = resolverSaidaRelativa(chegada, '10:22')
    expect(viraDia).toBe(false)
    expect(minutosEntre(chegada, saida)).toBe(0)
  })

  // A chegada carrega segundos; a hora de saída, não. Comparar 10:22:00 contra
  // uma chegada às 10:22:37 daria "menor" e saltaria 24 horas.
  it('ignora os segundos da chegada ao comparar', () => {
    const chegada = new Date(instanteDe(HOJE, '10:22').getTime() + 37_000)
    const { saida, viraDia } = resolverSaidaRelativa(chegada, '10:22')
    expect(viraDia).toBe(false)
    expect(minutosEntre(chegada, saida)).toBeLessThanOrEqual(0)
  })

  it('ainda joga para o dia seguinte quando a saída é realmente anterior', () => {
    const chegada = instanteDe(HOJE, '22:40')
    const { saida, viraDia } = resolverSaidaRelativa(chegada, '01:10')
    expect(viraDia).toBe(true)
    expect(minutosEntre(chegada, saida)).toBe(150)
  })
})

describe('faixa do cronômetro do pátio', () => {
  it('vira atenção na metade do limite e crítica no limite', () => {
    const p = PARAMETROS_PADRAO // permanencia_max_alerta = 240
    expect(faixaDePermanencia(30, p)).toBe('normal')
    expect(faixaDePermanencia(119, p)).toBe('normal')
    expect(faixaDePermanencia(120, p)).toBe('atencao')
    expect(faixaDePermanencia(240, p)).toBe('critica')
  })
})

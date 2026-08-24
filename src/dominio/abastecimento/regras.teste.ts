import { describe, expect, it } from 'vitest'
import { conferirLitros, validarAbastecimento, type ContextoAbastecimento, type RascunhoAbastecimento } from './regras'
import { PARAMETROS_PADRAO } from '@/dominio/parametros'
import type { BlocoAbastecimento, Frota } from '@/dominio/tipos'
import { dataBr, hojeOperacional, instanteDe } from '@/utilitarios/datas'

// O "agora" dos testes e ancorado no dia operacional, e nao no relogio da
// maquina que roda a suite: com hora fixa no rascunho, o teste passaria de
// manha e falharia a tarde.
const HOJE = hojeOperacional()
const AGORA = instanteDe(HOJE, '15:00')

const frotaColhedora: Frota = {
  id: 'frota-1',
  numero: '1204',
  descricao: 'Colhedora CH570',
  tipo: 'colhedora',
  tem_odometro: false,
  tem_horimetro_motor: true,
  tem_horimetro_elevador: true,
  capacidade_tanque_litros: 650,
  consumo_esperado_litros_hora: 32,
  consumo_esperado_km_litro: null,
  frente_id: null,
  ativo: true,
}

const bloco: BlocoAbastecimento = {
  id: 'bloco-1',
  numero_inicial: 6901,
  numero_final: 6950,
  funcionario_id: 'func-1',
  dispositivo_id: 'disp-1',
  comboio_frota_id: 'comboio-1',
  ativo: true,
}

function contexto(sobrescreve: Partial<ContextoAbastecimento> = {}): ContextoAbastecimento {
  return {
    parametros: PARAMETROS_PADRAO,
    frota: frotaColhedora,
    bloco,
    numerosUsados: new Set(),
    ultimasLeituras: {},
    ultimoRegistradorComboio: null,
    ultimoAbastecimentoDaFrota: null,
    agora: AGORA,
    ...sobrescreve,
  }
}

function rascunho(sobrescreve: Partial<RascunhoAbastecimento> = {}): RascunhoAbastecimento {
  return {
    id: 'abast-1',
    numero_documento: 6901,
    data: HOJE,
    hora: '14:32',
    frota_id: 'frota-1',
    comboio_frota_id: 'comboio-1',
    horimetro_motor: 12345.7,
    horimetro_elevador: null,
    odometro: null,
    registrador_inicio: 45265,
    registrador_fim: 45310,
    litros: 45,
    operador_funcionario_id: 'func-1',
    justificativa_leitura: null,
    justificativa_divergencia: null,
    avisos_confirmados: [],
    ...sobrescreve,
  }
}

const codigos = (r: ReturnType<typeof validarAbastecimento>) => r.achados.map((a) => a.codigo)

describe('conferência de litros contra a bomba', () => {
  it('confere quando os litros batem com o registrador', () => {
    const c = conferirLitros(rascunho(), PARAMETROS_PADRAO)
    expect(c).toEqual({ daBomba: 45, diferenca: 0, confere: true })
  })

  it('aceita diferença dentro da tolerância absoluta', () => {
    const c = conferirLitros(rascunho({ litros: 45.5 }), PARAMETROS_PADRAO)
    expect(c?.confere).toBe(true)
  })

  it('acusa a diferença um passo além da tolerância', () => {
    const c = conferirLitros(rascunho({ litros: 45.6 }), PARAMETROS_PADRAO)
    expect(c?.confere).toBe(false)
    expect(c?.diferenca).toBeCloseTo(0.6)
  })

  it('não conclui nada enquanto falta um dos três valores', () => {
    expect(conferirLitros(rascunho({ registrador_fim: null }), PARAMETROS_PADRAO)).toBeNull()
  })
})

describe('lançamento correto', () => {
  it('passa sem nenhum achado', () => {
    const r = validarAbastecimento(rascunho(), contexto())
    expect(codigos(r)).toEqual([])
    expect(r.podeSalvar).toBe(true)
  })
})

describe('número da ficha', () => {
  it('bloqueia número fora da faixa do bloco deste celular', () => {
    const r = validarAbastecimento(rascunho({ numero_documento: 7000 }), contexto())
    expect(codigos(r)).toContain('DOC_FORA_DA_FAIXA')
    expect(r.podeSalvar).toBe(false)
  })

  it('bloqueia número já lançado', () => {
    const r = validarAbastecimento(rascunho(), contexto({ numerosUsados: new Set([6901]) }))
    expect(codigos(r)).toContain('DOC_JA_USADO')
  })

  // Sem faixa o repositório não tem de onde tirar número, então os dois vêm
  // nulos juntos — era esta combinação que faltava no teste, e por isso a tela
  // pedia "informe o número da ficha" num campo que o operador não pode digitar.
  it('bloqueia quando o celular não tem faixa alocada, explicando o que fazer', () => {
    const r = validarAbastecimento(rascunho({ numero_documento: null }), contexto({ bloco: null }))
    expect(codigos(r)).toContain('BLOCO_AUSENTE')
    const achado = r.achados.find((x) => x.codigo === 'BLOCO_AUSENTE')
    expect(achado?.mensagem).toContain('Peça um bloco ao escritório')
  })

  it('distingue faixa esgotada de faixa inexistente', () => {
    const r = validarAbastecimento(rascunho({ numero_documento: null }), contexto())
    expect(codigos(r)).toContain('BLOCO_ESGOTADO')
    expect(codigos(r)).not.toContain('BLOCO_AUSENTE')
    expect(r.achados.find((x) => x.codigo === 'BLOCO_ESGOTADO')?.mensagem).toContain('acabou')
  })

  it('avisa quando o bloco está acabando, sem impedir o lançamento', () => {
    const r = validarAbastecimento(rascunho({ numero_documento: 6945 }), contexto())
    expect(codigos(r)).toContain('BLOCO_ACABANDO')
    expect(r.podeSalvar).toBe(false) // aviso pendente de confirmação
    const confirmado = validarAbastecimento(
      rascunho({ numero_documento: 6945, avisos_confirmados: ['BLOCO_ACABANDO'] }),
      contexto(),
    )
    expect(confirmado.podeSalvar).toBe(true)
  })
})

describe('registrador da bomba', () => {
  it('bloqueia leitura final menor ou igual à inicial', () => {
    const r = validarAbastecimento(rascunho({ registrador_fim: 45265 }), contexto())
    expect(codigos(r)).toContain('REG_NAO_CRESCE')
  })

  // O caso que este sistema existe para pegar: o totalizador da bomba é
  // contínuo, então um salto significa diesel que saiu sem lançamento.
  it('avisa quando o início não continua o fim do abastecimento anterior', () => {
    const r = validarAbastecimento(
      rascunho({ registrador_inicio: 45300, registrador_fim: 45345 }),
      contexto({
        ultimoRegistradorComboio: {
          valor: 45265,
          numero_documento: 6900,
          momento: new Date('2026-08-20T10:00:00Z').toISOString(),
        },
      }),
    )
    const achado = r.achados.find((a) => a.codigo === 'REG_DESCONTINUO')
    expect(achado).toBeDefined()
    expect(achado?.mensagem).toContain('6900')
    expect(achado?.sugestao?.valor).toBe(45265)
  })

  it('fica calado quando o início continua exatamente o anterior', () => {
    const r = validarAbastecimento(
      rascunho(),
      contexto({
        ultimoRegistradorComboio: {
          valor: 45265,
          numero_documento: 6900,
          momento: new Date().toISOString(),
        },
      }),
    )
    expect(codigos(r)).not.toContain('REG_DESCONTINUO')
  })
})

describe('litros', () => {
  it('exige justificativa quando os litros divergem da bomba', () => {
    const r = validarAbastecimento(rascunho({ litros: 90 }), contexto())
    expect(codigos(r)).toContain('LITROS_DIVERGEM')
    expect(r.justificativasExigidas).toContain('justificativa_divergencia')
    expect(r.podeSalvar).toBe(false)
  })

  it('libera a mesma divergência assim que o motivo é escrito', () => {
    const r = validarAbastecimento(
      rascunho({ litros: 90, justificativa_divergencia: 'Bomba travou; completado com balde aferido.' }),
      contexto(),
    )
    expect(r.podeSalvar).toBe(true)
  })

  it('bloqueia volume que não cabe no tanque da frota', () => {
    const r = validarAbastecimento(
      rascunho({ litros: 800, registrador_inicio: 45265, registrador_fim: 46065 }),
      contexto(),
    )
    expect(codigos(r)).toContain('LITROS_ACIMA_DO_TANQUE')
  })
})

describe('leituras da máquina', () => {
  it('exige justificativa quando o horímetro anda para trás', () => {
    const r = validarAbastecimento(
      rascunho({ horimetro_motor: 12000 }),
      contexto({
        ultimasLeituras: {
          horimetro_motor: {
            frota_id: 'frota-1',
            tipo: 'horimetro_motor',
            valor: 12345.7,
            momento: new Date('2026-08-19T17:40:00Z').toISOString(),
            origem_tabela: 'abastecimentos',
            origem_id: 'anterior',
          },
        },
      }),
    )
    expect(codigos(r)).toContain('HORIMETRO_MOTOR_REGREDIU')
    expect(r.justificativasExigidas).toContain('justificativa_leitura')
  })

  it('bloqueia horímetro de elevador em frota que não tem elevador', () => {
    const semElevador = { ...frotaColhedora, tem_horimetro_elevador: false }
    const r = validarAbastecimento(rascunho({ horimetro_elevador: 900 }), contexto({ frota: semElevador }))
    expect(codigos(r)).toContain('SEM_ELEVADOR')
  })
})

describe('assinatura e hora', () => {
  it('bloqueia lançamento sem o aceite do operador', () => {
    const r = validarAbastecimento(rascunho({ operador_funcionario_id: null }), contexto())
    expect(codigos(r)).toContain('SEM_ASSINATURA')
  })

  it('bloqueia hora à frente do relógio do servidor', () => {
    const r = validarAbastecimento(rascunho({ hora: '16:00' }), contexto())
    expect(codigos(r)).toContain('MOMENTO_FUTURO')
  })

  it('tolera o pequeno adiantamento do relógio do celular', () => {
    // 15:10 contra um servidor em 15:00 cabe na tolerância de 15 minutos:
    // relógio de celular quase nunca está exato, e barrar isso travaria o
    // lançamento por um problema que não é do operador.
    const r = validarAbastecimento(rascunho({ hora: '15:10' }), contexto())
    expect(codigos(r)).not.toContain('MOMENTO_FUTURO')
  })
})

describe('formatação de data de negócio', () => {
  it('formata a data de dez caracteres que o servidor devolve', () => {
    expect(dataBr('2026-08-09')).toBe('09/08/2026')
  })

  // Nem todo driver respeita o tipo `date`: alguns devolvem Date, que vira ISO
  // com hora no JSON. O rótulo do gráfico não pode virar "09T00" por causa disso.
  it('tolera um ISO completo sem produzir rótulo sem sentido', () => {
    expect(dataBr('2026-08-09T00:00:00.000Z')).toBe('09/08/2026')
  })
})

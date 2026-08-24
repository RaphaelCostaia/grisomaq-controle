import type { BlocoAbastecimento, Frota, UltimaLeitura } from '@/dominio/tipos'
import type { Parametros } from '@/dominio/parametros'
import { type Achado, aviso, bloqueante, diagnosticar, justificavel, type Diagnostico } from '@/dominio/severidade'
import { formatarLeitura, formatarLitros } from '@/utilitarios/numeros'
import { dataHoraBr, instanteDe, minutosEntre } from '@/utilitarios/datas'

/** O que a tela preencheu, ainda cru (numeros ja convertidos de virgula). */
export interface RascunhoAbastecimento {
  id: string
  numero_documento: number | null
  data: string
  hora: string
  frota_id: string | null
  comboio_frota_id: string | null
  horimetro_motor: number | null
  horimetro_elevador: number | null
  odometro: number | null
  registrador_inicio: number | null
  registrador_fim: number | null
  litros: number | null
  operador_funcionario_id: string | null
  justificativa_leitura: string | null
  justificativa_divergencia: string | null
  avisos_confirmados: string[]
}

/** Tudo que a validacao precisa saber do mundo, ja carregado do Dexie. */
export interface ContextoAbastecimento {
  parametros: Parametros
  frota: Frota | null
  bloco: BlocoAbastecimento | null
  /** Numeros ja usados neste dispositivo, incluindo os que ainda nao subiram. */
  numerosUsados: Set<number>
  ultimasLeituras: Partial<Record<UltimaLeitura['tipo'], UltimaLeitura>>
  /** Fim do registrador no ultimo abastecimento deste comboio. */
  ultimoRegistradorComboio: { valor: number; numero_documento: number; momento: string } | null
  ultimoAbastecimentoDaFrota: string | null
  /** Relogio do servidor quando conhecido; sem sinal, o do aparelho. */
  agora: Date
}

/**
 * Litros informados x litros que a bomba registrou. E a conferencia que o papel
 * carbonado nunca fez, e a tela mostra a conta ao vivo enquanto o operador digita.
 */
export function conferirLitros(
  r: RascunhoAbastecimento,
  p: Parametros,
  capacidadeTanque?: number | null,
) {
  if (r.registrador_inicio === null || r.registrador_fim === null || r.litros === null) return null
  const daBomba = r.registrador_fim - r.registrador_inicio
  const diferenca = r.litros - daBomba
  const tolerado = Math.max(p.tolerancia_litros_abs, Math.abs(daBomba) * p.tolerancia_litros_pct)

  // O valor da bomba só serve de atalho se ELE PRÓPRIO for aceitável. Oferecer
  // "usar 820,0" num tanque de 650 leva o operador a um beco: ele toca, o app
  // aceita o número e continua recusando o salvamento — e ainda mostra "confere
  // com a bomba" ao lado de "não cabe no tanque". Quando a leitura da bomba é
  // implausível, o problema está no registrador, não nos litros.
  const daBombaCabe =
    daBomba > 0 && (!capacidadeTanque || daBomba <= capacidadeTanque * p.fator_capacidade_tanque)

  return { daBomba, diferenca, confere: Math.abs(diferenca) <= tolerado, daBombaCabe }
}

export function validarAbastecimento(r: RascunhoAbastecimento, ctx: ContextoAbastecimento): Diagnostico {
  const a: Achado[] = []
  const p = ctx.parametros

  // --- Numero do documento --------------------------------------------------
  // O numero e a identidade da via de papel. Sem faixa alocada o dispositivo nao
  // emite nada: e o que impede dois celulares offline de gerarem o mesmo numero.
  //
  // O numero NAO e digitado — sai da faixa do celular. Entao "numero ausente"
  // nunca significa "faltou preencher": significa que a faixa nao existe ou que
  // ela acabou. Checar a faixa ANTES do numero e o que faz a tela dizer o que o
  // operador precisa fazer, em vez de pedir um campo que nao existe na tela.
  if (!ctx.bloco) {
    a.push(
      bloqueante(
        'BLOCO_AUSENTE',
        'numero_documento',
        'Este celular não tem faixa de numeração. Peça um bloco ao escritório.',
      ),
    )
  } else if (r.numero_documento === null) {
    a.push(
      bloqueante(
        'BLOCO_ESGOTADO',
        'numero_documento',
        'A faixa deste celular (' +
          ctx.bloco.numero_inicial +
          ' a ' +
          ctx.bloco.numero_final +
          ') acabou. Peça outro bloco ao escritório.',
      ),
    )
  } else if (r.numero_documento < ctx.bloco.numero_inicial || r.numero_documento > ctx.bloco.numero_final) {
    a.push(
      bloqueante(
        'DOC_FORA_DA_FAIXA',
        'numero_documento',
        'Fora da faixa deste celular (' + ctx.bloco.numero_inicial + ' a ' + ctx.bloco.numero_final + ').',
      ),
    )
  } else if (ctx.numerosUsados.has(r.numero_documento)) {
    a.push(bloqueante('DOC_JA_USADO', 'numero_documento', 'A ficha ' + r.numero_documento + ' já foi lançada.'))
  } else if (ctx.bloco.numero_final - r.numero_documento < p.blocos_aviso_restante) {
    a.push(
      aviso(
        'BLOCO_ACABANDO',
        'numero_documento',
        'Restam ' +
          (ctx.bloco.numero_final - r.numero_documento) +
          ' números neste bloco. Peça outro ao escritório.',
      ),
    )
  }

  // --- Quando ---------------------------------------------------------------
  if (!r.data || !r.hora) {
    a.push(bloqueante('MOMENTO_AUSENTE', 'hora', 'Informe a data e a hora.'))
  } else if (minutosEntre(ctx.agora, instanteDe(r.data, r.hora)) > p.minutos_tolerancia_futuro) {
    a.push(
      bloqueante(
        'MOMENTO_FUTURO',
        'hora',
        'A hora informada está à frente do relógio. Confira a hora deste celular.',
      ),
    )
  }

  // --- Frota ----------------------------------------------------------------
  if (!r.frota_id || !ctx.frota) {
    a.push(bloqueante('FROTA_AUSENTE', 'frota_id', 'Escolha a frota abastecida.'))
  } else if (!ctx.frota.ativo) {
    a.push(bloqueante('FROTA_INATIVA', 'frota_id', 'Esta frota está inativa. Procure o escritório.'))
  }

  // --- Registrador da bomba -------------------------------------------------
  if (r.registrador_inicio === null) {
    a.push(bloqueante('REG_INICIO_AUSENTE', 'registrador_inicio', 'Informe a leitura inicial da bomba.'))
  }
  if (r.registrador_fim === null) {
    a.push(bloqueante('REG_FIM_AUSENTE', 'registrador_fim', 'Informe a leitura final da bomba.'))
  }
  if (r.registrador_inicio !== null && r.registrador_fim !== null && r.registrador_fim <= r.registrador_inicio) {
    a.push(
      bloqueante('REG_NAO_CRESCE', 'registrador_fim', 'A leitura final da bomba tem que ser maior que a inicial.'),
    )
  }

  // A validacao de maior valor do sistema. O totalizador da bomba e continuo: o
  // inicio de um abastecimento tem que ser o fim do anterior. Um salto aqui e
  // diesel que saiu sem lancamento - no papel isso so aparecia no fechamento.
  const anterior = ctx.ultimoRegistradorComboio
  if (anterior && r.registrador_inicio !== null && Math.abs(r.registrador_inicio - anterior.valor) > 0.01) {
    a.push(
      aviso(
        'REG_DESCONTINUO',
        'registrador_inicio',
        'O último abastecimento deste comboio (ficha ' +
          anterior.numero_documento +
          ', ' +
          dataHoraBr(new Date(anterior.momento)) +
          ') terminou em ' +
          formatarLeitura(anterior.valor) +
          '. Falta lançar algum abastecimento?',
        { rotulo: 'Usar ' + formatarLeitura(anterior.valor), valor: anterior.valor },
      ),
    )
  }

  // --- Litros ---------------------------------------------------------------
  if (r.litros === null || r.litros <= 0) {
    a.push(bloqueante('LITROS_AUSENTE', 'litros', 'Informe quantos litros foram abastecidos.'))
  } else if (ctx.frota?.capacidade_tanque_litros) {
    const teto = ctx.frota.capacidade_tanque_litros * p.fator_capacidade_tanque
    if (r.litros > teto) {
      a.push(
        bloqueante(
          'LITROS_ACIMA_DO_TANQUE',
          'litros',
          formatarLitros(r.litros) +
            ' não cabe no tanque desta frota (' +
            formatarLitros(ctx.frota.capacidade_tanque_litros) +
            ').',
        ),
      )
    }
  }

  const conferencia = conferirLitros(r, p)
  if (conferencia && !conferencia.confere) {
    a.push(
      justificavel(
        'LITROS_DIVERGEM',
        'justificativa_divergencia',
        'A bomba registrou ' +
          formatarLitros(conferencia.daBomba) +
          ' e você informou ' +
          formatarLitros(r.litros) +
          '. Explique a diferença ou corrija.',
      ),
    )
  }

  // --- Leituras da maquina --------------------------------------------------
  // Campo de elevador em frota sem elevador nao e aviso: e frota errada ou
  // cadastro errado. A tela ja mostra esses campos desabilitados.
  if (ctx.frota && !ctx.frota.tem_horimetro_elevador && r.horimetro_elevador !== null) {
    a.push(
      bloqueante(
        'SEM_ELEVADOR',
        'horimetro_elevador',
        'A frota ' + ctx.frota.numero + ' não tem horímetro de elevador.',
      ),
    )
  }
  if (ctx.frota && !ctx.frota.tem_odometro && r.odometro !== null) {
    a.push(bloqueante('SEM_ODOMETRO', 'odometro', 'A frota ' + ctx.frota.numero + ' não tem hodômetro.'))
  }

  conferirLeitura(a, 'horimetro_motor', r.horimetro_motor, ctx.ultimasLeituras.horimetro_motor, 'Horímetro do motor')
  conferirLeitura(a, 'horimetro_elevador', r.horimetro_elevador, ctx.ultimasLeituras.horimetro_elevador, 'Horímetro do elevador')
  conferirLeitura(a, 'odometro', r.odometro, ctx.ultimasLeituras.odometro, 'Hodômetro')

  // --- Repeticao ------------------------------------------------------------
  if (ctx.ultimoAbastecimentoDaFrota && r.data && r.hora) {
    const minutos = minutosEntre(new Date(ctx.ultimoAbastecimentoDaFrota), instanteDe(r.data, r.hora))
    if (minutos >= 0 && minutos < p.minutos_min_entre_abastecimentos) {
      a.push(
        aviso(
          'ABASTECIMENTO_SEGUIDO',
          'frota_id',
          'Esta frota abasteceu há ' + minutos + ' minutos. É outro abastecimento mesmo?',
        ),
      )
    }
  }

  // --- Assinatura -----------------------------------------------------------
  if (!r.operador_funcionario_id) {
    a.push(
      bloqueante(
        'SEM_ASSINATURA',
        'operador_funcionario_id',
        'O operador que recebeu o diesel precisa confirmar com o PIN.',
      ),
    )
  }

  return diagnosticar(a, {
    justificativas: {
      justificativa_divergencia: r.justificativa_divergencia,
      justificativa_leitura: r.justificativa_leitura,
    },
    avisosConfirmados: r.avisos_confirmados,
  })
}

/**
 * Leitura que anda para tras e rara mas acontece: painel trocado, horimetro
 * zerado. Exigimos o motivo em vez de bloquear - senao o operador arredonda o
 * numero ate o formulario aceitar, e o dado fica errado parecendo certo.
 */
function conferirLeitura(
  achados: Achado[],
  campo: string,
  valor: number | null,
  ultima: UltimaLeitura | undefined,
  rotulo: string,
): void {
  if (valor === null) return
  if (valor < 0) {
    achados.push(bloqueante(campo.toUpperCase() + '_NEGATIVO', campo, rotulo + ' não pode ser negativo.'))
    return
  }
  if (!ultima) return

  if (valor < ultima.valor) {
    achados.push(
      justificavel(
        campo.toUpperCase() + '_REGREDIU',
        'justificativa_leitura',
        rotulo +
          ' está menor que a última leitura (' +
          formatarLeitura(ultima.valor) +
          ' em ' +
          dataHoraBr(new Date(ultima.momento)) +
          '). Explique o motivo.',
      ),
    )
  }
}

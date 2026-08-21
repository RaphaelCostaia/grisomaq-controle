import { db, lerMeta } from '../db'
import { enfileirar } from '../outbox'
import { sincronizarSePuder } from '../sincronizacao/motor'
import type { Apontamento, ApontamentoItem, UltimaLeitura } from '@/dominio/tipos'
import type {
  ContextoApontamento,
  ContextoItem,
  RascunhoApontamento,
  RascunhoItem,
} from '@/dominio/apontamento/regras'
import { mesclarParametros, PARAMETROS_PADRAO } from '@/dominio/parametros'
import { cifrarPin } from '@/autenticacao/pin-cifrado'
import { hashDocumento, novoId } from '@/utilitarios/id'
import { idDoDispositivo, versaoDoApp } from '@/utilitarios/dispositivo'
import { hojeOperacional } from '@/utilitarios/datas'
import { formatarLeitura } from '@/utilitarios/numeros'
import type { SessaoCampo } from '@/autenticacao/login'

// --- Cabeçalho ---------------------------------------------------------------

export async function novoRascunhoApontamento(sessao: SessaoCampo): Promise<RascunhoApontamento> {
  return {
    id: novoId(),
    data: hojeOperacional(),
    frente_id: sessao.frente_padrao_id,
    turno_id: null,
    // Quem está com o celular na mão é o responsável, até dizerem o contrário.
    responsavel_funcionario_id: sessao.funcionario_id,
    observacao: null,
  }
}

export async function apontamentosDoDia(data = hojeOperacional()): Promise<Apontamento[]> {
  return (await db.apontamentos.where('data').equals(data).toArray())
    .filter((a) => !a.excluido)
    .sort((a, b) => a.criado_em.localeCompare(b.criado_em))
}

export async function contextoDoApontamento(): Promise<ContextoApontamento> {
  const [parametrosBrutos, existentes] = await Promise.all([
    lerMeta<Array<{ chave: string; valor: unknown }>>('parametros'),
    db.apontamentos.toArray(),
  ])

  return {
    parametros: parametrosBrutos ? mesclarParametros(parametrosBrutos) : PARAMETROS_PADRAO,
    existentes: existentes
      .filter((a) => !a.excluido)
      .map((a) => ({ id: a.id, data: a.data, frente_id: a.frente_id, turno_id: a.turno_id })),
  }
}

export async function salvarApontamento(
  r: RascunhoApontamento,
  sessao: SessaoCampo,
): Promise<Apontamento> {
  const agora = new Date().toISOString()

  const registro: Apontamento = {
    id: r.id,
    data: r.data,
    frente_id: r.frente_id!,
    turno_id: r.turno_id!,
    responsavel_funcionario_id: r.responsavel_funcionario_id!,
    observacao: r.observacao,
    // Nasce como rascunho: a ficha vive o turno inteiro, ganhando linhas.
    status: 'rascunho',
    finalizado_em: null,
    criado_por: sessao.funcionario_id,
    criado_em: agora,
    criado_em_dispositivo: agora,
    atualizado_por: null,
    atualizado_em: agora,
    versao: 1,
    dispositivo_id: idDoDispositivo(),
    app_versao: versaoDoApp,
    excluido: false,
    excluido_em: null,
    excluido_por: null,
    _sync: 'pendente',
  }

  await db.transaction('rw', [db.apontamentos, db.outbox], async () => {
    await db.apontamentos.put(registro)
    await enfileirar({
      tabela: 'apontamentos',
      registro_id: registro.id,
      tipo: 'inserir',
      payload: semMarcasLocais(registro),
    })
  })

  sincronizarSePuder()
  return registro
}

// --- Linhas ------------------------------------------------------------------

export async function itensDoApontamento(apontamentoId: string): Promise<ApontamentoItem[]> {
  return (await db.apontamento_itens.where('apontamento_id').equals(apontamentoId).toArray())
    .filter((i) => !i.excluido)
    .sort((a, b) => a.seq - b.seq)
}

export function paraRascunhoItem(i: ApontamentoItem): RascunhoItem {
  return {
    id: i.id,
    seq: i.seq,
    funcionario_id: i.funcionario_id,
    frota_id: i.frota_id,
    odometro_inicial: i.odometro_inicial,
    odometro_final: i.odometro_final,
    elevador_inicial: i.elevador_inicial,
    elevador_final: i.elevador_final,
    justificativa_leitura: i.justificativa_leitura,
    assinado: i.assinatura_status !== 'pendente',
    avisos_confirmados: i.avisos_confirmados ?? [],
  }
}

export async function novoRascunhoItem(apontamentoId: string): Promise<RascunhoItem> {
  const existentes = await itensDoApontamento(apontamentoId)
  return {
    id: novoId(),
    // A numeração continua a do papel: a ficha tem 25 linhas numeradas.
    seq: (existentes.at(-1)?.seq ?? 0) + 1,
    funcionario_id: null,
    frota_id: null,
    odometro_inicial: null,
    odometro_final: null,
    elevador_inicial: null,
    elevador_final: null,
    justificativa_leitura: null,
    assinado: false,
    avisos_confirmados: [],
  }
}

export async function contextoDoItem(
  apontamentoId: string,
  r: RascunhoItem,
): Promise<ContextoItem> {
  const apontamento = await db.apontamentos.get(apontamentoId)

  const [frota, turno, parametrosBrutos, irmaos] = await Promise.all([
    r.frota_id ? db.mestre_frotas.get(r.frota_id) : Promise.resolve(undefined),
    apontamento?.turno_id ? db.mestre_turnos.get(apontamento.turno_id) : Promise.resolve(undefined),
    lerMeta<Array<{ chave: string; valor: unknown }>>('parametros'),
    itensDoApontamento(apontamentoId),
  ])

  const leituras = r.frota_id
    ? ((await db.mestre_ultimas_leituras.where('frota_id').equals(r.frota_id).toArray()) as UltimaLeitura[])
    : []
  const ultimasLeituras: ContextoItem['ultimasLeituras'] = {}
  for (const l of leituras) ultimasLeituras[l.tipo] = l

  return {
    parametros: parametrosBrutos ? mesclarParametros(parametrosBrutos) : PARAMETROS_PADRAO,
    frota: frota ?? null,
    turno: turno ?? null,
    ultimasLeituras,
    funcionariosNaFicha: irmaos.map((i) => ({ itemId: i.id, funcionario_id: i.funcionario_id })),
    frotasNaFicha: irmaos.map((i) => ({ itemId: i.id, frota_id: i.frota_id })),
  }
}

export async function salvarItem(
  apontamentoId: string,
  r: RascunhoItem,
  sessao: SessaoCampo,
): Promise<void> {
  const agora = new Date().toISOString()
  const existente = await db.apontamento_itens.get(r.id)

  const registro: ApontamentoItem = {
    id: r.id,
    apontamento_id: apontamentoId,
    seq: r.seq,
    funcionario_id: r.funcionario_id!,
    frota_id: r.frota_id!,
    odometro_inicial: r.odometro_inicial,
    odometro_final: r.odometro_final,
    elevador_inicial: r.elevador_inicial,
    elevador_final: r.elevador_final,
    justificativa_leitura: r.justificativa_leitura,
    observacao: null,
    assinatura_status: existente?.assinatura_status ?? 'pendente',
    assinado_em: existente?.assinado_em ?? null,
    avisos_confirmados: r.avisos_confirmados,
    criado_por: existente?.criado_por ?? sessao.funcionario_id,
    criado_em: existente?.criado_em ?? agora,
    criado_em_dispositivo: existente?.criado_em_dispositivo ?? agora,
    atualizado_por: existente ? sessao.funcionario_id : null,
    atualizado_em: agora,
    versao: existente?.versao ?? 1,
    dispositivo_id: idDoDispositivo(),
    app_versao: versaoDoApp,
    excluido: false,
    excluido_em: null,
    excluido_por: null,
    _sync: 'pendente',
  }

  await db.transaction('rw', [db.apontamento_itens, db.outbox], async () => {
    await db.apontamento_itens.put(registro)
    await enfileirar({
      tabela: 'apontamento_itens',
      registro_id: registro.id,
      tipo: existente ? 'atualizar' : 'inserir',
      payload: semMarcasLocais(registro),
      ...(existente ? { base_versao: existente.versao } : {}),
    })
  })

  sincronizarSePuder()
}

// --- Assinatura --------------------------------------------------------------

/**
 * Texto do aceite de uma linha. É o que fica gravado na trilha, e é o que a
 * pessoa lê antes de digitar o PIN — sem ele, a assinatura provaria apenas que
 * alguém digitou quatro números.
 */
export function textoDeAceiteItem(
  nomeFuncionario: string,
  numeroFrota: string,
  item: RascunhoItem,
): string {
  const partes: string[] = []
  if (item.odometro_inicial !== null || item.odometro_final !== null) {
    partes.push(
      'hodômetro de ' + formatarLeitura(item.odometro_inicial) + ' a ' + formatarLeitura(item.odometro_final),
    )
  }
  if (item.elevador_inicial !== null || item.elevador_final !== null) {
    partes.push(
      'elevador de ' + formatarLeitura(item.elevador_inicial) + ' a ' + formatarLeitura(item.elevador_final),
    )
  }

  return (
    'Eu, ' + nomeFuncionario + ', confirmo que trabalhei na frota ' + numeroFrota +
    (partes.length > 0 ? ', com ' + partes.join(' e ') : '') + ', conforme lançado nesta ficha.'
  )
}

export async function assinarItem(
  itemId: string,
  textoAceite: string,
  pin: string,
): Promise<void> {
  const item = await db.apontamento_itens.get(itemId)
  if (!item) throw new Error('Linha não encontrada neste aparelho.')

  const agora = new Date().toISOString()
  const pinCifrado = await cifrarPin(pin)

  const assinatura = {
    id: novoId(),
    tipo_documento: 'apontamento_item' as const,
    documento_id: item.id,
    funcionario_id: item.funcionario_id,
    metodo: 'PIN' as const,
    texto_aceite: textoAceite,
    hash_documento: await hashDocumento({
      apontamento_id: item.apontamento_id,
      seq: item.seq,
      funcionario_id: item.funcionario_id,
      frota_id: item.frota_id,
      odometro_inicial: item.odometro_inicial,
      odometro_final: item.odometro_final,
      elevador_inicial: item.elevador_inicial,
      elevador_final: item.elevador_final,
    }),
    momento_dispositivo: agora,
    dispositivo_id: idDoDispositivo(),
    app_versao: versaoDoApp,
    latitude: null,
    longitude: null,
    precisao_metros: null,
    validacao_pin: 'validado_local' as const,
    _sync: 'pendente' as const,
  }

  const alteracao = { assinatura_status: 'validado_local' as const, assinado_em: agora }

  await db.transaction('rw', [db.apontamento_itens, db.assinaturas_aceite, db.outbox], async () => {
    await db.apontamento_itens.update(itemId, { ...alteracao, _sync: 'pendente' })
    await db.assinaturas_aceite.put(assinatura)
    await enfileirar({
      tabela: 'apontamento_itens',
      registro_id: itemId,
      tipo: 'atualizar',
      payload: alteracao,
      base_versao: item.versao,
    })
    await enfileirar({
      tabela: 'assinaturas_aceite',
      registro_id: assinatura.id,
      tipo: 'inserir',
      payload: semMarcasLocais(assinatura),
      ...(pinCifrado ? { pin_cifrado: pinCifrado } : {}),
    })
  })

  sincronizarSePuder()
}

// --- Fechamento --------------------------------------------------------------

export async function fecharApontamento(id: string, sessao: SessaoCampo): Promise<void> {
  const apontamento = await db.apontamentos.get(id)
  if (!apontamento) throw new Error('Ficha não encontrada neste aparelho.')

  const alteracao = {
    status: 'finalizado' as const,
    finalizado_em: new Date().toISOString(),
    atualizado_por: sessao.funcionario_id,
    atualizado_em: new Date().toISOString(),
  }

  await db.transaction('rw', [db.apontamentos, db.outbox], async () => {
    await db.apontamentos.update(id, { ...alteracao, _sync: 'pendente' })
    await enfileirar({
      tabela: 'apontamentos',
      registro_id: id,
      tipo: 'atualizar',
      payload: alteracao,
      base_versao: apontamento.versao,
    })
  })

  sincronizarSePuder()
}

function semMarcasLocais(registro: object): Record<string, unknown> {
  const copia: Record<string, unknown> = { ...registro }
  delete copia._sync
  delete copia._erro
  return copia
}

import { db, lerMeta } from '../db'
import { enfileirar } from '../outbox'
import { sincronizarSePuder } from '../sincronizacao/motor'
import type { Abastecimento, UltimaLeitura } from '@/dominio/tipos'
import type { ContextoAbastecimento, RascunhoAbastecimento } from '@/dominio/abastecimento/regras'
import { mesclarParametros, PARAMETROS_PADRAO } from '@/dominio/parametros'
import { hashDocumento, novoId } from '@/utilitarios/id'
import { idDoDispositivo, versaoDoApp } from '@/utilitarios/dispositivo'
import { hojeOperacional, horaDe, instanteDe } from '@/utilitarios/datas'
import type { SessaoCampo } from '@/autenticacao/login'

/** Rascunho em branco, já com o que o app consegue preencher sozinho. */
export async function novoRascunho(): Promise<RascunhoAbastecimento> {
  const bloco = await blocoDoDispositivo()
  const agora = new Date()

  return {
    id: novoId(),
    numero_documento: bloco ? await proximoNumero(bloco.numero_inicial, bloco.numero_final) : null,
    data: hojeOperacional(),
    hora: horaDe(agora),
    frota_id: null,
    comboio_frota_id: bloco?.comboio_frota_id ?? null,
    horimetro_motor: null,
    horimetro_elevador: null,
    odometro: null,
    registrador_inicio: null,
    registrador_fim: null,
    litros: null,
    operador_funcionario_id: null,
    justificativa_leitura: null,
    justificativa_divergencia: null,
    avisos_confirmados: [],
  }
}

export async function blocoDoDispositivo() {
  const dispositivo = idDoDispositivo()
  const blocos = await db.mestre_blocos.toArray()
  return blocos.find((b) => b.ativo && b.dispositivo_id === dispositivo) ?? null
}

/**
 * Próximo número livre da faixa deste celular. Conta os lançamentos LOCAIS,
 * inclusive os que ainda não subiram: se olhasse só o servidor, o operador
 * offline repetiria o número da ficha anterior.
 */
export async function proximoNumero(inicial: number, final: number): Promise<number | null> {
  const usados = await numerosUsados()
  for (let n = inicial; n <= final; n++) {
    if (!usados.has(n)) return n
  }
  return null
}

export async function numerosUsados(): Promise<Set<number>> {
  const lancados = await db.abastecimentos.toArray()
  return new Set(lancados.filter((a) => !a.excluido).map((a) => a.numero_documento))
}

/** Monta tudo que a validação precisa saber, lendo só do cache local. */
export async function contextoDeValidacao(
  rascunho: RascunhoAbastecimento,
): Promise<ContextoAbastecimento> {
  const [bloco, frota, parametrosBrutos] = await Promise.all([
    blocoDoDispositivo(),
    rascunho.frota_id ? db.mestre_frotas.get(rascunho.frota_id) : Promise.resolve(undefined),
    lerMeta<Array<{ chave: string; valor: unknown }>>('parametros'),
  ])

  const leituras = rascunho.frota_id
    ? await db.mestre_ultimas_leituras.where('frota_id').equals(rascunho.frota_id).toArray()
    : []

  const ultimasLeituras: ContextoAbastecimento['ultimasLeituras'] = {}
  for (const l of leituras as UltimaLeitura[]) ultimasLeituras[l.tipo] = l

  return {
    parametros: parametrosBrutos ? mesclarParametros(parametrosBrutos) : PARAMETROS_PADRAO,
    frota: frota ?? null,
    bloco,
    numerosUsados: await numerosUsados(),
    ultimasLeituras,
    ultimoRegistradorComboio: await ultimoRegistradorDoComboio(rascunho.comboio_frota_id, rascunho.id),
    ultimoAbastecimentoDaFrota: await ultimoMomentoDaFrota(rascunho.frota_id, rascunho.id),
    agora: await agoraDoServidor(),
  }
}

/**
 * Fim do registrador no último abastecimento deste comboio. É o que sustenta a
 * validação de continuidade da bomba — e o campo já vem preenchido com ele.
 */
export async function ultimoRegistradorDoComboio(
  comboioId: string | null,
  ignorarId?: string,
): Promise<ContextoAbastecimento['ultimoRegistradorComboio']> {
  if (!comboioId) return null

  const doComboio = (await db.abastecimentos.where('comboio_frota_id').equals(comboioId).toArray())
    .filter((a) => !a.excluido && a.id !== ignorarId)
    .sort((a, b) => b.momento.localeCompare(a.momento))

  const ultimo = doComboio[0]
  if (!ultimo) return null
  return {
    valor: ultimo.registrador_fim,
    numero_documento: ultimo.numero_documento,
    momento: ultimo.momento,
  }
}

async function ultimoMomentoDaFrota(frotaId: string | null, ignorarId?: string): Promise<string | null> {
  if (!frotaId) return null
  const daFrota = (await db.abastecimentos.where('frota_id').equals(frotaId).toArray())
    .filter((a) => !a.excluido && a.id !== ignorarId)
    .sort((a, b) => b.momento.localeCompare(a.momento))
  return daFrota[0]?.momento ?? null
}

/**
 * Relógio do servidor, corrigido pelo desvio medido no último sync. Sem sinal
 * cai no relógio do aparelho — que é justamente o que pode estar errado, então
 * a validação de "hora no futuro" tem tolerância generosa.
 */
async function agoraDoServidor(): Promise<Date> {
  const desvio = (await lerMeta<number>('desvio_relogio_ms')) ?? 0
  return new Date(Date.now() - desvio)
}

/**
 * Grava o abastecimento e o aceite do operador.
 *
 * Registro de domínio, trilha de assinatura e itens de fila entram na MESMA
 * transação: ou tudo é gravado, ou nada. Um lançamento salvo sem item de fila
 * seria um abastecimento que nunca sobe e que ninguém percebe que não subiu.
 */
export async function salvarAbastecimento(
  rascunho: RascunhoAbastecimento,
  sessao: SessaoCampo,
): Promise<Abastecimento> {
  const agora = new Date().toISOString()
  const momento = instanteDe(rascunho.data, rascunho.hora).toISOString()

  const registro: Abastecimento = {
    id: rascunho.id,
    numero_documento: rascunho.numero_documento!,
    bloco_id: (await blocoDoDispositivo())?.id ?? null,
    data: rascunho.data,
    hora: rascunho.hora,
    momento,
    frota_id: rascunho.frota_id!,
    comboio_frota_id: rascunho.comboio_frota_id,
    horimetro_motor: rascunho.horimetro_motor,
    horimetro_elevador: rascunho.horimetro_elevador,
    odometro: rascunho.odometro,
    registrador_inicio: rascunho.registrador_inicio!,
    registrador_fim: rascunho.registrador_fim!,
    litros: rascunho.litros!,
    operador_funcionario_id: rascunho.operador_funcionario_id!,
    abastecedor_funcionario_id: sessao.funcionario_id,
    justificativa_leitura: rascunho.justificativa_leitura,
    justificativa_divergencia: rascunho.justificativa_divergencia,
    observacao: null,
    status: 'finalizado',
    avisos_confirmados: rascunho.avisos_confirmados,
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

  const textoAceite = textoDeAceite(registro)
  const assinatura = {
    id: novoId(),
    tipo_documento: 'abastecimento' as const,
    documento_id: registro.id,
    funcionario_id: registro.operador_funcionario_id,
    metodo: 'PIN' as const,
    texto_aceite: textoAceite,
    hash_documento: await hashDocumento(paraHash(registro)),
    momento_dispositivo: agora,
    dispositivo_id: idDoDispositivo(),
    app_versao: versaoDoApp,
    latitude: null,
    longitude: null,
    precisao_metros: null,
    validacao_pin: 'validado_local' as const,
    _sync: 'pendente' as const,
  }

  await db.transaction('rw', [db.abastecimentos, db.assinaturas_aceite, db.outbox], async () => {
    await db.abastecimentos.put(registro)
    await db.assinaturas_aceite.put(assinatura)
    await enfileirar({
      tabela: 'abastecimentos',
      registro_id: registro.id,
      tipo: 'inserir',
      payload: semMarcasLocais(registro),
    })
    await enfileirar({
      tabela: 'assinaturas_aceite',
      registro_id: assinatura.id,
      tipo: 'inserir',
      payload: semMarcasLocais(assinatura),
    })
  })

  sincronizarSePuder()
  return registro
}

/**
 * O texto que o operador vê na hora de digitar o PIN. Sem ele, a assinatura
 * prova apenas que alguém digitou quatro números — não o que foi aceito.
 */
export function textoDeAceite(a: {
  litros: number
  numero_documento: number
  data: string
  hora: string
}): string {
  return (
    'Confirmo o recebimento de ' +
    a.litros.toLocaleString('pt-BR', { minimumFractionDigits: 1 }) +
    ' litros de diesel na frota, conforme a ficha nº ' +
    a.numero_documento +
    ' de ' +
    a.data.split('-').reverse().join('/') +
    ' às ' +
    a.hora +
    '.'
  )
}

/** Campos que definem o documento assinado — a base do hash da trilha. */
function paraHash(a: Abastecimento): Record<string, unknown> {
  return {
    numero_documento: a.numero_documento,
    momento: a.momento,
    frota_id: a.frota_id,
    registrador_inicio: a.registrador_inicio,
    registrador_fim: a.registrador_fim,
    litros: a.litros,
    operador_funcionario_id: a.operador_funcionario_id,
  }
}

/** `_sync` e `_erro` são controle local; o servidor não conhece essas colunas. */
function semMarcasLocais(registro: object): Record<string, unknown> {
  const copia: Record<string, unknown> = { ...registro }
  delete copia._sync
  delete copia._erro
  return copia
}

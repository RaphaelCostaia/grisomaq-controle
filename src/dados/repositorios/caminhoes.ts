import { db, lerMeta } from '../db'
import { enfileirar } from '../outbox'
import { sincronizarSePuder } from '../sincronizacao/motor'
import type { CaminhaoCiclo } from '@/dominio/tipos'
import type { ContextoCiclo, RascunhoCiclo } from '@/dominio/caminhoes/regras'
import { resolverSaidaDoCiclo, resolverSaidaRelativa } from '@/dominio/caminhoes/regras'
import { mesclarParametros, PARAMETROS_PADRAO } from '@/dominio/parametros'
import { novoId } from '@/utilitarios/id'
import { idDoDispositivo, versaoDoApp } from '@/utilitarios/dispositivo'
import { hojeOperacional, horaDe } from '@/utilitarios/datas'
import type { SessaoCampo } from '@/autenticacao/login'

export async function novoRascunhoCiclo(): Promise<RascunhoCiclo> {
  return {
    id: novoId(),
    data: hojeOperacional(),
    fazenda_id: null,
    caminhao_id: null,
    carreta1_id: null,
    carreta2_id: null,
    // A hora vem do relógio e é editável: o operador às vezes só consegue
    // lançar minutos depois que o caminhão entrou.
    hora_chegada: horaDe(new Date()),
    hora_saida: null,
    lider_id: null,
    observacao: null,
    avisos_confirmados: [],
  }
}

/** Ciclos sem saída registrada — é o que a tela do pátio mostra. */
export async function ciclosAbertos(): Promise<CaminhaoCiclo[]> {
  return (await db.caminhao_ciclos.toArray())
    .filter((c) => !c.excluido && c.saida_em === null)
    .sort((a, b) => a.chegada_em.localeCompare(b.chegada_em))
}

export async function ciclosConcluidosDoDia(data = hojeOperacional()): Promise<CaminhaoCiclo[]> {
  return (await db.caminhao_ciclos.where('data').equals(data).toArray())
    .filter((c) => !c.excluido && c.saida_em !== null)
    .sort((a, b) => b.saida_em!.localeCompare(a.saida_em!))
}

export async function contextoDeValidacaoCiclo(r: RascunhoCiclo): Promise<ContextoCiclo> {
  const [caminhao, parametrosBrutos, abertos] = await Promise.all([
    r.caminhao_id ? db.mestre_veiculos.get(r.caminhao_id) : Promise.resolve(undefined),
    lerMeta<Array<{ chave: string; valor: unknown }>>('parametros'),
    ciclosAbertos(),
  ])

  return {
    parametros: parametrosBrutos ? mesclarParametros(parametrosBrutos) : PARAMETROS_PADRAO,
    caminhao: caminhao ?? null,
    ciclosAbertos: abertos.map((c) => ({
      id: c.id,
      caminhao_id: c.caminhao_id,
      carreta1_id: c.carreta1_id,
      carreta2_id: c.carreta2_id,
    })),
    agora: new Date(),
  }
}

export async function salvarChegada(r: RascunhoCiclo, sessao: SessaoCampo): Promise<CaminhaoCiclo> {
  const agora = new Date().toISOString()
  const { chegada } = resolverSaidaDoCiclo(r)

  const registro: CaminhaoCiclo = {
    id: r.id,
    data: r.data,
    fazenda_id: r.fazenda_id,
    caminhao_id: r.caminhao_id!,
    carreta1_id: r.carreta1_id,
    carreta2_id: r.carreta2_id,
    chegada_em: chegada.toISOString(),
    saida_em: null,
    lider_id: r.lider_id,
    lider_nome_livre: null,
    frente_id: sessao.frente_padrao_id,
    turno_id: null,
    observacao: r.observacao,
    status: 'finalizado',
    avisos_confirmados: r.avisos_confirmados,
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

  await db.transaction('rw', [db.caminhao_ciclos, db.outbox], async () => {
    await db.caminhao_ciclos.put(registro)
    await enfileirar({
      tabela: 'caminhao_ciclos',
      registro_id: registro.id,
      tipo: 'inserir',
      payload: semMarcasLocais(registro),
    })
  })

  sincronizarSePuder()
  return registro
}

/**
 * Fecha o ciclo. É a operação mais frequente da tela e precisa ser um toque só:
 * a hora vem do relógio, e o operador confirma ou corrige.
 */
export async function registrarSaida(
  cicloId: string,
  sessao: SessaoCampo,
  horaSaida?: string,
): Promise<void> {
  const ciclo = await db.caminhao_ciclos.get(cicloId)
  if (!ciclo) throw new Error('Ciclo não encontrado neste aparelho.')

  // Sem hora informada, a saída é agora — e agora é sempre depois da chegada.
  // Passar por uma string de hora aqui só criaria chance de erro de virada de
  // dia num caso que não tem ambiguidade nenhuma.
  const saida = horaSaida
    ? resolverSaidaRelativa(new Date(ciclo.chegada_em), horaSaida).saida
    : new Date()

  const alteracao = {
    saida_em: saida.toISOString(),
    atualizado_por: sessao.funcionario_id,
    atualizado_em: new Date().toISOString(),
  }

  await db.transaction('rw', [db.caminhao_ciclos, db.outbox], async () => {
    await db.caminhao_ciclos.update(cicloId, { ...alteracao, _sync: 'pendente' })
    await enfileirar({
      tabela: 'caminhao_ciclos',
      registro_id: cicloId,
      tipo: 'atualizar',
      payload: alteracao,
      // A versão que o celular conhecia. O servidor usa isso para saber se o
      // escritório mexeu no ciclo enquanto ele estava fora de alcance.
      base_versao: ciclo.versao,
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

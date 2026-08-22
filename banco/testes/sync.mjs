/**
 * Testes de comportamento do motor de sincronizacao, contra Postgres de verdade
 * e com RLS ligada (rodando como `authenticated`, nunca como superusuario).
 *
 * O que estes testes protegem, em ordem de importancia:
 *   1. Reenviar a mesma operacao NAO duplica o lancamento. E o modo de falha
 *      numero um em sinal instavel: o servidor grava e a resposta se perde.
 *   2. Uma constraint violada NAO descarta o payload do campo. O operador
 *      preencheu; o dado tem que sobreviver ate alguem decidir o que fazer.
 *   3. Um erro numa operacao NAO derruba as outras do mesmo lote.
 *   4. Um funcionario nao enxerga lancamento de outro.
 *
 *   npm run db:testar
 */
import { criarBanco, comoFuncionario, literal } from '../banco-de-teste.mjs'

let passou = 0
let falhou = 0

function verificar(descricao, condicao, detalhe) {
  if (condicao) {
    passou++
    console.log(`  ok    ${descricao}`)
  } else {
    falhou++
    console.error(`  FALHA ${descricao}`)
    if (detalhe !== undefined) console.error(`        ${JSON.stringify(detalhe)}`)
  }
}

// PGlite despeja o bundle inteiro no stack de erro. Sem isto, uma falha de SQL
// vira 12 mil caracteres de minificado e o erro de verdade se perde.
process.on('uncaughtException', (erro) => {
  console.error(`\n  ERRO SQL: ${erro.message}`)
  if (erro.where) console.error(`  em: ${String(erro.where).split('\n')[0]}`)
  if (erro.internalQuery) console.error(`  trecho: ${String(erro.internalQuery).trim().slice(0, 200)}`)
  if (erro.hint) console.error(`  dica: ${erro.hint}`)
  process.exit(1)
})

const db = await criarBanco()

// --- Massa de teste ---------------------------------------------------------

const ID = {
  operador: '01920000-0000-7000-8000-000000000001',
  outro: '01920000-0000-7000-8000-000000000002',
  admin: '01920000-0000-7000-8000-000000000003',
  frota: '01920000-0000-7000-8000-000000000010',
  comboio: '01920000-0000-7000-8000-000000000011',
  bloco: '01920000-0000-7000-8000-000000000020',
  cavalo: '01920000-0000-7000-8000-000000000030',
  fazenda: '01920000-0000-7000-8000-000000000040',
}

await db.exec(`
  insert into public.funcionarios (id, codigo, nome, papel) values
    ('${ID.operador}', '1001', 'Operador de Comboio', 'campo'),
    ('${ID.outro}',    '1002', 'Outro Operador',      'campo'),
    ('${ID.admin}',    '9001', 'Escritório',          'admin');

  insert into public.fazendas (id, codigo, nome) values ('${ID.fazenda}', 'FZ01', 'Santa Rita');

  insert into public.frotas (id, numero, descricao, tipo, tem_odometro, tem_horimetro_motor, tem_horimetro_elevador, capacidade_tanque_litros) values
    ('${ID.frota}',   '1204', 'Colhedora CH570', 'colhedora', false, true, true, 650),
    ('${ID.comboio}', '9100', 'Comboio Diesel',  'comboio',   true,  true, false, 6000);

  insert into public.blocos_abastecimento (id, numero_inicial, numero_final, funcionario_id, dispositivo_id, comboio_frota_id)
  values ('${ID.bloco}', 6901, 6950, '${ID.operador}', 'disp-teste-a', '${ID.comboio}');

  insert into public.veiculos_transporte (id, numero, tipo) values ('${ID.cavalo}', '77', 'cavalo');
`)

const contexto = { funcionarioId: ID.operador }

function abastecimento(id, numero, extra = {}) {
  return {
    id,
    numero_documento: numero,
    bloco_id: ID.bloco,
    data: 'HOJE',
    hora: '14:32',
    momento: 'AGORA',
    frota_id: ID.frota,
    comboio_frota_id: ID.comboio,
    horimetro_motor: 12345.7,
    registrador_inicio: 45265.0,
    registrador_fim: 45310.0,
    litros: 45.0,
    operador_funcionario_id: ID.operador,
    criado_em_dispositivo: 'AGORA',
    ...extra,
  }
}

/** Chama sync_push com os placeholders de data resolvidos pelo servidor. */
async function push(operacoes, { dispositivo = 'disp-teste-a', versao = '0.1.0' } = {}) {
  const json = JSON.stringify(operacoes)
    .replace(/"HOJE"/g, '"__HOJE__"')
    .replace(/"AGORA"/g, '"__AGORA__"')
  const sql = `
    select public.sync_push(
      replace(replace(${literal(json)}, '__HOJE__', current_date::text), '__AGORA__', now()::text)::jsonb,
      ${literal(dispositivo)}, ${literal(versao)}
    ) as r`
  const { rows } = await db.query(sql)
  return rows[0].r
}

const op = (id, tabela, registro_id, payload, tipo = 'inserir', base_versao = null) => ({
  op_id: id,
  tabela,
  registro_id,
  tipo,
  payload,
  base_versao,
})

// --- 1. Insercao basica ------------------------------------------------------

const abastA = '01920000-0000-7000-8000-0000000000a1'
await comoFuncionario(db, contexto, async () => {
  const r = await push([op('01920000-0000-7000-8000-0000000000f1', 'abastecimentos', abastA, abastecimento(abastA, 6901))])
  verificar('abastecimento novo é aplicado', r.resultados[0].status === 'aplicada', r.resultados[0])
})

{
  const { rows } = await db.query(`select litros, litros_registrador, divergencia_litros from public.abastecimentos where id = '${abastA}'`)
  verificar('coluna gerada calcula os litros do registrador', Number(rows[0]?.litros_registrador) === 45, rows[0])
  verificar('divergência entre informado e bomba fica zerada', Number(rows[0]?.divergencia_litros) === 0, rows[0])
}

{
  const { rows } = await db.query(
    `select tipo, valor from public.frota_leituras where origem_id = '${abastA}' order by tipo`,
  )
  verificar('trigger alimenta o histórico de leituras da frota', rows.length === 1 && rows[0].tipo === 'horimetro_motor', rows)
}

// --- 2. Idempotencia ---------------------------------------------------------
// O caso real: o Postgres gravou, o 4G caiu antes da resposta chegar, o celular
// reenvia a MESMA operacao. Nao pode virar um segundo abastecimento.

await comoFuncionario(db, contexto, async () => {
  const r = await push([op('01920000-0000-7000-8000-0000000000f1', 'abastecimentos', abastA, abastecimento(abastA, 6901))])
  verificar('reenvio do mesmo op_id devolve "duplicada"', r.resultados[0].status === 'duplicada', r.resultados[0])
})

{
  const { rows } = await db.query(`select count(*)::int as n from public.abastecimentos`)
  verificar('reenvio não cria segundo lançamento', rows[0].n === 1, rows[0])
}

// --- 3. Conflito preserva o payload -----------------------------------------
// Numero de documento repetido: o unique index dispara. O lancamento do campo
// nao pode sumir por causa disso.

const abastB = '01920000-0000-7000-8000-0000000000a2'
await comoFuncionario(db, contexto, async () => {
  const r = await push([op('01920000-0000-7000-8000-0000000000f2', 'abastecimentos', abastB, abastecimento(abastB, 6901))])
  verificar('número de documento repetido vira conflito', r.resultados[0].status === 'conflito', r.resultados[0])
  verificar(
    'conflito traz código semântico, não erro cru do Postgres',
    r.resultados[0].erro_codigo === 'NUMERO_DOCUMENTO_DUPLICADO',
    r.resultados[0],
  )
})

{
  const { rows } = await db.query(
    `select status, payload -> 'litros' as litros from public.sync_operacoes where id = '01920000-0000-7000-8000-0000000000f2'`,
  )
  verificar('payload do conflito fica guardado para o escritório', rows[0]?.status === 'conflito' && rows[0]?.litros !== null, rows[0])
}

// --- 4. Isolamento de falha dentro do lote ----------------------------------
// Uma operacao ruim no meio do lote nao pode levar as boas junto.

const abastC = '01920000-0000-7000-8000-0000000000a3'
const abastD = '01920000-0000-7000-8000-0000000000a4'
await comoFuncionario(db, contexto, async () => {
  const r = await push([
    op('01920000-0000-7000-8000-0000000000f3', 'abastecimentos', abastC, abastecimento(abastC, 6901)), // duplica: falha
    op('01920000-0000-7000-8000-0000000000f4', 'abastecimentos', abastD, abastecimento(abastD, 6902, {
      registrador_inicio: 45310.0, registrador_fim: 45360.0, litros: 50.0,
    })),
  ])
  verificar('operação ruim no lote falha sozinha', r.resultados[0].status === 'conflito', r.resultados[0])
  verificar('operação boa do mesmo lote é aplicada', r.resultados[1].status === 'aplicada', r.resultados[1])
})

// --- 5. Constraint de negocio: litros x registrador -------------------------
// Divergencia sem justificativa e erro de digitacao, e o banco e a ultima
// barreira: bloqueia mesmo se a validacao do app for burlada.

const abastE = '01920000-0000-7000-8000-0000000000a5'
await comoFuncionario(db, contexto, async () => {
  const r = await push([op('01920000-0000-7000-8000-0000000000f5', 'abastecimentos', abastE, abastecimento(abastE, 6903, {
    registrador_inicio: 45360.0, registrador_fim: 45400.0, litros: 90.0, // bomba diz 40, operador digitou 90
  }))])
  verificar('litros divergindo da bomba sem justificativa é barrado', r.resultados[0].status === 'conflito', r.resultados[0])
})

const abastF = '01920000-0000-7000-8000-0000000000a6'
await comoFuncionario(db, contexto, async () => {
  const r = await push([op('01920000-0000-7000-8000-0000000000f6', 'abastecimentos', abastF, abastecimento(abastF, 6904, {
    registrador_inicio: 45360.0, registrador_fim: 45400.0, litros: 90.0,
    justificativa_divergencia: 'Bomba travou no meio; completado com balde aferido.',
  }))])
  verificar('a mesma divergência passa quando justificada', r.resultados[0].status === 'aplicada', r.resultados[0])
})

// --- 6. Ciclo de caminhao: sobreposicao -------------------------------------

const cicloA = '01920000-0000-7000-8000-0000000000b1'
const cicloB = '01920000-0000-7000-8000-0000000000b2'
const ciclo = (id, extra = {}) => ({
  id,
  data: 'HOJE',
  fazenda_id: ID.fazenda,
  caminhao_id: ID.cavalo,
  chegada_em: 'AGORA',
  criado_em_dispositivo: 'AGORA',
  ...extra,
})

await comoFuncionario(db, contexto, async () => {
  const r = await push([op('01920000-0000-7000-8000-0000000000f7', 'caminhao_ciclos', cicloA, ciclo(cicloA))])
  verificar('chegada de caminhão é registrada', r.resultados[0].status === 'aplicada', r.resultados[0])
})

await comoFuncionario(db, contexto, async () => {
  const r = await push([op('01920000-0000-7000-8000-0000000000f8', 'caminhao_ciclos', cicloB, ciclo(cicloB))])
  verificar(
    'segunda chegada do mesmo caminhão sem saída vira conflito',
    r.resultados[0].status === 'conflito' && r.resultados[0].erro_codigo === 'CICLO_ABERTO_DUPLICADO',
    r.resultados[0],
  )
})

// --- 7. Atualizacao e controle de versao ------------------------------------

await comoFuncionario(db, contexto, async () => {
  const r = await push([
    op('01920000-0000-7000-8000-0000000000f9', 'caminhao_ciclos', cicloA,
      { saida_em: 'AGORA', observacao: 'Saída registrada' }, 'atualizar', 1),
  ])
  verificar('registro de saída é aplicado', r.resultados[0].status === 'aplicada', r.resultados[0])
})

{
  const { rows } = await db.query(`select versao, saida_em, permanencia_minutos from public.caminhao_ciclos where id = '${cicloA}'`)
  verificar('versão é incrementada pelo trigger', rows[0]?.versao === 2, rows[0])
  verificar('permanência é calculada sozinha', rows[0]?.permanencia_minutos !== null, rows[0])
}

// --- 8. RLS: o campo não enxerga lançamento alheio --------------------------

await comoFuncionario(db, { funcionarioId: ID.outro }, async () => {
  const { rows } = await db.query(`select count(*)::int as n from public.abastecimentos`)
  verificar('outro funcionário não vê os abastecimentos do primeiro', rows[0].n === 0, rows[0])
})

await comoFuncionario(db, contexto, async () => {
  const { rows } = await db.query(`select count(*)::int as n from public.abastecimentos`)
  verificar('o autor vê os próprios abastecimentos', rows[0].n === 3, rows[0])
})

await comoFuncionario(db, { funcionarioId: ID.admin, papel: 'admin' }, async () => {
  const { rows } = await db.query(`select count(*)::int as n from public.abastecimentos`)
  verificar('o escritório vê tudo', rows[0].n === 3, rows[0])
})

// --- 9. O hash do PIN não vaza ----------------------------------------------

await comoFuncionario(db, contexto, async () => {
  let bloqueado = false
  try {
    await db.query(`select pin_hash from public.funcionarios limit 1`)
  } catch {
    bloqueado = true
  }
  verificar('funcionário não consegue ler pin_hash', bloqueado)

  const { rows } = await db.query(`select count(*)::int as n from public.vw_funcionarios_publico`)
  verificar('mas lê o cadastro pela view pública (cache offline)', rows[0].n === 3, rows[0])
})

// --- 10. Ninguém apaga lançamento -------------------------------------------

await comoFuncionario(db, contexto, async () => {
  let bloqueado = false
  try {
    await db.query(`delete from public.abastecimentos where id = '${abastA}'`)
  } catch {
    bloqueado = true
  }
  verificar('DELETE de lançamento é negado ao campo', bloqueado)
})

await comoFuncionario(db, { funcionarioId: ID.admin, papel: 'admin' }, async () => {
  let bloqueado = false
  try {
    await db.query(`delete from public.abastecimentos where id = '${abastA}'`)
  } catch {
    bloqueado = true
  }
  verificar('DELETE de lançamento é negado até para o escritório', bloqueado)
})

// --- 11. Assinatura é append-only -------------------------------------------

await comoFuncionario(db, contexto, async () => {
  await db.query(`
    insert into public.assinaturas_aceite
      (id, tipo_documento, documento_id, funcionario_id, texto_aceite, hash_documento,
       momento_dispositivo, dispositivo_id, app_versao)
    values ('01920000-0000-7000-8000-0000000000c1', 'abastecimento', '${abastA}', '${ID.operador}',
            'Confirmo o recebimento de 45,0 L na frota 1204.', repeat('a', 64), now(), 'disp-teste-a', '0.1.0')`)

  let bloqueado = false
  try {
    await db.query(`update public.assinaturas_aceite set texto_aceite = 'outro texto'`)
  } catch {
    bloqueado = true
  }
  verificar('assinatura gravada não pode ser alterada', bloqueado)
})

// --- 12. sync_pull -----------------------------------------------------------

await comoFuncionario(db, contexto, async () => {
  const { rows } = await db.query(`select public.sync_pull(null) as r`)
  const r = rows[0].r
  verificar('pull traz os mestres para o cache offline', r.mestres.frotas.length === 2, r.mestres.frotas?.length)
  verificar('pull traz a última leitura de cada frota', r.mestres.ultimas_leituras.length > 0, r.mestres.ultimas_leituras?.length)
  verificar('pull traz os lançamentos do próprio funcionário', r.transacionais.abastecimentos.length === 3, r.transacionais.abastecimentos?.length)
  verificar('pull nunca inclui o hash do PIN', JSON.stringify(r.mestres.funcionarios).includes('pin_hash') === false)
})

// --- 13. App obsoleto --------------------------------------------------------

await comoFuncionario(db, contexto, async () => {
  await db.query(`update public.parametros set valor = '"9.9.9"' where chave = 'app_versao_minima'`).catch(() => {})
})
await db.exec(`update public.parametros set valor = '"9.9.9"' where chave = 'app_versao_minima'`)
await comoFuncionario(db, contexto, async () => {
  let recusado = false
  try {
    await push([op('01920000-0000-7000-8000-0000000000fa', 'abastecimentos', '01920000-0000-7000-8000-0000000000a9', abastecimento('01920000-0000-7000-8000-0000000000a9', 6910))])
  } catch (e) {
    recusado = /VERSAO_OBSOLETA/.test(e.message)
  }
  verificar('app abaixo da versão mínima tem o lote recusado', recusado)
})
await db.exec(`update public.parametros set valor = '"0.1.0"' where chave = 'app_versao_minima'`)

// --- Resultado ---------------------------------------------------------------

await db.close()
console.log(`\n  ${passou} passaram, ${falhou} falharam\n`)
process.exit(falhou > 0 ? 1 : 0)

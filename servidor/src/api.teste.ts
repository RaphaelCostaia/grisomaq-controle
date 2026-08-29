/**
 * Testes de integração da API contra um Postgres real (PGlite), com RLS ligada.
 *
 * Sobem o servidor Fastify de verdade e batem nas rotas por HTTP (via `inject`),
 * então exercitam o caminho completo: JWT, `SET LOCAL ROLE`, publicação das
 * reivindicações, policies e as funções de sync.
 *
 * O que estes testes protegem, em ordem de importância:
 *   1. A identidade NÃO vaza entre requisições que reusam a conexão do pool.
 *   2. Código inexistente e PIN errado são indistinguíveis para quem tenta.
 *   3. Um funcionário não enxerga lançamento de outro, mesmo pela API.
 *   4. Reenviar a mesma operação não duplica o lançamento.
 *
 *   npm test
 */
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist'
import { unaccent } from '@electric-sql/pglite/contrib/unaccent'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

process.env.DATABASE_URL = 'postgres://teste'
process.env.JWT_SEGREDO = 'segredo-de-teste-nao-usar-em-producao-0123456789'
process.env.NODE_ENV = 'production'
process.env.ORIGENS_PERMITIDAS = 'http://localhost:5180'
// A suíte faz dezenas de logins do mesmo dispositivo em segundos, o que o
// limite de produção (10/min) barraria com razão. O limite continua ativo —
// só o teto muda, para o teste medir a lógica e não o limitador.
process.env.RATE_LIMITE_LOGIN = '10000'
process.env.RATE_LIMITE_GERAL = '10000'

const pg = new PGlite({ extensions: { pgcrypto, btree_gist, unaccent } })

/**
 * O `pg.Pool` é substituído por um adaptador sobre o PGlite.
 *
 * O PGlite é uma instância única, sem pool — o que na verdade endurece o teste
 * de vazamento de identidade: todas as requisições compartilham a MESMA
 * conexão, que é o pior caso do pool real.
 */
const clienteFalso = {
  query: async (texto: string, valores?: unknown[]) => {
    const r = await pg.query(texto, valores as never[])
    return { rows: r.rows, rowCount: r.rows.length }
  },
  release: () => {},
}

// Só `connect` e `end` são trocados: `totalCount` e afins são getters do Pool,
// e o que a rota de saúde reporta a partir deles não é o que está sob teste.
const { pool } = await import('./banco.ts')
Object.assign(pool, {
  connect: async () => clienteFalso,
  end: async () => {},
})

const ID = {
  operador: '01920000-0000-7000-8000-000000000001',
  outro: '01920000-0000-7000-8000-000000000002',
  admin: '01920000-0000-7000-8000-000000000003',
  frota: '01920000-0000-7000-8000-000000000010',
  comboio: '01920000-0000-7000-8000-000000000011',
  bloco: '01920000-0000-7000-8000-000000000020',
}

let app: Awaited<ReturnType<typeof construir>>
type Construir = typeof import('./index.ts').construirServidor
let construir: Construir

before(async () => {
  await pg.exec(`
    do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'servico') then
        create role servico nologin bypassrls;
      end if;
    end $$;
  `)

  const pasta = join(RAIZ, 'banco', 'migrations')
  for (const nome of readdirSync(pasta).filter((f) => f.endsWith('.sql')).sort()) {
    await pg.exec(readFileSync(join(pasta, nome), 'utf8'))
  }

  await pg.exec(`
    insert into public.funcionarios (id, codigo, nome, papel) values
      ('${ID.operador}', '1001', 'Operador de Comboio', 'campo'),
      ('${ID.outro}',    '1002', 'Outro Operador',      'campo'),
      ('${ID.admin}',    '9001', 'Escritório',          'admin');

    insert into public.frotas (id, numero, descricao, tipo, tem_horimetro_motor, capacidade_tanque_litros) values
      ('${ID.frota}',   '1204', 'Colhedora CH570', 'colhedora', true, 650),
      ('${ID.comboio}', '9100', 'Comboio Diesel',  'comboio',   true, 6000);

    insert into public.blocos_abastecimento (id, numero_inicial, numero_final, funcionario_id, dispositivo_id, comboio_frota_id)
    values ('${ID.bloco}', 6901, 6950, '${ID.operador}', 'disp-a', '${ID.comboio}');

    select public.fn_definir_pin('${ID.operador}', '4731', null, false);
    select public.fn_definir_pin('${ID.outro}',    '5824', null, false);
    select public.fn_definir_pin('${ID.admin}',    '7196', null, false);
  `)

  construir = (await import('./index.ts')).construirServidor
  app = await construir()
})

after(async () => {
  await app?.close()
  await pg.close()
})

async function entrar(codigo: string, pin: string) {
  const r = await app.inject({
    method: 'POST',
    url: '/auth/login-campo',
    payload: { codigo, pin, dispositivo_id: 'disp-a', app_versao: '0.1.0' },
  })
  return { status: r.statusCode, corpo: r.json() as Record<string, string> }
}

/**
 * `noUncheckedIndexedAccess` faz o corpo da resposta vir com tudo opcional, o
 * que é correto: um teste que assume campo presente sem conferir falha com
 * "undefined is not a function" em vez de dizer o que faltou.
 */
function exigirToken(corpo: Record<string, string>): string {
  const token = corpo.access_token
  assert.ok(token, 'a resposta não trouxe access_token: ' + JSON.stringify(corpo))
  return token
}

const comToken = (corpo: Record<string, string>) => ({
  authorization: 'Bearer ' + exigirToken(corpo),
})

describe('login de campo', () => {
  it('devolve sessão para código e PIN corretos', async () => {
    const { status, corpo } = await entrar('1001', '4731')
    assert.equal(status, 200)
    assert.ok(corpo.access_token, 'faltou access_token')
    assert.ok(corpo.refresh_token, 'faltou refresh_token')
    assert.equal((corpo.funcionario as unknown as Record<string, string>).codigo, '1001')
  })

  // Distinguir os dois entregaria a lista de códigos válidos a quem tentasse
  // adivinhar. A resposta e o código HTTP têm que ser idênticos.
  it('responde igual para código inexistente e para PIN errado', async () => {
    const inexistente = await entrar('7777', '4731')
    const pinErrado = await entrar('1001', '0000')
    assert.equal(inexistente.status, 401)
    assert.equal(pinErrado.status, 401)
    assert.deepEqual(inexistente.corpo, pinErrado.corpo)
  })

  it('bloqueia após cinco tentativas erradas', async () => {
    for (let i = 0; i < 5; i++) await entrar('1002', '0000')
    const { status } = await entrar('1002', '5824')
    assert.equal(status, 429, 'deveria estar bloqueado mesmo com o PIN certo')
    await pg.exec(`select public.fn_zerar_falhas_pin('${ID.outro}')`)
  })

  /**
   * A tela do campo manda "peça ao escritório para liberar". Sem esta rota a
   * promessa era falsa: o painel mostrava o bloqueio e o único jeito de
   * desfazê-lo era GERAR UM PIN NOVO — obrigando o operador a decorar outro
   * número no meio do turno porque errou cinco vezes de luva.
   */
  it('o escritório libera quem se bloqueou, mantendo o PIN de sempre', async () => {
    for (let i = 0; i < 5; i++) await entrar('1002', '0000')
    assert.equal((await entrar('1002', '5824')).status, 429, 'deveria estar bloqueado')

    const admin = await entrar('9001', '7196')
    const liberacao = await app.inject({
      method: 'POST',
      url: '/painel/funcionarios/liberar',
      headers: comToken(admin.corpo),
      payload: { id: ID.outro },
    })
    assert.equal(liberacao.statusCode, 200)

    const depois = await entrar('1002', '5824')
    assert.equal(depois.status, 200, 'o PIN de sempre deveria voltar a funcionar')
  })

  it('só o escritório libera', async () => {
    const campo = await entrar('1001', '4731')
    const r = await app.inject({
      method: 'POST',
      url: '/painel/funcionarios/liberar',
      headers: comToken(campo.corpo),
      payload: { id: ID.outro },
    })
    assert.equal(r.statusCode, 403, 'funcionário de campo não pode destravar ninguém')
  })

  it('nunca devolve o hash do PIN', async () => {
    const { corpo } = await entrar('1001', '4731')
    assert.ok(!JSON.stringify(corpo).includes('pin_hash'))
    assert.ok(!JSON.stringify(corpo).includes('$2'))
  })
})

describe('sessão', () => {
  it('renova com o refresh token e rotaciona', async () => {
    const { corpo } = await entrar('1001', '4731')
    const r = await app.inject({
      method: 'POST',
      url: '/auth/renovar',
      payload: { refresh_token: corpo.refresh_token },
    })
    assert.equal(r.statusCode, 200)
    const novo = r.json()
    assert.ok(novo.access_token)
    assert.notEqual(novo.refresh_token, corpo.refresh_token, 'o refresh deveria rotacionar')
  })

  // Em rede instável duas requisições sobem juntas e a segunda chega com o
  // token já rotacionado. Derrubar a sessão puniria o operador pelo sinal.
  it('tolera o reuso do refresh recém-rotacionado', async () => {
    const { corpo } = await entrar('1001', '4731')
    await app.inject({ method: 'POST', url: '/auth/renovar', payload: { refresh_token: corpo.refresh_token } })
    const segunda = await app.inject({
      method: 'POST',
      url: '/auth/renovar',
      payload: { refresh_token: corpo.refresh_token },
    })
    assert.equal(segunda.statusCode, 200)
  })

  it('recusa refresh desconhecido', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/auth/renovar',
      payload: { refresh_token: 'inventado' },
    })
    assert.equal(r.statusCode, 401)
  })

  it('encerra a sessão no logout', async () => {
    const { corpo } = await entrar('1001', '4731')
    await app.inject({ method: 'POST', url: '/auth/sair', payload: { refresh_token: corpo.refresh_token } })
    const r = await app.inject({
      method: 'POST',
      url: '/auth/renovar',
      payload: { refresh_token: corpo.refresh_token },
    })
    assert.equal(r.statusCode, 401)
  })
})

describe('sincronização', () => {
  const abastecimento = (id: string, numero: number) => ({
    id,
    numero_documento: numero,
    bloco_id: ID.bloco,
    data: new Date().toISOString().slice(0, 10),
    hora: '14:32',
    momento: new Date().toISOString(),
    frota_id: ID.frota,
    comboio_frota_id: ID.comboio,
    registrador_inicio: 45265,
    registrador_fim: 45310,
    litros: 45,
    operador_funcionario_id: ID.operador,
    criado_em_dispositivo: new Date().toISOString(),
  })

  const push = (sessao: Record<string, string>, operacoes: unknown[]) =>
    app.inject({
      method: 'POST',
      url: '/sync/push',
      headers: comToken(sessao),
      payload: { operacoes, dispositivo_id: 'disp-a', app_versao: '0.1.0' },
    })

  it('recusa envio sem sessão', async () => {
    const r = await app.inject({ method: 'POST', url: '/sync/push', payload: { operacoes: [] } })
    assert.equal(r.statusCode, 401)
  })

  it('aplica um lançamento e não duplica no reenvio', async () => {
    const { corpo } = await entrar('1001', '4731')
    const registro = '01920000-0000-7000-8000-0000000000a1'
    const operacao = {
      op_id: '01920000-0000-7000-8000-0000000000f1',
      tabela: 'abastecimentos',
      registro_id: registro,
      tipo: 'inserir',
      payload: abastecimento(registro, 6901),
      base_versao: null,
    }

    const primeira = await push(corpo, [operacao])
    assert.equal(primeira.json().resultados[0].status, 'aplicada')

    // O 4G caiu antes da resposta chegar e o celular reenviou o mesmo op_id.
    const segunda = await push(corpo, [operacao])
    assert.equal(segunda.json().resultados[0].status, 'duplicada')

    const { rows } = await pg.query<{ n: number }>('select count(*)::int as n from public.abastecimentos')
    assert.equal(rows[0]?.n, 1, 'o reenvio criou um segundo lançamento')
  })

  it('devolve conflito com código semântico, preservando o payload', async () => {
    const { corpo } = await entrar('1001', '4731')
    const registro = '01920000-0000-7000-8000-0000000000a2'
    const r = await push(corpo, [
      {
        op_id: '01920000-0000-7000-8000-0000000000f2',
        tabela: 'abastecimentos',
        registro_id: registro,
        tipo: 'inserir',
        payload: abastecimento(registro, 6901),
        base_versao: null,
      },
    ])

    const resultado = r.json().resultados[0]
    assert.equal(resultado.status, 'conflito')
    assert.equal(resultado.erro_codigo, 'NUMERO_DOCUMENTO_DUPLICADO')

    const { rows } = await pg.query<{ status: string }>(
      `select status from public.sync_operacoes where id = '01920000-0000-7000-8000-0000000000f2'`,
    )
    assert.equal(rows[0]?.status, 'conflito')
  })

  it('o pull traz os mestres e só os lançamentos do próprio funcionário', async () => {
    const { corpo } = await entrar('1001', '4731')
    const r = await app.inject({
      method: 'POST',
      url: '/sync/pull',
      headers: comToken(corpo),
      payload: { desde: null },
    })
    const dados = r.json()
    assert.equal(dados.mestres.frotas.length, 2)
    assert.equal(dados.transacionais.abastecimentos.length, 1)
    assert.ok(!JSON.stringify(dados.mestres.funcionarios).includes('pin_hash'))
  })

  // A RLS é a autoridade, não a API. Mesmo que uma rota tivesse bug, o banco
  // recusaria — o papel `authenticated` não tem bypassrls.
  it('outro funcionário não enxerga o lançamento do primeiro', async () => {
    const { corpo } = await entrar('1002', '5824')
    const r = await app.inject({
      method: 'POST',
      url: '/sync/pull',
      headers: comToken(corpo),
      payload: { desde: null },
    })
    assert.equal(r.json().transacionais.abastecimentos.length, 0)
  })
})

describe('isolamento de identidade no pool', () => {
  /**
   * O teste mais importante do arquivo.
   *
   * Todas estas requisições compartilham a mesma conexão. Se `set_config` não
   * estivesse amarrado à transação, a identidade do primeiro vazaria para o
   * segundo e ele leria dados que não são dele — um vazamento silencioso, que
   * não aparece em log nem em erro.
   */
  it('não vaza identidade entre requisições intercaladas', async () => {
    const um = await entrar('1001', '4731')
    const dois = await entrar('1002', '5824')

    const pulls = await Promise.all([
      app.inject({ method: 'POST', url: '/sync/pull', headers: comToken(um.corpo), payload: {} }),
      app.inject({ method: 'POST', url: '/sync/pull', headers: comToken(dois.corpo), payload: {} }),
      app.inject({ method: 'POST', url: '/sync/pull', headers: comToken(dois.corpo), payload: {} }),
      app.inject({ method: 'POST', url: '/sync/pull', headers: comToken(um.corpo), payload: {} }),
    ])

    const contagens = pulls.map((p) => p.json().transacionais.abastecimentos.length)
    assert.deepEqual(contagens, [1, 0, 0, 1], 'a identidade vazou entre requisições')
  })

  it('deixa a sessão limpa depois da requisição', async () => {
    const { rows } = await pg.query<{ claims: string }>(
      `select current_setting('request.jwt.claims', true) as claims`,
    )
    assert.ok(!rows[0]?.claims, 'as reivindicações sobreviveram fora da transação')
  })
})

describe('administração', () => {
  it('recusa provisionamento para quem não é do escritório', async () => {
    const { corpo } = await entrar('1001', '4731')
    const r = await app.inject({
      method: 'POST',
      url: '/painel/provisionar-funcionario',
      headers: comToken(corpo),
      payload: { funcionario_id: ID.outro },
    })
    assert.equal(r.statusCode, 403)
  })

  it('gera PIN inicial não previsível e encerra as sessões antigas', async () => {
    const antes = await entrar('1002', '5824')
    const admin = await entrar('9001', '7196')

    const r = await app.inject({
      method: 'POST',
      url: '/painel/provisionar-funcionario',
      headers: comToken(admin.corpo),
      payload: { funcionario_id: ID.outro },
    })

    assert.equal(r.statusCode, 200)
    const pin = r.json().pin_inicial as string
    assert.match(pin, /^[0-9]{4}$/)
    assert.ok(!/^(.)\1{3}$/.test(pin), 'PIN com dígitos repetidos')
    assert.ok(!'01234567890'.includes(pin), 'PIN em sequência')

    // O motivo mais comum de gerar PIN novo é o aparelho ter sumido.
    const renovacao = await app.inject({
      method: 'POST',
      url: '/auth/renovar',
      payload: { refresh_token: antes.corpo.refresh_token },
    })
    assert.equal(renovacao.statusCode, 401, 'a sessão antiga continuou valendo')
  })
})

describe('painel do escritório', () => {
  it('recusa acesso a quem não é do escritório', async () => {
    const { corpo } = await entrar('1001', '4731')
    for (const rota of ['/painel/resumo', '/painel/conflitos', '/painel/funcionarios']) {
      const r = await app.inject({ method: 'POST', url: rota, headers: comToken(corpo), payload: {} })
      assert.equal(r.statusCode, 403, 'rota desprotegida: ' + rota)
    }
  })

  it('traz o resumo com os números do período', async () => {
    const admin = await entrar('9001', '7196')
    const r = await app.inject({
      method: 'POST',
      url: '/painel/resumo',
      headers: comToken(admin.corpo),
      payload: { dias: 30 },
    })
    assert.equal(r.statusCode, 200)
    const dados = r.json()
    assert.equal(dados.periodo_dias, 30)
    assert.ok(Array.isArray(dados.abastecimento))
    assert.ok(typeof dados.conflitos_pendentes === 'number')
  })

  // O conflito criado no teste de sincronização precisa chegar até aqui: é a
  // única forma de o escritório saber que existe um lançamento travado.
  it('lista o conflito preservado, com o payload do operador', async () => {
    const admin = await entrar('9001', '7196')
    const r = await app.inject({
      method: 'POST',
      url: '/painel/conflitos',
      headers: comToken(admin.corpo),
      payload: {},
    })

    const conflitos = r.json().conflitos as Array<Record<string, unknown>>
    assert.ok(conflitos.length > 0, 'o conflito não apareceu no painel')

    const duplicado = conflitos.find((c) => c.erro_codigo === 'NUMERO_DOCUMENTO_DUPLICADO')
    assert.ok(duplicado, 'faltou o conflito de número duplicado')
    assert.ok(duplicado.payload, 'o payload do operador não veio junto')
    assert.equal(duplicado.funcionario_codigo, '1001')
  })

  it('marca o conflito como resolvido e o tira da fila', async () => {
    const admin = await entrar('9001', '7196')
    const lista = await app.inject({
      method: 'POST',
      url: '/painel/conflitos',
      headers: comToken(admin.corpo),
      payload: {},
    })
    const primeiro = (lista.json().conflitos as Array<{ id: string }>)[0]
    assert.ok(primeiro)

    const r = await app.inject({
      method: 'POST',
      url: '/painel/conflitos/resolver',
      headers: comToken(admin.corpo),
      payload: { operacao_id: primeiro.id },
    })
    assert.equal(r.json().resolvido, true)

    const depois = await app.inject({
      method: 'POST',
      url: '/painel/conflitos',
      headers: comToken(admin.corpo),
      payload: {},
    })
    const ids = (depois.json().conflitos as Array<{ id: string }>).map((c) => c.id)
    assert.ok(!ids.includes(primeiro.id), 'o conflito resolvido continuou na fila')
  })

  it('lista funcionários com o estado do PIN, sem expor o hash', async () => {
    const admin = await entrar('9001', '7196')
    const r = await app.inject({
      method: 'POST',
      url: '/painel/funcionarios',
      headers: comToken(admin.corpo),
      payload: {},
    })

    const bruto = JSON.stringify(r.json())
    assert.ok(!bruto.includes('pin_hash'), 'o hash do PIN vazou para o painel')
    assert.ok(!bruto.includes('pin_verificador_offline'))

    const funcionarios = r.json().funcionarios as Array<Record<string, unknown>>
    const operador = funcionarios.find((f) => f.codigo === '1001')
    assert.equal(operador?.pin_provisionado, true)
  })

  it('cadastra funcionário novo e recusa código repetido', async () => {
    const admin = await entrar('9001', '7196')

    const novo = await app.inject({
      method: 'POST',
      url: '/painel/funcionarios/salvar',
      headers: comToken(admin.corpo),
      payload: { codigo: '1050', nome: 'Novo Operador', papel: 'campo', ativo: true },
    })
    assert.equal(novo.statusCode, 200)
    assert.ok(novo.json().id)

    const repetido = await app.inject({
      method: 'POST',
      url: '/painel/funcionarios/salvar',
      headers: comToken(admin.corpo),
      payload: { codigo: '1050', nome: 'Outro', papel: 'campo', ativo: true },
    })
    assert.equal(repetido.statusCode, 409)
    assert.equal(repetido.json().erro, 'CODIGO_JA_USADO')
  })

  // A ficha escolhe a consulta indexando um mapa fechado. Um valor fora do mapa
  // tem que ser recusado, e não concatenado.
  it('recusa ficha desconhecida na consulta de lançamentos', async () => {
    const admin = await entrar('9001', '7196')
    const r = await app.inject({
      method: 'POST',
      url: '/painel/lancamentos',
      headers: comToken(admin.corpo),
      payload: { ficha: 'funcionarios; drop table public.abastecimentos' },
    })
    assert.equal(r.statusCode, 400)

    const { rows } = await pg.query<{ n: number }>('select count(*)::int as n from public.abastecimentos')
    assert.ok(rows[0]!.n >= 0, 'a tabela sobreviveu')
  })

  it('traz os lançamentos de abastecimento do período', async () => {
    const admin = await entrar('9001', '7196')
    const r = await app.inject({
      method: 'POST',
      url: '/painel/lancamentos',
      headers: comToken(admin.corpo),
      payload: { ficha: 'abastecimentos', de: null, ate: null },
    })
    assert.equal(r.statusCode, 200)
    const linhas = r.json().linhas as Array<Record<string, unknown>>
    assert.ok(linhas.length >= 1)
    assert.equal(linhas[0]?.frota_numero, '1204')
  })
})

describe('cadastros mestres', () => {
  it('recusa cadastro fora do mapa fechado', async () => {
    const admin = await entrar('9001', '7196')
    for (const cadastro of ['funcionarios', 'sync_operacoes', 'frotas; drop table public.frotas']) {
      const r = await app.inject({
        method: 'POST',
        url: '/painel/cadastros/listar',
        headers: comToken(admin.corpo),
        payload: { cadastro },
      })
      assert.equal(r.statusCode, 400, 'aceitou cadastro não declarado: ' + cadastro)
    }

    const { rows } = await pg.query<{ n: number }>('select count(*)::int as n from public.frotas')
    assert.ok(rows[0]!.n >= 2, 'a tabela sobreviveu')
  })

  it('cadastra e edita uma frota', async () => {
    const admin = await entrar('9001', '7196')

    const criada = await app.inject({
      method: 'POST',
      url: '/painel/cadastros/salvar',
      headers: comToken(admin.corpo),
      payload: {
        cadastro: 'frotas',
        registro: {
          numero: '3120',
          descricao: 'Trator Valtra BH180',
          tipo: 'trator',
          tem_horimetro_motor: true,
          capacidade_tanque_litros: 290,
        },
      },
    })
    assert.equal(criada.statusCode, 200)
    const frota = criada.json().registro as { id: string; numero: string }
    assert.equal(frota.numero, '3120')

    const editada = await app.inject({
      method: 'POST',
      url: '/painel/cadastros/salvar',
      headers: comToken(admin.corpo),
      payload: { cadastro: 'frotas', id: frota.id, registro: { descricao: 'Trator Valtra BH180 (revisado)' } },
    })
    assert.equal(editada.statusCode, 200)
    assert.equal((editada.json().registro as { descricao: string }).descricao, 'Trator Valtra BH180 (revisado)')
  })

  it('ignora coluna não declarada em vez de gravá-la', async () => {
    const admin = await entrar('9001', '7196')
    const r = await app.inject({
      method: 'POST',
      url: '/painel/cadastros/salvar',
      headers: comToken(admin.corpo),
      payload: {
        cadastro: 'frotas',
        registro: { numero: '4000', descricao: 'Frota teste', tipo: 'outro', criado_em: '1999-01-01' },
      },
    })
    assert.equal(r.statusCode, 200)
    const criada = r.json().registro as { criado_em: string }
    assert.ok(!String(criada.criado_em).startsWith('1999'), 'gravou coluna que não estava declarada')
  })

  it('cobra os campos obrigatórios', async () => {
    const admin = await entrar('9001', '7196')
    const r = await app.inject({
      method: 'POST',
      url: '/painel/cadastros/salvar',
      headers: comToken(admin.corpo),
      payload: { cadastro: 'frotas', registro: { numero: '5000' } },
    })
    assert.equal(r.statusCode, 400)
    assert.equal(r.json().erro, 'CAMPOS_OBRIGATORIOS')
    assert.deepEqual(r.json().campos, ['descricao', 'tipo'])
  })

  // Faixa sobreposta é o erro que mais importa aqui: é ela que garante que dois
  // celulares offline nunca emitam o mesmo número de ficha.
  it('recusa faixa de bloco sobreposta, com motivo legível', async () => {
    const admin = await entrar('9001', '7196')
    const r = await app.inject({
      method: 'POST',
      url: '/painel/cadastros/salvar',
      headers: comToken(admin.corpo),
      payload: { cadastro: 'blocos', registro: { numero_inicial: 6940, numero_final: 6990 } },
    })
    assert.equal(r.statusCode, 409)
    assert.equal(r.json().erro, 'FAIXA_SOBREPOSTA')
  })

  it('aceita faixa que não colide', async () => {
    const admin = await entrar('9001', '7196')
    const r = await app.inject({
      method: 'POST',
      url: '/painel/cadastros/salvar',
      headers: comToken(admin.corpo),
      payload: { cadastro: 'blocos', registro: { numero_inicial: 7001, numero_final: 7050 } },
    })
    assert.equal(r.statusCode, 200)
  })

  it('ajusta um parâmetro de validação sem deploy', async () => {
    const admin = await entrar('9001', '7196')
    const r = await app.inject({
      method: 'POST',
      url: '/painel/parametros/salvar',
      headers: comToken(admin.corpo),
      payload: { chave: 'km_max_turno', valor: 500 },
    })
    assert.equal(r.statusCode, 200)
    assert.equal((r.json().parametro as { valor: number }).valor, 500)
  })

  it('não deixa o campo mexer em cadastro', async () => {
    const { corpo } = await entrar('1001', '4731')
    const r = await app.inject({
      method: 'POST',
      url: '/painel/cadastros/salvar',
      headers: comToken(corpo),
      payload: { cadastro: 'frotas', registro: { numero: '9999', descricao: 'x', tipo: 'outro' } },
    })
    assert.equal(r.statusCode, 403)
  })
})

describe('fechamento de período', () => {
  const hoje = () => new Date().toISOString().slice(0, 10)

  it('só o escritório fecha', async () => {
    const { corpo } = await entrar('1001', '4731')
    const r = await app.inject({
      method: 'POST',
      url: '/painel/fechamentos/travar',
      headers: comToken(corpo),
      payload: { de: hoje(), ate: hoje() },
    })
    assert.equal(r.statusCode, 403)
  })

  it('recusa período invertido', async () => {
    const admin = await entrar('9001', '7196')
    const r = await app.inject({
      method: 'POST',
      url: '/painel/fechamentos/travar',
      headers: comToken(admin.corpo),
      payload: { de: '2026-08-31', ate: '2026-08-01' },
    })
    assert.equal(r.statusCode, 400)
    assert.equal(r.json().erro, 'PERIODO_INVALIDO')
  })

  // O ponto do fechamento: depois dele o campo não corrige mais nada dentro do
  // período. Os números já viraram folha e conferência de diesel.
  it('trava os lançamentos e impede a correção pelo campo', async () => {
    const admin = await entrar('9001', '7196')

    const fechado = await app.inject({
      method: 'POST',
      url: '/painel/fechamentos/travar',
      headers: comToken(admin.corpo),
      payload: { de: hoje(), ate: hoje(), observacao: 'Fechamento de teste' },
    })
    assert.equal(fechado.statusCode, 200)
    assert.ok((fechado.json() as { documentos: number }).documentos > 0, 'não travou nada')

    const { rows } = await pg.query<{ status: string }>(
      `select status from public.abastecimentos where data = current_date limit 1`,
    )
    assert.equal(rows[0]?.status, 'travado')

    // O operador tenta corrigir o próprio lançamento do dia.
    const campo = await entrar('1001', '4731')
    const { rows: alvo } = await pg.query<{ id: string; versao: number }>(
      `select id, versao from public.abastecimentos where data = current_date limit 1`,
    )

    const tentativa = await app.inject({
      method: 'POST',
      url: '/sync/push',
      headers: comToken(campo.corpo),
      payload: {
        operacoes: [
          {
            op_id: '01920000-0000-7000-8000-0000000000e1',
            tabela: 'abastecimentos',
            registro_id: alvo[0]!.id,
            tipo: 'atualizar',
            payload: { observacao: 'tentando corrigir depois do fechamento' },
            base_versao: alvo[0]!.versao,
          },
        ],
        dispositivo_id: 'disp-a',
        app_versao: '0.1.0',
      },
    })

    const resultado = tentativa.json().resultados[0]
    assert.equal(resultado.status, 'conflito', 'o campo conseguiu alterar período fechado')
  })

  it('reabrir exige motivo escrito', async () => {
    const admin = await entrar('9001', '7196')
    const lista = await app.inject({
      method: 'POST',
      url: '/painel/fechamentos',
      headers: comToken(admin.corpo),
      payload: {},
    })
    const vigente = (lista.json().fechamentos as Array<{ id: string; vigente: boolean }>).find((f) => f.vigente)
    assert.ok(vigente)

    const semMotivo = await app.inject({
      method: 'POST',
      url: '/painel/fechamentos/reabrir',
      headers: comToken(admin.corpo),
      payload: { fechamento_id: vigente.id, motivo: '   ' },
    })
    assert.equal(semMotivo.statusCode, 400)
    assert.equal(semMotivo.json().erro, 'MOTIVO_OBRIGATORIO')

    const comMotivo = await app.inject({
      method: 'POST',
      url: '/painel/fechamentos/reabrir',
      headers: comToken(admin.corpo),
      payload: { fechamento_id: vigente.id, motivo: 'Horímetro lançado errado na frota 1204.' },
    })
    assert.equal(comMotivo.statusCode, 200)

    const { rows } = await pg.query<{ status: string }>(
      `select status from public.abastecimentos where data = current_date limit 1`,
    )
    assert.equal(rows[0]?.status, 'finalizado', 'o lançamento não voltou a aceitar correção')
  })

  it('guarda quem reabriu e por quê', async () => {
    const admin = await entrar('9001', '7196')
    const lista = await app.inject({
      method: 'POST',
      url: '/painel/fechamentos',
      headers: comToken(admin.corpo),
      payload: {},
    })
    const reaberto = (lista.json().fechamentos as Array<Record<string, unknown>>).find((f) => f.reaberto_em)
    assert.ok(reaberto, 'a reabertura não ficou registrada')
    assert.equal(reaberto.reaberto_por_nome, 'Escritório')
    assert.match(String(reaberto.motivo_reabertura), /Horímetro/)
  })
})

describe('saúde', () => {
  it('responde sem exigir sessão', async () => {
    const r = await app.inject({ method: 'GET', url: '/saude' })
    assert.equal(r.statusCode, 200)
    assert.equal(r.json().ok, true)
  })
})

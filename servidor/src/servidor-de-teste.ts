/**
 * Sobe a API contra um Postgres em memória, para desenvolver o painel sem
 * precisar de Docker na máquina.
 *
 * NÃO é para produção: o banco vive na memória do processo e some ao encerrar.
 * Serve para ver as telas com dados reais passando pela API de verdade.
 *
 *   node servidor/src/servidor-de-teste.ts
 */
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist'
import { unaccent } from '@electric-sql/pglite/contrib/unaccent'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

process.env.DATABASE_URL ??= 'postgres://memoria'
process.env.JWT_SEGREDO ??= 'segredo-de-desenvolvimento-nao-usar-em-producao'
process.env.ORIGENS_PERMITIDAS ??= 'http://localhost:5180'
process.env.NODE_ENV ??= 'production'

const pg = new PGlite({ extensions: { pgcrypto, btree_gist, unaccent } })

/** OIDs que o driver de produção converte via `setTypeParser` (ver banco.ts). */
const OID_NUMERIC = 1700
const OID_INT8 = 20

/**
 * Aplica as mesmas conversões de tipo que o driver de produção faz.
 *
 * O PGlite não passa pelos type parsers do `pg`, então NUMERIC chegava como
 * texto aqui e como número na VPS. Uma tela que some ou formata número
 * funcionava num ambiente e não no outro — e a falha é silenciosa: o valor
 * existe, só aparece como travessão. Sem isto, validar localmente não diz nada
 * sobre produção, que é justamente para o que este servidor serve.
 */
function converterTipos(linhas: unknown[], campos: Array<{ name: string; dataTypeID: number }>) {
  const numericas = campos.filter((c) => c.dataTypeID === OID_NUMERIC || c.dataTypeID === OID_INT8)
  if (numericas.length === 0) return linhas
  return linhas.map((linha) => {
    const l = linha as Record<string, unknown>
    for (const campo of numericas) {
      const v = l[campo.name]
      if (typeof v === 'string' && v !== '') l[campo.name] = Number(v)
    }
    return l
  })
}

const cliente = {
  query: async (texto: string, valores?: unknown[]) => {
    const r = await pg.query(texto, valores as never[])
    const linhas = converterTipos(r.rows, (r.fields ?? []) as Array<{ name: string; dataTypeID: number }>)
    return { rows: linhas, rowCount: linhas.length }
  },
  release: () => {},
}

const { pool } = await import('./banco.ts')
Object.assign(pool, { connect: async () => cliente, end: async () => {} })

await pg.exec(`do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'servico') then create role servico nologin bypassrls; end if;
end $$;`)

const pasta = join(RAIZ, 'banco', 'migrations')
for (const nome of readdirSync(pasta).filter((f) => f.endsWith('.sql')).sort()) {
  await pg.exec(readFileSync(join(pasta, nome), 'utf8'))
}

await pg.exec(`
  insert into public.funcionarios (id, codigo, nome, funcao, papel) values
    ('01920000-0000-7000-8000-000000000001', '1001', 'José Ferreira da Silva', 'Operador de colhedora', 'campo'),
    ('01920000-0000-7000-8000-000000000002', '1002', 'Antônio Carlos Souza', 'Abastecedor', 'campo'),
    ('01920000-0000-7000-8000-000000000009', '9001', 'Escritório GrisoMaq', 'Administração', 'admin');

  insert into public.fazendas (id, codigo, nome) values ('01920000-0000-7000-8000-000000000040', 'FZ01', 'Santa Rita');
  insert into public.frentes (id, codigo, nome, fazenda_id, escala) values
    ('01920000-0000-7000-8000-000000000050', 'F01', 'Frente 1 · Santa Rita', '01920000-0000-7000-8000-000000000040', '3_turnos');

  insert into public.frotas (id, numero, descricao, tipo, tem_horimetro_elevador, capacidade_tanque_litros) values
    ('01920000-0000-7000-8000-000000000010', '1204', 'Colhedora CH570', 'colhedora', true, 650),
    ('01920000-0000-7000-8000-000000000011', '9100', 'Comboio Diesel', 'comboio', false, 6000);

  insert into public.veiculos_transporte (id, numero, tipo, transportadora) values
    ('01920000-0000-7000-8000-000000000030', '77', 'cavalo', 'Transcana'),
    ('01920000-0000-7000-8000-000000000031', '82', 'cavalo', 'Transcana'),
    -- Rodotrem e cavalo + DUAS carretas. Sem carreta nenhuma cadastrada, a
    -- tela de chegada so conseguia registrar ciclo incompleto.
    ('01920000-0000-7000-8000-000000000032', '77A', 'carreta', 'Transcana'),
    ('01920000-0000-7000-8000-000000000033', '77B', 'carreta', 'Transcana'),
    ('01920000-0000-7000-8000-000000000034', '82A', 'carreta', 'Transcana'),
    ('01920000-0000-7000-8000-000000000035', '82B', 'carreta', 'Transcana');

  -- A Frente 1 e de 3 turnos; as duas escalas ficam cadastradas porque o
  -- seletor filtra pela escala da frente, e e isso que precisa ser conferido.
  insert into public.turnos (id, codigo, nome, escala, hora_inicio, hora_fim, duracao_horas, vira_dia) values
    ('01920000-0000-7000-8000-000000000060', 'T1', '1º Turno', '3_turnos', '06:00', '14:00', 8, false),
    ('01920000-0000-7000-8000-000000000061', 'T2', '2º Turno', '3_turnos', '14:00', '22:00', 8, false),
    ('01920000-0000-7000-8000-000000000062', 'T3', '3º Turno', '3_turnos', '22:00', '06:00', 8, true),
    ('01920000-0000-7000-8000-000000000063', 'A', 'Turno A', '2_turnos', '06:00', '18:00', 12, false),
    ('01920000-0000-7000-8000-000000000064', 'B', 'Turno B', '2_turnos', '18:00', '06:00', 12, true);

  insert into public.lideres (id, codigo, nome, funcionario_id) values
    ('01920000-0000-7000-8000-000000000070', 'L01', 'Sebastião Alves', null),
    ('01920000-0000-7000-8000-000000000071', 'L02', 'Antônio Carlos Souza', '01920000-0000-7000-8000-000000000002');

  select public.fn_definir_pin('01920000-0000-7000-8000-000000000009', '7196', null, false);
  select public.fn_definir_pin('01920000-0000-7000-8000-000000000001', '4731', null, false);
`)

// Duas semanas de operação, para os gráficos terem forma em vez de um ponto só.
for (let dia = 13; dia >= 0; dia--) {
  const ciclos = 3 + (dia % 4)
  for (let i = 0; i < ciclos; i++) {
    const chegada = 7 + i * 2
    const permanencia = 25 + ((dia * 7 + i * 13) % 95)
    await pg.exec(`
      insert into public.caminhao_ciclos
        (id, data, fazenda_id, caminhao_id, chegada_em, saida_em, criado_por, criado_em_dispositivo, dispositivo_id, app_versao)
      values (gen_random_uuid(), current_date - ${dia},
        '01920000-0000-7000-8000-000000000040',
        '${i % 2 === 0 ? '01920000-0000-7000-8000-000000000030' : '01920000-0000-7000-8000-000000000031'}',
        (current_date - ${dia} + time '${String(chegada).padStart(2, '0')}:${String((i * 17) % 60).padStart(2, '0')}') at time zone 'America/Sao_Paulo',
        (current_date - ${dia} + time '${String(chegada).padStart(2, '0')}:${String((i * 17) % 60).padStart(2, '0')}') at time zone 'America/Sao_Paulo' + interval '${permanencia} minutes',
        '01920000-0000-7000-8000-000000000001', now(), 'disp-exemplo', '0.1.0')`)
  }

  const litros = 180 + ((dia * 37) % 240)
  const divergencia = dia === 4 ? 30 : 0
  await pg.exec(`
    insert into public.abastecimentos
      (id, numero_documento, data, hora, momento, frota_id, comboio_frota_id,
       registrador_inicio, registrador_fim, litros, operador_funcionario_id,
       justificativa_divergencia, criado_por, criado_em_dispositivo, dispositivo_id, app_versao)
    values (gen_random_uuid(), ${6900 + dia}, current_date - ${dia}, '09:30',
      (current_date - ${dia} + time '09:30') at time zone 'America/Sao_Paulo',
      '01920000-0000-7000-8000-000000000010', '01920000-0000-7000-8000-000000000011',
      ${40000 + dia * 300}, ${40000 + dia * 300 + litros}, ${litros + divergencia},
      '01920000-0000-7000-8000-000000000001',
      ${divergencia > 0 ? "'Bomba travou; completado com balde aferido.'" : 'null'},
      '01920000-0000-7000-8000-000000000001', now(), 'disp-exemplo', '0.1.0')`)
}

// Um conflito e um celular parado, para o painel ter o que mostrar em "precisa
// de atenção" — que é o estado que o escritório precisa saber reconhecer.
await pg.exec(`
  insert into public.sync_operacoes (id, dispositivo_id, funcionario_id, tabela, registro_id, tipo, payload, status, erro_codigo, erro_mensagem)
  values (gen_random_uuid(), 'disp-exemplo', '01920000-0000-7000-8000-000000000001',
    'abastecimentos', gen_random_uuid(), 'inserir',
    '{"numero_documento": 6903, "litros": 45.0, "frota_id": "1204", "registrador_inicio": 45265, "registrador_fim": 45310}'::jsonb,
    'conflito', 'NUMERO_DOCUMENTO_DUPLICADO', 'duplicate key value violates unique constraint');

  insert into public.dispositivos (id, funcionario_id, app_versao, ultimo_sync_em)
  values ('disp-parado', '01920000-0000-7000-8000-000000000002', '0.1.0', now() - interval '31 hours');
`)

const { construirServidor } = await import('./index.ts')
const app = await construirServidor()

/**
 * Aloca uma faixa de numeração ao celular que entrar, se ele ainda não tiver.
 *
 * ANDAIME DE DESENVOLVIMENTO — em produção quem aloca é o escritório, de
 * propósito: a faixa é o que impede dois celulares offline de emitirem a mesma
 * ficha. Aqui o banco vive na memória e o id do aparelho nasce no navegador,
 * então a cada reinício ninguém conseguiria lançar um abastecimento sequer sem
 * ir ao painel primeiro. O andaime existe para a tela poder ser vista.
 */
app.addHook('preHandler', async (requisicao) => {
  if (requisicao.url !== '/auth/login-campo') return
  const corpo = requisicao.body as { dispositivo_id?: string } | undefined
  const dispositivo = corpo?.dispositivo_id
  if (!dispositivo) return

  const { rows } = await pg.query<{ n: number }>(
    'select count(*)::int as n from public.blocos_abastecimento where dispositivo_id = $1',
    [dispositivo],
  )
  if ((rows[0]?.n ?? 0) > 0) return

  // Cada aparelho ganha uma faixa de 50 que não encosta na dos outros.
  const { rows: usadas } = await pg.query<{ proximo: number }>(
    "select coalesce(max(numero_final), 6949) + 1 as proximo from public.blocos_abastecimento",
  )
  const inicial = usadas[0]?.proximo ?? 6950
  await pg.query(
    `insert into public.blocos_abastecimento
       (id, numero_inicial, numero_final, funcionario_id, dispositivo_id, comboio_frota_id, ativo)
     values (gen_random_uuid(), $1, $2,
       '01920000-0000-7000-8000-000000000001', $3,
       '01920000-0000-7000-8000-000000000011', true)`,
    [inicial, inicial + 49, dispositivo],
  )
  console.log('Faixa ' + inicial + '-' + (inicial + 49) + ' alocada ao aparelho ' + dispositivo.slice(0, 8))
})
// A porta vem de quem chamou (o plugin do Vite escolhe uma livre); 3000 fica
// como padrão para quem sobe este arquivo direto no terminal.
const porta = Number(process.env.PORTA ?? 3000)
await app.listen({ port: porta, host: '127.0.0.1' })
console.log('\nAPI de desenvolvimento em http://localhost:' + porta)
console.log('Escritório: código 9001 · PIN 7196')
console.log('Campo:      código 1001 · PIN 4731\n')

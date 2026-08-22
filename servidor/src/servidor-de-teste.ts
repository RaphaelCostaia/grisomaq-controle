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

const cliente = {
  query: async (texto: string, valores?: unknown[]) => {
    const r = await pg.query(texto, valores as never[])
    return { rows: r.rows, rowCount: r.rows.length }
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
    ('01920000-0000-7000-8000-000000000031', '82', 'cavalo', 'Transcana');

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
await app.listen({ port: 3000, host: '127.0.0.1' })
console.log('\nAPI de desenvolvimento em http://localhost:3000')
console.log('Escritório: código 9001 · PIN 7196')
console.log('Campo:      código 1001 · PIN 4731\n')

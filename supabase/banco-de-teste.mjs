/**
 * Monta um Postgres real (PGlite) com o esquema completo aplicado, mais os
 * stubs do que o Supabase fornece em runtime (schema auth, auth.jwt(), papeis).
 * Compartilhado pelo validador de migrations e pelos testes de comportamento.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist'
import { unaccent } from '@electric-sql/pglite/contrib/unaccent'

const aqui = dirname(fileURLToPath(import.meta.url))

export const PRELUDIO_SUPABASE = `
create schema if not exists auth;
create schema if not exists extensions;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  created_at timestamptz not null default now()
);

-- Em producao vem do GoTrue; aqui vem de uma GUC que os testes definem.
create or replace function auth.jwt() returns jsonb
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;

create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid
$$;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then create role supabase_auth_admin nologin; end if;
end $$;

-- O Supabase real ja concede isso; sem o grant, toda policy que chama
-- auth.jwt() morre com "permission denied for schema auth".
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.jwt() to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to authenticated, service_role;
alter default privileges in schema public grant all on functions to authenticated, service_role;
alter default privileges in schema public grant all on sequences to authenticated, service_role;
`

export function listarMigrations() {
  const pasta = join(aqui, 'migrations')
  return readdirSync(pasta)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((nome) => ({ nome, sql: readFileSync(join(pasta, nome), 'utf8') }))
}

/** Base nova com todas as migrations aplicadas. */
export async function criarBanco() {
  const db = new PGlite({ extensions: { pgcrypto, btree_gist, unaccent } })
  await db.exec(PRELUDIO_SUPABASE)
  for (const { sql } of listarMigrations()) {
    await db.exec(sql)
  }
  return db
}

/**
 * Executa como o papel `authenticated` com um JWT montado - e assim que a RLS
 * passa a valer. Rodar como superusuario passaria por cima de toda policy e o
 * teste nao provaria nada.
 */
export async function comoFuncionario(db, { funcionarioId, papel = 'campo', frenteId = null }, acao) {
  const claims = JSON.stringify({
    role: 'authenticated',
    app_metadata: { funcionario_id: funcionarioId, papel, frente_padrao_id: frenteId },
  })
  // Sessao, e nao `local`: as chamadas do teste nao rodam numa transacao unica,
  // e `set local` seria descartado antes da proxima instrucao.
  await db.exec(`set role authenticated; select set_config('request.jwt.claims', ${literal(claims)}, false);`)
  try {
    return await acao()
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claims', '', false);`)
  }
}

export function literal(texto) {
  return `'${String(texto).replace(/'/g, "''")}'`
}

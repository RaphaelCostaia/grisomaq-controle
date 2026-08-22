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

/**
 * O que o servidor de produção provisiona antes de aplicar as migrations.
 *
 * Encolheu bastante depois da troca do Supabase por uma API própria: o schema
 * `auth` e os papéis passaram a ser criados por migration (0000), então aqui
 * resta apenas o papel de serviço, que em produção é um usuário do banco.
 */
export const PRELUDIO_SERVIDOR = `
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'servico') then
    create role servico nologin bypassrls;
  end if;
end $$;
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
  await db.exec(PRELUDIO_SERVIDOR)
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

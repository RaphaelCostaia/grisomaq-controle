/**
 * Executa todas as migrations num Postgres real (PGlite, o mesmo motor
 * compilado para WASM) e falha no primeiro erro.
 *
 * Existe porque nem toda maquina de desenvolvimento tem Docker, e migration que
 * nunca foi executada nao e migration - e rascunho. Isto nao substitui
 * `supabase db reset`: o ambiente real tem GoTrue, Storage e o hook de token.
 * O que este script pega e o que mais custa caro achar tarde: erro de sintaxe,
 * coluna inexistente, trigger mal declarado, ordem errada de arquivo.
 *
 *   npm run db:validar
 */
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist'
import { unaccent } from '@electric-sql/pglite/contrib/unaccent'
import { PRELUDIO_SUPABASE, listarMigrations } from './banco-de-teste.mjs'

const db = new PGlite({ extensions: { pgcrypto, btree_gist, unaccent } })
await db.exec(PRELUDIO_SUPABASE)

const migrations = listarMigrations()
if (migrations.length === 0) {
  console.error('Nenhuma migration encontrada.')
  process.exit(1)
}

for (const { nome, sql } of migrations) {
  try {
    await db.exec(sql)
    console.log(`  ok   ${nome}`)
  } catch (erro) {
    console.error(`\n  FALHOU  ${nome}`)
    console.error(`  ${erro.message}`)
    if (erro.detail) console.error(`  detalhe: ${erro.detail}`)
    if (erro.hint) console.error(`  dica: ${erro.hint}`)
    if (erro.position) {
      const linha = sql.slice(0, Number(erro.position)).split('\n').length
      console.error(`  linha ~${linha}: ${sql.split('\n')[linha - 1]?.trim()}`)
    }
    process.exit(1)
  }
}

const resumo = await db.query(`
  select
    (select count(*) from information_schema.tables  where table_schema = 'public' and table_type = 'BASE TABLE') as tabelas,
    (select count(*) from information_schema.views   where table_schema = 'public') as views,
    (select count(*) from pg_trigger where not tgisinternal) as triggers,
    (select count(*) from pg_policies where schemaname = 'public') as policies,
    (select count(*) from public.parametros) as parametros
`)
console.log('\n  esquema:', resumo.rows[0])

// Tabela que guarda lancamento de campo sem RLS e um vazamento esperando
// acontecer. A checagem e explicita para nao depender de revisao humana.
const semRls = await db.query(`
  select c.relname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
   order by 1
`)
if (semRls.rows.length > 0) {
  console.error('\n  FALHOU: tabelas sem RLS:', semRls.rows.map((r) => r.relname).join(', '))
  process.exit(1)
}

await db.close()
console.log('  Todas as migrations aplicaram limpo, e toda tabela tem RLS.\n')

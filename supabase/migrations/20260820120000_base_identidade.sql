-- =============================================================================
-- GRISOMAQ CONTROLE - 0000 - identidade do chamador e papéis
-- =============================================================================
-- Este arquivo fornece o que uma plataforma gerenciada daria pronto: os papéis
-- do banco e a função que lê a identidade da requisição.
--
-- O mecanismo é o mesmo que o PostgREST usa: a API abre a transação, assume o
-- papel `authenticated` e publica as reivindicações do JWT numa configuração de
-- sessão. Daí em diante a RLS é a autoridade — a API não pode enxergar mais do
-- que o funcionário dela poderia, mesmo que tenha um bug.
--
-- Consequência prática: a API roda com um usuário SEM bypassrls. Se ela tentar
-- ler o que não deve, o banco recusa.
-- =============================================================================

create schema if not exists auth;

/**
 * Reivindicações da requisição atual.
 *
 * `request.jwt.claims` é definido por transação com `set_config(..., true)`.
 * O terceiro parâmetro `true` é o que amarra o valor à transação: sem ele, a
 * identidade vazaria para a próxima requisição que reusasse a mesma conexão
 * do pool — que é exatamente o modo de falha mais perigoso num pool.
 */
create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid
$$;

-- --- Papéis ------------------------------------------------------------------
-- `authenticated` é o papel que a API assume ao atender uma requisição de
-- usuário. `servico` é usado só no que precisa passar por fora da RLS: aplicar
-- migrations, provisionar funcionário e revalidar assinatura.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
end;
$$;

grant usage on schema auth to authenticated, anon;
grant execute on function auth.jwt() to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;

grant usage on schema public to authenticated, anon;

-- As tabelas criadas nas próximas migrations já nascem acessíveis ao papel; a
-- RLS é que decide o que ele enxerga em cada linha.
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public grant usage, select on sequences to authenticated;
alter default privileges in schema public grant execute on functions to authenticated;

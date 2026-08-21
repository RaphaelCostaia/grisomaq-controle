-- =============================================================================
-- GRISOMAQ CONTROLE - 0800 - Custom Access Token Hook
-- =============================================================================
-- Injeta a identidade de negocio dentro do proprio JWT. As policies de RLS leem
-- dali, e nao de `funcionarios`: sem isso, cada linha avaliada em cada consulta
-- dispararia um SELECT extra, e o painel do escritorio ficaria inviavel.
--
-- Habilitar em: Dashboard > Authentication > Hooks > Custom Access Token,
-- apontando para public.fn_token_customizado.
-- =============================================================================

create or replace function public.fn_token_customizado(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_reivindicacoes jsonb;
  v_funcionario    record;
begin
  select id, codigo, papel, frente_padrao_id, ativo
    into v_funcionario
    from public.funcionarios
   where auth_user_id = (event ->> 'user_id')::uuid;

  v_reivindicacoes := coalesce(event -> 'claims', '{}'::jsonb);

  if v_funcionario.id is null or not v_funcionario.ativo then
    -- Conta sem funcionario vinculado (ou desligado) recebe o papel mais
    -- restrito. Nao levantamos excecao: isso quebraria o login inteiro em vez
    -- de simplesmente nao dar acesso a nada.
    v_reivindicacoes := jsonb_set(
      v_reivindicacoes, '{app_metadata}',
      coalesce(v_reivindicacoes -> 'app_metadata', '{}'::jsonb) || jsonb_build_object('papel', 'campo')
    );
    return jsonb_set(event, '{claims}', v_reivindicacoes);
  end if;

  v_reivindicacoes := jsonb_set(
    v_reivindicacoes, '{app_metadata}',
    coalesce(v_reivindicacoes -> 'app_metadata', '{}'::jsonb) || jsonb_build_object(
      'funcionario_id',   v_funcionario.id,
      'codigo',           v_funcionario.codigo,
      'papel',            v_funcionario.papel,
      'frente_padrao_id', v_funcionario.frente_padrao_id
    )
  );

  return jsonb_set(event, '{claims}', v_reivindicacoes);
end;
$$;

grant execute on function public.fn_token_customizado(jsonb) to supabase_auth_admin;
revoke execute on function public.fn_token_customizado(jsonb) from authenticated, anon, public;

grant usage on schema public to supabase_auth_admin;
grant select on table public.funcionarios to supabase_auth_admin;

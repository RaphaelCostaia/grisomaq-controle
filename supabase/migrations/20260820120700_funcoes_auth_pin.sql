-- =============================================================================
-- GRISOMAQ CONTROLE - 0700 - PIN: definicao, conferencia e bloqueio
-- =============================================================================
-- O hash do PIN NUNCA sai do Postgres. Nem a Edge Function o le: ela chama
-- fn_verificar_pin, que devolve apenas verdadeiro/falso. Assim, um vazamento de
-- log ou de resposta HTTP nao entrega material para ataque offline.
-- =============================================================================

-- --- PIN fraco ---------------------------------------------------------------
-- Com 10.000 combinacoes, banir os padroes obvios remove justamente os que
-- alguem tentaria primeiro. A lista e curta de proposito: proibir demais faz o
-- funcionario anotar o PIN no capacete.

create or replace function public.fn_pin_fraco(p_pin text)
returns boolean
language plpgsql
immutable
as $$
begin
  if p_pin !~ '^[0-9]{4}$' then
    return true;
  end if;

  -- Todos os digitos iguais: 0000, 1111...
  if p_pin ~ '^(.)\1{3}$' then
    return true;
  end if;

  -- Sequencia crescente ou decrescente: 1234, 4321, 6789...
  if strpos('01234567890', p_pin) > 0 or strpos('09876543210', p_pin) > 0 then
    return true;
  end if;

  -- Ano de nascimento plausivel e o segundo palpite de qualquer um.
  if p_pin ~ '^(19[3-9][0-9]|20[0-2][0-9])$' then
    return true;
  end if;

  return false;
end;
$$;

-- --- Definir / trocar PIN ----------------------------------------------------

create or replace function public.fn_definir_pin(
  p_funcionario_id uuid,
  p_pin            text,
  p_verificador_offline jsonb default null,
  p_exigir_troca   boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.fn_pin_fraco(p_pin) then
    raise exception 'PIN_FRACO'
      using hint = 'Evite dígitos repetidos, sequências e anos de nascimento.';
  end if;

  update public.funcionarios
     set pin_hash = crypt(p_pin, gen_salt('bf', 12)),
         pin_verificador_offline = coalesce(p_verificador_offline, pin_verificador_offline),
         pin_definido_em = now(),
         pin_trocar_no_proximo_acesso = p_exigir_troca,
         pin_tentativas_falhas = 0,
         pin_bloqueado_ate = null
   where id = p_funcionario_id;

  if not found then
    raise exception 'FUNCIONARIO_NAO_ENCONTRADO';
  end if;
end;
$$;

revoke all on function public.fn_definir_pin(uuid, text, jsonb, boolean) from public, anon, authenticated;

-- --- Conferir PIN ------------------------------------------------------------

create or replace function public.fn_verificar_pin(p_funcionario_id uuid, p_pin text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash text;
begin
  select pin_hash into v_hash
    from public.funcionarios
   where id = p_funcionario_id and ativo;

  if v_hash is null then
    return false;
  end if;

  return v_hash = crypt(p_pin, v_hash);
end;
$$;

revoke all on function public.fn_verificar_pin(uuid, text) from public, anon, authenticated;

-- --- Contador de tentativas --------------------------------------------------
-- Cinco erros e 15 minutos de espera. O bloqueio vive no servidor, e nao no
-- celular: bloqueio local se resolve reinstalando o app.

create or replace function public.fn_registrar_falha_pin(p_funcionario_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.funcionarios
     set pin_tentativas_falhas = pin_tentativas_falhas + 1,
         pin_bloqueado_ate = case
           when pin_tentativas_falhas + 1 >= 5 then now() + interval '15 minutes'
           else pin_bloqueado_ate
         end
   where id = p_funcionario_id;
end;
$$;

create or replace function public.fn_zerar_falhas_pin(p_funcionario_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.funcionarios
     set pin_tentativas_falhas = 0,
         pin_bloqueado_ate = null
   where id = p_funcionario_id;
end;
$$;

revoke all on function public.fn_registrar_falha_pin(uuid) from public, anon, authenticated;
revoke all on function public.fn_zerar_falhas_pin(uuid) from public, anon, authenticated;

-- --- Dados de login ----------------------------------------------------------
-- Consultada pela Edge Function `login-campo` com service role.

create or replace function public.fn_funcionario_para_login(p_codigo text)
returns table (
  id uuid,
  codigo text,
  nome text,
  papel public.papel_usuario,
  frente_padrao_id uuid,
  auth_user_id uuid,
  ativo boolean,
  pin_definido boolean,
  pin_trocar boolean,
  bloqueado_ate timestamptz
)
language sql
security definer
set search_path = public
as $$
  select f.id, f.codigo, f.nome, f.papel, f.frente_padrao_id, f.auth_user_id, f.ativo,
         f.pin_hash is not null, f.pin_trocar_no_proximo_acesso, f.pin_bloqueado_ate
    from public.funcionarios f
   where f.codigo = p_codigo
$$;

revoke all on function public.fn_funcionario_para_login(text) from public, anon, authenticated;

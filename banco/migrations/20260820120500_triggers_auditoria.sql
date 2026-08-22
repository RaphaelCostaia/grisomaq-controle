-- =============================================================================
-- GRISOMAQ CONTROLE - 0500 - helpers de identidade, triggers e auditoria
-- =============================================================================

-- --- Identidade do chamador --------------------------------------------------
-- Leem do JWT, sem tocar em tabela. Isso importa: elas sao chamadas em toda
-- policy de RLS, e uma consulta por linha avaliada derrubaria o painel.

create or replace function public.fn_funcionario_atual()
returns uuid
language sql
stable
as $$
  select nullif(auth.jwt() -> 'app_metadata' ->> 'funcionario_id', '')::uuid
$$;

create or replace function public.fn_papel_atual()
returns public.papel_usuario
language sql
stable
as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'papel', 'campo')::public.papel_usuario
$$;

create or replace function public.fn_e_admin()
returns boolean
language sql
stable
as $$
  select public.fn_papel_atual() = 'admin'
$$;

-- --- atualizado_em + versao --------------------------------------------------
-- `versao` e o controle otimista: o celular envia a versao em que baseou a
-- edicao e o servidor compara. Sem isso, o escritorio corrigindo uma ficha
-- enquanto o campo a edita perde uma das duas alteracoes sem aviso.

create or replace function public.trg_fn_atualizado_em()
returns trigger
language plpgsql
as $$
begin
  new.atualizado_em := now();
  new.versao := coalesce(old.versao, 0) + 1;
  return new;
end;
$$;

create or replace function public.trg_fn_atualizado_em_mestre()
returns trigger
language plpgsql
as $$
begin
  new.atualizado_em := now();
  return new;
end;
$$;

-- --- Auditoria ---------------------------------------------------------------

create or replace function public.trg_fn_auditoria()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_antes  jsonb;
  v_depois jsonb;
  v_campos text[];
begin
  if tg_op = 'DELETE' then
    v_antes := to_jsonb(old);
  elsif tg_op = 'INSERT' then
    v_depois := to_jsonb(new);
  else
    v_antes  := to_jsonb(old);
    v_depois := to_jsonb(new);
    select array_agg(chave)
      into v_campos
      from jsonb_each(v_depois) as d(chave, valor)
     where d.valor is distinct from v_antes -> d.chave
       -- Ruido: essas tres mudam em toda gravacao e nao dizem nada.
       and d.chave not in ('atualizado_em', 'versao', 'atualizado_por');

    -- Nada mudou de fato: nao registra.
    if v_campos is null then
      return coalesce(new, old);
    end if;
  end if;

  insert into public.auditoria (tabela, registro_id, operacao, dados_antes, dados_depois, campos_alterados, feito_por)
  values (
    tg_table_name,
    coalesce((v_depois ->> 'id'), (v_antes ->> 'id'))::uuid,
    tg_op,
    v_antes,
    v_depois,
    v_campos,
    public.fn_funcionario_atual()
  );

  return coalesce(new, old);
end;
$$;

-- --- Documento travado -------------------------------------------------------
-- Depois do fechamento do mes, o campo nao altera mais. Sem essa trava, uma
-- correcao tardia mudaria um numero ja usado na folha e na conferencia de diesel.

create or replace function public.trg_fn_bloqueia_travado()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'travado' and not public.fn_e_admin() then
    raise exception 'DOCUMENTO_TRAVADO'
      using hint = 'Este período já foi fechado pelo escritório.';
  end if;
  return new;
end;
$$;

-- --- Historico de leituras ---------------------------------------------------
-- Alimentado por trigger, e nao pela aplicacao: assim vale igual para lancamento
-- vindo do celular, correcao feita pelo admin e importacao histórica.

-- SECURITY DEFINER: `frota_leituras` e dado DERIVADO, mantido pelo banco, e a
-- RLS dela so libera escrita ao escritorio. Sem isto, o trigger rodaria com a
-- permissao do funcionario e TODO lancamento de campo seria recusado pela
-- policy - o operador veria "sem permissao" ao salvar um abastecimento valido.
create or replace function public.trg_fn_leituras_abastecimento()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.excluido then
    delete from public.frota_leituras where origem_tabela = 'abastecimentos' and origem_id = new.id;
    return new;
  end if;

  if new.horimetro_motor is not null then
    insert into public.frota_leituras (id, frota_id, tipo, valor, momento, origem_tabela, origem_id)
    values (gen_random_uuid(), new.frota_id, 'horimetro_motor', new.horimetro_motor, new.momento, 'abastecimentos', new.id)
    on conflict (origem_tabela, origem_id, tipo)
      do update set valor = excluded.valor, momento = excluded.momento;
  end if;

  if new.horimetro_elevador is not null then
    insert into public.frota_leituras (id, frota_id, tipo, valor, momento, origem_tabela, origem_id)
    values (gen_random_uuid(), new.frota_id, 'horimetro_elevador', new.horimetro_elevador, new.momento, 'abastecimentos', new.id)
    on conflict (origem_tabela, origem_id, tipo)
      do update set valor = excluded.valor, momento = excluded.momento;
  end if;

  if new.odometro is not null then
    insert into public.frota_leituras (id, frota_id, tipo, valor, momento, origem_tabela, origem_id)
    values (gen_random_uuid(), new.frota_id, 'odometro', new.odometro, new.momento, 'abastecimentos', new.id)
    on conflict (origem_tabela, origem_id, tipo)
      do update set valor = excluded.valor, momento = excluded.momento;
  end if;

  return new;
end;
$$;

-- Mesmo motivo do trigger de abastecimento: dado derivado, escrito pelo banco.
create or replace function public.trg_fn_leituras_apontamento_item()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_momento timestamptz;
begin
  if new.excluido then
    delete from public.frota_leituras where origem_tabela = 'apontamento_itens' and origem_id = new.id;
    return new;
  end if;

  -- A leitura FINAL do item e a que vale como "ultima conhecida" da frota, e ela
  -- pertence ao fim do turno - por isso o momento vem do apontamento, nao de now().
  select (ap.data + t.hora_fim) at time zone 'America/Sao_Paulo'
    into v_momento
    from public.apontamentos ap
    join public.turnos t on t.id = ap.turno_id
   where ap.id = new.apontamento_id;

  v_momento := coalesce(v_momento, new.atualizado_em);

  if new.odometro_final is not null then
    insert into public.frota_leituras (id, frota_id, tipo, valor, momento, origem_tabela, origem_id)
    values (gen_random_uuid(), new.frota_id, 'odometro', new.odometro_final, v_momento, 'apontamento_itens', new.id)
    on conflict (origem_tabela, origem_id, tipo)
      do update set valor = excluded.valor, momento = excluded.momento;
  end if;

  if new.elevador_final is not null then
    insert into public.frota_leituras (id, frota_id, tipo, valor, momento, origem_tabela, origem_id)
    values (gen_random_uuid(), new.frota_id, 'horimetro_elevador', new.elevador_final, v_momento, 'apontamento_itens', new.id)
    on conflict (origem_tabela, origem_id, tipo)
      do update set valor = excluded.valor, momento = excluded.momento;
  end if;

  return new;
end;
$$;

-- --- IP da assinatura --------------------------------------------------------

create or replace function public.trg_fn_assinatura_ip()
returns trigger
language plpgsql
as $$
begin
  new.ip := inet_client_addr();
  return new;
end;
$$;

-- --- Ligacao dos triggers ----------------------------------------------------

do $$
declare
  v_tabela text;
begin
  -- Transacionais: versao + auditoria + trava de documento fechado.
  foreach v_tabela in array array['caminhao_ciclos', 'apontamentos', 'apontamento_itens', 'abastecimentos'] loop
    execute format(
      'create trigger trg_%1$s_atualizado before update on public.%1$s
         for each row execute function public.trg_fn_atualizado_em()', v_tabela);
    execute format(
      'create trigger trg_%1$s_travado before update on public.%1$s
         for each row execute function public.trg_fn_bloqueia_travado()', v_tabela);
    execute format(
      'create trigger trg_%1$s_auditoria after insert or update or delete on public.%1$s
         for each row execute function public.trg_fn_auditoria()', v_tabela);
  end loop;

  -- Mestres: so atualizado_em + auditoria (nao tem coluna versao).
  foreach v_tabela in array array['fazendas', 'frentes', 'turnos', 'funcionarios', 'frotas',
                                  'veiculos_transporte', 'lideres', 'blocos_abastecimento'] loop
    execute format(
      'create trigger trg_%1$s_atualizado before update on public.%1$s
         for each row execute function public.trg_fn_atualizado_em_mestre()', v_tabela);
    execute format(
      'create trigger trg_%1$s_auditoria after insert or update or delete on public.%1$s
         for each row execute function public.trg_fn_auditoria()', v_tabela);
  end loop;
end;
$$;

create trigger trg_abastecimentos_leituras
  after insert or update on public.abastecimentos
  for each row execute function public.trg_fn_leituras_abastecimento();

create trigger trg_apontamento_itens_leituras
  after insert or update on public.apontamento_itens
  for each row execute function public.trg_fn_leituras_apontamento_item();

create trigger trg_assinaturas_ip
  before insert on public.assinaturas_aceite
  for each row execute function public.trg_fn_assinatura_ip();

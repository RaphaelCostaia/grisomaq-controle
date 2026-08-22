-- =============================================================================
-- GRISOMAQ CONTROLE - 1400 - fechamento de período
-- =============================================================================
-- Depois que o mês fecha, os números viraram folha de pagamento e conferência
-- de diesel. Uma correção tardia mudaria um valor que já foi pago e já foi
-- conciliado — e ninguém saberia que mudou.
--
-- O trigger `trg_fn_bloqueia_travado` já recusa alteração em documento com
-- status 'travado'. O que faltava era alguém para virar essa chave, e um
-- registro de quem virou.
-- =============================================================================

create table public.fechamentos (
  id            uuid primary key default gen_random_uuid(),
  de            date not null,
  ate           date not null,
  observacao    text,

  fechado_por   uuid not null references public.funcionarios(id),
  fechado_em    timestamptz not null default now(),

  -- Reabrir é possível, mas fica registrado. Um período que foi reaberto e
  -- fechado de novo tem uma história que a conferência precisa poder ver.
  reaberto_por  uuid references public.funcionarios(id),
  reaberto_em   timestamptz,
  motivo_reabertura text,

  documentos_travados integer not null default 0,

  constraint fechamentos_periodo_valido check (ate >= de)
);

create index fechamentos_periodo_ix on public.fechamentos (de, ate);
create index fechamentos_abertos_ix on public.fechamentos (fechado_em desc) where reaberto_em is null;

alter table public.fechamentos enable row level security;
alter table public.fechamentos force row level security;

-- O campo enxerga os fechamentos para o app poder explicar por que uma ficha
-- parou de aceitar correção. Só o escritório fecha e reabre.
create policy fechamentos_leitura on public.fechamentos
  for select to authenticated using (true);

revoke insert, update, delete on table public.fechamentos from authenticated;

/**
 * Fecha um período.
 *
 * Marca como 'travado' todo lançamento das três fichas dentro do intervalo. A
 * partir daí o trigger recusa alteração vinda do campo, e só o escritório pode
 * mexer — que é exatamente a regra que o fechamento do mês precisa.
 *
 * Idempotente: fechar duas vezes o mesmo período não duplica nada nem quebra.
 */
create or replace function public.fn_travar_periodo(
  p_de date,
  p_ate date,
  p_observacao text default null
)
returns table (fechamento_id uuid, documentos integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := public.fn_funcionario_atual();
  v_total integer := 0;
  v_parcial integer;
  v_id uuid;
begin
  if not public.fn_e_admin() then
    raise exception 'SEM_PERMISSAO';
  end if;
  if p_ate < p_de then
    raise exception 'PERIODO_INVALIDO';
  end if;

  update public.abastecimentos set status = 'travado'
   where data between p_de and p_ate and not excluido and status <> 'travado';
  get diagnostics v_parcial = row_count;
  v_total := v_total + v_parcial;

  update public.caminhao_ciclos set status = 'travado'
   where data between p_de and p_ate and not excluido and status <> 'travado';
  get diagnostics v_parcial = row_count;
  v_total := v_total + v_parcial;

  update public.apontamentos set status = 'travado'
   where data between p_de and p_ate and not excluido and status <> 'travado';
  get diagnostics v_parcial = row_count;
  v_total := v_total + v_parcial;

  insert into public.fechamentos (de, ate, observacao, fechado_por, documentos_travados)
  values (p_de, p_ate, p_observacao, v_admin, v_total)
  returning id into v_id;

  return query select v_id, v_total;
end;
$$;

/**
 * Reabre um período fechado.
 *
 * Exige motivo. Reabrir o mês depois de fechado é excepcional — quem faz
 * precisa dizer por quê, e isso fica no registro para a conferência seguinte.
 *
 * A ficha de apontamento volta para 'finalizado', não para 'rascunho': ela já
 * tinha sido fechada pelo responsável em campo, e devolvê-la a rascunho
 * apagaria esse fato.
 */
create or replace function public.fn_destravar_periodo(
  p_fechamento_id uuid,
  p_motivo text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := public.fn_funcionario_atual();
  v_de date;
  v_ate date;
  v_total integer := 0;
  v_parcial integer;
begin
  if not public.fn_e_admin() then
    raise exception 'SEM_PERMISSAO';
  end if;
  if coalesce(trim(p_motivo), '') = '' then
    raise exception 'MOTIVO_OBRIGATORIO';
  end if;

  select de, ate into v_de, v_ate
    from public.fechamentos
   where id = p_fechamento_id and reaberto_em is null;

  if v_de is null then
    raise exception 'FECHAMENTO_NAO_ENCONTRADO';
  end if;

  update public.abastecimentos set status = 'finalizado'
   where data between v_de and v_ate and not excluido and status = 'travado';
  get diagnostics v_parcial = row_count;
  v_total := v_total + v_parcial;

  update public.caminhao_ciclos set status = 'finalizado'
   where data between v_de and v_ate and not excluido and status = 'travado';
  get diagnostics v_parcial = row_count;
  v_total := v_total + v_parcial;

  update public.apontamentos set status = 'finalizado'
   where data between v_de and v_ate and not excluido and status = 'travado';
  get diagnostics v_parcial = row_count;
  v_total := v_total + v_parcial;

  update public.fechamentos
     set reaberto_por = v_admin, reaberto_em = now(), motivo_reabertura = p_motivo
   where id = p_fechamento_id;

  return v_total;
end;
$$;

grant execute on function public.fn_travar_periodo(date, date, text) to authenticated;
grant execute on function public.fn_destravar_periodo(uuid, text) to authenticated;

/** Períodos fechados, com quem fechou e quem reabriu. */
create view public.vw_fechamentos
with (security_invoker = true) as
  select
    f.id,
    f.de,
    f.ate,
    f.observacao,
    f.fechado_em,
    f.documentos_travados,
    quem.nome as fechado_por_nome,
    f.reaberto_em,
    f.motivo_reabertura,
    reabriu.nome as reaberto_por_nome,
    f.reaberto_em is null as vigente
  from public.fechamentos f
  join public.funcionarios quem on quem.id = f.fechado_por
  left join public.funcionarios reabriu on reabriu.id = f.reaberto_por;

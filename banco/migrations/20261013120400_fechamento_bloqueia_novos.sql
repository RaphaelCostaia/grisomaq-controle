-- =============================================================================
-- GRISOMAQ CONTROLE - 1013120400 - fechamento bloqueia INSERT retroativo
-- =============================================================================
-- `fn_travar_periodo` só marcava os documentos EXISTENTES como 'travado'. O
-- trigger `trg_fn_bloqueia_travado` então impedia alteração deles.
--
-- QA mostrou o furo: um celular offline por 3 dias volta online e manda
-- lançamentos com data dentro de um mês já fechado. Como são INSERTs novos,
-- nunca foram marcados como 'travado' — passavam normalmente. O escritório
-- fecha o mês esperando que já veio tudo, operador liga o celular e os
-- números do mês crescem.
--
-- Trigger adicional: INSERT em qualquer uma das três fichas de campo é
-- recusado quando a data cai dentro de um fechamento vigente (não reaberto).
-- Admin ignora: correção/importação manual, com rastro de auditoria.
-- =============================================================================

create or replace function public.fn_bloqueia_insert_em_periodo_fechado()
returns trigger
language plpgsql
as $$
declare
  v_existe boolean;
begin
  if public.fn_e_admin() then
    return new;
  end if;

  select exists (
    select 1 from public.fechamentos
     where reaberto_em is null
       and new.data between de and ate
  ) into v_existe;

  if v_existe then
    raise exception 'PERIODO_FECHADO' using
      detail = format('A data %s está dentro de um fechamento vigente.', new.data);
  end if;
  return new;
end;
$$;

do $$
declare
  v_tabela text;
begin
  foreach v_tabela in array array['abastecimentos', 'caminhao_ciclos', 'apontamentos'] loop
    execute format(
      'create trigger trg_%1$s_bloqueia_periodo_fechado
         before insert on public.%1$I
         for each row execute function public.fn_bloqueia_insert_em_periodo_fechado()',
      v_tabela
    );
  end loop;
end;
$$;

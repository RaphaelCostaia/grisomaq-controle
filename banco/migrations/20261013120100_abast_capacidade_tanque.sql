-- =============================================================================
-- GRISOMAQ CONTROLE - 1013120100 - litros não podem exceder a capacidade do tanque
-- =============================================================================
-- A regra "abastecimento acima de 115% do tanque é bloqueado como erro de
-- digitação" vivia só no cliente. QA mostrou que mandar 600 L num tanque de
-- 500 L via /sync/push passava com `aplicada`.
--
-- O fator vive em `parametros.fator_capacidade_tanque` (default 1.15), para
-- o escritório ajustar sem deploy.
-- =============================================================================

create or replace function public.fn_abast_validar_capacidade()
returns trigger
language plpgsql
as $$
declare
  v_capacidade numeric;
  v_fator      numeric;
  v_limite     numeric;
begin
  select capacidade_tanque_litros into v_capacidade
    from public.frotas where id = new.frota_id;
  if v_capacidade is null then
    return new; -- frota sem capacidade cadastrada: nada a conferir
  end if;

  select (valor::text)::numeric into v_fator
    from public.parametros where chave = 'fator_capacidade_tanque';
  v_fator := coalesce(v_fator, 1.15);

  v_limite := v_capacidade * v_fator;
  if new.litros > v_limite then
    raise exception 'LITROS_EXCEDEM_TANQUE' using
      detail = format('%s L excede %s L (capacidade %s L x fator %s)',
                      new.litros, v_limite, v_capacidade, v_fator);
  end if;
  return new;
end;
$$;

create trigger trg_abast_validar_capacidade
  before insert or update on public.abastecimentos
  for each row execute function public.fn_abast_validar_capacidade();

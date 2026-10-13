-- =============================================================================
-- GRISOMAQ CONTROLE - 1013120200 - número tem que caber no bloco alocado
-- =============================================================================
-- Cada aparelho recebe uma faixa de numeração (ex.: 7000–7099). O que impede
-- dois celulares de emitirem a mesma ficha é essa alocação, não a unicidade
-- global do número. QA mostrou que um operador alocado em 7000–7099 conseguia
-- lançar com número 500 (fora da faixa) — a defesa só existia na UI.
--
-- Regra:
--   - se bloco_id está presente, numero_documento tem que estar entre
--     numero_inicial e numero_final do mesmo bloco, e o bloco tem que estar
--     ativo.
--   - admin ignora (manutenção pontual, importação de histórico, etc.).
-- =============================================================================

create or replace function public.fn_abast_validar_numero_no_bloco()
returns trigger
language plpgsql
as $$
declare
  v_bloco public.blocos_abastecimento;
begin
  if new.bloco_id is null then
    return new; -- sem bloco informado, trigger não opina
  end if;
  if public.fn_e_admin() then
    return new; -- admin passa (correção manual)
  end if;

  select * into v_bloco from public.blocos_abastecimento where id = new.bloco_id;
  if not found then
    raise exception 'BLOCO_INEXISTENTE';
  end if;
  if not v_bloco.ativo then
    raise exception 'BLOCO_INATIVO';
  end if;
  if new.numero_documento < v_bloco.numero_inicial
     or new.numero_documento > v_bloco.numero_final then
    raise exception 'NUMERO_FORA_DO_BLOCO' using
      detail = format('%s não cabe em %s–%s', new.numero_documento,
                      v_bloco.numero_inicial, v_bloco.numero_final);
  end if;
  return new;
end;
$$;

create trigger trg_abast_validar_numero_no_bloco
  before insert on public.abastecimentos
  for each row execute function public.fn_abast_validar_numero_no_bloco();

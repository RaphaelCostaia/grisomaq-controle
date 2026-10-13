-- =============================================================================
-- GRISOMAQ CONTROLE - 1013120300 - intervalo mínimo entre dois abastecimentos
-- =============================================================================
-- "Esta frota abasteceu há poucos minutos" era aviso só no cliente. QA mostrou
-- que dois pushes a 1 minuto de distância passavam direto no servidor —
-- então um cliente adulterado podia duplicar um lançamento quase idêntico sem
-- bater em nada.
--
-- Trava: operador do campo não insere outro abastecimento na mesma frota se o
-- último foi há menos de `minutos_min_entre_abastecimentos` (default 30 min).
-- Admin ignora, porque correção manual pode precisar.
-- =============================================================================

create or replace function public.fn_abast_validar_intervalo()
returns trigger
language plpgsql
as $$
declare
  v_minutos integer;
  v_recente timestamptz;
begin
  if public.fn_e_admin() then
    return new;
  end if;

  select (valor::text)::integer into v_minutos
    from public.parametros where chave = 'minutos_min_entre_abastecimentos';
  v_minutos := coalesce(v_minutos, 30);
  if v_minutos <= 0 then
    return new;
  end if;

  select max(momento) into v_recente
    from public.abastecimentos
   where frota_id = new.frota_id
     and not excluido
     and id <> new.id
     and momento >= new.momento - make_interval(mins => v_minutos)
     and momento <= new.momento;

  if v_recente is not null then
    raise exception 'INTERVALO_MINIMO' using
      detail = format('Última ficha desta frota foi em %s (menos de %s min).',
                      to_char(v_recente at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI'),
                      v_minutos);
  end if;
  return new;
end;
$$;

create trigger trg_abast_validar_intervalo
  before insert on public.abastecimentos
  for each row execute function public.fn_abast_validar_intervalo();

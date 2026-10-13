-- =============================================================================
-- GRISOMAQ CONTROLE - 1013120700 - validar numero_documento por trigger
-- =============================================================================
-- A migration 20261013120000 criou um CHECK CONSTRAINT com NOT VALID. Isso
-- resolveu o passado mas o Postgres ainda avalia o check em UPDATEs — e
-- fn_travar_periodo faz `update ... set status = 'travado'` em registros
-- históricos cujo numero_documento viola a regra (dados ruins deixados pelo
-- QA, antes da trava existir), abortando o fechamento inteiro.
--
-- Trocar por trigger before insert resolve: valida só o que entra agora, não
-- é acionado em nenhum UPDATE, e segue o mesmo padrão dos outros triggers
-- deste PR (capacidade, bloco, intervalo, período fechado).
-- =============================================================================

alter table public.abastecimentos
  drop constraint if exists abast_numero_documento_range;

create or replace function public.fn_abast_validar_numero_range()
returns trigger
language plpgsql
as $$
begin
  if new.numero_documento <= 0 or new.numero_documento > 99999999 then
    raise exception 'NUMERO_INVALIDO' using
      detail = format('%s não é um número de ficha válido (1..99.999.999).', new.numero_documento);
  end if;
  return new;
end;
$$;

create trigger trg_abast_validar_numero_range
  before insert on public.abastecimentos
  for each row execute function public.fn_abast_validar_numero_range();

-- Tradução no sync_push: antes vinha pelo nome do constraint
-- (abast_numero_documento_range); agora vem do raise exception 'NUMERO_INVALIDO'.
-- Adiciona a regra para o helper sem reescrever a função inteira — a cadeia de
-- `if ... then return ...` já cobre os outros códigos deste padrão.
create or replace function public.fn_sync_traduzir_erro(
  p_sqlstate text, p_sqlerrm text, p_tabela text
) returns text
language plpgsql
immutable
as $$
begin
  if p_sqlerrm like '%LITROS_EXCEDEM_TANQUE%'  then return 'LITROS_EXCEDEM_TANQUE'; end if;
  if p_sqlerrm like '%NUMERO_FORA_DO_BLOCO%'   then return 'NUMERO_FORA_DO_BLOCO'; end if;
  if p_sqlerrm like '%NUMERO_INVALIDO%'        then return 'NUMERO_INVALIDO'; end if;
  if p_sqlerrm like '%BLOCO_INATIVO%'          then return 'BLOCO_INATIVO'; end if;
  if p_sqlerrm like '%BLOCO_INEXISTENTE%'      then return 'BLOCO_INEXISTENTE'; end if;
  if p_sqlerrm like '%INTERVALO_MINIMO%'       then return 'INTERVALO_MINIMO'; end if;
  if p_sqlerrm like '%PERIODO_FECHADO%'        then return 'PERIODO_FECHADO'; end if;
  if p_sqlerrm like '%ALTERACAO_RECUSADA%'     then return 'PERIODO_FECHADO'; end if;
  if p_sqlerrm like '%DOCUMENTO_TRAVADO%'      then return 'PERIODO_FECHADO'; end if;
  if p_sqlerrm like '%REGISTRO_INEXISTENTE%'   then return 'REGISTRO_INEXISTENTE'; end if;
  if p_sqlerrm like '%VERSAO_DIVERGENTE%'      then return 'VERSAO_DIVERGENTE'; end if;

  if p_sqlerrm like '%abast_registrador_crescente%'   then return 'LEITURA_INVERTIDA'; end if;
  if p_sqlerrm like '%abast_litros_positivo%'         then return 'LITROS_INVALIDOS'; end if;
  if p_sqlerrm like '%abast_divergencia_justificada%' then return 'DIVERGENCIA_SEM_JUSTIFICATIVA'; end if;

  if p_sqlstate = '42501' then return 'SEM_PERMISSAO'; end if;
  if p_sqlerrm like '%row-level security%' then return 'DATA_FORA_PERIODO'; end if;

  if p_sqlstate = '23505' then
    return case
      when p_tabela = 'abastecimentos'  then 'NUMERO_DOCUMENTO_DUPLICADO'
      when p_tabela = 'apontamentos'    then 'APONTAMENTO_DUPLICADO'
      when p_tabela = 'caminhao_ciclos' then 'CICLO_ABERTO_DUPLICADO'
      else 'REGISTRO_DUPLICADO'
    end;
  end if;
  if p_sqlstate = '23P01' then return 'CICLO_SOBREPOSTO'; end if;
  if p_sqlstate = '23503' then return 'VINCULO_INEXISTENTE'; end if;
  if p_sqlstate = '23502' then return 'CAMPO_OBRIGATORIO'; end if;
  if p_sqlstate = '23514' then return 'DADOS_INVALIDOS'; end if;

  return 'ERRO_DESCONHECIDO';
end;
$$;

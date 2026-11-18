-- =============================================================================
-- GRISOMAQ CONTROLE - 1118130000 - janela de retroatividade do abastecimento
-- =============================================================================
-- A tela de campo deixa lançar abastecimento com data de até N dias atrás
-- (parâmetro dias_retroatividade_maxima, padrão 7). A RLS, porém, ainda só
-- aceitava hoje e ontem: a ficha de 3 dias atrás passava no celular e era
-- recusada no servidor como DATA_FORA_PERIODO, indo parar em conflitos. O
-- mesmo acontecia com o celular que ficava mais de um dia sem sinal.
--
-- A janela da RLS passa a ler o mesmo parâmetro. Período fechado continua
-- protegido pelo trigger fn_bloqueia_insert_em_periodo_fechado e pelo status
-- 'travado'. Só a tabela de abastecimentos muda: caminhões e apontamentos
-- seguem na janela de hoje e ontem.
-- =============================================================================

/**
 * Dias de retroatividade aceitos para o campo. Limitado a 1..31: um valor
 * digitado errado no parâmetro (0, 9999, texto) não pode fechar o campo nem
 * abrir o histórico inteiro.
 */
create or replace function public.fn_dias_retroatividade()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select greatest(1, least(31, coalesce(
    (select case when (valor #>> '{}') ~ '^[0-9]+$' then (valor #>> '{}')::integer end
       from public.parametros
      where chave = 'dias_retroatividade_maxima'),
    7)))
$$;

drop policy if exists abastecimentos_campo_leitura on public.abastecimentos;
drop policy if exists abastecimentos_campo_insercao on public.abastecimentos;
drop policy if exists abastecimentos_campo_correcao on public.abastecimentos;

create policy abastecimentos_campo_leitura on public.abastecimentos
  for select to authenticated
  using (
    criado_por = (select public.fn_funcionario_atual())
    and data >= current_date - (select public.fn_dias_retroatividade())
  );

create policy abastecimentos_campo_insercao on public.abastecimentos
  for insert to authenticated
  with check (
    criado_por = (select public.fn_funcionario_atual())
    and data between current_date - (select public.fn_dias_retroatividade()) and current_date
  );

create policy abastecimentos_campo_correcao on public.abastecimentos
  for update to authenticated
  using (
    criado_por = (select public.fn_funcionario_atual())
    and data >= current_date - (select public.fn_dias_retroatividade())
    and status <> 'travado'
  )
  with check (criado_por = (select public.fn_funcionario_atual()));

-- Tradução de erros do sync_push: a violação de RLS chega com SQLSTATE 42501,
-- o mesmo de "sem permissão". A checagem genérica do 42501 vinha antes da
-- mensagem "row-level security", então a ficha fora da janela de datas
-- aparecia ao comboista como SEM_PERMISSAO em vez de DATA_FORA_PERIODO.
-- Única mudança em relação a 20261013120700: a ordem dessas duas linhas.
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

  if p_sqlerrm like '%row-level security%' then return 'DATA_FORA_PERIODO'; end if;
  if p_sqlstate = '42501' then return 'SEM_PERMISSAO'; end if;

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

-- =============================================================================
-- GRISOMAQ CONTROLE - 1013120500 - traduzir erros do Postgres no sync_push
-- =============================================================================
-- O exception do sync_push mandava `DADOS_INVALIDOS` + sqlerrm cru para o
-- cliente em qualquer check_violation / foreign_key_violation. QA mostrou
-- que o escritório via no painel de Conflitos frases como:
--
--   "violates check constraint abast_divergencia_justificada"
--   "violates row-level security policy for table abastecimentos"
--   "violates foreign key constraint abastecimentos_operador_funcionario_id_fkey"
--
-- Mesma classe de bug que o commit 84207dc corrigiu em cadastros.
--
-- Função helper mapeia SQLSTATE + SQLERRM para códigos semânticos que o
-- cliente conhece (MENSAGEM_POR_CODIGO em src/dados/api.ts), e aqui o
-- EXCEPTION do sync_push passa a usar essa função.
-- =============================================================================

create or replace function public.fn_sync_traduzir_erro(
  p_sqlstate text, p_sqlerrm text, p_tabela text
) returns text
language plpgsql
immutable
as $$
begin
  -- Triggers de validação (RAISE EXCEPTION com código no texto)
  if p_sqlerrm like '%LITROS_EXCEDEM_TANQUE%'  then return 'LITROS_EXCEDEM_TANQUE'; end if;
  if p_sqlerrm like '%NUMERO_FORA_DO_BLOCO%'   then return 'NUMERO_FORA_DO_BLOCO'; end if;
  if p_sqlerrm like '%BLOCO_INATIVO%'          then return 'BLOCO_INATIVO'; end if;
  if p_sqlerrm like '%BLOCO_INEXISTENTE%'      then return 'BLOCO_INEXISTENTE'; end if;
  if p_sqlerrm like '%INTERVALO_MINIMO%'       then return 'INTERVALO_MINIMO'; end if;
  if p_sqlerrm like '%PERIODO_FECHADO%'        then return 'PERIODO_FECHADO'; end if;
  if p_sqlerrm like '%ALTERACAO_RECUSADA%'     then return 'PERIODO_FECHADO'; end if;
  if p_sqlerrm like '%DOCUMENTO_TRAVADO%'      then return 'PERIODO_FECHADO'; end if;
  if p_sqlerrm like '%REGISTRO_INEXISTENTE%'   then return 'REGISTRO_INEXISTENTE'; end if;
  if p_sqlerrm like '%VERSAO_DIVERGENTE%'      then return 'VERSAO_DIVERGENTE'; end if;

  -- Check constraints por nome — mensagem mais útil que "DADOS_INVALIDOS".
  if p_sqlerrm like '%abast_numero_documento_range%' then return 'NUMERO_INVALIDO'; end if;
  if p_sqlerrm like '%abast_registrador_crescente%'  then return 'LEITURA_INVERTIDA'; end if;
  if p_sqlerrm like '%abast_litros_positivo%'        then return 'LITROS_INVALIDOS'; end if;
  if p_sqlerrm like '%abast_divergencia_justificada%' then return 'DIVERGENCIA_SEM_JUSTIFICATIVA'; end if;

  -- RLS filtra a linha: data fora do current_date±1, autor que não bate etc.
  -- Em sync_push isso quase sempre é data fora da janela permitida.
  if p_sqlstate = '42501' then return 'SEM_PERMISSAO'; end if;
  if p_sqlerrm like '%row-level security%' then return 'DATA_FORA_PERIODO'; end if;

  -- Famílias padrão do Postgres sem tradução específica
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
  if p_sqlstate = '23514' then return 'DADOS_INVALIDOS'; end if;  -- outros check constraints

  return 'ERRO_DESCONHECIDO';
end;
$$;

grant execute on function public.fn_sync_traduzir_erro(text, text, text) to authenticated;

-- Reescreve o exception do sync_push para usar a tradução nova. Mantém TUDO
-- o resto da função — só muda os três blocos de exception para um WHEN OTHERS
-- com helper.
create or replace function public.sync_push(
  p_operacoes      jsonb,
  p_dispositivo_id text,
  p_app_versao     text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $func$
declare
  v_funcionario    uuid := public.fn_funcionario_atual();
  v_versao_minima  text;
  v_resultados     jsonb := '[]'::jsonb;
  v_op             jsonb;
  v_op_id          uuid;
  v_tabela         text;
  v_registro_id    uuid;
  v_tipo           public.tipo_operacao_sync;
  v_payload        jsonb;
  v_base_versao    integer;
  v_colunas        text[];
  v_lista_colunas  text;
  v_lista_sets     text;
  v_versao_atual   integer;
  v_autor_atual    uuid;
  v_linhas         integer;
  v_status         public.status_operacao_sync;
  v_erro_codigo    text;
  v_erro_mensagem  text;
begin
  if v_funcionario is null then
    raise exception 'SEM_IDENTIDADE'
      using hint = 'O token não carrega funcionario_id. Entre de novo no app.';
  end if;

  select valor #>> '{}' into v_versao_minima from public.parametros where chave = 'app_versao_minima';

  if v_versao_minima is not null and string_to_array(p_app_versao, '.')::int[] < string_to_array(v_versao_minima, '.')::int[] then
    raise exception 'VERSAO_OBSOLETA'
      using hint = 'Atualize o aplicativo para enviar os lançamentos.';
  end if;

  for v_op in select * from jsonb_array_elements(p_operacoes) loop
    v_op_id       := (v_op ->> 'op_id')::uuid;
    v_tabela      := v_op ->> 'tabela';
    v_registro_id := (v_op ->> 'registro_id')::uuid;
    v_tipo        := (v_op ->> 'tipo')::public.tipo_operacao_sync;
    v_payload     := coalesce(v_op -> 'payload', '{}'::jsonb);
    v_base_versao := nullif(v_op ->> 'base_versao', '')::integer;
    v_erro_codigo := null;
    v_erro_mensagem := null;

    if not public.fn_tabela_sincronizavel(v_tabela) then
      v_resultados := v_resultados || jsonb_build_object(
        'op_id', v_op_id, 'status', 'rejeitada', 'erro_codigo', 'TABELA_INVALIDA');
      continue;
    end if;

    if not public.fn_sync_reservar_operacao(
      v_op_id, p_dispositivo_id, v_funcionario, v_tabela, v_registro_id, v_tipo, v_base_versao, v_payload
    ) then
      v_resultados := v_resultados || jsonb_build_object('op_id', v_op_id, 'status', 'duplicada');
      continue;
    end if;

    begin
      v_payload := v_payload
        || jsonb_build_object('dispositivo_id', p_dispositivo_id, 'app_versao', p_app_versao);

      if v_tipo = 'inserir' then
        v_payload := v_payload || jsonb_build_object('id', v_registro_id, 'criado_por', v_funcionario);

        v_colunas := public.fn_colunas_gravaveis(v_tabela, v_payload);
        select string_agg(quote_ident(c), ', ') into v_lista_colunas from unnest(v_colunas) c;

        execute format(
          'insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I, $1)',
          v_tabela, v_lista_colunas, v_lista_colunas, v_tabela
        ) using v_payload;

      elsif v_tipo = 'atualizar' then
        execute format('select versao, criado_por from public.%I where id = $1', v_tabela)
          into v_versao_atual, v_autor_atual using v_registro_id;

        if v_versao_atual is null then
          raise exception 'REGISTRO_INEXISTENTE';
        end if;

        if v_base_versao is not null and v_versao_atual <> v_base_versao and v_autor_atual is distinct from v_funcionario then
          raise exception 'VERSAO_DIVERGENTE';
        end if;

        v_payload := v_payload - 'id' - 'criado_por' - 'criado_em' - 'versao'
          || jsonb_build_object('atualizado_por', v_funcionario);

        v_colunas := public.fn_colunas_gravaveis(v_tabela, v_payload);
        select string_agg(format('%1$I = p.%1$I', c), ', ') into v_lista_sets from unnest(v_colunas) c;

        execute format(
          'update public.%I t set %s from jsonb_populate_record(null::public.%I, $1) p where t.id = $2',
          v_tabela, v_lista_sets, v_tabela
        ) using v_payload, v_registro_id;

        get diagnostics v_linhas = row_count;
        if v_linhas = 0 then
          raise exception 'ALTERACAO_RECUSADA';
        end if;

      elsif v_tipo = 'excluir' then
        execute format(
          'update public.%I set excluido = true, excluido_em = now(), excluido_por = $2 where id = $1',
          v_tabela
        ) using v_registro_id, v_funcionario;

        get diagnostics v_linhas = row_count;
        if v_linhas = 0 then
          raise exception 'ALTERACAO_RECUSADA';
        end if;
      end if;

      v_status := 'aplicada';

    exception
      when others then
        v_status := 'conflito';
        v_erro_codigo := public.fn_sync_traduzir_erro(sqlstate, sqlerrm, v_tabela);
        v_erro_mensagem := sqlerrm;
    end;

    perform public.fn_sync_concluir_operacao(v_op_id, v_status, v_erro_codigo, v_erro_mensagem);

    v_resultados := v_resultados || jsonb_strip_nulls(jsonb_build_object(
      'op_id', v_op_id,
      'status', v_status,
      'erro_codigo', v_erro_codigo,
      'erro_mensagem', v_erro_mensagem
    ));
  end loop;

  perform public.fn_sync_registrar_dispositivo(p_dispositivo_id, v_funcionario, p_app_versao);

  return jsonb_build_object('servidor_agora', now(), 'resultados', v_resultados);
end;
$func$;

grant execute on function public.sync_push(jsonb, text, text) to authenticated;

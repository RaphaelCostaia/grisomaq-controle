-- =============================================================================
-- GRISOMAQ CONTROLE - 1000 - sincronizacao
-- =============================================================================
-- SECURITY INVOKER de proposito: o push roda com a identidade do funcionario,
-- entao a RLS de 0900 continua sendo a autoridade. Uma funcao SECURITY DEFINER
-- aqui viraria um tunel que ignora todas as policies.
--
-- Duas garantias que este arquivo precisa entregar:
--   1. Idempotencia. `sync_operacoes.id` e o op_id gerado no celular. Reenviar
--      a mesma operacao (porque a resposta se perdeu no sinal) devolve
--      'duplicada' - nunca um segundo abastecimento.
--   2. Nenhum payload descartado. Cada operacao roda no proprio bloco EXCEPTION,
--      entao uma constraint violada nao derruba o lote e o payload fica gravado
--      para o escritorio resolver.
-- =============================================================================

create or replace function public.fn_tabela_sincronizavel(p_tabela text)
returns boolean
language sql
immutable
as $$
  select p_tabela in (
    'caminhao_ciclos', 'apontamentos', 'apontamento_itens',
    'abastecimentos', 'assinaturas_aceite'
  )
$$;

-- Colunas do payload que realmente existem na tabela e nao sao geradas.
-- Ignorar as geradas nao e detalhe: `litros_registrador` e
-- `permanencia_minutos` viriam no payload e fariam o INSERT inteiro falhar.
create or replace function public.fn_colunas_gravaveis(p_tabela text, p_payload jsonb)
returns text[]
language sql
stable
as $$
  select coalesce(array_agg(c.column_name order by c.ordinal_position), '{}')
    from information_schema.columns c
   where c.table_schema = 'public'
     and c.table_name = p_tabela
     and c.is_generated = 'NEVER'
     and c.identity_generation is null
     and p_payload ? c.column_name
$$;

-- --- Ledger ------------------------------------------------------------------
-- Escrito so por estas duas funcoes. O papel `authenticated` nao tem INSERT nem
-- UPDATE em sync_operacoes (ver 0900): assim o cliente nao consegue carimbar
-- uma operacao em conflito como 'aplicada' e fazer o lancamento sumir da fila
-- de pendencias sem nunca ter entrado no banco.

-- Reserva o op_id. Devolve false quando ele JA tinha sido processado - e esse
-- false que transforma um reenvio em 'duplicada' em vez de um lancamento a mais.
create or replace function public.fn_sync_reservar_operacao(
  p_op_id uuid, p_dispositivo_id text, p_funcionario_id uuid, p_tabela text,
  p_registro_id uuid, p_tipo public.tipo_operacao_sync, p_base_versao integer, p_payload jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_linhas integer;
begin
  insert into public.sync_operacoes (
    id, dispositivo_id, funcionario_id, tabela, registro_id, tipo, base_versao, payload, status
  )
  values (
    p_op_id, p_dispositivo_id, p_funcionario_id, p_tabela, p_registro_id, p_tipo,
    p_base_versao, p_payload, 'aplicada'
  )
  on conflict (id) do nothing;

  get diagnostics v_linhas = row_count;
  return v_linhas > 0;
end;
$$;

create or replace function public.fn_sync_concluir_operacao(
  p_op_id uuid, p_status public.status_operacao_sync, p_erro_codigo text, p_erro_mensagem text
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.sync_operacoes
     set status = p_status, erro_codigo = p_erro_codigo, erro_mensagem = p_erro_mensagem
   where id = p_op_id
$$;

-- Marca de vida do aparelho. Tambem definer: `dispositivos` guarda o registro
-- de qual celular esta com fila parada, e isso e dado de operacao, nao do usuario.
create or replace function public.fn_sync_registrar_dispositivo(
  p_dispositivo_id text, p_funcionario_id uuid, p_app_versao text
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.dispositivos (id, funcionario_id, app_versao, ultimo_sync_em)
  values (p_dispositivo_id, p_funcionario_id, p_app_versao, now())
  on conflict (id) do update
    set funcionario_id = excluded.funcionario_id,
        app_versao = excluded.app_versao,
        ultimo_sync_em = now()
$$;

revoke all on function public.fn_sync_reservar_operacao(uuid, text, uuid, text, uuid, public.tipo_operacao_sync, integer, jsonb) from public, anon;
revoke all on function public.fn_sync_concluir_operacao(uuid, public.status_operacao_sync, text, text) from public, anon;
revoke all on function public.fn_sync_registrar_dispositivo(text, uuid, text) from public, anon;

-- --- PUSH --------------------------------------------------------------------

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

  -- App velho demais para o esquema atual: rejeita o lote inteiro com um codigo
  -- que o cliente entende, em vez de gravar payloads incompativeis.
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

    -- Trinco de idempotencia. Se o op_id nao pode ser reservado, ele ja foi
    -- processado antes: a gravacao aconteceu e so a resposta se perdeu.
    if not public.fn_sync_reservar_operacao(
      v_op_id, p_dispositivo_id, v_funcionario, v_tabela, v_registro_id, v_tipo, v_base_versao, v_payload
    ) then
      v_resultados := v_resultados || jsonb_build_object('op_id', v_op_id, 'status', 'duplicada');
      continue;
    end if;

    -- Aplicacao propriamente dita, isolada: o EXCEPTION aqui cria um savepoint
    -- implicito, entao um erro nesta operacao nao aborta as outras do lote.
    begin
      -- Carimbos de origem sao definidos pelo SERVIDOR, nunca aceitos do payload.
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

        -- Concorrencia: se a versao mudou desde que o celular leu, so aceitamos
        -- em silencio quando o autor e o mesmo (o operador corrigindo de outro
        -- aparelho). Autor diferente vira conflito para o escritorio decidir.
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

        -- Uma policy de RLS que recusa a linha NAO levanta excecao: o UPDATE
        -- simplesmente atinge zero linhas. Sem esta conferencia, o servidor
        -- responderia 'aplicada' para uma alteracao que foi descartada, e o
        -- operador veria "enviado" no celular para algo que nunca mudou.
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
      when unique_violation then
        v_status := 'conflito';
        v_erro_codigo := case
          when v_tabela = 'abastecimentos'  then 'NUMERO_DOCUMENTO_DUPLICADO'
          when v_tabela = 'apontamentos'    then 'APONTAMENTO_DUPLICADO'
          when v_tabela = 'caminhao_ciclos' then 'CICLO_ABERTO_DUPLICADO'
          else 'REGISTRO_DUPLICADO'
        end;
        v_erro_mensagem := sqlerrm;

      when exclusion_violation then
        v_status := 'conflito';
        v_erro_codigo := 'CICLO_SOBREPOSTO';
        v_erro_mensagem := sqlerrm;

      when check_violation or foreign_key_violation or not_null_violation then
        v_status := 'conflito';
        v_erro_codigo := 'DADOS_INVALIDOS';
        v_erro_mensagem := sqlerrm;

      when insufficient_privilege then
        v_status := 'conflito';
        v_erro_codigo := 'SEM_PERMISSAO';
        v_erro_mensagem := sqlerrm;

      when others then
        v_status := 'conflito';
        -- O motivo mais provavel de uma alteracao ser recusada em silencio e o
        -- periodo ja ter sido fechado pelo escritorio.
        v_erro_codigo := case
          when sqlerrm like '%ALTERACAO_RECUSADA%' then 'PERIODO_FECHADO'
          when sqlerrm like '%DOCUMENTO_TRAVADO%' then 'PERIODO_FECHADO'
          else coalesce(nullif(sqlerrm, ''), 'ERRO_DESCONHECIDO')
        end;
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

  -- `servidor_agora` nao e enfeite: o cliente compara com o proprio relogio para
  -- medir o desvio e avisar "a hora deste celular esta errada".
  return jsonb_build_object('servidor_agora', now(), 'resultados', v_resultados);
end;
$func$;

grant execute on function public.sync_push(jsonb, text, text) to authenticated;

-- --- PULL --------------------------------------------------------------------

create or replace function public.sync_pull(p_desde timestamptz default null)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $func$
declare
  v_desde timestamptz := coalesce(p_desde, timestamptz '-infinity');
begin
  -- O `select ... from tabela` respeita a RLS do chamador: o funcionario recebe
  -- os mestres completos e apenas os proprios lancamentos recentes.
  return jsonb_build_object(
    'servidor_agora', now(),
    'mestres', jsonb_build_object(
      'fazendas',            (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.fazendas t where t.atualizado_em > v_desde),
      'frentes',             (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.frentes t where t.atualizado_em > v_desde),
      'turnos',              (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.turnos t where t.atualizado_em > v_desde),
      'funcionarios',        (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.vw_funcionarios_publico t where t.atualizado_em > v_desde),
      'frotas',              (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.frotas t where t.atualizado_em > v_desde),
      'veiculos_transporte', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.veiculos_transporte t where t.atualizado_em > v_desde),
      'lideres',             (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.lideres t where t.atualizado_em > v_desde),
      'blocos',              (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.blocos_abastecimento t where t.atualizado_em > v_desde),
      'parametros',          (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.parametros t where t.atualizado_em > v_desde),
      -- Sem watermark: a ultima leitura de cada frota e sempre baixada inteira.
      -- E o dado que sustenta a validacao "leitura muito distante da anterior",
      -- e ele precisa estar correto no celular mesmo depois de dias offline.
      'ultimas_leituras',    (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.vw_ultima_leitura_frota t)
    ),
    'transacionais', jsonb_build_object(
      'caminhao_ciclos',    (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.caminhao_ciclos t where t.atualizado_em > v_desde),
      'apontamentos',       (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.apontamentos t where t.atualizado_em > v_desde),
      'apontamento_itens',  (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.apontamento_itens t where t.atualizado_em > v_desde),
      'abastecimentos',     (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.abastecimentos t where t.atualizado_em > v_desde)
    )
  );
end;
$func$;

grant execute on function public.sync_pull(timestamptz) to authenticated;

-- --- Proximo numero de documento --------------------------------------------
-- O celular decide o numero sozinho dentro da propria faixa (senao nao daria
-- para lancar offline). Esta funcao existe para o app se realinhar quando volta
-- a ter sinal, e para o admin ver quanto resta do bloco.

create or replace function public.fn_proximo_numero_bloco(p_bloco_id uuid)
returns integer
language sql
stable
security invoker
set search_path = public
as $$
  select greatest(
    b.numero_inicial,
    coalesce(max(a.numero_documento) + 1, b.numero_inicial)
  )
  from public.blocos_abastecimento b
  left join public.abastecimentos a
    on a.bloco_id = b.id and not a.excluido
  where b.id = p_bloco_id
  group by b.numero_inicial
$$;

grant execute on function public.fn_proximo_numero_bloco(uuid) to authenticated;

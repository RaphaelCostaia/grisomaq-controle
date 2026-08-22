-- =============================================================================
-- GRISOMAQ CONTROLE - 0600 - views de consulta e KPI
-- =============================================================================
-- Views rodam com os privilegios de quem consulta (security_invoker), entao a
-- RLS das tabelas de base continua valendo aqui. Sem isso, uma view viraria
-- porta dos fundos para o funcionario ler lancamento dos outros.
-- =============================================================================

-- --- Funcionarios sem os segredos do PIN -------------------------------------
-- O app precisa da lista inteira em cache offline (senao nenhum seletor abre),
-- mas `funcionarios` guarda pin_hash. A tabela base nao da SELECT a ninguem de
-- campo; o app le esta view.

create view public.vw_funcionarios_publico
with (security_invoker = true) as
  select id, codigo, nome, funcao, papel, frente_padrao_id, ativo, atualizado_em
  from public.funcionarios;

-- --- FICHA 1: permanencia dos caminhoes --------------------------------------
-- O numero que a planilha escondia. Ninguem subtraia 300 linhas a mao.

create view public.vw_kpi_caminhoes_dia
with (security_invoker = true) as
  select
    data,
    frente_id,
    fazenda_id,
    count(*) filter (where saida_em is not null) as ciclos_concluidos,
    count(*) filter (where saida_em is null)     as ciclos_abertos,
    round(avg(permanencia_minutos), 1)           as permanencia_media_min,
    percentile_cont(0.9) within group (order by permanencia_minutos) as permanencia_p90_min,
    min(permanencia_minutos) as permanencia_min_min,
    max(permanencia_minutos) as permanencia_max_min
  from public.caminhao_ciclos
  where not excluido
  group by data, frente_id, fazenda_id;

-- --- FICHA 3: consumo e divergencia por frota --------------------------------

create view public.vw_kpi_abastecimento_frota_dia
with (security_invoker = true) as
  select
    a.data,
    a.frota_id,
    f.numero    as frota_numero,
    f.tipo      as frota_tipo,
    count(*)                    as abastecimentos,
    sum(a.litros)               as litros,
    max(a.horimetro_motor) - min(a.horimetro_motor) as delta_horimetro,
    max(a.odometro) - min(a.odometro)               as delta_odometro,
    sum(a.divergencia_litros)   as divergencia_total,
    count(*) filter (where abs(a.divergencia_litros) > 0.5) as lancamentos_divergentes
  from public.abastecimentos a
  join public.frotas f on f.id = a.frota_id
  where not a.excluido
  group by a.data, a.frota_id, f.numero, f.tipo;

-- --- FICHA 3: rastro do registrador do comboio -------------------------------
-- A view de maior valor do sistema. O totalizador da bomba e continuo: o inicio
-- de um abastecimento tem que ser o fim do anterior. Um salto aqui e diesel que
-- saiu sem lancamento - no papel carbonado isso so aparecia no fim do mes.

create view public.vw_rastro_registrador_comboio
with (security_invoker = true) as
  select
    a.id,
    a.comboio_frota_id,
    a.numero_documento,
    a.momento,
    a.registrador_inicio,
    a.registrador_fim,
    a.litros,
    lag(a.registrador_fim) over j       as registrador_fim_anterior,
    lag(a.numero_documento) over j      as documento_anterior,
    a.registrador_inicio - lag(a.registrador_fim) over j as salto_litros
  from public.abastecimentos a
  where not a.excluido and a.comboio_frota_id is not null
  window j as (partition by a.comboio_frota_id order by a.momento, a.numero_documento);

-- --- FICHA 2: horas e quilometragem por turno --------------------------------

create view public.vw_kpi_apontamento_dia
with (security_invoker = true) as
  select
    ap.data,
    ap.frente_id,
    ap.turno_id,
    count(distinct i.funcionario_id) as funcionarios,
    count(distinct i.frota_id)       as frotas,
    sum(i.elevador_horas)            as horas_elevador,
    sum(i.odometro_percorrido)       as km_percorridos,
    count(*) filter (where i.assinatura_status = 'pendente') as assinaturas_pendentes
  from public.apontamentos ap
  join public.apontamento_itens i on i.apontamento_id = ap.id
  where not ap.excluido and not i.excluido
  group by ap.data, ap.frente_id, ap.turno_id;

-- --- Saude da operacao digital -----------------------------------------------
-- Um celular que nao sincroniza ha meio turno e um turno de lancamentos a um
-- acidente de distancia de sumir. Isso precisa estar no painel, nao num log.

create view public.vw_dispositivos_sem_sync
with (security_invoker = true) as
  select
    d.id,
    d.apelido,
    d.funcionario_id,
    f.nome as funcionario_nome,
    d.app_versao,
    d.ultimo_sync_em,
    d.desvio_relogio_ms,
    round(extract(epoch from (now() - d.ultimo_sync_em)) / 3600, 1) as horas_sem_sync
  from public.dispositivos d
  left join public.funcionarios f on f.id = d.funcionario_id
  where d.ultimo_sync_em is null or d.ultimo_sync_em < now() - interval '12 hours';

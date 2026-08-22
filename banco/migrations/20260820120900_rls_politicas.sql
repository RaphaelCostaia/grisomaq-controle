-- =============================================================================
-- GRISOMAQ CONTROLE - 0900 - Row Level Security
-- =============================================================================
-- Principio: o funcionario de campo enxerga o que ELE lancou, e so do dia
-- corrente e do anterior (ha lancamento de turno da noite que so e fechado na
-- manha seguinte). Ele nunca apaga nada - exclusao e logica e passa por UPDATE.
-- O escritorio ve tudo. O lider ve a propria frente do dia.
--
-- Toda chamada de funcao nas policies vem embrulhada em (select fn_...()) para
-- o Postgres avaliar uma vez por consulta (InitPlan), e nao uma vez por linha.
-- =============================================================================

create or replace function public.fn_frente_atual()
returns uuid
language sql
stable
as $$
  select nullif(auth.jwt() -> 'app_metadata' ->> 'frente_padrao_id', '')::uuid
$$;

-- --- Mestres: leitura para todo mundo autenticado ---------------------------
-- O celular precisa da lista inteira em cache, senao nenhum seletor abre sem
-- sinal. Escrita e exclusiva do escritorio.

do $$
declare
  v_tabela text;
begin
  foreach v_tabela in array array['fazendas', 'frentes', 'turnos', 'frotas',
                                  'veiculos_transporte', 'lideres', 'parametros',
                                  'frota_leituras'] loop
    execute format('alter table public.%I enable row level security', v_tabela);
    execute format('alter table public.%I force row level security', v_tabela);
    execute format(
      'create policy %1$s_leitura on public.%1$I for select to authenticated using (true)', v_tabela);
    execute format(
      'create policy %1$s_admin on public.%1$I for all to authenticated
         using ((select public.fn_e_admin())) with check ((select public.fn_e_admin()))', v_tabela);
  end loop;
end;
$$;

-- --- funcionarios: linha liberada, COLUNAS restritas -------------------------
-- RLS e por linha; o segredo aqui e por coluna. Entao a defesa do pin_hash e
-- privilegio de coluna, nao policy: mesmo com SELECT liberado, `authenticated`
-- simplesmente nao tem permissao de ler as colunas do PIN.

alter table public.funcionarios enable row level security;
alter table public.funcionarios force row level security;

revoke all on table public.funcionarios from anon, authenticated;
grant select (id, codigo, nome, funcao, papel, frente_padrao_id, ativo, criado_em, atualizado_em)
  on table public.funcionarios to authenticated;

create policy funcionarios_leitura on public.funcionarios
  for select to authenticated using (true);

create policy funcionarios_admin on public.funcionarios
  for all to authenticated
  using ((select public.fn_e_admin()))
  with check ((select public.fn_e_admin()));

-- Admin precisa das colunas de controle do PIN (nunca do hash em si).
grant insert, update, delete on table public.funcionarios to authenticated;

-- --- Blocos de numeracao -----------------------------------------------------
-- O celular so enxerga a faixa que foi alocada a ele. Assim, mesmo adulterado,
-- o app nao consegue emitir documento fora da propria faixa.

alter table public.blocos_abastecimento enable row level security;
alter table public.blocos_abastecimento force row level security;

create policy blocos_leitura on public.blocos_abastecimento
  for select to authenticated
  using (
    funcionario_id = (select public.fn_funcionario_atual())
    or (select public.fn_e_admin())
  );

create policy blocos_admin on public.blocos_abastecimento
  for all to authenticated
  using ((select public.fn_e_admin()))
  with check ((select public.fn_e_admin()));

-- --- Transacionais -----------------------------------------------------------

do $$
declare
  v_tabela text;
begin
  foreach v_tabela in array array['caminhao_ciclos', 'apontamentos', 'abastecimentos'] loop
    execute format('alter table public.%I enable row level security', v_tabela);
    execute format('alter table public.%I force row level security', v_tabela);

    -- Campo le o proprio lancamento recente.
    execute format($p$
      create policy %1$s_campo_leitura on public.%1$I
        for select to authenticated
        using (
          criado_por = (select public.fn_funcionario_atual())
          and data >= current_date - 1
        )$p$, v_tabela);

    -- Insercao: so em nome proprio e so em data plausivel. Impede que um
    -- aparelho com relogio adulterado lance retroativamente num mes fechado.
    execute format($p$
      create policy %1$s_campo_insercao on public.%1$I
        for insert to authenticated
        with check (
          criado_por = (select public.fn_funcionario_atual())
          and data between current_date - 1 and current_date
        )$p$, v_tabela);

    -- Correcao: so do proprio, so recente, so se o periodo nao foi fechado.
    execute format($p$
      create policy %1$s_campo_correcao on public.%1$I
        for update to authenticated
        using (
          criado_por = (select public.fn_funcionario_atual())
          and data >= current_date - 1
          and status <> 'travado'
        )
        with check (criado_por = (select public.fn_funcionario_atual()))$p$, v_tabela);

    execute format($p$
      create policy %1$s_admin on public.%1$I
        for all to authenticated
        using ((select public.fn_e_admin()))
        with check ((select public.fn_e_admin()))$p$, v_tabela);

    -- DELETE nao tem policy nenhuma: ninguem apaga, nem admin. Exclusao e
    -- logica, via UPDATE excluido = true, e fica na auditoria.
    execute format('revoke delete on table public.%I from authenticated', v_tabela);
  end loop;
end;
$$;

-- --- Leitura do lider --------------------------------------------------------
-- Escrita tabela a tabela, e nao no laco acima, porque a frente e alcancada de
-- um jeito diferente em cada ficha: caminhoes e apontamento tem frente_id
-- proprio; abastecimento so sabe a frota, e a frente vem dela.

create policy caminhao_ciclos_lider_leitura on public.caminhao_ciclos
  for select to authenticated
  using (
    (select public.fn_papel_atual()) = 'lider'
    and frente_id = (select public.fn_frente_atual())
    and data >= current_date - 1
  );

create policy apontamentos_lider_leitura on public.apontamentos
  for select to authenticated
  using (
    (select public.fn_papel_atual()) = 'lider'
    and frente_id = (select public.fn_frente_atual())
    and data >= current_date - 1
  );

create policy abastecimentos_lider_leitura on public.abastecimentos
  for select to authenticated
  using (
    (select public.fn_papel_atual()) = 'lider'
    and data >= current_date - 1
    and exists (
      select 1 from public.frotas f
       where f.id = frota_id and f.frente_id = (select public.fn_frente_atual())
    )
  );

-- apontamento_itens herda o acesso do cabecalho: quem pode ver a ficha, ve as
-- linhas dela. Sem isso, cada item precisaria repetir a regra de data e autor.
alter table public.apontamento_itens enable row level security;
alter table public.apontamento_itens force row level security;

create policy apontamento_itens_leitura on public.apontamento_itens
  for select to authenticated
  using (exists (select 1 from public.apontamentos ap where ap.id = apontamento_id));

create policy apontamento_itens_insercao on public.apontamento_itens
  for insert to authenticated
  with check (
    criado_por = (select public.fn_funcionario_atual())
    and exists (select 1 from public.apontamentos ap where ap.id = apontamento_id)
  );

create policy apontamento_itens_correcao on public.apontamento_itens
  for update to authenticated
  using (
    exists (
      select 1 from public.apontamentos ap
       where ap.id = apontamento_id and ap.status <> 'travado'
    )
    and (criado_por = (select public.fn_funcionario_atual()) or (select public.fn_e_admin()))
  )
  with check (true);

create policy apontamento_itens_admin on public.apontamento_itens
  for all to authenticated
  using ((select public.fn_e_admin()))
  with check ((select public.fn_e_admin()));

revoke delete on table public.apontamento_itens from authenticated;

-- --- Assinaturas: append-only ------------------------------------------------
-- Nenhuma policy de UPDATE ou DELETE, para papel nenhum. Uma trilha de aceite
-- que pode ser editada nao prova coisa alguma. A revalidacao server-side altera
-- validacao_pin usando service role, que passa por fora da RLS.

alter table public.assinaturas_aceite enable row level security;
alter table public.assinaturas_aceite force row level security;

create policy assinaturas_insercao on public.assinaturas_aceite
  for insert to authenticated
  with check (funcionario_id = (select public.fn_funcionario_atual()));

create policy assinaturas_leitura on public.assinaturas_aceite
  for select to authenticated
  using (
    funcionario_id = (select public.fn_funcionario_atual())
    or (select public.fn_e_admin())
  );

revoke update, delete on table public.assinaturas_aceite from authenticated;

-- --- Ledger de sync ----------------------------------------------------------

alter table public.sync_operacoes enable row level security;
alter table public.sync_operacoes force row level security;

create policy sync_operacoes_proprias on public.sync_operacoes
  for select to authenticated
  using (
    funcionario_id = (select public.fn_funcionario_atual())
    or (select public.fn_e_admin())
  );

-- O escritorio marca conflito como resolvido; ninguem mais escreve aqui.
create policy sync_operacoes_admin on public.sync_operacoes
  for update to authenticated
  using ((select public.fn_e_admin()))
  with check ((select public.fn_e_admin()));

-- O celular NAO escreve no ledger diretamente. Quem grava e o sync_push, por
-- funcoes SECURITY DEFINER (ver 1000). Se o cliente pudesse escrever aqui, ele
-- poderia carimbar uma operacao em conflito como 'aplicada' e o lancamento
-- sumiria da fila de pendencias sem nunca ter entrado no banco.
revoke insert, update, delete on table public.sync_operacoes from authenticated;

-- --- Dispositivos ------------------------------------------------------------

alter table public.dispositivos enable row level security;
alter table public.dispositivos force row level security;

create policy dispositivos_proprios on public.dispositivos
  for select to authenticated
  using (
    funcionario_id = (select public.fn_funcionario_atual())
    or (select public.fn_e_admin())
  );

create policy dispositivos_registro on public.dispositivos
  for insert to authenticated
  with check (funcionario_id = (select public.fn_funcionario_atual()));

create policy dispositivos_atualizacao on public.dispositivos
  for update to authenticated
  using (
    funcionario_id = (select public.fn_funcionario_atual())
    or (select public.fn_e_admin())
  )
  with check (true);

-- --- Auditoria e anexos ------------------------------------------------------

alter table public.auditoria enable row level security;
alter table public.auditoria force row level security;

-- Somente o escritorio le a auditoria, e ninguem escreve por fora do trigger.
create policy auditoria_admin on public.auditoria
  for select to authenticated
  using ((select public.fn_e_admin()));

revoke insert, update, delete on table public.auditoria from authenticated;

alter table public.anexos enable row level security;
alter table public.anexos force row level security;

create policy anexos_leitura on public.anexos
  for select to authenticated
  using (
    criado_por = (select public.fn_funcionario_atual())
    or (select public.fn_e_admin())
  );

create policy anexos_insercao on public.anexos
  for insert to authenticated
  with check (criado_por = (select public.fn_funcionario_atual()));

create policy anexos_admin on public.anexos
  for all to authenticated
  using ((select public.fn_e_admin()))
  with check ((select public.fn_e_admin()));

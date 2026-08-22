-- =============================================================================
-- GRISOMAQ CONTROLE - 0300 - as tres fichas
-- =============================================================================
-- Toda tabela aqui repete o mesmo rodape de auditoria/sync. Ele e escrito por
-- extenso em cada tabela (em vez de heranca) porque cada coluna precisa entrar
-- em indice e em policy de RLS, e heranca em Postgres complica os dois.
--
--   criado_em             -> relogio do SERVIDOR
--   criado_em_dispositivo -> relogio do CELULAR
-- Os dois sao guardados sempre. Quando divergem, o admin ve os dois e sabe que
-- aquele aparelho estava com a hora errada - o dado nao vira lixo silencioso.
-- =============================================================================

-- --- FICHA 1: CONTROLE DE CAMINHOES -----------------------------------------
-- Cada linha e um ciclo de rodotrem no campo. Nao e um registro imutavel: e uma
-- maquina de estado (chegou -> saiu). O KPI que a ficha de papel escondia e a
-- permanencia, calculada aqui como coluna gerada.

create table public.caminhao_ciclos (
  id            uuid primary key,
  data          date not null,
  fazenda_id    uuid references public.fazendas(id),
  caminhao_id   uuid not null references public.veiculos_transporte(id),
  carreta1_id   uuid references public.veiculos_transporte(id),
  carreta2_id   uuid references public.veiculos_transporte(id),
  chegada_em    timestamptz not null,
  saida_em      timestamptz,
  lider_id      uuid references public.lideres(id),
  lider_nome_livre text,
  frente_id     uuid references public.frentes(id),
  turno_id      uuid references public.turnos(id),
  observacao    text,
  status        public.status_documento not null default 'finalizado',
  avisos_confirmados text[],

  permanencia_minutos integer generated always as (
    case when saida_em is not null
      then (extract(epoch from (saida_em - chegada_em)) / 60)::integer
    end
  ) stored,

  criado_por            uuid not null references public.funcionarios(id),
  criado_em             timestamptz not null default now(),
  criado_em_dispositivo timestamptz not null,
  atualizado_por        uuid references public.funcionarios(id),
  atualizado_em         timestamptz not null default now(),
  versao                integer not null default 1,
  dispositivo_id        text not null,
  app_versao            text not null,
  excluido              boolean not null default false,
  excluido_em           timestamptz,
  excluido_por          uuid references public.funcionarios(id),

  constraint ciclo_saida_apos_chegada check (saida_em is null or saida_em > chegada_em),
  constraint ciclo_carretas_distintas check (carreta1_id is null or carreta1_id is distinct from carreta2_id),
  constraint ciclo_carreta2_exige_carreta1 check (carreta2_id is null or carreta1_id is not null)
);

create index caminhao_ciclos_data_ix        on public.caminhao_ciclos (data desc) where not excluido;
create index caminhao_ciclos_caminhao_ix    on public.caminhao_ciclos (caminhao_id, chegada_em desc);
create index caminhao_ciclos_criador_ix     on public.caminhao_ciclos (criado_por, data desc);
create index caminhao_ciclos_atualizacao_ix on public.caminhao_ciclos (atualizado_em);

-- Um caminhao so pode estar dentro do campo uma vez.
create unique index caminhao_ciclo_aberto_uk
  on public.caminhao_ciclos (caminhao_id)
  where (saida_em is null and not excluido);

-- E dois ciclos fechados do mesmo caminhao nao podem ocupar o mesmo intervalo.
alter table public.caminhao_ciclos add constraint caminhao_ciclos_sem_sobreposicao
  exclude using gist (
    caminhao_id with =,
    tstzrange(chegada_em, saida_em, '[)') with &&
  ) where (saida_em is not null and not excluido);

comment on constraint caminhao_ciclos_sem_sobreposicao on public.caminhao_ciclos is
  'Vai disparar em cenario offline legitimo (dois celulares registrando o mesmo '
  'caminhao). sync_push captura a excecao, marca a operacao como conflito e '
  'PRESERVA o payload - nenhum lancamento de campo e descartado.';

-- --- FICHA 2: APONTAMENTO E ASSINATURA --------------------------------------
-- Unica ficha mestre-detalhe, e unica com assinatura por linha.

create table public.apontamentos (
  id            uuid primary key,
  data          date not null,
  frente_id     uuid not null references public.frentes(id),
  turno_id      uuid not null references public.turnos(id),
  responsavel_funcionario_id uuid not null references public.funcionarios(id),
  observacao    text,
  status        public.status_documento not null default 'rascunho',
  finalizado_em timestamptz,

  criado_por            uuid not null references public.funcionarios(id),
  criado_em             timestamptz not null default now(),
  criado_em_dispositivo timestamptz not null,
  atualizado_por        uuid references public.funcionarios(id),
  atualizado_em         timestamptz not null default now(),
  versao                integer not null default 1,
  dispositivo_id        text not null,
  app_versao            text not null,
  excluido              boolean not null default false,
  excluido_em           timestamptz,
  excluido_por          uuid references public.funcionarios(id)
);

-- Uma ficha por frente por turno por dia. Se dois responsaveis abrirem a mesma,
-- o segundo recebe conflito e o app abre a que ja existe em vez de duplicar.
create unique index apontamentos_uk on public.apontamentos (data, frente_id, turno_id) where not excluido;
create index apontamentos_data_ix        on public.apontamentos (data desc) where not excluido;
create index apontamentos_criador_ix     on public.apontamentos (criado_por, data desc);
create index apontamentos_atualizacao_ix on public.apontamentos (atualizado_em);

create table public.apontamento_itens (
  id             uuid primary key,
  apontamento_id uuid not null references public.apontamentos(id) on delete cascade,
  seq            smallint not null,          -- 1..25 no papel; ate 99 aqui
  funcionario_id uuid not null references public.funcionarios(id),
  frota_id       uuid not null references public.frotas(id),

  odometro_inicial numeric(12,1),
  odometro_final   numeric(12,1),
  elevador_inicial numeric(12,1),
  elevador_final   numeric(12,1),

  -- Leitura que regride e rara mas REAL: painel trocado, horimetro zerado.
  -- Em vez de bloquear (o que faria o operador inventar um numero plausivel),
  -- exigimos que ele escreva o motivo.
  justificativa_leitura text,
  observacao     text,

  odometro_percorrido numeric(12,1) generated always as (odometro_final - odometro_inicial) stored,
  elevador_horas      numeric(12,1) generated always as (elevador_final - elevador_inicial) stored,

  assinatura_status public.status_assinatura not null default 'pendente',
  assinado_em       timestamptz,
  avisos_confirmados text[],

  criado_por            uuid not null references public.funcionarios(id),
  criado_em             timestamptz not null default now(),
  criado_em_dispositivo timestamptz not null,
  atualizado_por        uuid references public.funcionarios(id),
  atualizado_em         timestamptz not null default now(),
  versao                integer not null default 1,
  dispositivo_id        text not null,
  app_versao            text not null,
  excluido              boolean not null default false,
  excluido_em           timestamptz,
  excluido_por          uuid references public.funcionarios(id),

  constraint item_seq_valida check (seq between 1 and 99),
  constraint item_odometro_coerente check (
    odometro_final is null or odometro_inicial is null
    or odometro_final >= odometro_inicial or justificativa_leitura is not null
  ),
  constraint item_elevador_coerente check (
    elevador_final is null or elevador_inicial is null
    or elevador_final >= elevador_inicial or justificativa_leitura is not null
  ),
  constraint item_valores_nao_negativos check (
    coalesce(odometro_inicial, 0) >= 0 and coalesce(elevador_inicial, 0) >= 0
    and coalesce(odometro_final, 0) >= 0 and coalesce(elevador_final, 0) >= 0
  )
);

create unique index apontamento_itens_seq_uk on public.apontamento_itens (apontamento_id, seq) where not excluido;
-- O mesmo funcionario nao aparece duas vezes na mesma ficha.
create unique index apontamento_itens_funcionario_uk on public.apontamento_itens (apontamento_id, funcionario_id) where not excluido;
create index apontamento_itens_frota_ix       on public.apontamento_itens (frota_id);
create index apontamento_itens_criador_ix     on public.apontamento_itens (criado_por);
create index apontamento_itens_atualizacao_ix on public.apontamento_itens (atualizado_em);

-- --- FICHA 3: CONTROLE DIARIO DE ABASTECIMENTO ------------------------------
-- A unica que ainda era papel carbonado. Tem duas identidades que o papel
-- nunca conferia: litros = fim - inicio do registrador da bomba, e o inicio de
-- um abastecimento deve continuar o fim do anterior DO MESMO COMBOIO.

create table public.abastecimentos (
  id               uuid primary key,
  numero_documento integer not null,      -- a numeracao impressa no bloco (ex.: 6901)
  bloco_id         uuid references public.blocos_abastecimento(id),
  data             date not null,
  hora             time not null,
  momento          timestamptz not null,  -- data+hora resolvidos no fuso da operacao
  frota_id         uuid not null references public.frotas(id),
  comboio_frota_id uuid references public.frotas(id),

  horimetro_motor    numeric(12,1),
  horimetro_elevador numeric(12,1),
  odometro           numeric(12,1),

  registrador_inicio numeric(12,2) not null,
  registrador_fim    numeric(12,2) not null,
  litros             numeric(10,2) not null,

  operador_funcionario_id    uuid not null references public.funcionarios(id), -- quem recebeu e assina
  abastecedor_funcionario_id uuid references public.funcionarios(id),          -- quem operou a bomba

  justificativa_leitura     text,
  justificativa_divergencia text,
  observacao       text,
  status           public.status_documento not null default 'finalizado',
  avisos_confirmados text[],

  litros_registrador numeric(10,2) generated always as (registrador_fim - registrador_inicio) stored,
  divergencia_litros numeric(10,2) generated always as (litros - (registrador_fim - registrador_inicio)) stored,

  criado_por            uuid not null references public.funcionarios(id),
  criado_em             timestamptz not null default now(),
  criado_em_dispositivo timestamptz not null,
  atualizado_por        uuid references public.funcionarios(id),
  atualizado_em         timestamptz not null default now(),
  versao                integer not null default 1,
  dispositivo_id        text not null,
  app_versao            text not null,
  excluido              boolean not null default false,
  excluido_em           timestamptz,
  excluido_por          uuid references public.funcionarios(id),

  constraint abast_registrador_crescente check (registrador_fim > registrador_inicio),
  constraint abast_litros_positivo check (litros > 0),
  constraint abast_divergencia_justificada check (
    abs(litros - (registrador_fim - registrador_inicio)) <= 0.5
    or justificativa_divergencia is not null
  )
);

create unique index abastecimentos_numero_uk on public.abastecimentos (numero_documento) where not excluido;
create index abastecimentos_data_ix         on public.abastecimentos (data desc) where not excluido;
create index abastecimentos_frota_ix        on public.abastecimentos (frota_id, momento desc);
-- Indice do rastro do registrador: e por aqui que o painel detecta o salto que
-- denuncia um abastecimento nao lancado.
create index abastecimentos_comboio_ix      on public.abastecimentos (comboio_frota_id, momento desc);
create index abastecimentos_criador_ix      on public.abastecimentos (criado_por, data desc);
create index abastecimentos_atualizacao_ix  on public.abastecimentos (atualizado_em);

-- =============================================================================
-- GRISOMAQ CONTROLE - 0200 - tabelas mestres
-- =============================================================================
-- Os mestres sao pequenos (dezenas a centenas de linhas) e vao inteiros para o
-- IndexedDB de cada celular: sem eles em cache, nenhum seletor abre offline.
-- =============================================================================

-- A coluna "CODIGO" da ficha de caminhoes e o codigo da fazenda.
create table public.fazendas (
  id            uuid primary key,
  codigo        text not null,
  nome          text not null,
  municipio     text,
  ativo         boolean not null default true,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create unique index fazendas_codigo_uk on public.fazendas (upper(codigo));
create index fazendas_atualizacao_ix on public.fazendas (atualizado_em);

create table public.frentes (
  id            uuid primary key,
  codigo        text not null,
  nome          text not null,
  fazenda_id    uuid references public.fazendas(id),
  -- Nem toda frente roda a mesma escala: algumas operam em 2 turnos, outras em 3.
  -- O seletor de turno do app filtra por esta coluna.
  escala        public.escala_turno not null default '3_turnos',
  ativo         boolean not null default true,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create unique index frentes_codigo_uk on public.frentes (upper(codigo));
create index frentes_atualizacao_ix on public.frentes (atualizado_em);

create table public.turnos (
  id            uuid primary key,
  codigo        text not null,
  nome          text not null,
  escala        public.escala_turno not null,
  hora_inicio   time not null,
  hora_fim      time not null,
  duracao_horas numeric(4,2) not null,
  -- Turno que atravessa a meia-noite. A ficha continua sendo a do dia em que
  -- o turno COMECOU, senao o apontamento da madrugada cairia no dia seguinte.
  vira_dia      boolean not null default false,
  ativo         boolean not null default true,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint turnos_duracao_valida check (duracao_horas > 0 and duracao_horas <= 24)
);
create unique index turnos_codigo_uk on public.turnos (escala, upper(codigo));
create index turnos_atualizacao_ix on public.turnos (atualizado_em);

create table public.funcionarios (
  id            uuid primary key,
  codigo        text not null,          -- o "Cod. Func." que ja existe nas fichas
  nome          text not null,
  cpf           char(11),
  funcao        text,
  papel         public.papel_usuario not null default 'campo',
  frente_padrao_id uuid references public.frentes(id),

  -- Hash autoritativo do PIN (bcrypt cost 12). Nunca sai do Postgres: a
  -- conferencia acontece em fn_verificar_pin, que recebe o PIN e devolve bool.
  pin_hash      text,
  -- Verificador Argon2id espelhado no celular para conferir o PIN sem rede.
  -- E um artefato SEPARADO do hash acima, de proposito: comprometer o celular
  -- nao entrega o hash que o servidor usa.
  pin_verificador_offline jsonb,
  pin_definido_em         timestamptz,
  pin_trocar_no_proximo_acesso boolean not null default true,
  pin_tentativas_falhas   smallint not null default 0,
  pin_bloqueado_ate       timestamptz,

  ativo         boolean not null default true,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint funcionarios_codigo_formato check (codigo ~ '^[0-9]{1,8}$'),
  constraint funcionarios_cpf_formato check (cpf is null or cpf ~ '^[0-9]{11}$')
);
create unique index funcionarios_codigo_uk on public.funcionarios (codigo);
create index funcionarios_ativos_ix on public.funcionarios (ativo) where ativo;
create index funcionarios_atualizacao_ix on public.funcionarios (atualizado_em);

-- Parque de maquinas da GrisoMaq. Separado de veiculos_transporte porque
-- caminhao canavieiro costuma ser terceirizado e nao tem horimetro proprio aqui.
create table public.frotas (
  id            uuid primary key,
  numero        text not null,          -- a coluna "Frota" das fichas 2 e 3
  descricao     text not null,
  tipo          public.tipo_frota not null,

  -- Estes tres flags governam quais campos o formulario mostra e quais ele
  -- DESABILITA. Sem eles, o operador digita horimetro de elevador num trator.
  tem_odometro           boolean not null default false,
  tem_horimetro_motor    boolean not null default true,
  tem_horimetro_elevador boolean not null default false,

  capacidade_tanque_litros     numeric(8,1),
  consumo_esperado_litros_hora numeric(6,2),
  consumo_esperado_km_litro    numeric(6,2),
  frente_id     uuid references public.frentes(id),
  ativo         boolean not null default true,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint frotas_capacidade_positiva check (capacidade_tanque_litros is null or capacidade_tanque_litros > 0)
);
create unique index frotas_numero_uk on public.frotas (upper(numero));
create index frotas_tipo_ix on public.frotas (tipo) where ativo;
create index frotas_atualizacao_ix on public.frotas (atualizado_em);

create table public.veiculos_transporte (
  id            uuid primary key,
  numero        text not null,
  tipo          public.tipo_veiculo_transporte not null,
  placa         char(7),
  transportadora text,
  ativo         boolean not null default true,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
-- Cavalo 12 e carreta 12 sao veiculos diferentes: o numero so e unico por tipo.
create unique index veiculos_transporte_uk on public.veiculos_transporte (tipo, upper(numero));
create index veiculos_transporte_atualizacao_ix on public.veiculos_transporte (atualizado_em);

-- "LIDER DO MALHADOR" da ficha 1. FK opcional para funcionarios porque o lider
-- as vezes e da transportadora, e nao do quadro da GrisoMaq.
create table public.lideres (
  id            uuid primary key,
  codigo        text,
  nome          text not null,
  funcionario_id uuid references public.funcionarios(id),
  ativo         boolean not null default true,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index lideres_atualizacao_ix on public.lideres (atualizado_em);

-- Faixas de numeracao do bloco de papel, pre-alocadas por dispositivo.
-- E o mecanismo que faz dois celulares offline nunca gerarem o mesmo numero
-- de documento: cada um so pode emitir dentro da propria faixa.
create table public.blocos_abastecimento (
  id             uuid primary key,
  numero_inicial integer not null,
  numero_final   integer not null,
  funcionario_id uuid references public.funcionarios(id),
  dispositivo_id text,
  comboio_frota_id uuid references public.frotas(id),
  ativo          boolean not null default true,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),
  constraint blocos_faixa_valida check (numero_final >= numero_inicial and numero_inicial > 0),
  constraint blocos_sem_sobreposicao
    exclude using gist (int4range(numero_inicial, numero_final, '[]') with &&)
);
create index blocos_dispositivo_ix on public.blocos_abastecimento (dispositivo_id) where ativo;
create index blocos_atualizacao_ix on public.blocos_abastecimento (atualizado_em);

-- Limiares das validacoes, editaveis pelo escritorio sem deploy.
create table public.parametros (
  chave         text primary key,
  valor         jsonb not null,
  descricao     text,
  atualizado_em timestamptz not null default now()
);

create table public.dispositivos (
  id                text primary key,   -- UUID gerado na 1a abertura, em localStorage
  funcionario_id    uuid references public.funcionarios(id),
  apelido           text,
  user_agent        text,
  app_versao        text,
  ultimo_sync_em    timestamptz,
  -- Diferenca entre o relogio do celular e o do servidor. Se passar do limite,
  -- o app avisa: horario errado corrompe permanencia de caminhao em silencio.
  desvio_relogio_ms bigint,
  criado_em         timestamptz not null default now()
);
create index dispositivos_sem_sync_ix on public.dispositivos (ultimo_sync_em);

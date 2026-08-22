-- =============================================================================
-- GRISOMAQ CONTROLE - 0400 - assinaturas, leituras, sync e auditoria
-- =============================================================================

-- --- Trilha de aceite por PIN ------------------------------------------------
-- Substitui a rubrica a caneta do bloco carbonado. E IMUTAVEL: nao existe
-- policy de UPDATE ou DELETE para ninguem, nem para admin. A unica coluna que
-- muda e validacao_pin, e so pela Edge Function com service role.

create table public.assinaturas_aceite (
  id             uuid primary key,
  tipo_documento text not null check (
    tipo_documento in ('apontamento', 'apontamento_item', 'abastecimento', 'caminhao_ciclo')
  ),
  documento_id   uuid not null,
  funcionario_id uuid not null references public.funcionarios(id),
  metodo         text not null default 'PIN',

  -- O texto exato que estava na tela no momento do aceite. Sem ele, a
  -- assinatura prova apenas que alguem digitou 4 numeros - nao o que aceitou.
  texto_aceite   text not null,
  -- SHA-256 do JSON canonico do documento. Prova que o que foi assinado e
  -- exatamente o que esta gravado, e nao uma versao editada depois.
  hash_documento char(64) not null,

  momento_dispositivo timestamptz not null,
  momento_servidor    timestamptz not null default now(),
  dispositivo_id text not null,
  user_agent     text,
  app_versao     text not null,
  ip             inet,
  latitude       numeric(9,6),
  longitude      numeric(9,6),
  precisao_metros numeric(8,1),

  validacao_pin  public.status_assinatura not null default 'pendente',
  validado_em    timestamptz,
  criado_em      timestamptz not null default now()
);

create index assinaturas_documento_ix   on public.assinaturas_aceite (tipo_documento, documento_id);
create index assinaturas_funcionario_ix on public.assinaturas_aceite (funcionario_id, momento_servidor desc);
create index assinaturas_invalidas_ix   on public.assinaturas_aceite (validacao_pin)
  where validacao_pin <> 'validado_servidor';

-- --- Historico de leituras ---------------------------------------------------
-- Consolida toda leitura de horimetro/odometro vinda das fichas 2 e 3, para o
-- app poder dizer "a ultima leitura desta frota foi 12.345,0 em 19/08 as 17:40".
-- E o que transforma um campo em branco numa conferencia.

create table public.frota_leituras (
  id            uuid primary key,
  frota_id      uuid not null references public.frotas(id),
  tipo          public.tipo_leitura not null,
  valor         numeric(12,1) not null,
  momento       timestamptz not null,
  origem_tabela text not null,
  origem_id     uuid not null,
  criado_em     timestamptz not null default now()
);

create index frota_leituras_ix on public.frota_leituras (frota_id, tipo, momento desc);
-- Uma leitura por origem: reprocessar o mesmo abastecimento nao duplica historico.
create unique index frota_leituras_origem_uk on public.frota_leituras (origem_tabela, origem_id, tipo);

create view public.vw_ultima_leitura_frota as
  select distinct on (frota_id, tipo)
    frota_id, tipo, valor, momento, origem_tabela, origem_id
  from public.frota_leituras
  order by frota_id, tipo, momento desc, criado_em desc;

-- --- Ledger de sincronizacao -------------------------------------------------
-- A chave primaria e o op_id gerado NO CELULAR. E isso, e so isso, que torna o
-- push idempotente: se o servidor gravou mas a resposta se perdeu no sinal
-- ruim, o reenvio bate no conflito de PK e devolve 'duplicada' em vez de
-- lancar o abastecimento duas vezes.

create table public.sync_operacoes (
  id             uuid primary key,
  dispositivo_id text not null,
  funcionario_id uuid not null references public.funcionarios(id),
  tabela         text not null,
  registro_id    uuid not null,
  tipo           public.tipo_operacao_sync not null,
  base_versao    integer,
  -- O payload fica guardado mesmo em conflito. E o cofre que garante que
  -- nenhum lancamento feito em campo se perca por causa de uma constraint.
  payload        jsonb not null,
  status         public.status_operacao_sync not null,
  erro_codigo    text,
  erro_mensagem  text,
  recebido_em    timestamptz not null default now(),
  resolvido_em   timestamptz,
  resolvido_por  uuid references public.funcionarios(id)
);

create index sync_operacoes_conflito_ix    on public.sync_operacoes (status, recebido_em desc)
  where status in ('conflito', 'rejeitada');
create index sync_operacoes_dispositivo_ix on public.sync_operacoes (dispositivo_id, recebido_em desc);
create index sync_operacoes_registro_ix    on public.sync_operacoes (tabela, registro_id);

-- --- Auditoria ---------------------------------------------------------------

create table public.auditoria (
  id               bigserial primary key,
  tabela           text not null,
  registro_id      uuid not null,
  operacao         text not null,
  dados_antes      jsonb,
  dados_depois     jsonb,
  campos_alterados text[],
  feito_por        uuid,
  feito_em         timestamptz not null default now()
);

create index auditoria_registro_ix on public.auditoria (tabela, registro_id, feito_em desc);
create index auditoria_data_ix     on public.auditoria (feito_em desc);

-- --- Anexos ------------------------------------------------------------------
-- Foto opcional do painel/horimetro. Nao e obrigatoria em lugar nenhum: exigir
-- foto em campo sem sinal significa fila travada por megabytes de imagem.

create table public.anexos (
  id              uuid primary key,
  tabela          text not null,
  registro_id     uuid not null,
  caminho_storage text not null,
  tipo_mime       text,
  tamanho_bytes   integer,
  hash_sha256     char(64),
  criado_por      uuid not null references public.funcionarios(id),
  criado_em       timestamptz not null default now()
);

create index anexos_registro_ix on public.anexos (tabela, registro_id);

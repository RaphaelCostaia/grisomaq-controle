-- =============================================================================
-- GRISOMAQ CONTROLE - 0100 - extensoes, tipos e convencoes
-- =============================================================================
-- Convencoes de todo o esquema:
--   * Chaves primarias sao UUID gerados NO CLIENTE (UUIDv7). Sem isso nada
--     poderia ser criado offline. O banco nunca gera id de registro de campo.
--   * Datas de negocio ("a data da ficha") sao `date` resolvidas em
--     America/Sao_Paulo. Instantes sao `timestamptz`.
--   * Exclusao e sempre logica (`excluido`), nunca DELETE: o papel que este
--     sistema substitui e um bloco carbonado, e via de carbono nao se rasga.
-- =============================================================================

create extension if not exists pgcrypto;    -- crypt/gen_salt para o PIN, digest para hashes
create extension if not exists btree_gist;  -- EXCLUDE de sobreposicao de ciclos de caminhao
create extension if not exists unaccent;    -- busca por nome no painel admin

-- --- Tipos -------------------------------------------------------------------

create type public.papel_usuario as enum ('campo', 'lider', 'admin');

create type public.tipo_frota as enum (
  'colhedora', 'trator', 'caminhao', 'comboio', 'transbordo', 'outro'
);

create type public.tipo_veiculo_transporte as enum ('cavalo', 'carreta');

create type public.escala_turno as enum ('2_turnos', '3_turnos');

create type public.status_documento as enum (
  'rascunho',    -- em preenchimento no celular
  'finalizado',  -- fechado pelo funcionario, ainda editavel no mesmo dia
  'travado',     -- periodo fechado pelo escritorio; so admin altera
  'cancelado'
);

create type public.status_assinatura as enum (
  'pendente',
  'validado_local',      -- PIN conferido no celular (Argon2id), ainda sem rede
  'validado_servidor',   -- revalidado contra o hash autoritativo
  'invalida'             -- revalidacao falhou: assinatura contestada
);

create type public.tipo_leitura as enum ('odometro', 'horimetro_motor', 'horimetro_elevador');

create type public.tipo_operacao_sync as enum ('inserir', 'atualizar', 'excluir');

create type public.status_operacao_sync as enum (
  'aplicada',
  'duplicada',   -- op_id ja processado: a resposta anterior se perdeu no sinal
  'conflito',    -- constraint ou versao divergente; payload preservado
  'rejeitada'    -- payload invalido ou app obsoleto; o cliente tenta de novo
);

-- --- Fuso da operacao --------------------------------------------------------

-- Usada em toda conversao instante -> data de negocio. Existe como funcao para
-- o fuso ficar num lugar so, e nao espalhado em dezenas de `at time zone`.
create or replace function public.fn_data_operacional(p_momento timestamptz default now())
returns date
language sql
immutable
as $$
  select (p_momento at time zone 'America/Sao_Paulo')::date
$$;

comment on function public.fn_data_operacional is
  'Data de negocio de um instante, no fuso da operacao. Evita a virada de dia '
  'errada no turno da noite.';

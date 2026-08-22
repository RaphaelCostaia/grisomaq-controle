-- =============================================================================
-- GRISOMAQ CONTROLE - 1200 - sessões
-- =============================================================================
-- Sessão longa do celular, com revogação.
--
-- Sem esta tabela a alternativa seria um token de longa duração que não pode
-- ser cancelado — e celular de campo se perde, cai do trator e é trocado de
-- funcionário. Poder revogar é requisito, não refinamento.
--
-- O refresh token nunca é gravado em claro: a tabela guarda só o SHA-256 dele.
-- O backup do banco sai da máquina, e um refresh em claro num dump daria a
-- quem o lesse o poder de emitir sessão em nome de qualquer funcionário.
-- =============================================================================

create table public.sessoes (
  id             uuid primary key default gen_random_uuid(),
  funcionario_id uuid not null references public.funcionarios(id) on delete cascade,

  refresh_hash   char(64) not null,
  -- Guardado por uma janela curta para tolerar a rotação concorrente: em rede
  -- instável, duas requisições sobem juntas e a segunda chega com o token já
  -- trocado. Derrubar a sessão nesse caso puniria o operador por um problema
  -- que é do sinal.
  refresh_anterior_hash char(64),
  rotacionada_em timestamptz,

  dispositivo_id text,
  criada_em      timestamptz not null default now(),
  ultimo_uso_em  timestamptz,
  expira_em      timestamptz not null,
  revogada_em    timestamptz
);

create unique index sessoes_refresh_uk on public.sessoes (refresh_hash);
create index sessoes_anterior_ix on public.sessoes (refresh_anterior_hash)
  where refresh_anterior_hash is not null;
create index sessoes_funcionario_ix on public.sessoes (funcionario_id) where revogada_em is null;
create index sessoes_expiracao_ix on public.sessoes (expira_em) where revogada_em is null;

-- Só a API, com o papel de serviço, escreve aqui. O funcionário enxerga as
-- próprias sessões (para o escritório poder mostrar "aparelhos conectados"),
-- mas não pode criar, alterar nem revogar — senão poderia prolongar o próprio
-- acesso ou apagar o rastro de um aparelho perdido.
alter table public.sessoes enable row level security;
alter table public.sessoes force row level security;

create policy sessoes_proprias on public.sessoes
  for select to authenticated
  using (
    funcionario_id = (select public.fn_funcionario_atual())
    or (select public.fn_e_admin())
  );

revoke insert, update, delete on table public.sessoes from authenticated;

/**
 * Limpeza das sessões vencidas. Chamada pela API na subida; não há agendador
 * na KVM 1 e não vale subir um só para isto.
 */
create or replace function public.fn_limpar_sessoes_vencidas()
returns integer
language sql
security definer
set search_path = public
as $$
  with removidas as (
    delete from public.sessoes
     where expira_em < now() - interval '30 days'
        or (revogada_em is not null and revogada_em < now() - interval '30 days')
    returning 1
  )
  select count(*)::integer from removidas
$$;

revoke all on function public.fn_limpar_sessoes_vencidas() from public, anon, authenticated;

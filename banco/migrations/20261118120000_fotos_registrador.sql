-- =============================================================================
-- GRISOMAQ CONTROLE - 1118120000 - fotos da registradora da bomba
-- =============================================================================
-- O comboista passa a fotografar o totalizador da bomba no inicio e no fim do
-- abastecimento. Com sinal, a IA le a foto e preenche o numero na hora; sem
-- sinal, ele digita. Quando a foto chega ao servidor, ela e lida de novo e o
-- valor lido fica gravado no anexo - e o que permite ao escritorio ver quando o
-- numero digitado nao bate com o que a foto mostra.
-- =============================================================================

alter table public.anexos
  add column papel text not null default 'horimetro'
    constraint anexos_papel_valido
    check (papel in ('horimetro', 'registrador_inicio', 'registrador_fim')),
  add column leitura_ia numeric(12,1),
  add column leitura_ia_confianca text,
  add column leitura_ia_em timestamptz;

create index anexos_registro_papel_ix on public.anexos (tabela, registro_id, papel);

-- Quando falta uma das fotos, o comboista explica o motivo (camera quebrada,
-- sem luz). Sem a explicacao a ficha nao salva.
alter table public.abastecimentos
  add column justificativa_sem_foto text;

/**
 * Fichas em que o numero digitado nao bate com o que a IA leu na foto.
 *
 * Diferenca de ate 0,1 L e arredondamento de leitura, nao divergencia. Quando a
 * ficha tem mais de uma foto do mesmo papel (o comboista refotografou), vale a
 * mais recente.
 */
create view public.vw_registrador_foto_divergente
with (security_invoker = true) as
  with ultima as (
    select distinct on (x.registro_id, x.papel)
           x.id, x.registro_id, x.papel, x.leitura_ia, x.leitura_ia_confianca
      from public.anexos x
     where x.tabela = 'abastecimentos'
       and x.papel in ('registrador_inicio', 'registrador_fim')
       and x.leitura_ia is not null
     order by x.registro_id, x.papel, x.criado_em desc
  )
  select
    a.id               as abastecimento_id,
    a.numero_documento,
    a.data,
    a.hora,
    u.papel,
    case u.papel when 'registrador_inicio' then a.registrador_inicio
                 else a.registrador_fim end as valor_digitado,
    u.leitura_ia       as valor_lido,
    u.leitura_ia_confianca as confianca,
    u.id               as anexo_id,
    f.numero           as frota_numero,
    fu.nome            as comboista_nome
  from ultima u
  join public.abastecimentos a on a.id = u.registro_id and not a.excluido
  left join public.frotas f on f.id = a.frota_id
  left join public.funcionarios fu on fu.id = a.criado_por
  where abs(u.leitura_ia - case u.papel when 'registrador_inicio' then a.registrador_inicio
                                        else a.registrador_fim end) > 0.1;

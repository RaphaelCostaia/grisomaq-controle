-- =============================================================================
-- GRISOMAQ CONTROLE - 1300 - visão administrativa
-- =============================================================================
-- O escritório precisa saber o estado do PIN de cada funcionário para operar:
-- quem ainda não foi provisionado, quem está bloqueado, quem nunca trocou o
-- inicial. Nada disso é segredo — saber que um PIN está bloqueado não ajuda
-- ninguém a adivinhá-lo.
--
-- O que continua fora do alcance de qualquer papel da aplicação é o material
-- que permitiria ataque offline: `pin_hash` e `pin_verificador_offline`. E o
-- CPF fica de fora porque o painel não precisa dele para nada que exista hoje;
-- expor dado pessoal "por precaução" é o caminho mais curto para vazá-lo.
-- =============================================================================

grant select (pin_definido_em, pin_trocar_no_proximo_acesso, pin_tentativas_falhas, pin_bloqueado_ate)
  on table public.funcionarios to authenticated;

/**
 * Quadro de funcionários como o escritório precisa ver.
 *
 * `security_invoker` para a RLS continuar valendo: um funcionário de campo que
 * consultasse esta view veria o mesmo que já vê pela `vw_funcionarios_publico`.
 */
create view public.vw_funcionarios_admin
with (security_invoker = true) as
  select
    f.id,
    f.codigo,
    f.nome,
    f.funcao,
    f.papel,
    f.frente_padrao_id,
    f.ativo,
    f.pin_definido_em is not null                as pin_provisionado,
    f.pin_trocar_no_proximo_acesso               as pin_precisa_trocar,
    f.pin_tentativas_falhas,
    f.pin_bloqueado_ate,
    (f.pin_bloqueado_ate is not null and f.pin_bloqueado_ate > now()) as bloqueado,
    f.criado_em,
    f.atualizado_em
  from public.funcionarios f;

/**
 * Conflitos aguardando o escritório.
 *
 * Cada linha é um lançamento que o campo preencheu e o banco recusou — número
 * de ficha repetido, caminhão com dois ciclos abertos, apontamento duplicado.
 * O payload está guardado; o que falta é alguém decidir o que fazer com ele.
 */
create view public.vw_conflitos_pendentes
with (security_invoker = true) as
  select
    o.id,
    o.tabela,
    o.registro_id,
    o.tipo,
    o.erro_codigo,
    o.erro_mensagem,
    o.payload,
    o.recebido_em,
    o.dispositivo_id,
    f.codigo as funcionario_codigo,
    f.nome   as funcionario_nome
  from public.sync_operacoes o
  join public.funcionarios f on f.id = o.funcionario_id
  where o.status in ('conflito', 'rejeitada')
    and o.resolvido_em is null;

/**
 * Assinaturas que ainda não foram confirmadas pelo servidor.
 *
 * Uma assinatura só conferida no celular vale menos: aparelho adulterado
 * consegue burlar a checagem local. Esta lista existe para o escritório saber
 * o que ainda está pendente de confirmação — e o que foi contestado.
 */
create view public.vw_assinaturas_a_conferir
with (security_invoker = true) as
  select
    a.id,
    a.tipo_documento,
    a.documento_id,
    a.validacao_pin,
    a.texto_aceite,
    a.momento_dispositivo,
    a.momento_servidor,
    a.dispositivo_id,
    f.codigo as funcionario_codigo,
    f.nome   as funcionario_nome
  from public.assinaturas_aceite a
  join public.funcionarios f on f.id = a.funcionario_id
  where a.validacao_pin <> 'validado_servidor';

/**
 * Marca um conflito como resolvido.
 *
 * Não reaplica o lançamento: o que o escritório decide fazer com ele (corrigir
 * o número, lançar de novo, descartar) varia caso a caso, e automatizar essa
 * decisão significaria escolher errado em silêncio. A função só registra que
 * alguém olhou e resolveu, para o conflito sair da fila.
 */
create or replace function public.fn_resolver_conflito(p_operacao_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_linhas integer;
begin
  if not public.fn_e_admin() then
    raise exception 'SEM_PERMISSAO';
  end if;

  update public.sync_operacoes
     set resolvido_em = now(),
         resolvido_por = public.fn_funcionario_atual()
   where id = p_operacao_id
     and resolvido_em is null;

  get diagnostics v_linhas = row_count;
  return v_linhas > 0;
end;
$$;

grant execute on function public.fn_resolver_conflito(uuid) to authenticated;

-- Privilégio e policy são portas diferentes: a policy diz QUAIS linhas, o grant
-- diz SE pode agir. A migration 0900 revogou o UPDATE da tabela inteira para o
-- cliente não conseguir forjar o status de uma operação — e isso também barrava
-- o escritório de marcar um conflito como resolvido.
--
-- A permissão volta apenas nas duas colunas da resolução. Status, payload e
-- código de erro continuam fora do alcance de qualquer papel da aplicação:
-- eles são o registro do que aconteceu, e registro não se reescreve.
grant update (resolvido_em, resolvido_por) on table public.sync_operacoes to authenticated;

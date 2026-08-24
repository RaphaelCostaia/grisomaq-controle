-- =============================================================================
-- Liberar o acesso de quem se bloqueou errando o PIN.
--
-- O bloqueio por 5 tentativas existe e funciona. O que faltava era a saída: a
-- tela do campo manda "peça ao escritório para liberar", e o escritório via o
-- bloqueio no painel sem nenhum botão para desfazê-lo. O único caminho era
-- GERAR UM PIN NOVO — obrigando o operador a decorar outro número por rádio, no
-- meio do turno, porque errou cinco vezes de luva.
--
-- Liberar NÃO troca o PIN e NÃO revela nada: só zera o contador e a data de
-- bloqueio. Fica registrado em auditoria como qualquer outra alteração.
-- =============================================================================

create or replace function public.fn_liberar_pin(p_funcionario_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- SECURITY DEFINER contorna a RLS, então a permissão é conferida aqui: sem
  -- isto, qualquer sessão autenticada destravaria qualquer funcionário.
  if not public.fn_e_admin() then
    raise exception 'SEM_PERMISSAO';
  end if;

  update public.funcionarios
     set pin_tentativas_falhas = 0,
         pin_bloqueado_ate = null,
         atualizado_em = now()
   where id = p_funcionario_id;

  if not found then
    raise exception 'FUNCIONARIO_NAO_ENCONTRADO';
  end if;
end;
$$;

revoke all on function public.fn_liberar_pin(uuid) from public, anon;
grant execute on function public.fn_liberar_pin(uuid) to authenticated;

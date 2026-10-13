-- =============================================================================
-- GRISOMAQ CONTROLE - 1013120600 - trigger de capacidade só em INSERT
-- =============================================================================
-- A migration 20261013120100 criou trg_abast_validar_capacidade como
-- `before insert or update`. QA pós-deploy pegou que isso bloqueava
-- fn_travar_periodo, que faz `update abastecimentos set status = 'travado'`:
-- qualquer linha histórica com litros > limite (lançada antes do trigger
-- existir) fazia o trigger disparar em cima de um UPDATE que nem toca em
-- `litros`, abortando o fechamento inteiro.
--
-- A validação de capacidade só precisa rodar quando o usuário informa litros
-- novos. UPDATE de status, observação, exclusão lógica não devem acionar.
-- =============================================================================

drop trigger if exists trg_abast_validar_capacidade on public.abastecimentos;

create trigger trg_abast_validar_capacidade
  before insert on public.abastecimentos
  for each row execute function public.fn_abast_validar_capacidade();

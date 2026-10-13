-- =============================================================================
-- GRISOMAQ CONTROLE - 1013120000 - numero_documento tem que fazer sentido
-- =============================================================================
-- QA em produção pegou que número 0, -1 e 999.999.999 passavam no sync_push:
-- o único filtro do banco era a unicidade. Um bloco impresso real vai de 1 a
-- uns 9000 por folha; qualquer coisa fora disso é digitação quebrada ou cliente
-- adulterado. Pequena defesa em profundidade.
-- =============================================================================

-- NOT VALID: a regra vale para novos inserts e updates, mas o Postgres não
-- recusa a migration por causa de linhas históricas ruins (números 0/-1/
-- 999999999 que entraram no banco antes desta trava existir). O escritório
-- pode limpar os anômalos e depois rodar
--   alter table public.abastecimentos validate constraint abast_numero_documento_range;
-- para passar a cobrar também o passado.
alter table public.abastecimentos
  add constraint abast_numero_documento_range
  check (numero_documento > 0 and numero_documento <= 99999999)
  not valid;

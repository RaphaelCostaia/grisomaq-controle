-- =============================================================================
-- GRISOMAQ CONTROLE - 1013120000 - numero_documento tem que fazer sentido
-- =============================================================================
-- QA em produção pegou que número 0, -1 e 999.999.999 passavam no sync_push:
-- o único filtro do banco era a unicidade. Um bloco impresso real vai de 1 a
-- uns 9000 por folha; qualquer coisa fora disso é digitação quebrada ou cliente
-- adulterado. Pequena defesa em profundidade.
-- =============================================================================

alter table public.abastecimentos
  add constraint abast_numero_documento_range
  check (numero_documento > 0 and numero_documento <= 99999999);

-- =============================================================================
-- GRISOMAQ CONTROLE - 1024120000 - parametro dias_retroatividade_maxima
-- =============================================================================
-- Feedback do cliente: a tela de nova ficha trava a data em "agora" e nao
-- deixa lancar uma ficha de ontem como exemplo. Vamos permitir edicao com
-- janela de 7 dias (configuravel por aqui). Mais que isso continua indo pelo
-- escritorio, e o fechamento de periodo ja protege o passado selado.
-- =============================================================================

insert into public.parametros (chave, valor, descricao) values
  ('dias_retroatividade_maxima', '7',
   'Ate quantos dias no passado o operador pode lancar um abastecimento pela tela de campo. Fechamento de periodo ainda prevalece.')
on conflict (chave) do nothing;

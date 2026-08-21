-- =============================================================================
-- GRISOMAQ CONTROLE - 1100 - parametros de validacao
-- =============================================================================
-- Os limiares vivem em tabela, e nao no codigo, porque quem sabe o valor certo
-- e o escritorio - e ele descobre isso na safra, nao antes dela. Ajustar um
-- numero aqui nao exige build nem atualizar 30 celulares.
-- =============================================================================

insert into public.parametros (chave, valor, descricao) values
  ('app_versao_minima', '"0.1.0"',
   'Versão mínima do app aceita pelo sync. Abaixo disso o push é rejeitado com VERSAO_OBSOLETA.'),

  -- FICHA 1
  ('permanencia_min_alerta', '10',
   'Permanência de caminhão abaixo deste valor (minutos) gera aviso: provavelmente a saída foi lançada por engano.'),
  ('permanencia_max_alerta', '240',
   'Permanência acima deste valor (minutos) gera aviso: provavelmente esqueceram de registrar a saída.'),

  -- FICHA 2
  ('km_max_turno', '400',
   'Quilometragem máxima plausível num turno. Acima disso, aviso de leitura suspeita.'),
  ('horas_elevador_folga', '1',
   'Folga (horas) sobre a duração do turno antes de avisar que o horímetro do elevador rodou demais.'),
  ('delta_leitura_odometro_aviso', '5',
   'Diferença (km) entre a leitura inicial informada e a última conhecida da frota que dispara aviso.'),
  ('delta_leitura_horimetro_aviso', '0.5',
   'Diferença (horas) entre a leitura inicial informada e a última conhecida da frota que dispara aviso.'),

  -- FICHA 3
  ('tolerancia_litros_abs', '0.5',
   'Divergência absoluta (litros) tolerada entre os litros informados e o registrador da bomba.'),
  ('tolerancia_litros_pct', '0.005',
   'Divergência relativa tolerada entre litros informados e registrador (0,5%).'),
  ('fator_capacidade_tanque', '1.15',
   'Multiplicador da capacidade do tanque acima do qual o abastecimento é bloqueado.'),
  ('minutos_min_entre_abastecimentos', '30',
   'Intervalo mínimo entre dois abastecimentos da mesma frota antes de gerar aviso.'),
  ('desvio_consumo_aviso_pct', '0.40',
   'Desvio do consumo (L/h ou km/L) em relação ao esperado da frota que dispara aviso.'),
  ('blocos_aviso_restante', '10',
   'Quando restarem menos números que isto na faixa do dispositivo, o app pede nova faixa ao escritório.'),

  -- Gerais
  ('desvio_relogio_max_min', '5',
   'Desvio (minutos) entre o relógio do celular e o do servidor que dispara aviso ao operador.'),
  ('minutos_tolerancia_futuro', '15',
   'Tolerância (minutos) para lançamento com hora à frente do relógio do servidor.'),
  ('horas_bloqueio_tela', '8',
   'Inatividade (horas) após a qual o app pede o PIN novamente, sem encerrar a sessão.')
on conflict (chave) do nothing;

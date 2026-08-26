-- =============================================================================
-- Fotos guardadas como bytes no próprio Postgres.
--
-- A tabela `anexos` foi desenhada para storage externo (`caminho_storage`); o
-- plano original apontava para Supabase. Com a virada para VPS própria, guardar
-- os bytes na mesma linha simplifica: o dump do banco já cobre backup, não
-- precisa de S3 nem sincronizar dois lugares, e as fotos são pequenas (JPEG
-- ~200 KB depois de comprimir no cliente).
--
-- Migração aditiva:
--   - nova coluna `dados` opcional;
--   - `caminho_storage` deixa de ser obrigatório;
--   - CHECK exigindo pelo menos uma das duas formas — sem isto um anexo
--     poderia ser gravado sem apontar para lugar nenhum.
-- =============================================================================

alter table public.anexos
  add column if not exists dados bytea;

alter table public.anexos
  alter column caminho_storage drop not null;

alter table public.anexos
  add constraint anexos_tem_conteudo
  check (dados is not null or caminho_storage is not null);

-- --- Foto de abastecimento: metadado semântico ------------------------------
-- `tabela` já existia como texto livre; um enum com o único caso previsto até
-- agora ajudaria, mas texto continua sendo mais barato de ampliar depois.
comment on column public.anexos.tabela is
  'Tabela a que este anexo pertence. Hoje só "abastecimentos".';
comment on column public.anexos.dados is
  'Bytes do arquivo. Preferido sobre caminho_storage para instalações que não usam storage externo.';

#!/bin/sh
# =============================================================================
# GRISOMAQ CONTROLE — restauração do Postgres
# =============================================================================
# Restaura um dump gerado por `backup.sh`.
#
#   DATABASE_URL=postgres://usuario:senha@host:5432/nome \
#   sh banco/restaurar.sh /backups/grisomaq_2026-08-22_0300.dump
#
# TESTE ISTO ANTES DE PRECISAR. Restaure num banco vazio de teste e confira que
# o painel abre com os dados. Backup nunca restaurado é esperança, não backup.
#
# Como testar sem risco: crie um segundo serviço Postgres no EasyPanel, aponte
# DATABASE_URL para ele e rode este script. O banco de produção não é tocado.
# =============================================================================
set -eu

: "${DATABASE_URL:?defina DATABASE_URL}"
ARQUIVO="${1:?informe o arquivo .dump}"

if [ ! -f "$ARQUIVO" ]; then
  echo "✗ arquivo não encontrado: $ARQUIVO" >&2
  exit 1
fi

if ! pg_restore --list "$ARQUIVO" > /dev/null 2>&1; then
  echo "✗ o arquivo não é um dump válido do pg_dump" >&2
  exit 1
fi

# Guarda de segurança: restaurar por cima de um banco com dados apagaria o que
# está lá. Exige confirmação explícita em vez de descobrir depois.
TEM_DADOS=$(psql "$DATABASE_URL" -tAc \
  "select count(*) from information_schema.tables where table_schema = 'public'" 2>/dev/null || echo 0)

if [ "$TEM_DADOS" -gt 0 ] && [ "${FORCAR:-}" != "sim" ]; then
  echo "✗ o banco de destino já tem $TEM_DADOS tabelas." >&2
  echo "  Restaurar por cima apagaria os dados atuais." >&2
  echo "  Se é isso mesmo que você quer, rode de novo com FORCAR=sim." >&2
  exit 1
fi

echo "→ restaurando $ARQUIVO"

# `--clean --if-exists` derruba os objetos antes de recriar; sem isso a
# restauração falha em cima de um esquema já existente.
pg_restore --dbname="$DATABASE_URL" --clean --if-exists --no-owner --no-privileges "$ARQUIVO"

echo "→ conferindo"
psql "$DATABASE_URL" -c "
  select
    (select count(*) from public.funcionarios)   as funcionarios,
    (select count(*) from public.frotas)         as frotas,
    (select count(*) from public.abastecimentos) as abastecimentos,
    (select count(*) from public.caminhao_ciclos) as ciclos,
    (select count(*) from public.apontamentos)   as apontamentos;
"

echo "✓ restauração concluída — confira os números acima antes de liberar o acesso"

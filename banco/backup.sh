#!/bin/sh
# =============================================================================
# GRISOMAQ CONTROLE — backup do Postgres
# =============================================================================
# Gera um dump comprimido, apaga os antigos e CONFERE que o arquivo gerado
# abre. Um backup que nunca foi lido é esperança, não backup.
#
# Uso na VPS (cron do EasyPanel, ou crontab do host):
#
#   DATABASE_URL=postgres://usuario:senha@banco:5432/grisomaq \
#   DESTINO=/backups \
#   sh banco/backup.sh
#
# Variáveis:
#   DATABASE_URL  obrigatória
#   DESTINO       pasta dos dumps (padrão: ./backups)
#   RETENCAO_DIAS quantos dias manter (padrão: 30)
#
# Agende uma vez por dia, de madrugada. A safra dura meses e o erro costuma ser
# percebido dias depois — reter 30 dias cobre o cenário realista.
# =============================================================================
set -eu

: "${DATABASE_URL:?defina DATABASE_URL}"
DESTINO="${DESTINO:-./backups}"
RETENCAO_DIAS="${RETENCAO_DIAS:-30}"

mkdir -p "$DESTINO"

CARIMBO=$(date +%Y-%m-%d_%H%M)
ARQUIVO="$DESTINO/grisomaq_$CARIMBO.dump"

echo "→ gerando $ARQUIVO"

# Formato custom (-Fc): comprimido, e permite restaurar tabela por tabela com
# pg_restore. Um .sql puro só serve para restaurar tudo de uma vez.
pg_dump --dbname="$DATABASE_URL" --format=custom --compress=9 --file="$ARQUIVO"

# Conferência: pg_restore --list falha se o arquivo estiver truncado ou
# corrompido. É barato, e é a diferença entre ter backup e achar que tem.
if ! pg_restore --list "$ARQUIVO" > /dev/null 2>&1; then
  echo "✗ o dump gerado não abre — backup ABORTADO, arquivo removido" >&2
  rm -f "$ARQUIVO"
  exit 1
fi

TABELAS=$(pg_restore --list "$ARQUIVO" | grep -c 'TABLE DATA' || true)
TAMANHO=$(du -h "$ARQUIVO" | cut -f1)
echo "✓ $ARQUIVO ($TAMANHO, $TABELAS tabelas com dados)"

# Um dump que abre mas veio vazio é o pior caso: parece sucesso e não é.
if [ "$TABELAS" -lt 5 ]; then
  echo "✗ o dump tem só $TABELAS tabelas com dados — algo está errado" >&2
  exit 1
fi

echo "→ removendo dumps com mais de $RETENCAO_DIAS dias"
find "$DESTINO" -name 'grisomaq_*.dump' -type f -mtime "+$RETENCAO_DIAS" -print -delete

echo "✓ backup concluído"

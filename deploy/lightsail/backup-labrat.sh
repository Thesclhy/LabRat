#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${LABRAT_ENV_FILE:-/etc/labrat/backend.env}"
BACKUP_DIR="${LABRAT_BACKUP_DIR:-/var/backups/labrat}"
FILES_ROOT="${LABRAT_FILE_STORAGE_ROOT:-/var/lib/labrat/files}"
RETENTION_DAYS="${LABRAT_BACKUP_RETENTION_DAYS:-14}"
STAMP="$(date -u +%Y%m%d%H%M%S)"

[[ -f "$ENV_FILE" ]] || {
  echo "Missing environment file: $ENV_FILE" >&2
  exit 1
}

set -a
source "$ENV_FILE"
set +a

mkdir -p "$BACKUP_DIR"
pg_dump "$DATABASE_URL" | gzip > "$BACKUP_DIR/labrat-db-$STAMP.sql.gz"
tar -czf "$BACKUP_DIR/labrat-files-$STAMP.tar.gz" -C "$(dirname "$FILES_ROOT")" "$(basename "$FILES_ROOT")"
find "$BACKUP_DIR" -type f -mtime +"$RETENTION_DAYS" -delete

echo "created LabRat backup set $STAMP in $BACKUP_DIR"

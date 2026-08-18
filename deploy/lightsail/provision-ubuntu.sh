#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script with sudo on the Lightsail instance." >&2
  exit 1
fi

LABRAT_DOMAIN="${LABRAT_DOMAIN:?Set LABRAT_DOMAIN before running this script.}"
LABRAT_DB_PASSWORD="${LABRAT_DB_PASSWORD:-$(openssl rand -hex 24)}"
LABRAT_SESSION_SECRET="${LABRAT_SESSION_SECRET:-$(openssl rand -hex 32)}"
LABRAT_APP_USER="${LABRAT_APP_USER:-labrat}"
LABRAT_DB_NAME="${LABRAT_DB_NAME:-labrat}"
LABRAT_DB_USER="${LABRAT_DB_USER:-labrat_app}"
LABRAT_DEPLOY_ROOT="${LABRAT_DEPLOY_ROOT:-/opt/labrat}"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"

if [[ ! "$LABRAT_DB_PASSWORD" =~ ^[A-Za-z0-9._~-]+$ ]]; then
  echo "LABRAT_DB_PASSWORD must use only URL-safe characters: A-Z a-z 0-9 . _ ~ -" >&2
  exit 1
fi

apt-get update
apt-get install -y ca-certificates curl gnupg postgresql postgresql-contrib caddy tar gzip rsync

if ! command -v node >/dev/null 2>&1 || ! node --version | grep -Eq '^v2[2-9]\.'; then
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" \
    > /etc/apt/sources.list.d/nodesource.list
  apt-get update
  apt-get install -y nodejs
fi

id "$LABRAT_APP_USER" >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin "$LABRAT_APP_USER"
mkdir -p "$LABRAT_DEPLOY_ROOT/releases" /var/lib/labrat/files /var/backups/labrat /etc/labrat
chown -R "$LABRAT_APP_USER:$LABRAT_APP_USER" "$LABRAT_DEPLOY_ROOT" /var/lib/labrat
chmod 750 /var/lib/labrat /var/lib/labrat/files

sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${LABRAT_DB_USER}') THEN
    CREATE ROLE ${LABRAT_DB_USER} LOGIN PASSWORD '${LABRAT_DB_PASSWORD}';
  ELSE
    ALTER ROLE ${LABRAT_DB_USER} WITH LOGIN PASSWORD '${LABRAT_DB_PASSWORD}';
  END IF;
END
\$\$;
SELECT 'CREATE DATABASE ${LABRAT_DB_NAME} OWNER ${LABRAT_DB_USER}'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = '${LABRAT_DB_NAME}')\gexec
GRANT ALL PRIVILEGES ON DATABASE ${LABRAT_DB_NAME} TO ${LABRAT_DB_USER};
SQL

umask 077
cat > /etc/labrat/backend.env <<EOF
NODE_ENV=production
HOST=127.0.0.1
PORT=8787
DATABASE_URL=postgres://${LABRAT_DB_USER}:${LABRAT_DB_PASSWORD}@127.0.0.1:5432/${LABRAT_DB_NAME}
SESSION_SECRET=${LABRAT_SESSION_SECRET}
LABRAT_FILE_STORAGE_ROOT=/var/lib/labrat/files
LABRAT_SEED_DEV_ACCOUNTS=false
LABRAT_AI_PROVIDER=deepseek
DEEPSEEK_API_KEY=
DEEPSEEK_MODEL=deepseek-v4-pro
DEEPSEEK_BASE_URL=https://api.deepseek.com
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-sonnet-4-5
LABRAT_ANALYSIS_EXECUTOR=disabled
EOF
chown root:"$LABRAT_APP_USER" /etc/labrat/backend.env
chmod 640 /etc/labrat/backend.env

sed "s/{{LABRAT_DOMAIN}}/${LABRAT_DOMAIN}/g; s#{{LABRAT_DEPLOY_ROOT}}#${LABRAT_DEPLOY_ROOT}#g" \
  "$SCRIPT_DIR/Caddyfile" > /etc/caddy/Caddyfile
sed "s/{{LABRAT_APP_USER}}/${LABRAT_APP_USER}/g; s#{{LABRAT_DEPLOY_ROOT}}#${LABRAT_DEPLOY_ROOT}#g" \
  "$SCRIPT_DIR/labrat-backend.service" > /etc/systemd/system/labrat-backend.service
install -m 0755 "$SCRIPT_DIR/backup-labrat.sh" /usr/local/bin/backup-labrat
cat > /etc/cron.d/labrat-backup <<'EOF'
17 7 * * * root /usr/local/bin/backup-labrat
EOF

systemctl daemon-reload
systemctl enable labrat-backend.service
systemctl enable --now caddy

echo "Lightsail provisioning complete for ${LABRAT_DOMAIN}."
echo "Database password and session secret are stored in /etc/labrat/backend.env."
echo "Configure the selected AI provider key in /etc/labrat/backend.env before the first backend start."
echo "The backend service will start after the first release is deployed."

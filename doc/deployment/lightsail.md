# Lightsail Deployment

Status: active deployment guide
Last reviewed: 2026-07-24

This guide deploys LabRat to one AWS Lightsail Ubuntu server. The production
site is same-origin: Caddy serves `https://DOMAIN/LabRat/` and proxies
`/api/*` plus `/health` to the Node backend on `127.0.0.1:8787`.

## Prerequisites

- AWS CLI profile `labrat` can read account `477611841179`.
- A domain points to the Lightsail static IP.
- GitHub repository secrets are configured:
  - `LIGHTSAIL_HOST`
  - `LIGHTSAIL_USER`
  - `LIGHTSAIL_SSH_KEY`
  - optional `LIGHTSAIL_PORT`
  - optional `LIGHTSAIL_DEPLOY_PATH` (defaults to `/opt/labrat`)

## Create AWS Infrastructure

Create an Ubuntu 24.04 Lightsail instance in `us-east-1`, attach a static IP,
and open only ports `22`, `80`, and `443`. Do not expose Postgres `5432` or
the backend `8787` to the public internet.

After DNS points at the static IP, copy the repository or just
`deploy/lightsail/` to the server and provision it:

```bash
sudo LABRAT_DOMAIN=example.com deploy/lightsail/provision-ubuntu.sh
```

The provision script installs Node 22, Postgres, Caddy, backup tooling, the
systemd service, and `/etc/labrat/backend.env`. It generates a URL-safe
database password and session secret unless `LABRAT_DB_PASSWORD` and
`LABRAT_SESSION_SECRET` are supplied.

## First Deployment

This repository has local development changes that may be ahead of GitHub
`main`. Commit and push the local state that should go live before expecting
automatic deployment. The workflow deploys only the pushed GitHub commit, not
uncommitted local files and not an older remote `main`.

Push to `main` or run the `Deploy to Lightsail` workflow manually. The workflow
runs frontend tests, backend tests, configured Postgres integration tests, and
`npm run build`; then it uploads a clean release archive and executes
`deploy/lightsail/remote-deploy.sh` on the server.

The remote deploy script:

- extracts the release into `/opt/labrat/releases/TIMESTAMP-SHA`
- installs backend production dependencies
- runs `npm --prefix backend run migrate`
- switches `/opt/labrat/current`
- restarts `labrat-backend`
- checks `http://127.0.0.1:8787/health`
- keeps the newest five releases
- rolls the symlink back if the restarted backend does not become healthy

## Bootstrap Admin

Production must not enable development seed accounts. After the first
deployment and migration, create the first super admin only while the `users`
table is empty:

```bash
sudo -u labrat bash -lc '
  set -a
  source /etc/labrat/backend.env
  set +a
  LABRAT_BOOTSTRAP_USERNAME=hanqi \
  LABRAT_BOOTSTRAP_PASSWORD="replace-with-a-strong-password" \
  LABRAT_BOOTSTRAP_DISPLAY_NAME="Hanqi Liu" \
  npm --prefix /opt/labrat/current/backend run bootstrap:admin
'
```

Once any user exists, the bootstrap script exits without creating another
admin. Create labs and later users through the authenticated admin API/UI.

## Backups And Rollback

`/usr/local/bin/backup-labrat` runs daily from `/etc/cron.d/labrat-backup`. It
creates a compressed `pg_dump` and a compressed archive of
`/var/lib/labrat/files`, then deletes backups older than 14 days by default.

Manual rollback is a symlink switch followed by a service restart:

```bash
sudo ln -sfn /opt/labrat/releases/PREVIOUS_RELEASE /opt/labrat/current
sudo systemctl restart labrat-backend
```

Database migrations are forward-only. Restore the database from backup when a
database-level rollback is required.

## Acceptance Checks

- `aws sts get-caller-identity --profile labrat` returns account `477611841179`.
- `https://DOMAIN/LabRat/` loads and browser refresh does not 404.
- `https://DOMAIN/health` returns backend health JSON.
- Browser API calls use same-origin `/api/...` and show no CORS errors.
- Login cookie is `HttpOnly` and `Secure`; refresh keeps the session valid.
- `admin / LabRatAdmin123!` and `labuser / LabRatLab123!` are not valid
  production entry points.
- Workbook upload persists files under `/var/lib/labrat/files` and rows in
  Postgres.
- Restarting `labrat-backend` preserves project state and uploaded workbook
  review state.
- A push to `main` deploys the pushed commit SHA, or leaves the previous
  release active on failure.
- Daily backups exist and at least one restore drill has been completed.
- An AWS Budget monthly alert is configured.
- `LABRAT_ANALYSIS_EXECUTOR=disabled` unless a hardened no-network worker is
  separately deployed.

# Public Guest Access v1

Status: locally verified; hosted provisioning follows deployment of this build
Last reviewed: 2026-09-15

## Scope

A shared public demo account is a restricted identity, not a new Lab role or
an administrator. Migration 030 records its sole permitted project in
`public_guest_accounts`. Normal active membership and grants are still required.
The backend filters its lab/project lists and caps its effective capabilities
at `read` and `export`, even after an accidental broader grant or role change.
Platform status never elevates a registered public Guest.

Guest requests permit GET/HEAD and its own POST logout only. Uploads, AI calls,
analysis, annotations, canvas saves, invitation redemption, membership changes
and all other mutations are rejected before the controller. Existing ordinary
accounts keep their existing contracts. Scientific result semantics are unchanged.

## Provisioning

An explicit operator script creates a new user, dedicated demo lab/project,
owner/member memberships, a View grant, restriction registry and audit event
in one transaction. An existing active non-Guest platform administrator must
be named as operator/owner. Username or lab-slug collisions fail rather than
overwriting or adopting existing accounts/data. This is not a startup seed and
never copies real labs, files or accepted results. Start with an empty public
project unless synthetic fixtures are separately selected.

Only the password hash is stored. The operator supplies the intended public
demo password; it must not be a real-user/admin/provider credential. Its later
publication in the README is intentional. Account creation and successful
hosted login must be verified before reporting Guest access as available.

## Operational Limits

Sessions expire after at most 30 minutes. Login attempts are capped at 20 per
IP/minute and 60 per Guest/minute; authenticated requests at 180 per IP/minute
and 1,200 per Guest/minute. Logout remains available after this budget is used.
Counters are bounded in-memory and fail closed at
capacity. Production trusts only loopback Caddy proxy information; development
may aggregate visitors behind the proxy. Multi-instance hosting needs a shared
limiter. Authentication responses and Guest responses use `no-store`.

Disabling the user or removing its membership/grant takes effect on the next
request. Resetting its password uses the existing administrator operation and
revokes its sessions. Do not remove its restriction registry as a way to revoke
access, or roll back to a server without Guest enforcement while it is active.

Read/export access allows copying the demo content. Do not put confidential
data in the demo project. This is application-level isolation on the existing
instance, not a separate infrastructure security boundary or a claim that all
production hardening is complete.

## Acceptance

- Fresh/upgrade/repeated migration and atomic provisioning/collision rollback.
- Login, refresh, one permitted lab/project and no elevated public identity.
- Write/AI/invitation/admin rejection; other-lab/project concealment even with
  accidental extra memberships, grants or platform flags.
- Membership/grant/account revocation and logout.
- Bounded limiter expiry/capacity and unchanged normal-user authorization.
- Actual browser login and readonly workspace, then hosted HTTP verification.

Local verification on 2026-09-15: full `codex:verify`, 16 PostgreSQL cases and
real headless Chrome acceptance passed. The browser checks login, only the demo
lab/project, disabled upload/AI/profile controls, inert readonly canvas and Save,
API rejection of writes/invitations/admin access, refresh and logout. It records
no unintended UI writes, legacy API calls or runtime errors. This empty demo
does not validate populated chart/export workflows or change scientific data.

Repeat with `node backend/scripts/public-guest-browser-check.mjs` after
`build:v1`. Supply a dedicated loopback `LABRAT_TEST_DATABASE_URL`,
`LABRAT_QA_PYTHON` (with Playwright) and `LABRAT_QA_CHROMIUM`. The helper
creates/removes a synthetic schema and manages its own local HTTP servers;
screenshots stay in the ignored `.tmp/public-guest-browser-live` directory.

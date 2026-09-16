# Invitation Onboarding v1

Status: implemented and locally verified; production rollout not performed
Last reviewed: 2026-09-11

## Roles and scope

Only `isSuperAdmin` issues lab-owner invitations; platform status grants no
scientific access. Owners and existing lab administrators issue member invitations
for their active lab. Recipients cannot choose role or target lab. Members start
without projects and cannot create projects.

Email verification, password recovery, billing, group/experiment permissions UI,
ownership transfer and deployment are not part of this milestone.

## Invitation lifecycle

Migration `028_invitation_onboarding.sql` stores a SHA-256 hash of a 32-byte
cryptographically random base64url code. The code is returned only once on
creation. Default lifetime is seven days and one redemption is allowed. Lists
contain pending/used/revoked/expired states and opaque audit references, never
hashes or plaintext codes. No code/password is placed in audits, URLs, browser
storage or logs.

All operations use `/api/v1`. Owner collection: `/admin/invitations`; member
collection: `/labs/{labId}/invitations`. Both support GET/POST and POST
`/{invitationId}/revoke`. Pagination defaults to 50, maximum 100, with opaque
offset cursors; concurrent inserts may shift pages. Revoking a used code returns
409; remove the membership instead.

POST `/auth/invitations/preview` accepts `invitationCode` in the body.
POST `/auth/register` additionally accepts username, displayName, password
(12–1000 characters) and owner-only labName. Already authenticated users use
POST `/auth/invitations/redeem` without changing passwords. Both return
`{ auth, lab }`. Registration sets the existing HttpOnly session cookie.
Lab slugs are server-generated opaque IDs.

User creation, lab/membership, session, code consumption and audit are one
transaction. Row locking serializes redemption; failures such as username
conflict or existing active membership leave the code unused. Issuer activity,
current authority and lab activity are rechecked inside the transaction.
Existing-account redemption also rechecks its session.

Authentication bodies are capped at 8 KiB. Preview allows 30 attempts/IP/minute;
registration and redemption share 10. The single-instance limiter holds at most
10,000 counters, expires old entries and fails closed at capacity. Production
trusts only loopback reverse proxies (Caddy); development ignores forwarded IP
headers. Multi-instance deployment needs a shared limiter first.
Token practices follow the relevant random, single-use and secure-storage guidance
in [OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html).
This feature is account onboarding, not a password-reset endpoint.

## Project access administration

GET `/projects/{projectId}/member-access` returns active members, their direct
grant, actual effective access and lab/group/experiment sources. Only lab managers
use this interface.

PUT `/projects/{projectId}/member-access/{userId}` requires `preset` and
`expectedGrantId` (explicit null when absent). It locks the lab, rechecks membership,
compares the current direct grant ID, disables that grant and creates a new ID,
all in one transaction. Stale IDs return `409 grant_conflict`.

| Preset | Capabilities |
| --- | --- |
| none | Remove direct project grant only |
| view | read, export |
| edit | read, propose, export |
| approve | read, propose, approve, export |

No preset grants manage_access. Owner/admin access is inherited and not editable
here. Selected-experiment direct grants are displayed but rejected by this editor.
Group and experiment grants remain unchanged. Removing direct access is not
equivalent to removing all effective access.

A full-project view grant does not promote a separate selected-experiment edit
or approval grant to the entire project. Such extra capabilities remain bound
to the explicit experiment IDs.

Removal disables the target lab's membership, direct project/experiment grants
and group memberships transactionally. Reactivation defensively clears historical
access too. Other labs and scientific records/authorship are unchanged.

## Frontend behavior

Registration checks the code before showing the matching form; existing users
have a separate redemption action. Platform management works with zero labs.
The compact lab-management screen has Members, Invitations and Project permissions.
Codes/passwords remain transient component state only.

Project capabilities govern editing, uploads/proposals, approval and export.
Readonly manuscripts cannot mutate persisted state through normalization,
keyboard undo or nested editing controls. Scope changes abort pending requests
and reject late responses even if a transport ignores cancellation. Observed
authorization loss clears the workspace. Backend checks remain authoritative.

## Using the feature

1. Sign in with an existing `isSuperAdmin` account; use **Platform management**
   to create a lab-owner invitation. This works even with no lab memberships.
   Initial platform-account provisioning still uses the existing
   `backend/scripts/bootstrap-admin.mjs` operator workflow.
2. Send the displayed code privately. The recipient chooses **Register with
   invitation**, checks the code, and sets username, display name, password
   and lab name. Successful registration signs them into the new lab.
3. The owner opens **Lab management → Invitations** to issue employee codes.
   Employees register without choosing a lab or role and initially see the
   waiting-for-access state.
4. In **Lab management → Project permissions**, choose a project and save
   View, Edit or Approve for each employee. Actual access and additional
   grant sources are shown beside the direct preset. A conflicting save
   reloads the latest values for review.
5. Existing accounts use **Use invitation** after signing in; they do not
   create a second account or reset their password. **Members → Remove
   member** ends lab access. Revoking an already used code cannot remove
   its recipient.

Code disclosure is once-only: if it is lost before redemption, revoke it and
issue another code. Verification and reproducible local acceptance are recorded
in `doc/plans/invitation-onboarding-plan.md`.

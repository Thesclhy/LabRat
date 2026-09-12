create table if not exists invitations (
  id text primary key,
  code_hash text not null unique,
  kind text not null check (kind in ('lab_owner', 'lab_member')),
  lab_id text references labs(id),
  created_by text not null references users(id),
  created_at timestamptz not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by text references users(id),
  redeemed_at timestamptz,
  redeemed_by text references users(id),
  redeemed_lab_id text references labs(id),
  check ((kind = 'lab_owner' and lab_id is null)
      or (kind = 'lab_member' and lab_id is not null)),
  check (expires_at > created_at),
  check (revoked_at is null or redeemed_at is null),
  check ((redeemed_at is null and redeemed_by is null and redeemed_lab_id is null)
      or (redeemed_at is not null and redeemed_by is not null and redeemed_lab_id is not null))
);

create index if not exists invitations_scope_created_idx
  on invitations(kind, lab_id, created_at desc, id);

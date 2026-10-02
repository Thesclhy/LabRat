-- Additive: old PDF checkpoints/passages and their citations retain their meaning.
alter table context_document_versions
  add column if not exists processing_task_id text,
  add column if not exists processing_actor_id text references users(id),
  add column if not exists processing_session_id text references sessions(id) on delete set null,
  add column if not exists processing_started_at timestamptz,
  add column if not exists processing_attempts integer not null default 0
    check (processing_attempts between 0 and 3),
  add column if not exists next_attempt_at timestamptz;

create index if not exists context_document_versions_recovery
  on context_document_versions(next_attempt_at, lease_expires_at)
  where status in ('pending', 'processing', 'failed');

-- Bound lexeme expansion, not page storage. Literal search covers the whole text.
create index if not exists context_document_pages_lexical
  on context_document_pages using gin(to_tsvector('simple', left(body ->> 'text', 100000)))
  where body ->> 'schemaVersion' = '2';

do $$ begin
if not exists (select 1 from pg_constraint where conrelid = 'context_document_pages'::regclass
  and conname = 'context_document_pages_v2_shape') then
alter table context_document_pages add constraint context_document_pages_v2_shape
  check (body ->> 'schemaVersion' is distinct from '2' or coalesce((
    jsonb_typeof(body -> 'text') = 'string'
    and jsonb_typeof(body -> 'blocks') = 'array'
    and jsonb_typeof(body -> 'warnings') = 'array'
    and body ->> 'status' in ('ready', 'empty', 'needs_review', 'failed')
    and (body ->> 'page')::integer = page_number
    and length(body ->> 'text') <= 2000000
  ), false));
end if;
end $$;

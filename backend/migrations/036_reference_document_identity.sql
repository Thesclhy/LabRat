-- References have explicit identities. Equal filenames need not be versions
-- of the same document; existing documents and historical citations are kept.
drop index if exists context_documents_active_name;
create index if not exists context_documents_active_name_lookup
  on context_documents(project_id, original_name) where status = 'active';

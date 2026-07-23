alter table if exists chart_specs
  drop column if exists source_chart_proposal_set_id,
  drop column if exists source_proposal_id;

drop table if exists source_extract_proposals;
drop table if exists chart_proposal_sets;

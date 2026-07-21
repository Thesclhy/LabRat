drop table if exists workbook_understandings;

alter table workbook_review_sessions
  drop column if exists current_understanding,
  drop column if exists regions;

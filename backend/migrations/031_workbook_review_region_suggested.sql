-- Detected candidate regions now start idle ("suggested") instead of being
-- queued for model interpretation; the user promotes the ones they want.
alter table workbook_review_regions
  drop constraint if exists workbook_review_regions_review_status_check;

alter table workbook_review_regions
  add constraint workbook_review_regions_review_status_check
  check (review_status in ('suggested', 'interpreting', 'awaiting_review', 'accepted', 'interpretation_failed'));

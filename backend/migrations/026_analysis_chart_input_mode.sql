alter table analysis_threads
  add column if not exists input_mode text;

alter table analysis_threads
  drop constraint if exists analysis_threads_input_mode_check;

alter table analysis_threads
  add constraint analysis_threads_input_mode_check
  check (input_mode is null or input_mode in ('experiment_browser', 'workbook'));

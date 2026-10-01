-- Link saved quiz sessions to the material they came from.
-- Run after material-quiz-schema.sql.

alter table public.study_sessions
  add column if not exists material_id uuid references public.materials(id) on delete set null;

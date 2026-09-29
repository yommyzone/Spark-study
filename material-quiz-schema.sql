-- Material-specific generated quizzes
-- Run after summary-schema.sql.

alter table public.materials
  add column if not exists generated_quiz jsonb not null default '[]'::jsonb;

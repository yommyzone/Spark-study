-- Spark Study AI summaries
-- Run after the existing Library schema.

alter table public.materials
  add column if not exists summary text not null default '',
  add column if not exists explanation text not null default '',
  add column if not exists key_points jsonb not null default '[]'::jsonb,
  add column if not exists generated_at timestamptz;

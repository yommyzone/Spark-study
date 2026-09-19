-- Add extracted text storage for Spark Study materials.
-- Run this after library-schema.sql.

alter table public.materials
add column if not exists extracted_text text not null default '';

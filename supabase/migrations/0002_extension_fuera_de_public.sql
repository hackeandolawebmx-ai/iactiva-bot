-- Recomendacion del linter de Supabase: las extensiones no deben vivir en el esquema public.
alter extension btree_gist set schema extensions;

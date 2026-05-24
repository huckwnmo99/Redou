-- Remove the legacy 4-argument match_chunks overload left behind by earlier
-- embedding/RAG migrations. PostgREST cannot disambiguate it from the newer
-- 6-argument function when callers use the historical argument set.

drop function if exists public.match_chunks(vector, double precision, integer, uuid[]);

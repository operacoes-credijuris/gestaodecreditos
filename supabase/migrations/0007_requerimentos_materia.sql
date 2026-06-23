-- Migração 0007: garante a coluna 'materia' em requerimentos.
-- Ela já havia sido criada na 0005; este script é uma segurança caso
-- aquele trecho não tenha sido aplicado. Idempotente.

alter table public.requerimentos
  add column if not exists materia text;

notify pgrst, 'reload schema';

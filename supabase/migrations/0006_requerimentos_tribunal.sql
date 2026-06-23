-- Migração 0006: Requerimentos — separa "Órgão" de "Tribunal / Entidade".
-- Adiciona a coluna tribunal_entidade. A antiga 'materia' sai da interface
-- (a coluna fica no banco, sem uso). Idempotente.

alter table public.requerimentos
  add column if not exists tribunal_entidade text;

-- Recarrega o cache da API (evita "column does not exist").
notify pgrst, 'reload schema';

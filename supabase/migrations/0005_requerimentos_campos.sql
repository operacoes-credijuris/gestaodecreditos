-- Migração 0005: ajusta campos de Requerimentos.
-- Novos campos: materia e classe_processual. O antigo 'assunto' sai da
-- interface (vira opcional e seu conteúdo é aproveitado como 'materia').
-- O 'status' deixa de ser usado pela interface (a coluna fica, com default).
-- Idempotente.

alter table public.requerimentos
  add column if not exists materia           text,
  add column if not exists classe_processual text;

-- 'assunto' deixa de ser obrigatório.
alter table public.requerimentos alter column assunto drop not null;

-- Aproveita o antigo 'assunto' como matéria (quando ainda vazia).
update public.requerimentos
  set materia = assunto
  where materia is null and assunto is not null;

-- Recarrega o cache da API (evita "column does not exist").
notify pgrst, 'reload schema';

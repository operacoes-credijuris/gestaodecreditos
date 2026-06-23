-- Migração 0009: Apensos (incidentes, recursos etc.) atrelados a um principal.
-- Um apenso pertence a um crédito (processo_id) OU a um requerimento
-- (requerimento_id). on delete cascade: some junto com o principal. Idempotente.

create table if not exists public.apensos (
  id                uuid primary key default gen_random_uuid(),
  processo_id       uuid references public.processos (id) on delete cascade,
  requerimento_id   uuid references public.requerimentos (id) on delete cascade,
  numero            text,
  classe_processual text,
  tribunal          text,
  comarca           text,
  vara              text,
  polo_ativo        text,
  polo_passivo      text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

drop trigger if exists set_updated_at on public.apensos;
create trigger set_updated_at before update on public.apensos
  for each row execute function public.set_updated_at();

alter table public.apensos enable row level security;
drop policy if exists "auth_all" on public.apensos;
create policy "auth_all" on public.apensos
  for all to authenticated using (true) with check (true);

create index if not exists apensos_processo_idx on public.apensos (processo_id);
create index if not exists apensos_requerimento_idx on public.apensos (requerimento_id);

notify pgrst, 'reload schema';

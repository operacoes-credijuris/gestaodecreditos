-- Marcação de "tratada" (providenciada) por publicação do DJEN.
-- A sincronização (Edge Function) faz upsert SEM a coluna tratada, então o
-- valor marcado pelo usuário é preservado entre sincronizações.
alter table public.djen_publicacoes
  add column if not exists tratada boolean not null default false;

-- Permite ao usuário autenticado marcar/desmarcar (update) no cache.
drop policy if exists "djen_pub_update" on public.djen_publicacoes;
create policy "djen_pub_update" on public.djen_publicacoes
  for update to authenticated using (true) with check (true);

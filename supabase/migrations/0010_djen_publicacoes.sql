-- Cache das publicações do DJEN (Comunica PJe). A página lê desta tabela
-- (rápido) e a Edge Function djen-publicacoes a mantém atualizada.
create table if not exists public.djen_publicacoes (
  id                    bigint primary key, -- id da comunicação no DJEN
  data_disponibilizacao date,
  numero_processo       text,
  sigla_tribunal        text,
  tipo_comunicacao      text,
  raw                   jsonb not null default '{}'::jsonb, -- todos os campos do DJEN
  sincronizado_em       timestamptz not null default now()
);

create index if not exists djen_pub_data_idx
  on public.djen_publicacoes (data_disponibilizacao desc);

alter table public.djen_publicacoes enable row level security;

-- Leitura por qualquer autenticado; escrita só via service_role (Edge Function).
drop policy if exists "djen_pub_select" on public.djen_publicacoes;
create policy "djen_pub_select" on public.djen_publicacoes
  for select to authenticated using (true);

-- Cache das TAREFAS do ADVBOX, para a aba "Tarefas" da ficha de cada processo.
--
-- Por que cache, e não consulta ao vivo: o endpoint /posts do ADVBOX não filtra
-- por processo — a única forma de saber as tarefas de UM processo é baixar
-- todas e casar por lawsuits_id. Fazer isso a cada abertura de ficha seria uma
-- varredura completa por clique. A Edge Function advbox-tarefas (action 'sync')
-- mantém esta tabela; a ficha lê daqui e abre instantânea.
--
-- numero_digits: mesma decisão de advbox_movimentacoes (migração 0016) — o
-- número vem do ADVBOX em formatos variados e PostgREST não normaliza em
-- consulta, então a forma só-dígitos é gravada e indexada.
create table if not exists public.advbox_tarefas (
  id                text primary key,      -- id do post no ADVBOX
  advbox_lawsuit_id text,
  numero_processo   text,
  numero_digits     text,
  tipo              text,                  -- nome do tipo de tarefa (task)
  data              date,                  -- data da tarefa (start_date)
  date_deadline     date,                  -- prazo fatal, quando houver
  notes             text,
  responsaveis      jsonb not null default '[]'::jsonb,
  important         boolean not null default false,
  urgent            boolean not null default false,
  concluida         boolean not null default false,
  raw               jsonb not null default '{}'::jsonb,
  sincronizado_em   timestamptz not null default now()
);

create index if not exists advbox_tarefas_numero_digits_idx
  on public.advbox_tarefas (numero_digits);
create index if not exists advbox_tarefas_data_idx
  on public.advbox_tarefas (data desc);

alter table public.advbox_tarefas enable row level security;

-- Leitura por qualquer autenticado; escrita só via service_role (Edge Function).
drop policy if exists "advbox_tarefas_select" on public.advbox_tarefas;
create policy "advbox_tarefas_select" on public.advbox_tarefas
  for select to authenticated using (true);

comment on table public.advbox_tarefas is
  'Cache das tarefas do ADVBOX por processo. Mantido pela Edge Function advbox-tarefas (action sync), por cron e ao abrir a aba Tarefas da ficha.';
comment on column public.advbox_tarefas.numero_digits is
  'numero_processo só com dígitos — chave de busca da ficha do processo.';

notify pgrst, 'reload schema';

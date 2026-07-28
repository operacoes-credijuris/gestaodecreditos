-- Cache das MOVIMENTAÇÕES (andamentos) do ADVBOX. A aba Movimentações lê desta
-- tabela (rápido) e a Edge Function advbox-movimentacoes a mantém atualizada:
-- compila os números dos processos cadastrados (Créditos, Requerimentos e
-- Apensos), casa com os processos do ADVBOX e grava os andamentos dos últimos
-- 20 dias, agrupáveis por processo e ordenáveis por data.
create table if not exists public.advbox_movimentacoes (
  id               text primary key,     -- id da movimentação no ADVBOX (ou sintético)
  advbox_lawsuit_id text,                -- id do processo (lawsuit) no ADVBOX
  numero_processo  text,                 -- número do processo (process/protocol_number)
  data             date,                 -- data do andamento (para janela/ordenação)
  data_ts          timestamptz,          -- timestamp exato quando disponível
  conteudo         text,                 -- descrição do andamento
  raw              jsonb not null default '{}'::jsonb, -- todos os campos do ADVBOX
  sincronizado_em  timestamptz not null default now()
);

create index if not exists advbox_mov_data_idx
  on public.advbox_movimentacoes (data desc);
create index if not exists advbox_mov_numero_idx
  on public.advbox_movimentacoes (numero_processo);

alter table public.advbox_movimentacoes enable row level security;

-- Leitura por qualquer autenticado; escrita só via service_role (Edge Function).
drop policy if exists "advbox_mov_select" on public.advbox_movimentacoes;
create policy "advbox_mov_select" on public.advbox_movimentacoes
  for select to authenticated using (true);

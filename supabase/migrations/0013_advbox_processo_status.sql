-- Migração 0013: status por processo do ADVBOX (para o grupo "Paralisados").
-- Uma linha por processo cadastrado/casado no ADVBOX, com a data da ÚLTIMA
-- movimentação (independente da janela de 20 dias). A Edge Function
-- advbox-movimentacoes preenche isto (já baixa todo o histórico, sem custo
-- extra de API). A aba Movimentações usa para montar Novas x Paralisados.
create table if not exists public.advbox_processo_status (
  numero_processo     text primary key,
  advbox_lawsuit_id   text,
  ultima_movimentacao date,        -- null = nenhuma movimentação registrada
  sincronizado_em     timestamptz not null default now()
);

alter table public.advbox_processo_status enable row level security;

-- Leitura por qualquer autenticado; escrita só via service_role (Edge Function).
drop policy if exists "advbox_ps_select" on public.advbox_processo_status;
create policy "advbox_ps_select" on public.advbox_processo_status
  for select to authenticated using (true);

notify pgrst, 'reload schema';

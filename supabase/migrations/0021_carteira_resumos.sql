-- Migração 0021: resumos da carteira gerados por IA.
--
-- Alimenta as colunas "Estágio processual" e "Providências / prox. passos" do
-- grupo "Dados vivos" da carteira do investidor. Os dois textos são escritos
-- pela Edge Function carteira-resumo (Claude), a partir do histórico de
-- movimentações (advbox_movimentacoes) e de tarefas (advbox_tarefas) de cada
-- crédito. Ninguém digita nessas colunas.
--
-- Um registro por crédito: o texto é o retrato ATUAL do processo, não um
-- histórico de versões. Regerar sobrescreve.
create table if not exists public.carteira_resumos (
  processo_id        uuid primary key
                     references public.processos(id) on delete cascade,
  estagio_processual text,
  providencias       text,
  -- Impressão digital dos insumos (nº de andamentos/tarefas + data do mais
  -- recente). A rodada semanal compara: se nada mudou naquele crédito, não
  -- gasta chamada e — mais importante — não troca um texto bom por outro de
  -- redação diferente sem nada ter acontecido no processo. O botão "gerar
  -- todos" ignora e força.
  fonte_hash         text,
  modelo             text,
  -- Última falha de geração (rate limit, crédito sem andamento, recusa do
  -- modelo). Guardada para a tela poder dizer por que a célula está vazia em
  -- vez de mentir que o processo não tem resumo.
  erro               text,
  gerado_em          timestamptz not null default now()
);

alter table public.carteira_resumos enable row level security;

-- Leitura por qualquer autenticado; escrita só via service_role (a Edge
-- Function). Mesmo padrão dos caches do ADVBOX.
drop policy if exists "carteira_resumos_select" on public.carteira_resumos;
create policy "carteira_resumos_select" on public.carteira_resumos
  for select to authenticated using (true);

comment on table public.carteira_resumos is
  'Estágio processual e providências por crédito, gerados por IA a partir das movimentações e tarefas do ADVBOX. Um registro por crédito (sem versionamento).';
comment on column public.carteira_resumos.fonte_hash is
  'Impressão digital dos insumos; igual = nada mudou, não precisa regerar.';

notify pgrst, 'reload schema';

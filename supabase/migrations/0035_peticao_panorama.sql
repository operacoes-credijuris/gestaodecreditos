-- Migração 0035: panorama do caso, gerado por IA para a redação da petição.
--
-- POR TAREFA, e não por crédito: o panorama é o insumo de UMA peça. A mesma
-- execução recebe várias tarefas ao longo do tempo (concordar com cálculos,
-- pedir sequestro, levantar o alvará), e cada uma se escreve com um recorte
-- diferente do mesmo processo. Guardar por crédito faria a segunda tarefa herdar
-- a leitura feita para a primeira.
--
-- É a `carteira_resumos` (migração 0021) vista de outro ângulo: mesmo insumo
-- (advbox_movimentacoes + advbox_tarefas), mesma ideia de impressão digital, mas
-- ali quem lê é o INVESTIDOR (texto curto, sem data, sem jargão) e aqui quem lê é
-- o ADVOGADO que vai redigir (técnico, com datas e prazos, que é o que importa
-- para decidir a peça).
--
-- PARA QUE O CACHE EXISTE: a análise dispara sozinha ao abrir a aba, então sem
-- cache abrir a mesma tarefa três vezes custaria três chamadas ao modelo. Com
-- fonte_hash, só se paga quando algo mudou de verdade no processo.
create table if not exists public.peticao_panorama (
  -- id da tarefa no ADVBOX (text, como em advbox_tarefas).
  tarefa_id   text primary key,
  processo_id uuid references public.processos(id) on delete cascade,
  -- Situação apurada e sugestões de peça, em Markdown, como o modelo devolveu.
  panorama    text,
  -- Impressão digital dos insumos (ids dos andamentos e tarefas da janela +
  -- campos do cadastro que mudam a leitura). Igual = nada mudou, devolve o
  -- guardado sem gastar chamada. Ver carteira_resumos.fonte_hash: a lição de lá
  -- é que contagem + data satura e deixa de detectar novidade.
  fonte_hash  text,
  modelo      text,
  -- Última falha (limite de uso, crédito sem andamento, recusa do modelo).
  -- Guardada para a tela dizer por que não há panorama, em vez de ficar vazia.
  erro        text,
  gerado_em   timestamptz not null default now()
);

alter table public.peticao_panorama enable row level security;

-- Leitura por qualquer autenticado; escrita só via service_role (a Edge
-- Function). Mesmo padrão de carteira_resumos e dos caches do ADVBOX.
drop policy if exists "peticao_panorama_select" on public.peticao_panorama;
create policy "peticao_panorama_select" on public.peticao_panorama
  for select to authenticated using (true);

comment on table public.peticao_panorama is
  'Panorama do caso por TAREFA do ADVBOX, gerado por IA para a redação da petição. Cache: regerado só quando fonte_hash muda.';
comment on column public.peticao_panorama.fonte_hash is
  'Impressão digital dos insumos; igual = nada mudou, não precisa regerar.';

notify pgrst, 'reload schema';

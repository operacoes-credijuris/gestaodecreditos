-- Migração 0051: "Situação" e "Data da Situação" por crédito, dentro de cada
-- fase processual. É uma anotação MANUAL do usuário, à parte da classificação
-- automática — a IA nunca lê nem escreve aqui, só a pessoa.
--
-- O catálogo de situações é ESCOPADO POR FASE de propósito: uma situação
-- criada em "Sequestro" não faz sentido em "Alvará Expedido", e listar tudo
-- junto ia virar uma lista longa e confusa. unique(fase_codigo, nome) evita
-- duplicata dentro da mesma fase (mas o mesmo nome pode existir em fases
-- diferentes, são catálogos independentes).
create table public.processos_fase_situacoes_catalogo (
  id         uuid primary key default gen_random_uuid(),
  fase_codigo text not null,
  nome       text not null,
  -- Chave de uma paleta fixa no front (ex.: 'blue', 'red'...), escolhida pela
  -- pessoa ao criar a situação — não é CSS nem hex, só um rótulo curto. Existe
  -- porque a cor aqui carrega sentido (ex.: vermelho = atenção), então não dá
  -- pra ser calculada sozinha.
  cor        text,
  criado_por uuid references public.profiles(id) on delete set null,
  criado_em  timestamptz not null default now(),
  unique (fase_codigo, nome)
);

alter table public.processos_fase_situacoes_catalogo enable row level security;

-- Leitura e criação livres para autenticado: é só um catálogo de rótulos, sem
-- risco de integridade (ao contrário de processos_fase.fase_codigo, que só o
-- service_role grava). Sem policy de update/delete por ora — apagar um rótulo
-- em uso quebraria a referência de quem já selecionou ele.
drop policy if exists "fase_situacoes_catalogo_select" on public.processos_fase_situacoes_catalogo;
create policy "fase_situacoes_catalogo_select" on public.processos_fase_situacoes_catalogo
  for select to authenticated using (true);

drop policy if exists "fase_situacoes_catalogo_insert" on public.processos_fase_situacoes_catalogo;
create policy "fase_situacoes_catalogo_insert" on public.processos_fase_situacoes_catalogo
  for insert to authenticated with check (true);

comment on table public.processos_fase_situacoes_catalogo is
  'Catálogo de "situações" que o usuário pode marcar por crédito, escopado por fase_codigo — uma situação criada numa fase não aparece nas outras.';

-- Seleção atual por crédito. Escrita só via service_role (Edge Function
-- fase-processual, ação definir_situacao) — mesmo motivo de "tratado": evitar
-- abrir update direto numa tabela que também guarda fase_codigo.
alter table public.processos_fase
  add column if not exists situacao_id uuid references public.processos_fase_situacoes_catalogo(id) on delete set null,
  add column if not exists situacao_data date;

notify pgrst, 'reload schema';

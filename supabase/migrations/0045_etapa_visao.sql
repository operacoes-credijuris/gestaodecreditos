-- Curadoria das colunas do Kommo na tela: quais aparecem, e agrupadas em quê.
--
-- O problema: o funil de Precatórios no Kommo atende DUAS coisas diferentes, e a
-- aba de Precatórios (migration 0044) mostra todas as colunas dele cruas —
-- corretamente, porque o sistema não tinha como saber quais interessam a quem. O
-- resultado é uma fileira de pílulas em que a maioria não é da pessoa que está
-- olhando.
--
-- A saída errada seria eu escrever a divisão no código. Já sabemos onde isso dá:
-- a aba de Precatórios não existia justamente porque os status_id estavam
-- chumbados em src/lib/kommo.ts. Coluna nova no Kommo, coluna renomeada, equipe
-- que muda de ideia — tudo isso viraria pedido de deploy. Então a divisão é DADO,
-- editável na própria tela.
--
-- ============================================================
-- A DECISÃO CENTRAL DESTE ARQUIVO: linha ausente ≠ grupo nulo
-- ============================================================
--
--   sem linha nenhuma  →  coluna NÃO CLASSIFICADA. Ninguém decidiu ainda.
--   linha com grupo nulo → coluna OCULTA. Alguém decidiu que não aparece.
--
-- Um `boolean visivel` juntaria as duas em "não aparece", e é aí que se perde
-- crédito: coluna criada no Kommo depois da configuração entraria como não
-- visível e sumiria da tela sem ninguém ter escolhido isso — "não sei o que é"
-- registrado como "não precisa aparecer". Separadas, a tela pode ocultar em
-- silêncio o que foi mandado ocultar e AVISAR sobre o que ninguém classificou.
--
-- Em nenhum dos dois casos o card desaparece: coluna fora dos grupos cai na
-- pílula "Outras etapas" (ver agruparPorAba em src/lib/kommo.ts). Esconder aqui
-- é tirar do caminho, nunca tirar da existência.

create table if not exists public.etapa_visao (
  pipeline_id  bigint not null,
  status_id    bigint not null,

  -- NULL = ocultar esta coluna da tela. Texto = nome do grupo em que ela aparece.
  -- Grupo é texto livre de propósito: quem opera nomeia com a palavra que a
  -- equipe usa, sem depender de mim para criar um registro antes.
  grupo        text,

  definido_por uuid references public.profiles (id) on delete set null,
  definido_em  timestamptz not null default now(),

  primary key (pipeline_id, status_id),

  -- Grupo em branco ou só com espaço criaria um grupo fantasma na tela, com
  -- pílula sem rótulo. Ou tem nome, ou é NULL (oculta).
  constraint etapa_visao_grupo_nao_vazio
    check (grupo is null or btrim(grupo) <> '')
);

create index if not exists etapa_visao_pipeline_idx
  on public.etapa_visao (pipeline_id);

comment on table public.etapa_visao is
  'Quais colunas do Kommo aparecem na Análise de Crédito e em qual grupo. '
  'Sem linha = não classificada (a tela avisa); grupo NULL = oculta de propósito.';

alter table public.etapa_visao enable row level security;

-- Escrita liberada para autenticado: quem configura é quem opera a tela, e a
-- configuração é de exibição — não muda dado de crédito nem escreve no Kommo.
-- O `definido_por` guarda quem mexeu.
drop policy if exists "etapa_visao_all" on public.etapa_visao;
create policy "etapa_visao_all" on public.etapa_visao
  for all to authenticated using (true) with check (true);

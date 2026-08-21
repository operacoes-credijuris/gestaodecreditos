-- Espelho das COLUNAS do kanban do Kommo (funis e seus estágios).
--
-- O problema que isto resolve: a aba Análise de Crédito só existia para o funil
-- de RPV porque os cinco status_id dele estão escritos à mão em src/lib/kommo.ts.
-- O funil de Precatórios tem outros status_id, e não havia como saber quais —
-- ninguém consegue ler o kanban do Kommo de dentro do banco.
--
-- A saída errada seria alguém abrir o Kommo, copiar os números da URL e colar no
-- código. É onde se erra: número de coluna não tem cara de nada, um dígito
-- trocado aponta para outra coluna existente, e o resultado é card que
-- desaparece da tela sem erro nenhum. Sincronizar a ESTRUTURA do kanban resolve
-- de vez, para qualquer funil, presente ou futuro.
--
-- CHAVE COMPOSTA, e isto não é zelo: no Kommo os estágios de sistema 142
-- ("Venda ganha") e 143 ("Venda perdida") existem em TODOS os funis, com O MESMO
-- status_id. Com status_id como chave primária, o segundo funil sincronizado
-- sobrescreveria as linhas do primeiro e as duas colunas passariam a se chamar
-- pelo nome do funil errado.

create table if not exists public.kommo_etapa (
  pipeline_id     bigint not null,
  status_id       bigint not null,

  pipeline_nome   text,
  nome            text not null,

  -- `sort` do Kommo: a ordem em que as colunas aparecem no kanban. É a ordem em
  -- que as abas devem aparecer na tela — inventar outra faria a tela contar uma
  -- história diferente do CRM que o comercial usa.
  ordem           int not null default 0,

  -- `type` do Kommo: 1 = coluna de entrada de leads, 0 = comum. Guardado porque
  -- a coluna de entrada é a única que o Kommo trata de forma especial, e a tela
  -- pode querer distinguir sem consultar a API de novo.
  tipo            int not null default 0,
  cor             text,

  sincronizado_em timestamptz not null default now(),

  primary key (pipeline_id, status_id)
);

create index if not exists kommo_etapa_pipeline_idx
  on public.kommo_etapa (pipeline_id, ordem);

comment on table public.kommo_etapa is
  'Estrutura do kanban do Kommo (funis e estágios), espelhada pelo kommo-sync. '
  'É de onde a tela monta as abas, em vez de status_id escrito à mão.';

alter table public.kommo_etapa enable row level security;

-- Leitura para todo autenticado: é estrutura de kanban, não dado de negócio.
-- Escrita SÓ pelo kommo-sync, que usa service_role e não passa por RLS — por
-- isso não há policy de insert/update aqui. Se a tela pudesse escrever, uma
-- edição na tela divergiria do Kommo sem ninguém notar, e o Kommo é a fonte.
drop policy if exists "kommo_etapa_select" on public.kommo_etapa;
create policy "kommo_etapa_select" on public.kommo_etapa
  for select to authenticated using (true);

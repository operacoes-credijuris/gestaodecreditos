-- 0073 — Antes do pedido ao Escavador, os processos do crédito.
--
-- O QUE MUDA. A 0072 pedia os autos de UM processo por card: o CNJ do título.
-- Um crédito costuma ser três — o conhecimento, o cumprimento de sentença (ou a
-- execução) e os autos administrativos do precatório (ou da RPV). Pedido da
-- equipe de 28/09/2026: antes de pagar a requisição, um agente de IA lê o
-- título, as anotações e os PDFs anexados ao card e diz quais são os processos
-- DESTE crédito; só esses são pedidos, cada um uma vez só.
--
-- DUAS TABELAS, DOIS MOMENTOS:
--   escavador_autos_card      a LEITURA do card (uma linha por card): quais
--                             processos a IA achou, quantas vezes leu, e a
--                             impressão do que leu.
--   escavador_autos_processo  o PEDIDO de cada processo (card × CNJ): é aqui
--                             que mora a regra "um pedido por processo", pela
--                             chave primária.

-- ============================================================
-- A leitura do card
-- ============================================================
--
-- ESTADOS DO CARD:
--   NOVO          esperando a leitura
--   LENDO         uma volta da rotina está lendo (a posse — impede duas leituras)
--   LIDO          processos definidos (e pedidos, em escavador_autos_processo)
--   SEM_PROCESSO  a leitura não achou número de processo nenhum; lê de novo
--                 quando o card mudar (anotação ou anexo novo)
alter table public.escavador_autos_card
  add column if not exists processos jsonb not null default '[]'::jsonb,
  add column if not exists leituras  int not null default 0,
  add column if not exists lido_em   timestamptz,
  add column if not exists impressao text,
  add column if not exists fontes    jsonb not null default '[]'::jsonb;

-- ============================================================
-- O pedido de cada processo
-- ============================================================
--
-- ESTADOS DO PROCESSO: NOVO, PEDINDO (a posse do pedido pago), FILA (cota do
-- dia), AGUARDANDO (o robô no tribunal), ANEXANDO, CONCLUIDO, FALHOU, SEM_SALDO.
create table if not exists public.escavador_autos_processo (
  kommo_lead_id    bigint not null,
  numero_cnj       text not null,
  -- conhecimento | cumprimento | requisitorio — o que a IA disse que ele é.
  papeis           text[] not null default '{}',
  -- O que abre o nome dos anexos no card: "Conhecimento 001 - …".
  rotulo           text not null default 'Processo',
  estado           text not null default 'NOVO',
  pedido_id        bigint,
  total_documentos int not null default 0,
  anexados         int not null default 0,
  paginas          int not null default 0,
  chaves_anexadas  text[] not null default '{}',
  detalhe          text,
  trabalhando_ate  timestamptz,
  verificado_em    timestamptz,
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now(),
  concluido_em     timestamptz,
  primary key (kommo_lead_id, numero_cnj)
);

create index if not exists escavador_autos_processo_estado_idx
  on public.escavador_autos_processo (estado);
create index if not exists escavador_autos_processo_cnj_idx
  on public.escavador_autos_processo (numero_cnj);

alter table public.escavador_autos_processo enable row level security;

drop policy if exists "escavador_autos_processo_leitura" on public.escavador_autos_processo;
create policy "escavador_autos_processo_leitura" on public.escavador_autos_processo
  for select to authenticated using (true);

-- ============================================================
-- O que a 0072 já tinha feito
-- ============================================================
--
-- Card que já tinha processo pedido na forma antiga vira um processo do card —
-- o pedido já foi pago e não se repete. O card fica NOVO para a IA procurar os
-- outros processos do crédito.
insert into public.escavador_autos_processo
  (kommo_lead_id, numero_cnj, estado, pedido_id, total_documentos, anexados,
   paginas, chaves_anexadas, detalhe, verificado_em, criado_em, atualizado_em,
   concluido_em, rotulo)
select kommo_lead_id, numero_cnj,
       case when estado = 'PEDINDO' then 'FILA' else estado end,
       pedido_id, total_documentos, anexados, paginas, chaves_anexadas, detalhe,
       verificado_em, criado_em, atualizado_em, concluido_em, 'Autos'
from public.escavador_autos_card
where numero_cnj is not null
  and estado not in ('SEM_CNJ', 'NOVO', 'LENDO', 'LIDO', 'SEM_PROCESSO')
on conflict (kommo_lead_id, numero_cnj) do nothing;

update public.escavador_autos_card
set estado = 'NOVO', atualizado_em = now()
where estado not in ('NOVO', 'LENDO', 'LIDO', 'SEM_PROCESSO');

notify pgrst, 'reload schema';

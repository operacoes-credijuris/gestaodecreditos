-- 0072 — Os autos do Escavador vão direto para o card do Kommo.
--
-- O QUE MUDA. Até aqui os PDFs que o Escavador entregava ficavam num balde da
-- plataforma (`autos-escavador`, migração 0068), à espera de alguém abrir uma
-- tela. Decisão de 28/09/2026: os autos descem e SOBEM COMO ANEXO DO CARD no
-- Kommo, e não ficam em lugar nenhum daqui. O card é o lugar dos documentos, e é
-- de lá que o "Executar análise" já lê.
--
-- E O PEDIDO PASSA A SER AUTOMÁTICO: o card chega na primeira coluna do
-- Operacional (RPV, precatório interno e externo), e a rotina
-- `escavador-autos-rotina` pede os autos pelo CNJ dele. Cada pedido custa
-- R$ 1,34 ao Escavador; baixar os PDFs não custa.

-- ============================================================
-- O andamento dos autos de cada card
-- ============================================================
--
-- UMA LINHA POR CARD, e é ela que impede o segundo pedido: card que já tem
-- linha não é pedido de novo, nem quando o sync o traz outra vez.
--
-- ESTADOS:
--   SEM_CNJ     o card não tem número de processo no título nem nas anotações
--               (a rotina olha de novo a cada volta — o comercial pode corrigir)
--   FILA        esperando a cota diária de pedidos
--   AGUARDANDO  pedido feito; o robô do Escavador está no tribunal
--   ANEXANDO    os autos estão prontos e descendo para o card
--   CONCLUIDO   todos os documentos no card
--   FALHOU      o tribunal não entregou (processo físico, sigiloso, erro do robô)
--   SEM_SALDO   o Escavador recusou por falta de crédito (tenta de novo depois)
create table if not exists public.escavador_autos_card (
  kommo_lead_id    bigint primary key,
  numero_cnj       text,
  estado           text not null default 'SEM_CNJ',
  pedido_id        bigint,
  total_documentos int not null default 0,
  anexados         int not null default 0,
  paginas          int not null default 0,
  -- As chaves (do Escavador) já anexadas A ESTE CARD. O mesmo processo pode
  -- estar em dois cards — principal e honorários cedidos em separado —, e o
  -- arquivo que subiu para um é anexado ao outro sem subir de novo.
  chaves_anexadas  text[] not null default '{}',
  detalhe          text,
  -- A trava: quem está trabalhando neste card, até quando. Duas voltas da
  -- rotina ao mesmo tempo subiriam o mesmo PDF duas vezes.
  trabalhando_ate  timestamptz,
  verificado_em    timestamptz,
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now(),
  concluido_em     timestamptz
);

create index if not exists escavador_autos_card_estado_idx
  on public.escavador_autos_card (estado);
create index if not exists escavador_autos_card_cnj_idx
  on public.escavador_autos_card (numero_cnj);

alter table public.escavador_autos_card enable row level security;

drop policy if exists "escavador_autos_card_leitura" on public.escavador_autos_card;
create policy "escavador_autos_card_leitura" on public.escavador_autos_card
  for select to authenticated using (true);

-- ============================================================
-- O documento sabe onde está no Kommo
-- ============================================================
--
-- `caminho` (o balde) deixa de ser preenchido. `kommo_file_uuid` é o arquivo no
-- drive do Kommo — é por ele que o mesmo documento se anexa a outro card sem
-- descer de novo do Escavador.
alter table public.escavador_documento
  add column if not exists data_documento  timestamptz,
  add column if not exists paginas         int,
  add column if not exists ordem           int,
  add column if not exists kommo_file_uuid text,
  add column if not exists anexado_em      timestamptz,
  add column if not exists tentativas      int not null default 0;

notify pgrst, 'reload schema';

-- 0077 — Os autos juntados num PDF por processo, e a repetição do pedido
-- quando o robô do Escavador falha no tribunal.
--
-- O QUE MUDA (pedidos do dono, 07/10/2026):
--
-- 1. OS AUTOS JUNTADOS. A rotina `escavador-autos-rotina` subia cada documento
--    do processo como um PDF separado (21 a 421 por processo), só na área
--    Arquivos do card. Agora os documentos de cada processo são juntados num
--    PDF, na ordem do processo, em partes só quando o tamanho obriga, e cada
--    parte entra também como nota de anexo no chat do card. A junção atravessa
--    invocações (um processo de 187 MB não cabe numa só), e o estado dela mora
--    na coluna `juntada`. Os bytes da parte em curso NÃO ficam no banco.
--
-- 2. A FALHA DO ROBÔ SE REPETE. INTERNAL_ERROR e LOGIN_ERROR (o robô do
--    Escavador não conseguiu entrar no tribunal) não encerram mais o processo:
--    o pedido se refaz de 10 em 10 minutos até um teto (6 por padrão,
--    `teto_de_tentativas` muda por processo). Estado novo: REPETIR.
--
-- ANTES DESTA MIGRAÇÃO a rotina segue fazendo o que fazia (um arquivo por
-- documento; a falha do robô encerra o processo). Ela confere se estas colunas
-- existem antes de usá-las.
--
-- NADA RODA SOZINHO SOBRE O QUE JÁ EXISTE: os processos já CONCLUIDOS (com os
-- arquivos soltos no card) e os que já estão em FALHOU por falha do robô só
-- mudam pelas ações explícitas da rotina (`rejuntar`, `repetir_falhas`).

alter table public.escavador_autos_processo
  -- O estado da junção (ver `_shared/autosJuntos.ts`, interface Juntada): o
  -- tamanho-alvo das partes, as partes que já subiram (uuid, versão, nome,
  -- páginas, se a nota de anexo já está no chat), os documentos que não
  -- puderam ser juntados e a contagem de falhas da parte em curso.
  add column if not exists juntada             jsonb,
  -- Pedidos pagos ao Escavador para este processo na rodada atual. É o que o
  -- teto de repetições confere (cada um pode custar R$ 1,34 e entra na cota
  -- diária de 40).
  add column if not exists tentativas_do_pedido int not null default 0,
  -- O teto de tentativas deste processo; nulo = o padrão da rotina (6).
  add column if not exists teto_de_tentativas  int,
  -- O código da falha passageira do robô (INTERNAL_ERROR, LOGIN_ERROR…) da
  -- rodada em curso. Preenchido = a nota da primeira falha já foi escrita.
  add column if not exists falha_do_robo       text,
  -- Quando a rotina desistiu (teto atingido). Devolver o card à coluna de
  -- entrada DEPOIS disto abre outra rodada.
  add column if not exists desistiu_em         timestamptz;

comment on column public.escavador_autos_processo.juntada is
  'Estado da junção dos autos em poucos PDFs (escavador-autos-rotina/juntar.ts).';
comment on column public.escavador_autos_processo.tentativas_do_pedido is
  'Pedidos pagos ao Escavador nesta rodada (teto em teto_de_tentativas, padrão 6).';

notify pgrst, 'reload schema';

-- 0078 — Uma nota só por card nos autos do Escavador, editada no lugar; e o
-- card que sai da coluna de análise não pede mais autos.
--
-- O QUE MUDA (pedidos do dono, 20/10/2026):
--
-- 1. A NOTA ÚNICA. A rotina `escavador-autos-rotina` escrevia uma nota no card
--    do Kommo a cada passo (processos identificados, falha do robô, conclusão
--    de cada processo, uma nota de anexo por PDF…). Agora é UMA nota de texto
--    por card, criada quando a leitura identifica os processos e EDITADA no
--    lugar (PATCH /api/v4/leads/notes/{id}) a cada mudança. O texto é
--    recalculado do banco a cada volta; aqui fica o id da nota no Kommo, o
--    último texto que subiu (para não editar quando nada mudou, e para refazer
--    na volta seguinte a edição que falhou) e o marco do regime.
--
--    Os PDFs dos autos ficam só na aba Arquivos do card (sem nota de anexo).
--
-- 2. O ESTADO INTERROMPIDO (não pede coluna nova: `estado` é texto livre).
--    Card de um funil operacional (RPV, Precatório Interno ou Externo) que saiu
--    da coluna de entrada tem os processos ainda não pedidos (NOVO, FILA,
--    SEM_SALDO, REPETIR) e a leitura pendente do card (NOVO) em INTERROMPIDO;
--    se o card volta à coluna, voltam para NOVO.
--
-- ANTES DESTA MIGRAÇÃO a rotina escreve só a primeira nota do card (os
-- processos identificados) e nenhuma outra. Ela confere se as colunas existem
-- antes de usá-las.
--
-- NADA RODA SOBRE O QUE JÁ EXISTE: os cards lidos antes desta mudança ficam com
-- `nota_em` nulo e NÃO ganham nota nova (já têm as notas antigas no histórico);
-- os PDFs que ainda subirem para eles vão só para a aba Arquivos.
--
-- Idempotente: pode rodar mais de uma vez.

alter table public.escavador_autos_card
  -- O id da nota única no Kommo. Nulo = ainda não criada (ou apagada no Kommo,
  -- e por recriar); 0 = o Kommo aceitou a nota sem devolver o id.
  add column if not exists nota_id    bigint,
  -- O último texto que subiu para a nota (assinado). Igual ao calculado = nada a editar.
  add column if not exists nota_texto text,
  -- Quando o card entrou no regime da nota única (a primeira leitura depois
  -- desta migração) e, depois, quando uma volta tomou a criação da nota.
  -- NULO = card lido antes: nenhuma nota nova.
  add column if not exists nota_em    timestamptz;

comment on column public.escavador_autos_card.nota_id is
  'Id da nota única dos autos no Kommo (editada no lugar pela escavador-autos-rotina). Nulo = por criar; 0 = criada sem id.';
comment on column public.escavador_autos_card.nota_texto is
  'Último texto enviado para a nota única dos autos; a rotina só edita a nota quando o texto calculado difere.';
comment on column public.escavador_autos_card.nota_em is
  'Marco do regime da nota única (primeira leitura após a 0078) e posse da criação. Nulo = card de antes: sem nota nova.';

notify pgrst, 'reload schema';

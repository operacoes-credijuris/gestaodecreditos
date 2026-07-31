-- Movimentações do ADVBOX: de janela de 20 dias para histórico integral.
--
-- A Edge Function advbox-movimentacoes sempre BAIXOU o histórico inteiro de
-- cada processo (GET /movements/{id} não tem parâmetro de data) — a janela era
-- aplicada só na gravação: filtrava o que entrava e podava o que envelhecia.
-- A partir de agora tudo é guardado. Motivos: a ficha de cada processo passa a
-- exibir as movimentações dele, e o resumo/próximos-passos por IA planejado
-- precisa do histórico completo, não dos últimos 20 dias.
--
-- numero_digits: o número do processo como o ADVBOX devolve varia de formato
-- (com/sem pontuação). A ficha precisa buscar "movimentações deste processo e
-- dos seus apensos" por igualdade, e normalizar dígitos em consulta PostgREST
-- não dá. A função grava a forma normalizada; o índice serve a consulta da
-- ficha. Linhas antigas ficam com null até a primeira sincronização após o
-- deploy — como a função refetch o histórico inteiro, uma execução preenche
-- tudo.
alter table public.advbox_movimentacoes
  add column if not exists numero_digits text;

create index if not exists advbox_mov_numero_digits_idx
  on public.advbox_movimentacoes (numero_digits);

comment on column public.advbox_movimentacoes.numero_digits is
  'numero_processo só com dígitos — chave de busca da ficha do processo.';
comment on table public.advbox_movimentacoes is
  'Histórico INTEGRAL de andamentos do ADVBOX (sem janela). A aba Movimentações filtra os últimos 20 dias na consulta.';

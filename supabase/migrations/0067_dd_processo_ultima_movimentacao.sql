-- 0067 — dd_processo.data_ultima_movimentacao: quando o processo andou pela última vez.
--
-- O DADO JÁ CHEGAVA E ERA JOGADO FORA. A busca por CPF/CNPJ do Escavador
-- (/envolvido/processos) devolve `data_ultima_movimentacao` em cada processo,
-- no mesmo pacote que já se paga — nenhuma consulta a mais, nenhum crédito a
-- mais. O tipo do nosso cliente até declarava o campo; ninguém o lia.
--
-- POR QUE ELE MUDA O JULGAMENTO. Hoje a diligência classifica o risco pelo
-- ESTÁGIO ("citação", "penhora", "baixado/arquivado"), e estágio não tem idade:
-- uma execução em penhora que andou semana passada e uma que está parada há três
-- anos chegam à tela com a mesma cara. É a data que separa a ameaça viva da
-- lembrança.
--
-- NÃO CONFUNDIR COM `data_ultima_verificacao`, que a mesma resposta traz: aquela
-- é quando o ROBÔ do Escavador olhou a fonte, e é sempre recente. Gravá-la aqui
-- faria todo processo morto parecer movimentado ontem.
--
-- DATE, E NÃO TIMESTAMP: a API devolve YYYY-MM-DD, sem hora. Guardar como
-- timestamp inventaria uma meia-noite que ninguém apurou.
alter table public.dd_processo
  add column if not exists data_ultima_movimentacao date;

comment on column public.dd_processo.data_ultima_movimentacao is
  'Data da última movimentação registrada no processo (campo data_ultima_movimentacao da busca do Escavador). NÃO é a data em que o Escavador verificou a fonte.';

notify pgrst, 'reload schema';

-- Migração 0050: marcação de "tratado" nas Movimentações recentes da aba
-- Fase Processual — mesma ideia de djen_publicacoes.tratada, mas escrita só
-- via service_role (Edge Function fase-processual, ação marcar_tratado), não
-- direto pelo cliente: processos_fase guarda a fase em si, e uma policy de
-- update aberta abriria brecha pra sobrescrever fase_codigo por fora da
-- function, sem passar pelo log de auditoria (processos_fase_mudancas).
--
-- tratado_movimentacao_data guarda A DATA da movimentação que estava sendo
-- exibida quando o usuário marcou — se uma movimentação MAIS NOVA chegar
-- depois, a comparação no front deixa de bater e o item volta a aparecer como
-- não tratado sozinho, sem precisar de nenhuma rotina de "limpar marcação".
alter table public.processos_fase
  add column if not exists tratado boolean not null default false,
  add column if not exists tratado_em timestamptz,
  add column if not exists tratado_movimentacao_data date;

comment on column public.processos_fase.tratado_movimentacao_data is
  'Data da movimentação que estava em exibição quando marcada como tratada. Uma movimentação mais nova que esta reabre o item automaticamente.';

notify pgrst, 'reload schema';

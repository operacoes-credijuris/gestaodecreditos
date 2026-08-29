-- Migração 0049: classificação automática de fase processual por crédito.
--
-- Separada, de propósito, de carteira_resumos (migração 0021): aquela tabela
-- guarda texto livre para o investidor (estágio/providências); esta guarda um
-- código de fase estruturado (taxonomia fixa, ver diagnostico-fases-processuais)
-- para alimentar a aba "Fase Processual" da tela de Créditos. Nem a chamada de
-- IA, nem a tabela, nem a UI se misturam entre as duas.
--
-- Um registro por crédito: retrato ATUAL, sem versionamento (histórico de
-- mudanças fica em processos_fase_mudancas, abaixo). A trilha (ativo/
-- complementar) não é coluna aqui — vem de processos.status, já existente.
create table if not exists public.processos_fase (
  processo_id                       uuid primary key
                                    references public.processos(id) on delete cascade,
  fase_codigo                       text not null,
  -- Só relevante na trilha complementar (instância do ciclo de complementação,
  -- pela data de protocolo da respectiva petição). Nulo na trilha ativo.
  ciclo_complementacao              int,
  data_entrada_fase                 date not null,
  movimentacao_ancora_data          date,
  movimentacao_ancora_texto         text,
  -- Preenchido só quando fase_codigo cai no "Outros" da trilha — preserva onde
  -- o crédito estava antes de cair no fallback, para não perder a posição real.
  fase_anterior_valida              text,
  -- Atributo cross-cutting, não posição na esteira (ver Concluso no
  -- documento): o crédito continua na fase substantiva e aparece também no
  -- filtro de conclusos.
  conclusao_pendente                boolean not null default false,
  conclusao_desde                   date,
  -- Âncora extraída pelo modelo (intimação lida da expedição da RPV). A partir
  -- dela o SERVIDOR calcula data_limite_pagamento — não é o modelo que soma os
  -- dias, mesmo princípio já usado na composição da mensagem de contato.
  data_intimacao_lida_expedicao_rpv date,
  data_limite_pagamento             date,
  -- Impressão digital dos insumos (mesmo padrão de carteira_resumos.fonte_hash):
  -- contagem total de andamentos do processo + ids da janela enviada ao modelo
  -- + status. Igual = sem novidade, pula a chamada.
  fonte_hash                        text,
  modelo                            text,
  erro                              text,
  classificado_em                   timestamptz not null default now()
);

alter table public.processos_fase enable row level security;

drop policy if exists "processos_fase_select" on public.processos_fase;
create policy "processos_fase_select" on public.processos_fase
  for select to authenticated using (true);

comment on table public.processos_fase is
  'Fase processual estruturada por crédito (taxonomia fixa Ativo/Complementar), gerada pela Edge Function fase-processual. Separada de carteira_resumos, que guarda texto livre.';
comment on column public.processos_fase.fonte_hash is
  'Impressão digital dos insumos; igual = nada mudou, não precisa reclassificar.';
comment on column public.processos_fase.data_limite_pagamento is
  'Calculada em código a partir de data_intimacao_lida_expedicao_rpv (hoje só regra padrão TJGO: +10 dias +60 dias corridos). Nula quando a âncora não foi encontrada nas movimentações.';

-- Log de mudanças de fase — auto (varredura diária) ou manual (override do
-- usuário na gaveta do crédito). Alimenta a seção "Movimentações recentes" da aba.
create table if not exists public.processos_fase_mudancas (
  id                        uuid primary key default gen_random_uuid(),
  processo_id               uuid not null references public.processos(id) on delete cascade,
  fase_anterior             text,
  fase_nova                 text not null,
  origem                    text not null check (origem in ('auto', 'manual')),
  movimentacao_ancora_data  date,
  movimentacao_ancora_texto text,
  usuario_id                uuid references public.profiles(id) on delete set null,
  criado_em                 timestamptz not null default now()
);
create index if not exists processos_fase_mudancas_criado_em_idx
  on public.processos_fase_mudancas (criado_em desc);

alter table public.processos_fase_mudancas enable row level security;

drop policy if exists "processos_fase_mudancas_select" on public.processos_fase_mudancas;
create policy "processos_fase_mudancas_select" on public.processos_fase_mudancas
  for select to authenticated using (true);

comment on table public.processos_fase_mudancas is
  'Histórico de transições de fase processual, automáticas ou manuais (override). Escrita só via service_role (Edge Function fase-processual), inclusive no override manual, para o log nunca ficar dessincronizado do estado atual em processos_fase.';

notify pgrst, 'reload schema';

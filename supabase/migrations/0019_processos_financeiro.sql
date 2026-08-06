-- Migração 0019: dados financeiros e tipo do crédito.
-- Alimentam a seção "Aquisição e liquidação" da ficha lateral da aba Créditos.
-- De propósito NÃO aparecem na tabela: ela continua enxuta, para escanear.
alter table public.processos
  add column if not exists tipo_credito                text[] not null default '{}',
  add column if not exists capital_investido           numeric,
  add column if not exists valor_face                  numeric,
  add column if not exists data_referencia             date,
  add column if not exists indice_atualizacao          text,
  add column if not exists ja_recebido                 numeric,
  add column if not exists data_recebimento_efetivo    date,
  add column if not exists valor_estimado_complementar numeric;

-- Um mesmo crédito pode acumular mais de um tipo (o principal e os honorários
-- vêm no mesmo processo), por isso é array e não um valor único. O check
-- garante que só entrem os três tipos previstos — array vazio = não informado.
alter table public.processos
  drop constraint if exists processos_tipo_credito_valido;
alter table public.processos
  add constraint processos_tipo_credito_valido check (
    tipo_credito <@ array[
      'principal','honorarios_contratuais','honorarios_advocaticios'
    ]::text[]
  );

alter table public.processos
  drop constraint if exists processos_indice_valido;
alter table public.processos
  add constraint processos_indice_valido check (
    indice_atualizacao is null or indice_atualizacao in ('selic','ipca_2')
  );

notify pgrst, 'reload schema';

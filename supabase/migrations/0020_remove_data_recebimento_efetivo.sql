-- Migração 0020: remove data_recebimento_efetivo.
-- Era redundante com data_liquidacao — as duas registravam a mesma coisa (quando
-- o crédito efetivamente entrou), então fica só data_liquidacao, que já existia
-- antes e é a usada na tabela e nos filtros.
alter table public.processos
  drop column if exists data_recebimento_efetivo;

notify pgrst, 'reload schema';

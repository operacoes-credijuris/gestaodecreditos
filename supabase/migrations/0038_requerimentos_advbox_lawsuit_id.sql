-- Migração 0038: vínculo do requerimento administrativo com o processo na ADVBOX.
--
-- Mesmo papel que a coluna homônima em `processos`: guarda o id do registro criado
-- na ADVBOX, e é ela que torna o cadastro IDEMPOTENTE. A chamada de cadastro
-- acontece a cada salvamento, e sem esta coluna cada salvamento consultaria a
-- ADVBOX de novo — ou, pior, criaria um segundo registro no sistema onde o
-- escritório trabalha.
--
-- Requerimento entra na ADVBOX por PROTOCOL_NUMBER, não por process_number: o
-- número é de protocolo do órgão, não um CNJ, e a ADVBOX valida process_number
-- contra as bases dos tribunais. Consequência conhecida e aceita: os robôs de
-- andamento se guiam pelo CNJ, então requerimento não ganha movimentação
-- automática — ganha lugar na ADVBOX, com tarefas, e passa a casar com a
-- sincronização, que já procura pelos dois campos.
alter table public.requerimentos
  add column if not exists advbox_lawsuit_id text;

comment on column public.requerimentos.advbox_lawsuit_id is
  'Id do registro correspondente na ADVBOX (criado por protocol_number). Nulo = ainda não cadastrado lá.';

-- Sem índice: a coluna é lida junto com o requerimento, uma linha por vez.

notify pgrst, 'reload schema';

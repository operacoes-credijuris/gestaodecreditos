-- Migração 0038: vínculo do requerimento administrativo com o processo na ADVBOX.
--
-- Mesmo papel que a coluna homônima em `processos`: guarda o id do registro criado
-- na ADVBOX, e é ela que torna o cadastro IDEMPOTENTE. A chamada de cadastro
-- acontece a cada salvamento, e sem esta coluna cada salvamento consultaria a
-- ADVBOX de novo — ou, pior, criaria um segundo registro no sistema onde o
-- escritório trabalha.
--
-- SÓ REQUERIMENTO COM NÚMERO CNJ ENTRA NA ADVBOX. O cadastro existe para que os
-- robôs dela busquem os andamentos nos tribunais, e eles se guiam pelo CNJ.
-- Requerimento com apenas protocolo do órgão poderia ser cadastrado no campo livre
-- protocol_number, mas não traria movimentação nenhuma — seria registro a mais na
-- lista do escritório, sem nada em troca.
--
-- Como requerimento administrativo GANHA o CNJ quando é distribuído, o cadastro é
-- tentado também na EDIÇÃO, e não só na criação: é no dia em que o número aparece
-- que ele passa a valer a pena. Esta coluna é o que impede isso de criar um segundo
-- registro a cada salvamento seguinte.
alter table public.requerimentos
  add column if not exists advbox_lawsuit_id text;

comment on column public.requerimentos.advbox_lawsuit_id is
  'Id do registro correspondente na ADVBOX. Só é preenchido quando o requerimento tem número CNJ (é por ele que a ADVBOX busca andamentos). Nulo = ainda não cadastrado lá.';

-- Sem índice: a coluna é lida junto com o requerimento, uma linha por vez.

notify pgrst, 'reload schema';

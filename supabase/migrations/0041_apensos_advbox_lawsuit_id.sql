-- Migração 0041: vínculo do apenso com o processo na ADVBOX.
--
-- Mesmo papel das colunas homônimas em `processos` (0001) e `requerimentos` (0038):
-- guarda o id do registro criado na ADVBOX e é ela que torna o cadastro
-- IDEMPOTENTE. A chamada acontece a cada salvamento; sem esta coluna, cada
-- salvamento consultaria a ADVBOX de novo — ou criaria um segundo registro no
-- sistema onde o escritório trabalha.
--
-- POR QUE APENSO PRECISA DISSO: agravo, embargo e incidente têm CNJ PRÓPRIO e
-- andamento próprio. A sincronização de movimentações já procura pelos números dos
-- apensos (numerosCadastrados lê processos, requerimentos E apensos), mas só encontra
-- o que existe na ADVBOX — e apenso nunca era cadastrado lá. Ou seja: a plataforma
-- estava preparada para trazer o andamento do apenso e não trazia, porque a outra
-- ponta faltava.
alter table public.apensos
  add column if not exists advbox_lawsuit_id text;

comment on column public.apensos.advbox_lawsuit_id is
  'Id do registro correspondente na ADVBOX. Nulo = ainda não cadastrado lá.';

-- Sem índice: lida junto com o apenso, uma linha por vez.

notify pgrst, 'reload schema';

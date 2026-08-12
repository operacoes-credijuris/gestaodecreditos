-- Migração 0039: partes do requerimento administrativo — requerente e requerido.
--
-- O requerimento não guardava QUEM pede nem CONTRA QUEM. A informação existia só na
-- cabeça de quem cadastrou, ou espalhada em observações, e a listagem mostrava um
-- número de protocolo sem dizer de quem é — enquanto a tabela de Créditos identifica
-- cada linha por "cedente v. cessionário".
--
-- Texto livre, como cedente e cessionário em `processos`, e pela mesma razão: as
-- partes de um requerimento administrativo não estão cadastradas em lugar nenhum da
-- plataforma, e criar tabela de partes agora obrigaria a cadastrar entidade antes de
-- registrar o requerimento — emperrando o começo do fluxo para ganhar normalização
-- que ninguém pediu.
--
-- Nullable: requerimento antigo não tem essas partes preenchidas, e inventá-las
-- seria pior que deixar em branco.
alter table public.requerimentos
  add column if not exists requerente text;

alter table public.requerimentos
  add column if not exists requerido text;

comment on column public.requerimentos.requerente is
  'Quem apresenta o requerimento. Texto livre, como cedente em processos.';
comment on column public.requerimentos.requerido is
  'Contra quem o requerimento é apresentado (ente, órgão ou entidade).';

-- Sem índice: são lidas junto com o requerimento e a busca da tela filtra em
-- memória sobre as linhas já carregadas.

notify pgrst, 'reload schema';

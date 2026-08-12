-- Migração 0037: número do processo administrativo do precatório.
--
-- Precatório tramita em DOIS lugares, com DOIS números. O processo judicial é onde
-- a dívida foi reconhecida; depois de expedido, o requisitório ganha um processo
-- ADMINISTRATIVO no tribunal, com número próprio, e é por esse número que o
-- precatório é acompanhado na fila de pagamento do ente devedor. Sem o campo, esse
-- número ficava fora da plataforma ou era escrito por dentro de outro campo.
--
-- Coluna de texto, e não numérica: o formato varia por tribunal (aparece com ano,
-- com barra, com dígito verificador), e normalizar aqui seria decidir por um
-- formato que não é o de todos.
--
-- Sem NOT NULL e sem default: só precatório tem esse número, e a carteira é
-- majoritariamente RPV. Nulo aqui significa "não se aplica" ou "ainda não
-- localizado" -- os dois casos legítimos, nenhum deles um valor a inventar.
alter table public.processos
  add column if not exists numero_processo_administrativo text;

comment on column public.processos.numero_processo_administrativo is
  'Número do processo administrativo do precatório no tribunal, quando houver. Só se aplica a especie_requisitorio = precatorio; nulo em RPV.';

-- Sem check constraint amarrando à espécie: o cadastro preenche a espécie e o
-- número em telas e momentos diferentes (a espécie pode vir da pasta do Drive e o
-- número, de um documento lido depois), e um check aqui rejeitaria o UPDATE
-- intermediário com erro de banco no meio do preenchimento. Quem controla a
-- coerência é a tela, que só mostra o campo em precatório.

-- Sem índice: a coluna é lida junto com o crédito, e a busca da tela filtra em
-- memória sobre as ~95 linhas já carregadas.

notify pgrst, 'reload schema';

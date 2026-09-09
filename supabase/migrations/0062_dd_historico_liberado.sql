-- Migração 0062: "li a diligência e ela não impede a cessão".
--
-- O QUE FALTAVA DIZER. A apuração de processos responde "que dívida existe em
-- nome desta pessoa", e o motor de RPV transforma isso nas linhas 10 e 11 do
-- questionário — "Histórico do cedente: tem dívida?", "Histórico do advogado:
-- tem dívida?". Um cedente com execução no polo passivo vira "Sim" ali, por
-- construção e do lado conservador.
--
-- Mas quem opera lê a lista e frequentemente conclui o contrário: a execução é
-- de mil e seiscentos reais, está em juizado, o crédito é de trinta mil e não há
-- constrição nenhuma. "Sim, tem dívida" numa planilha que vai ao investidor, sem
-- que ninguém tenha discordado, transforma um julgamento humano em omissão.
--
-- ESTA COLUNA É ESSE JULGAMENTO. Ao clicar em "Seguir" na janela de due
-- diligence, a pessoa declara que leu os processos e que eles não prejudicam a
-- cessão; as duas linhas voltam a responder "Não".
--
-- O QUE ELA NÃO FAZ: apagar o que a apuração achou. A coluna D da planilha
-- continua listando os processos, com a marca de que a resposta "Não" foi
-- decisão de quem revisou — é a mesma regra que já valia para a linha travada
-- pelo chat (ver aplicarDiligenciaNoM2 em _shared/dueDiligencia.ts). Esconder a
-- apuração seria pior do que não tê-la feito: quem lê depois acharia que nada
-- consta.

alter table public.dd_historico
  add column if not exists liberado_em  timestamptz,
  add column if not exists liberado_por uuid references public.profiles (id) on delete set null;

comment on column public.dd_historico.liberado_em is
  'Quando alguém leu a apuração e declarou que ela não impede a cessão. '
  'Faz a linha 10/11 do questionário responder "Não" mesmo com processo achado — '
  'a coluna D continua listando os processos, com a marca do conflito.';

-- LIBERADO SEM APURAÇÃO NÃO QUER DIZER NADA. Só se libera o que foi olhado, e
-- olhar exige que a busca tenha corrido: sem o check, um UPDATE no SQL Editor
-- marcaria como conferida uma diligência que nunca aconteceu, e a planilha
-- imprimiria "Não" com a autoridade de quem revisou.
alter table public.dd_historico
  drop constraint if exists dd_historico_liberado_exige_apurado;
alter table public.dd_historico
  add constraint dd_historico_liberado_exige_apurado
  check (liberado_em is null or status = 'APURADO');

notify pgrst, 'reload schema';

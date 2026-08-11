-- Migração 0032: espécie do requisitório — RPV ou precatório.
--
-- Serve a dois propósitos. O primeiro é de negócio: precatório é produto que a
-- Credijuris está começando a operar agora, e sem o campo não há como separar a
-- carteira por espécie nem medir o que é um e o que é o outro.
--
-- O segundo é operacional: é ELE que decide em qual pasta do Drive a petição
-- gerada vai ser salva. A pasta de petições fica em
-- "Precatórios" ou "Requisições de Pequeno Valor", e o caminho continua por
-- originador e por crédito. Sem a espécie, a plataforma não sabe por onde começar.
--
-- Sem NOT NULL nem default: os 95 créditos já cadastrados nascem sem espécie, e
-- "não informado" é ausência de valor, não um palpite. Quem for gerar petição de um
-- crédito sem espécie será avisado a preencher — melhor isso que a plataforma
-- adivinhar RPV e salvar a peça na pasta errada.
alter table public.processos
  add column if not exists especie_requisitorio text;

-- Só as duas espécies que existem. Valor inventado não apareceria em nenhum filtro
-- e viraria dado invisível — o mesmo cuidado das migrações 0019 e 0027.
alter table public.processos
  drop constraint if exists processos_especie_requisitorio_valida;
alter table public.processos
  add constraint processos_especie_requisitorio_valida check (
    especie_requisitorio is null
    or especie_requisitorio in ('rpv', 'precatorio')
  );

comment on column public.processos.especie_requisitorio is
  'rpv | precatorio. Decide a pasta de topo no Drive onde a petição gerada é salva.';

-- Índice não entra: a coluna é lida junto com o crédito, e a tabela tem 95 linhas.

notify pgrst, 'reload schema';

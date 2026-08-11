-- Migração 0033: cache do ID da pasta do crédito no Drive.
--
-- NÃO É INFORMAÇÃO, É ATALHO. Nunca aparece em tela: não entra na tabela de
-- Créditos, nem no formulário, nem na ficha lateral. Um id do Google não diz nada a
-- quem usa a plataforma, e a tela já mostra muita coisa — poluí-la com um dado que
-- ninguém lê seria custo sem retorno.
--
-- PARA QUE SERVE: achar a pasta de um crédito no Drive custa três chamadas em
-- sequência (listar as pastas da espécie, as do originador, as do crédito), o que dá
-- algumas centenas de milissegundos e pode pedir autorização do Google. Isso é
-- aceitável num botão que diz "Gerar petição"; é ruim no número do processo, que
-- parece link e por isso cria expectativa de resposta imediata.
--
-- Então a primeira resolução — venha da geração de petição ou do primeiro clique no
-- número — guarda o id aqui. Dali em diante o número é link direto: instantâneo, sem
-- chamada ao Drive e sem chance de falhar.
--
-- Anulável de propósito: os 95 créditos existentes nascem sem pasta resolvida, e o
-- número do processo simplesmente não vira link até a primeira resolução.
alter table public.processos
  add column if not exists drive_pasta_id text;

comment on column public.processos.drive_pasta_id is
  'Cache do id da pasta do crédito no Drive. Uso interno: torna o número do processo um link direto. Não exibir em tela.';

notify pgrst, 'reload schema';

-- 0070 — Integração BullAI: a plataforma que EMITE as certidões.
--
-- O QUE MUDA. Até aqui a aba Certidões da due diligence montava o checklist —
-- quais certidões, de quem, em que estado e município, pelas regras da casa
-- (migração 0042) — e parava ali: a emissão era trabalho manual, portal por
-- portal, com CAPTCHA e login gov.br. A casa contratou a BullAI, que faz a
-- emissão: recebe um CPF ou CNPJ e a lista de portais, e devolve os PDFs — e,
-- de quebra, o RESULTADO de cada certidão (positiva, negativa, nada consta),
-- que a plataforma nunca teve como registrar.
--
-- ESTA MIGRAÇÃO É SÓ A CHAVE. O que se pede e o que volta vêm na próxima.

-- A BullAI entra na lista de serviços que a tela de Configurações mostra.
alter table public.integracoes drop constraint if exists integracoes_servico_check;
alter table public.integracoes add constraint integracoes_servico_check
  check (servico in ('advbox', 'djen', 'kommo', 'anthropic', 'escavador', 'bullai'));

-- A chave da API. Mesmo padrão de todas as outras: RLS ligada e NENHUMA policy,
-- ou seja, inacessível ao cliente por construção — só a service_role das Edge
-- Functions lê. E não como VITE_*: variável de ambiente do front vai assada no
-- bundle público, e cada portal pedido gasta uma consulta do plano.
create table if not exists public.integracao_bullai_secret (
  id             int primary key default 1 check (id = 1),
  token          text,
  atualizado_em  timestamptz not null default now(),
  atualizado_por uuid
);

alter table public.integracao_bullai_secret enable row level security;

notify pgrst, 'reload schema';

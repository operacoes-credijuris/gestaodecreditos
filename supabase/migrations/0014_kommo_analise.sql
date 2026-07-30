-- Integração com o Kommo (CRM em kanban) para a aba Análise de Crédito.
--
-- O comercial cria o card no funil do Kommo com os dados básicos do crédito; o
-- operacional analisa e devolve movendo o card. Esta migration cria o espelho
-- local dos cards (para a UI não depender da API do Kommo, que tem teto de 7
-- req/s), o estado interno que só nós conhecemos, e liga o resultado da análise
-- ao card de origem.
--
-- Funis que o operacional usa (ids da conta contatocredijuriscom):
--   Funil Geral RPV        13901939
--   Funil Geral Precatório 13971995  (fase 2)

-- ----------- 1. Credenciais -----------

-- 'kommo' passa a ser um serviço válido de integração.
-- O check original foi declarado inline na coluna, então o nome dele é gerado
-- pelo Postgres. Em vez de supor o nome, descobre e derruba qualquer check da
-- tabela que mencione "servico" — um `drop constraint if exists` com nome
-- errado passaria calado e o insert de 'kommo' quebraria só em produção.
do $$
declare c record;
begin
  for c in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'integracoes'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%servico%'
  loop
    execute format('alter table public.integracoes drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.integracoes add constraint integracoes_servico_check
  check (servico in ('advbox', 'djen', 'kommo'));

-- Token de longa duração do Kommo. Mesmo padrão do ADVBOX: sem policies, ou
-- seja, inacessível ao cliente — só a service_role das Edge Functions lê.
-- O subdomínio fica aqui junto porque a API do Kommo resolve a conta pelo host
-- (https://<subdominio>.kommo.com); o token sozinho não identifica a conta.
create table if not exists public.integracao_kommo_secret (
  id             int primary key default 1 check (id = 1),
  token          text,
  subdominio     text,
  atualizado_em  timestamptz not null default now(),
  atualizado_por uuid
);

-- ----------- 2. Espelho dos cards -----------

-- Cache dos cards do Kommo, mantido pela Edge Function kommo-sync. A UI lê
-- daqui, nunca da API do Kommo.
create table if not exists public.kommo_leads (
  kommo_lead_id    bigint primary key,   -- id do lead no Kommo
  pipeline_id      bigint not null,      -- funil
  status_id        bigint not null,       -- coluna (estágio) — define a tela
  nome             text,                  -- título do card
  responsavel_id   bigint,                -- responsible_user_id no Kommo
  responsavel_nome text,
  -- Nota 'common' do card: é onde o comercial escreve os dados do crédito, em
  -- texto livre (a conta não tem campos personalizados). Guardada crua de
  -- propósito — o formato varia entre cards e um parser adivinharia.
  nota_texto       text,
  -- Único dado extraído do texto: o CNJ tem formato rígido, então o regex é
  -- seguro. Serve para casar o card com public.processos.
  processo_cnj     text,
  tags             text[] not null default '{}',
  criado_em        timestamptz,           -- created_at do Kommo
  atualizado_em    timestamptz,           -- updated_at do Kommo
  raw              jsonb not null default '{}'::jsonb,
  sincronizado_em  timestamptz not null default now()
);

create index if not exists kommo_leads_status_idx
  on public.kommo_leads (pipeline_id, status_id);
create index if not exists kommo_leads_cnj_idx
  on public.kommo_leads (processo_cnj);

-- ----------- 3. Estado interno do operacional -----------

-- A tela de Revisão não corresponde a nenhuma coluna do Kommo: é controle
-- interno. Fica em tabela separada de kommo_leads justamente para o sync poder
-- substituir o espelho inteiro sem risco de apagar estado nosso no meio.
--
-- status_id_quando_marcado registra em que coluna o card estava quando foi
-- marcado. Se o card sair dessa coluna (alguém moveu direto no Kommo), a
-- marcação perde validade e a UI a ignora — é o que evita dessincronia.
create table if not exists public.kommo_analise_interna (
  kommo_lead_id            bigint primary key,
  etapa_interna            text not null default 'em_revisao'
                           check (etapa_interna in ('em_revisao')),
  status_id_quando_marcado bigint not null,
  marcado_por              uuid references public.profiles (id) on delete set null,
  marcado_em               timestamptz not null default now()
);

-- ----------- 4. Resultado da análise ligado ao card -----------

-- analises_credito já existia como cadastro manual solto. Passa a ser o
-- resultado da análise de um card do Kommo: o card é o insumo (processo,
-- tribunal, cedente), estas colunas são o parecer (valores, risco).
-- Sem foreign key para kommo_leads de propósito: o espelho é descartável (o
-- sync pode remover a linha se o card sair do funil ou for apagado no Kommo) e
-- um FK faria isso bloquear o sync ou apagar em cascata o parecer que o
-- operacional produziu. O parecer sobrevive ao card.
alter table public.analises_credito
  add column if not exists kommo_lead_id bigint;

-- Um card tem no máximo uma análise. Índice parcial para não conflitar com as
-- linhas antigas, sem vínculo, que ficam com kommo_lead_id nulo.
create unique index if not exists analises_credito_kommo_lead_idx
  on public.analises_credito (kommo_lead_id)
  where kommo_lead_id is not null;

-- ----------- 5. RLS -----------

alter table public.integracao_kommo_secret enable row level security;
alter table public.kommo_leads             enable row level security;
alter table public.kommo_analise_interna   enable row level security;

-- integracao_kommo_secret: nenhuma policy de propósito (só service_role).

-- Espelho: qualquer autenticado lê; escrita só pela Edge Function (service_role).
drop policy if exists "kommo_leads_select" on public.kommo_leads;
create policy "kommo_leads_select" on public.kommo_leads
  for select to authenticated using (true);

-- Estado interno: a UI escreve direto (marcar/desmarcar análise concluída não
-- toca o Kommo, é decisão nossa).
drop policy if exists "kommo_interna_all" on public.kommo_analise_interna;
create policy "kommo_interna_all" on public.kommo_analise_interna
  for all to authenticated using (true) with check (true);

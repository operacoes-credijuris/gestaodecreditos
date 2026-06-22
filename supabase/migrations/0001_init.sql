-- ============================================================
-- Credijuris — Sistema de Gestão de Cessões de Créditos
-- Migração inicial: tabelas, RLS, triggers, storage.
-- Acesso: todo usuário autenticado vê/edita os dados de negócio.
-- Gestão de usuários e integrações: somente administrador.
-- ============================================================

-- ----------- Helpers -----------

-- Atualiza updated_at automaticamente.
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ----------- Tabelas -----------

create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null,
  nome        text,
  role        text not null default 'usuario' check (role in ('admin','usuario')),
  ativo       boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Verifica se o usuário atual é administrador (SECURITY DEFINER evita
-- recursão de RLS ao ler a tabela profiles). Definida após a tabela profiles
-- pois funções SQL têm o corpo validado na criação.
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select
    coalesce((auth.jwt() ->> 'email') = 'operacoes@credijuris.com', false)
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    );
$$;

create table if not exists public.analises_credito (
  id              uuid primary key default gen_random_uuid(),
  numero_processo text,
  cedente         text,
  devedor         text,
  tribunal        text,
  valor_face      numeric,
  valor_avaliado  numeric,
  risco           text check (risco in ('baixo','medio','alto')),
  status          text not null default 'pendente'
                  check (status in ('pendente','em_analise','aprovada','reprovada')),
  observacoes     text,
  responsavel_id  uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists public.processos (
  id                uuid primary key default gen_random_uuid(),
  numero_cnj        text not null,
  tribunal          text,
  vara              text,
  comarca           text,
  classe            text,
  assunto           text,
  parte_autora      text,
  parte_re          text,
  fase              text,
  valor_causa       numeric,
  status            text not null default 'ativo'
                    check (status in ('ativo','suspenso','arquivado','baixado','encerrado')),
  advbox_lawsuit_id text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table if not exists public.publicacoes (
  id               uuid primary key default gen_random_uuid(),
  processo_id      uuid references public.processos (id) on delete set null,
  numero_processo  text,
  fonte            text not null default 'manual'
                   check (fonte in ('djen','advbox','manual')),
  tipo             text not null default 'publicacao'
                   check (tipo in ('publicacao','movimentacao')),
  tribunal         text,
  data_publicacao  date,
  conteudo         text,
  lida             boolean not null default false,
  tratada          boolean not null default false,
  responsavel_id   uuid references public.profiles (id) on delete set null,
  external_id      text,
  created_at       timestamptz not null default now()
);
-- Evita duplicar registros vindos das integrações (dedup por fonte+external_id).
create unique index if not exists publicacoes_fonte_external_uidx
  on public.publicacoes (fonte, external_id)
  where external_id is not null;

create table if not exists public.tarefas (
  id              uuid primary key default gen_random_uuid(),
  advbox_id       text,
  processo_id     uuid references public.processos (id) on delete set null,
  titulo          text not null,
  descricao       text,
  responsavel     text,
  prazo           date,
  status          text not null default 'pendente'
                  check (status in ('pendente','em_andamento','concluida','atrasada')),
  prioridade      text not null default 'media'
                  check (prioridade in ('baixa','media','alta')),
  sincronizado_em timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index if not exists tarefas_advbox_uidx
  on public.tarefas (advbox_id) where advbox_id is not null;

create table if not exists public.contatos_serventias (
  id                  uuid primary key default gen_random_uuid(),
  tipo                text not null default 'serventia'
                      check (tipo in ('serventia','gabinete','cartorio','vara','outro')),
  nome                text not null,
  tribunal            text,
  comarca             text,
  telefone            text,
  email               text,
  horario_atendimento text,
  observacoes         text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table if not exists public.investidores (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null,
  documento   text,
  email       text,
  telefone    text,
  tipo        text not null default 'pf' check (tipo in ('pf','pj')),
  status      text not null default 'ativo' check (status in ('ativo','inativo')),
  observacoes text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.cessoes (
  id              uuid primary key default gen_random_uuid(),
  codigo          text not null,
  processo_id     uuid references public.processos (id) on delete set null,
  analise_id      uuid references public.analises_credito (id) on delete set null,
  descricao       text,
  valor_face      numeric,
  valor_aquisicao numeric,
  valor_cessao    numeric,
  desagio         numeric,
  data_cessao     date,
  status          text not null default 'disponivel'
                  check (status in ('disponivel','parcial','captado','liquidado')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists public.investimentos (
  id                     uuid primary key default gen_random_uuid(),
  investidor_id          uuid not null references public.investidores (id) on delete cascade,
  cessao_id              uuid references public.cessoes (id) on delete set null,
  valor_investido        numeric not null default 0,
  percentual             numeric,
  rentabilidade_esperada numeric,
  data_investimento      date,
  status                 text not null default 'ativo'
                         check (status in ('ativo','liquidado','cancelado')),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create table if not exists public.contrato_templates (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null,
  tipo       text not null default 'cessao' check (tipo in ('cessao','investimento','outro')),
  conteudo   text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.contratos (
  id             uuid primary key default gen_random_uuid(),
  numero         text,
  tipo           text not null default 'cessao' check (tipo in ('cessao','investimento','outro')),
  investidor_id  uuid references public.investidores (id) on delete set null,
  cessao_id      uuid references public.cessoes (id) on delete set null,
  template_id    uuid references public.contrato_templates (id) on delete set null,
  dados          jsonb not null default '{}'::jsonb,
  conteudo_final text,
  status         text not null default 'rascunho'
                 check (status in ('rascunho','gerado','assinado','cancelado')),
  arquivo_url    text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Configurações não secretas das integrações (legível por usuários).
create table if not exists public.integracoes (
  id             uuid primary key default gen_random_uuid(),
  servico        text not null unique check (servico in ('advbox','djen')),
  config         jsonb not null default '{}'::jsonb,
  ativo          boolean not null default false,
  atualizado_em  timestamptz not null default now(),
  atualizado_por uuid references public.profiles (id) on delete set null
);

-- Token secreto do ADVBOX. NUNCA exposto ao cliente (sem policies =
-- acesso negado; apenas service_role, usada pelas Edge Functions).
create table if not exists public.integracao_advbox_secret (
  id             int primary key default 1 check (id = 1),
  token          text,
  atualizado_em  timestamptz not null default now(),
  atualizado_por uuid
);

-- ----------- Triggers de updated_at -----------
do $$
declare t text;
begin
  foreach t in array array[
    'analises_credito','processos','tarefas','contatos_serventias',
    'investidores','cessoes','investimentos','contrato_templates','contratos'
  ] loop
    execute format(
      'drop trigger if exists set_updated_at on public.%I;
       create trigger set_updated_at before update on public.%I
       for each row execute function public.set_updated_at();', t, t);
  end loop;
end $$;

-- ----------- Trigger de criação de profile -----------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, nome, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'nome', ''),
    case when new.email = 'operacoes@credijuris.com' then 'admin' else 'usuario' end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill: cria/ajusta profiles para usuários já existentes.
insert into public.profiles (id, email, nome, role, ativo)
select
  u.id,
  u.email,
  coalesce(u.raw_user_meta_data ->> 'nome', ''),
  case when u.email = 'operacoes@credijuris.com' then 'admin' else 'usuario' end,
  true
from auth.users u
on conflict (id) do update
  set role = excluded.role,
      email = excluded.email;

-- ----------- RLS -----------
alter table public.profiles                  enable row level security;
alter table public.analises_credito          enable row level security;
alter table public.processos                 enable row level security;
alter table public.publicacoes               enable row level security;
alter table public.tarefas                   enable row level security;
alter table public.contatos_serventias       enable row level security;
alter table public.investidores              enable row level security;
alter table public.cessoes                   enable row level security;
alter table public.investimentos             enable row level security;
alter table public.contrato_templates        enable row level security;
alter table public.contratos                 enable row level security;
alter table public.integracoes               enable row level security;
alter table public.integracao_advbox_secret  enable row level security;

-- Tabelas de negócio: qualquer autenticado faz tudo.
do $$
declare t text;
begin
  foreach t in array array[
    'analises_credito','processos','publicacoes','tarefas','contatos_serventias',
    'investidores','cessoes','investimentos','contrato_templates','contratos'
  ] loop
    execute format('drop policy if exists "auth_all" on public.%I;', t);
    execute format(
      'create policy "auth_all" on public.%I
         for all to authenticated using (true) with check (true);', t);
  end loop;
end $$;

-- profiles: todos leem; usuário edita o próprio; admin gerencia todos.
drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles
  for select to authenticated using (true);

drop policy if exists "profiles_update" on public.profiles;
create policy "profiles_update" on public.profiles
  for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

drop policy if exists "profiles_insert" on public.profiles;
create policy "profiles_insert" on public.profiles
  for insert to authenticated with check (public.is_admin());

drop policy if exists "profiles_delete" on public.profiles;
create policy "profiles_delete" on public.profiles
  for delete to authenticated using (public.is_admin());

-- integracoes (config não secreta): leitura por todos; escrita só admin.
drop policy if exists "integracoes_select" on public.integracoes;
create policy "integracoes_select" on public.integracoes
  for select to authenticated using (true);

drop policy if exists "integracoes_write" on public.integracoes;
create policy "integracoes_write" on public.integracoes
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- integracao_advbox_secret: sem policies => sem acesso via anon/authenticated.
-- Apenas service_role (Edge Functions) acessa, pois ela ignora RLS.

-- ----------- Seeds das integrações -----------
insert into public.integracoes (servico, config, ativo)
values
  ('advbox', '{"base_url":"https://app.advbox.com.br/api/v1","configurado":false}'::jsonb, false),
  ('djen',   '{"oabs":[],"numeros_processo":[],"tribunais":[],"dias_retroativos":7}'::jsonb, false)
on conflict (servico) do nothing;

insert into public.integracao_advbox_secret (id, token)
values (1, null) on conflict (id) do nothing;

-- ----------- Storage: bucket de contratos -----------
insert into storage.buckets (id, name, public)
values ('contratos', 'contratos', false)
on conflict (id) do nothing;

drop policy if exists "contratos_read" on storage.objects;
create policy "contratos_read" on storage.objects
  for select to authenticated using (bucket_id = 'contratos');

drop policy if exists "contratos_write" on storage.objects;
create policy "contratos_write" on storage.objects
  for insert to authenticated with check (bucket_id = 'contratos');

drop policy if exists "contratos_update" on storage.objects;
create policy "contratos_update" on storage.objects
  for update to authenticated using (bucket_id = 'contratos');

drop policy if exists "contratos_delete" on storage.objects;
create policy "contratos_delete" on storage.objects
  for delete to authenticated using (bucket_id = 'contratos');

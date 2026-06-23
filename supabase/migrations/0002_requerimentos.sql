-- Migração 0002: Requerimentos administrativos.
-- Cadastro dos requerimentos administrativos da Credijuris.
-- Segue o mesmo padrão das demais tabelas de negócio (RLS aberta a
-- autenticados + trigger de updated_at). Idempotente.

create table if not exists public.requerimentos (
  id                uuid primary key default gen_random_uuid(),
  assunto           text not null,
  orgao             text,
  numero_protocolo  text,
  data_protocolo    date,
  status            text not null default 'pendente'
                    check (status in ('pendente','protocolado','em_analise','deferido','indeferido')),
  observacoes       text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- updated_at automático (reutiliza a função criada na migração 0001).
drop trigger if exists set_updated_at on public.requerimentos;
create trigger set_updated_at before update on public.requerimentos
  for each row execute function public.set_updated_at();

-- RLS: qualquer usuário autenticado faz tudo (mesmo padrão das outras tabelas).
alter table public.requerimentos enable row level security;
drop policy if exists "auth_all" on public.requerimentos;
create policy "auth_all" on public.requerimentos
  for all to authenticated using (true) with check (true);

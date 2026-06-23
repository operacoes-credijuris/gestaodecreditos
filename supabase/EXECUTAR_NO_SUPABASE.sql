-- ============================================================
-- SCRIPT CONSOLIDADO — rodar 1x no SQL Editor do Supabase.
-- Junta as atualizacoes 0002 (Requerimentos) e 0003 (Contatos).
-- E seguro rodar mais de uma vez (idempotente).
-- ============================================================

-- Funcao auxiliar usada pelos triggers (recriada por seguranca).
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ------------------------------------------------------------
-- 1) REQUERIMENTOS (nova tabela)
-- ------------------------------------------------------------
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

drop trigger if exists set_updated_at on public.requerimentos;
create trigger set_updated_at before update on public.requerimentos
  for each row execute function public.set_updated_at();

alter table public.requerimentos enable row level security;
drop policy if exists "auth_all" on public.requerimentos;
create policy "auth_all" on public.requerimentos
  for all to authenticated using (true) with check (true);

-- ------------------------------------------------------------
-- 2) CONTATOS POR ORGAO (serventia + gabinete)
-- ------------------------------------------------------------
alter table public.contatos_serventias
  add column if not exists orgao              text,
  add column if not exists serventia_telefone text,
  add column if not exists serventia_email    text,
  add column if not exists gabinete_telefone  text,
  add column if not exists gabinete_email     text;

-- 'nome' deixa de ser obrigatorio (o identificador agora e o 'orgao').
alter table public.contatos_serventias alter column nome drop not null;

-- Backfill do orgao a partir do antigo 'nome' (quando ainda vazio).
update public.contatos_serventias
  set orgao = nome
  where (orgao is null or btrim(orgao) = '') and nome is not null;

-- Best-effort: move telefone/e-mail antigos para serventia ou gabinete.
update public.contatos_serventias
  set gabinete_telefone = coalesce(gabinete_telefone, telefone),
      gabinete_email    = coalesce(gabinete_email, email)
  where tipo = 'gabinete';

update public.contatos_serventias
  set serventia_telefone = coalesce(serventia_telefone, telefone),
      serventia_email    = coalesce(serventia_email, email)
  where tipo is distinct from 'gabinete';

-- ============================================================
-- FIM. Se rodou sem erro, as paginas Requerimentos e Contatos
-- ja funcionam no sistema.
-- ============================================================

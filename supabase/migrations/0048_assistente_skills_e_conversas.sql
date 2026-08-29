-- Três extensões do assistente ("Clips"): Skills da Anthropic, ação com
-- confirmação (gerar petição) e histórico de conversas por usuário.
--
-- Nenhuma das três abre caminho de escrita nos dados do sistema: Skills geram
-- arquivo avulso (guardado à parte, num bucket próprio); a ação de gerar
-- petição só propõe — quem executa é a pessoa, na tela de revisão de sempre;
-- o histórico é conversa do próprio usuário, isolada por RLS.

-- ============================================================
-- 1. Skills cadastradas (metadado local; o pacote em si vive na Anthropic)
-- ============================================================

create table if not exists public.assistente_skills (
  id             uuid primary key default gen_random_uuid(),
  skill_id       text not null unique,   -- id devolvido pela Anthropic (skill_01...)
  nome           text not null,
  descricao      text,
  ativo          boolean not null default true,
  criado_por     uuid references public.profiles (id) on delete set null,
  criado_em      timestamptz not null default now()
);

alter table public.assistente_skills enable row level security;

-- Leitura para todo autenticado: é configuração (quais skills existem), não
-- segredo — o pacote da skill em si fica só na Anthropic. Escrita só pela
-- Edge Function assistente-skills, que valida admin e usa a service_role.
drop policy if exists "assistente_skills_select" on public.assistente_skills;
create policy "assistente_skills_select" on public.assistente_skills
  for select to authenticated using (true);

-- ============================================================
-- 2. Histórico de conversas, por usuário
-- ============================================================

create table if not exists public.assistente_conversas (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles (id) on delete cascade,
  titulo         text not null,
  mensagens      jsonb not null default '[]'::jsonb,
  modelo         text,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);

create index if not exists assistente_conversas_user_idx
  on public.assistente_conversas (user_id, atualizado_em desc);

alter table public.assistente_conversas enable row level security;

-- Cada um só vê e mexe nas próprias conversas.
drop policy if exists "assistente_conversas_dono" on public.assistente_conversas;
create policy "assistente_conversas_dono" on public.assistente_conversas
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Mantém só as 10 conversas mais recentes de cada usuário. Fica no banco, e
-- não na tela, pelo mesmo motivo da trava de completude da due diligence
-- (migração 0042): se a regra vivesse só no TypeScript, um upsert feito por
-- outro caminho (script, SQL Editor) furaria o limite sem ninguém perceber.
create or replace function public.assistente_conversas_aparar()
returns trigger language plpgsql as $$
begin
  delete from public.assistente_conversas
  where user_id = new.user_id
    and id not in (
      select id from public.assistente_conversas
      where user_id = new.user_id
      order by atualizado_em desc
      limit 10
    );
  return null;
end $$;

drop trigger if exists assistente_conversas_aparar_trg on public.assistente_conversas;
create trigger assistente_conversas_aparar_trg
  after insert or update on public.assistente_conversas
  for each row execute function public.assistente_conversas_aparar();

-- ============================================================
-- 3. Bucket privado para arquivos gerados por Skills
-- ============================================================

insert into storage.buckets (id, name, public)
values ('assistente-arquivos', 'assistente-arquivos', false)
on conflict (id) do nothing;

-- Caminho do objeto é "{user_id}/...": cada um só lê os arquivos que o
-- assistente gerou PARA ELE. A gravação é só pela Edge Function
-- (service_role), que não passa por RLS — por isso não há policy de insert.
drop policy if exists "assistente_arquivos_dono" on storage.objects;
create policy "assistente_arquivos_dono" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'assistente-arquivos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

notify pgrst, 'reload schema';

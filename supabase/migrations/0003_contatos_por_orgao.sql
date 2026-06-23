-- Migração 0003: Contatos por órgão (serventia + gabinete).
-- A página de Contatos passa a listar os órgãos puxados automaticamente da
-- comarca/vara dos créditos. Os contatos se restringem a WhatsApp + e-mail
-- da serventia e WhatsApp + e-mail do gabinete. Mantém o nome da tabela.
-- Idempotente.

alter table public.contatos_serventias
  add column if not exists orgao              text,
  add column if not exists serventia_telefone text,
  add column if not exists serventia_email    text,
  add column if not exists gabinete_telefone  text,
  add column if not exists gabinete_email     text;

-- 'nome' deixa de ser obrigatório (o identificador agora é o 'orgao').
alter table public.contatos_serventias alter column nome drop not null;

-- Backfill do órgão a partir do antigo 'nome' (quando ainda vazio).
update public.contatos_serventias
  set orgao = nome
  where (orgao is null or btrim(orgao) = '') and nome is not null;

-- Best-effort: move telefone/e-mail antigos para serventia ou gabinete
-- conforme o antigo campo 'tipo'.
update public.contatos_serventias
  set gabinete_telefone = coalesce(gabinete_telefone, telefone),
      gabinete_email    = coalesce(gabinete_email, email)
  where tipo = 'gabinete';

update public.contatos_serventias
  set serventia_telefone = coalesce(serventia_telefone, telefone),
      serventia_email    = coalesce(serventia_email, email)
  where tipo is distinct from 'gabinete';

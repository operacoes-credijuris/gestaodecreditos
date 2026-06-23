-- Migração 0004: separa Telefone e WhatsApp nos contatos.
-- Antes cada contato tinha apenas *_telefone (usado como WhatsApp) e *_email.
-- Agora há três campos: telefone (comum), whatsapp e e-mail.
-- Os números já cadastrados em *_telefone eram WhatsApp -> movidos p/ *_whatsapp,
-- deixando *_telefone livre para telefone comum. Idempotente.

alter table public.contatos_serventias
  add column if not exists serventia_whatsapp text,
  add column if not exists gabinete_whatsapp  text;

-- Move o que estava em *_telefone (era WhatsApp) para *_whatsapp.
update public.contatos_serventias
  set serventia_whatsapp = serventia_telefone
  where serventia_whatsapp is null and serventia_telefone is not null;
update public.contatos_serventias
  set gabinete_whatsapp = gabinete_telefone
  where gabinete_whatsapp is null and gabinete_telefone is not null;

-- Limpa *_telefone (agora reservado para telefone comum, sem WhatsApp).
update public.contatos_serventias
  set serventia_telefone = null
  where serventia_telefone is not null and serventia_telefone = serventia_whatsapp;
update public.contatos_serventias
  set gabinete_telefone = null
  where gabinete_telefone is not null and gabinete_telefone = gabinete_whatsapp;

-- Recarrega o cache da API (evita "column does not exist").
notify pgrst, 'reload schema';

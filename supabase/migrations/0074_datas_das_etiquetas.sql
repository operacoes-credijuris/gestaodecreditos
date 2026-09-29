-- 0074 — Desde quando cada etiqueta de fundo está no card.
--
-- Pedido de 29/09/2026: na aba Em precificação, mostrar há quanto tempo cada
-- etiqueta foi posta — "Enviado PJUS há 9 dias" é fundo que não respondeu, e é
-- esse o controle que a equipe quer ter.
--
-- A DATA VEM DO KOMMO, e não só da plataforma: o evento `entity_tag_added` do
-- Kommo registra a etiqueta posta por qualquer caminho — pela plataforma ou à mão,
-- no próprio Kommo. O kommo-sync a busca uma vez por etiqueta e a guarda aqui; a
-- kommo-etiquetar grava a data na hora em que alguém marca pela plataforma.
--
-- O FORMATO: nome da etiqueta → data (ISO), só as etiquetas da casa que o card
-- tem agora. null quer dizer "o Kommo não guarda o evento" (etiqueta mais antiga
-- que o histórico dele) — e é o que impede o sync de perguntar de novo a cada
-- volta.
alter table public.kommo_leads
  add column if not exists tags_em jsonb not null default '{}'::jsonb;

comment on column public.kommo_leads.tags_em is
  'Desde quando cada etiqueta de fundo está no card: nome → data ISO (null = o Kommo não guarda o evento).';

notify pgrst, 'reload schema';

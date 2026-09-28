-- ============================================================
-- CRON: os autos do Escavador, do tribunal para o card do Kommo.
-- Rodar 1x no SQL Editor do Supabase (projeto dnxqajfxmdayqljyiqps), DEPOIS
-- da migração 0072.
--
-- A CADA 10 MINUTOS a rotina `escavador-autos-rotina`:
--   - pede os autos dos cards que chegaram na primeira coluna do Operacional
--     (RPV, precatório interno e externo) — R$ 1,34 por processo, no máximo 40
--     pedidos por dia;
--   - confere, de meia em meia hora e sem custo, os pedidos em andamento;
--   - anexa ao card, em voltas encadeadas, os PDFs dos pedidos prontos.
--
-- IMPORTANTE: substitua __CRON_SECRET__ pelo mesmo valor do secret CRON_SECRET
-- da Edge Function (o mesmo do CRON_KOMMO_SYNC.sql). NÃO faça commit deste
-- arquivo com o segredo real.
-- ============================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('escavador-autos-10min')
where exists (select 1 from cron.job where jobname = 'escavador-autos-10min');

select cron.schedule(
  'escavador-autos-10min',
  '*/10 * * * *',
  $$
  select net.http_post(
    url     := 'https://dnxqajfxmdayqljyiqps.supabase.co/functions/v1/escavador-autos-rotina',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', '__CRON_SECRET__'
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 5000
  );
  $$
);

-- Conferir o andamento dos cards:
--   select kommo_lead_id, numero_cnj, estado, anexados, total_documentos, detalhe, atualizado_em
--   from escavador_autos_card order by atualizado_em desc limit 20;
--
-- Parar a automação (sem apagar nada):
--   select cron.unschedule('escavador-autos-10min');

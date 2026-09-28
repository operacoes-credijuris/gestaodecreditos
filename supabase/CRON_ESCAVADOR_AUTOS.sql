-- ============================================================
-- CRON: os autos do Escavador, do tribunal para o card do Kommo.
-- Rodar 1x no SQL Editor do Supabase (projeto dnxqajfxmdayqljyiqps), DEPOIS
-- das migrações 0072 e 0073.
--
-- A CADA 10 MINUTOS a rotina `escavador-autos-rotina`:
--   - lê com a IA os cards que chegaram numa coluna de entrada (a primeira do
--     Operacional em RPV, precatório interno e externo; e a NOVOS do funil
--     geral) e define os processos do crédito: conhecimento, cumprimento e
--     precatório/RPV;
--   - pede os autos de cada processo, uma vez só — R$ 1,34 por processo, no
--     máximo 40 pedidos por dia;
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

-- Conferir o que a IA leu em cada card:
--   select kommo_lead_id, estado, leituras, processos, fontes, detalhe
--   from escavador_autos_card order by atualizado_em desc limit 20;
--
-- Conferir o andamento de cada processo:
--   select kommo_lead_id, numero_cnj, rotulo, estado, anexados, total_documentos, detalhe
--   from escavador_autos_processo order by atualizado_em desc limit 30;
--
-- Parar a automação (sem apagar nada):
--   select cron.unschedule('escavador-autos-10min');

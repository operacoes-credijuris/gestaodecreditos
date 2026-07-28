-- ============================================================
-- CRON: sincronização periódica das Publicações do DJEN.
-- Rodar 1x no SQL Editor do Supabase (projeto dnxqajfxmdayqljyiqps).
-- Requer as extensões pg_cron e pg_net (já habilitadas pelo cron das
-- movimentações; os CREATE EXTENSION abaixo são idempotentes).
--
-- IMPORTANTE: substitua __CRON_SECRET__ pelo mesmo valor do secret CRON_SECRET
-- da Edge Function. NÃO faça commit deste arquivo com o segredo real.
-- ============================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Remove agendamento anterior (idempotente).
select cron.unschedule('djen-publicacoes-2h')
where exists (select 1 from cron.job where jobname = 'djen-publicacoes-2h');

-- Agenda a cada 2 horas: chama a Edge Function com o segredo de cron.
select cron.schedule(
  'djen-publicacoes-2h',
  '30 */2 * * *',  -- no minuto 30 (defasado do job de movimentações, no minuto 0)
  $$
  select net.http_post(
    url     := 'https://dnxqajfxmdayqljyiqps.supabase.co/functions/v1/djen-publicacoes',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', '__CRON_SECRET__'
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- Conferir agendamento:
--   select jobid, jobname, schedule, active from cron.job;

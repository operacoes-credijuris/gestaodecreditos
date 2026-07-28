-- ============================================================
-- CRON: sincronização periódica das Movimentações do ADVBOX.
-- Rodar 1x no SQL Editor do Supabase (projeto dnxqajfxmdayqljyiqps).
-- Requer as extensões pg_cron e pg_net (habilite em Database → Extensions,
-- ou pelos CREATE EXTENSION abaixo).
--
-- IMPORTANTE: substitua __CRON_SECRET__ pelo mesmo valor definido no secret
-- CRON_SECRET da Edge Function (supabase secrets set CRON_SECRET=...).
-- NÃO faça commit deste arquivo com o segredo real preenchido.
-- ============================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Remove agendamento anterior (idempotente).
select cron.unschedule('advbox-movimentacoes-2h')
where exists (select 1 from cron.job where jobname = 'advbox-movimentacoes-2h');

-- Agenda a cada 2 horas: chama a Edge Function com o segredo de cron.
select cron.schedule(
  'advbox-movimentacoes-2h',
  '0 */2 * * *',
  $$
  select net.http_post(
    url     := 'https://dnxqajfxmdayqljyiqps.supabase.co/functions/v1/advbox-movimentacoes',
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
-- Conferir execuções:
--   select * from cron.job_run_details order by start_time desc limit 10;

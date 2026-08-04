-- ============================================================
-- CRON: sincronização periódica das Tarefas do ADVBOX (cache das fichas).
-- Alimenta public.advbox_tarefas, lida pela aba "Tarefas" da ficha de cada
-- processo (Créditos, Requerimentos e Apensos).
--
-- Rodar 1x no SQL Editor do Supabase (projeto dnxqajfxmdayqljyiqps).
-- Requer as extensões pg_cron e pg_net (habilite em Database → Extensions,
-- ou pelos CREATE EXTENSION abaixo).
--
-- IMPORTANTE: substitua __CRON_SECRET__ pelo mesmo valor definido no secret
-- CRON_SECRET da Edge Function (o mesmo já usado pelos outros crons).
-- NÃO faça commit deste arquivo com o segredo real preenchido.
-- ============================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Remove agendamento anterior (idempotente).
select cron.unschedule('advbox-tarefas-2h')
where exists (select 1 from cron.job where jobname = 'advbox-tarefas-2h');

-- Agenda a cada 2 horas, deslocado 30 min do cron de movimentações para as
-- duas varreduras não competirem pelo rate limit do ADVBOX.
select cron.schedule(
  'advbox-tarefas-2h',
  '30 */2 * * *',
  $$
  select net.http_post(
    url     := 'https://dnxqajfxmdayqljyiqps.supabase.co/functions/v1/advbox-tarefas',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', '__CRON_SECRET__'
    ),
    body    := '{"action":"sync"}'::jsonb
  );
  $$
);

-- Conferir agendamento:
--   select jobid, jobname, schedule, active from cron.job;
-- Conferir execuções:
--   select * from cron.job_run_details order by start_time desc limit 10;

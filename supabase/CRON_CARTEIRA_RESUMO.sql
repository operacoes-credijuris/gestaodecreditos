-- ============================================================
-- CRON: resumos da carteira (Estágio processual e Providências).
-- Alimenta public.carteira_resumos, exibida na carteira do investidor
-- (Comercial → Carteiras de Investimentos → Por investidor).
--
-- Roda TODA QUARTA-FEIRA às 06:00 de Brasília. O agendador do pg_cron trabalha
-- em UTC, e o Brasil não tem mais horário de verão, então 06:00 BRT = 09:00 UTC.
-- Escolha do horário: antes do início do dia, para o texto já estar novo quando
-- alguém abrir a carteira.
--
-- A função só regera os créditos que tiveram nova movimentação ou tarefa desde
-- a última geração (compara fonte_hash). Sem "forcar", uma quarta-feira sem
-- novidade em nenhum processo não gasta nenhuma chamada ao modelo.
--
-- Rodar 1x no SQL Editor do Supabase (projeto dnxqajfxmdayqljyiqps).
-- Requer pg_cron e pg_net (Database → Extensions, ou os CREATE EXTENSION abaixo).
--
-- IMPORTANTE: substitua __CRON_SECRET__ pelo mesmo valor do secret CRON_SECRET
-- da Edge Function (o mesmo já usado pelos outros crons).
-- NÃO faça commit deste arquivo com o segredo real preenchido.
-- ============================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Remove agendamento anterior (idempotente).
select cron.unschedule('carteira-resumo-semanal')
where exists (select 1 from cron.job where jobname = 'carteira-resumo-semanal');

-- '0 9 * * 3' = quarta-feira, 09:00 UTC (06:00 BRT).
select cron.schedule(
  'carteira-resumo-semanal',
  '0 9 * * 3',
  $$
  select net.http_post(
    url     := 'https://dnxqajfxmdayqljyiqps.supabase.co/functions/v1/carteira-resumo',
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
-- Conferir execuções (o jobname NÃO existe em job_run_details — precisa do join):
--   select j.jobname, d.status, d.start_time, d.return_message
--   from cron.job_run_details d join cron.job j using (jobid)
--   order by d.start_time desc limit 10;

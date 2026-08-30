-- ============================================================
-- CRON: classificação de fase processual (aba "Fase Processual" de Créditos).
-- Alimenta public.processos_fase e public.processos_fase_mudancas.
--
-- Roda TODO DIA às 07:00 de Brasília (10:00 UTC, sem horário de verão).
-- Escolha do horário: depois do CRON_CARTEIRA_RESUMO (06:00 BRT), para não
-- disputar o mesmo minuto — são jobs independentes, mas não custa espaçar.
--
-- A função só reclassifica: (1) créditos nunca classificados (primeira fase) e
-- (2) créditos (ou um de seus apensos) com andamento dentro da janela recente
-- — mesma resolução usada na tela "Movimentações recentes", pra nunca haver
-- duas ideias de "quem mudou" divergentes. Faz também, à parte e sem gastar
-- chamada ao modelo, a única transição por calendário da taxonomia (ATV-02 ->
-- ATV-03 quando o prazo de pagamento vence sem nenhuma movimentação nova).
--
-- Rodar 1x no SQL Editor do Supabase (projeto dnxqajfxmdayqljyiqps).
-- Requer pg_cron e pg_net (já habilitados pelo CRON_CARTEIRA_RESUMO).
--
-- IMPORTANTE: substitua __CRON_SECRET__ pelo mesmo valor do secret CRON_SECRET
-- da Edge Function (o mesmo já usado pelos outros crons).
-- NÃO faça commit deste arquivo com o segredo real preenchido.
-- ============================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('fase-processual-diaria')
where exists (select 1 from cron.job where jobname = 'fase-processual-diaria');

-- '0 10 * * *' = todo dia, 10:00 UTC (07:00 BRT).
select cron.schedule(
  'fase-processual-diaria',
  '0 10 * * *',
  $$
  select net.http_post(
    url     := 'https://dnxqajfxmdayqljyiqps.supabase.co/functions/v1/fase-processual',
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
--   select j.jobname, d.status, d.start_time, d.return_message
--   from cron.job_run_details d join cron.job j using (jobid)
--   order by d.start_time desc limit 10;

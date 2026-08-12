-- ============================================================
-- CRON: sincronização periódica das Movimentações do ADVBOX.
-- Rodar 1x no SQL Editor do Supabase (projeto dnxqajfxmdayqljyiqps).
-- Requer as extensões pg_cron e pg_net (habilite em Database → Extensions,
-- ou pelos CREATE EXTENSION abaixo).
--
-- IMPORTANTE: substitua __CRON_SECRET__ pelo mesmo valor definido no secret
-- CRON_SECRET da Edge Function (supabase secrets set CRON_SECRET=...).
-- NÃO faça commit deste arquivo com o segredo real preenchido.
--
-- DE 2h PARA 4h. A ADVBOX responde por quase todo o consumo de API da
-- plataforma, e é o único que cresce com o tamanho da carteira: uma chamada por
-- processo, por ciclo. Passar de 12 para 6 ciclos diários corta metade disso.
-- Movimentação processual não muda de hora em hora — o que é urgente chega pelo
-- DJEN, que continua de 2 em 2 horas porque custa o mesmo com 94 ou com 2.000
-- créditos (busca por OAB, não por processo).
--
-- ESTE ARQUIVO SUBSTITUI O AGENDAMENTO ANTIGO: o unschedule abaixo remove o nome
-- '...-2h' antes de criar o '...-4h'. Rodar sem isso deixaria os DOIS ativos, e o
-- consumo aumentaria em vez de cair.
-- ============================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Remove agendamentos anteriores (idempotente) — o de 2h e o próprio de 4h.
select cron.unschedule('advbox-movimentacoes-2h')
where exists (select 1 from cron.job where jobname = 'advbox-movimentacoes-2h');

select cron.unschedule('advbox-movimentacoes-4h')
where exists (select 1 from cron.job where jobname = 'advbox-movimentacoes-4h');

-- Agenda a cada 4 horas: chama a Edge Function com o segredo de cron.
select cron.schedule(
  'advbox-movimentacoes-4h',
  '0 */4 * * *',
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

-- Conferir agendamento (deve haver UMA linha de movimentações, a de 4h):
--   select jobid, jobname, schedule, active from cron.job order by jobname;
-- Conferir execuções:
--   select * from cron.job_run_details order by start_time desc limit 10;

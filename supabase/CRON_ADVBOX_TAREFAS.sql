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
--
-- DE 2h PARA 4h. Esta é a varredura mais cara da plataforma: DUAS chamadas por
-- processo por ciclo (o /history só informa a situação pelo filtro, então cada
-- processo é consultado em 'pending' e em 'completed'). Passar de 12 para 6 ciclos
-- diários corta metade. Tarefa de escritório não nasce de hora em hora, e a ficha
-- também é atualizada quando alguém abre a aba.
--
-- ESTE ARQUIVO SUBSTITUI O AGENDAMENTO ANTIGO: o unschedule abaixo remove o nome
-- '...-2h' antes de criar o '...-4h'. Rodar sem isso deixaria os DOIS ativos, e o
-- consumo aumentaria em vez de cair.
-- ============================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Remove agendamentos anteriores (idempotente) — o de 2h e o próprio de 4h.
select cron.unschedule('advbox-tarefas-2h')
where exists (select 1 from cron.job where jobname = 'advbox-tarefas-2h');

select cron.unschedule('advbox-tarefas-4h')
where exists (select 1 from cron.job where jobname = 'advbox-tarefas-4h');

-- Agenda a cada 4 horas, deslocado 30 min do cron de movimentações para as duas
-- varreduras não competirem pelo rate limit do ADVBOX.
select cron.schedule(
  'advbox-tarefas-4h',
  '30 */4 * * *',
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

-- Conferir agendamento (deve haver UMA linha de tarefas, a de 4h):
--   select jobid, jobname, schedule, active from cron.job order by jobname;
-- Conferir execuções:
--   select * from cron.job_run_details order by start_time desc limit 10;

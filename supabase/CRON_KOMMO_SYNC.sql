-- ============================================================
-- CRON: espelho dos cards do Kommo (funil de Análise de Crédito).
-- Rodar 1x no SQL Editor do Supabase (projeto dnxqajfxmdayqljyiqps).
--
-- POR QUE ESTE ARQUIVO EXISTE: o job `kommo-sync-15min` estava agendado só no
-- banco, criado à mão e em lugar nenhum do repositório. Descobriu-se ao
-- investigar por que os crons devolviam 401: ele aparecia em `cron.job` e não
-- tinha script correspondente aqui. Agendamento de produção que só existe no
-- banco não se revisa, não se recria e não se corrige junto dos outros.
--
-- 15 MINUTOS, e não 2 horas como os demais: a Análise de Crédito trabalha em
-- cima dos cards, e card que entrou no funil precisa aparecer na tela no mesmo
-- expediente — não no fim da tarde.
--
-- IMPORTANTE: substitua __CRON_SECRET__ pelo mesmo valor do secret CRON_SECRET
-- da Edge Function. NÃO faça commit deste arquivo com o segredo real.
-- ============================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Remove agendamento anterior (idempotente).
select cron.unschedule('kommo-sync-15min')
where exists (select 1 from cron.job where jobname = 'kommo-sync-15min');

select cron.schedule(
  'kommo-sync-15min',
  '*/15 * * * *',
  $$
  select net.http_post(
    url     := 'https://dnxqajfxmdayqljyiqps.supabase.co/functions/v1/kommo-sync',
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
--
-- Conferir o que a função respondeu (o pg_net guarda algumas horas):
--   select id, status_code, left(content, 200), created
--   from net._http_response order by created desc limit 10;
--     -> 200 é sucesso. 401 significa que o x-cron-secret daqui não bate com o
--        secret CRON_SECRET do projeto.

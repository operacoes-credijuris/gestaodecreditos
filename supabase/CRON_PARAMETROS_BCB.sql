-- ============================================================
-- CRON: SELIC e IPCA acumulados em 12 meses, direto do Banco Central.
-- Alimenta public.parametros_atualizacao, que a projeção de valor e a TIR de toda
-- a carteira usam. Antes eram digitados à mão.
--
-- Rodar 1x no SQL Editor do Supabase (projeto dnxqajfxmdayqljyiqps).
--
-- IMPORTANTE: substitua __CRON_SECRET__ pelo mesmo valor definido no secret
-- CRON_SECRET da Edge Function (o mesmo já usado pelos outros crons).
-- NÃO faça commit deste arquivo com o segredo real preenchido.
--
-- SEMANAL, e não diário, porque os dois índices são MENSAIS: o IPCA acumulado 12
-- meses muda quando o IBGE publica o mês, e a Selic acumulada do mês só fecha na
-- virada. Buscar todo dia repetiria o mesmo número ~29 vezes. Segunda-feira às 6h
-- para que a semana comece com o valor mais recente já no lugar.
--
-- O horário não briga com nada: os crons do ADVBOX rodam nos minutos 0 e 30 de 4
-- em 4 horas, o do DJEN de 2 em 2, e este é uma requisição a duas séries públicas.
-- ============================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Remove agendamento anterior (idempotente).
select cron.unschedule('parametros-bcb-semanal')
where exists (select 1 from cron.job where jobname = 'parametros-bcb-semanal');

-- Segunda-feira, 6h (dia da semana 1).
select cron.schedule(
  'parametros-bcb-semanal',
  '0 6 * * 1',
  $$
  select net.http_post(
    url     := 'https://dnxqajfxmdayqljyiqps.supabase.co/functions/v1/parametros-bcb',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', '__CRON_SECRET__'
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- Conferir agendamento:
--   select jobid, jobname, schedule, active from cron.job order by jobname;
-- Conferir o que foi gravado:
--   select selic_aa, ipca_12m_aa, data_referencia, atualizado_em
--     from public.parametros_atualizacao where id = 1;

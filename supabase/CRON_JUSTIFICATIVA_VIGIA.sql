-- ============================================================
-- CRON: o vigia da justificativa técnica (22/10/2026).
--
-- A cada 2 minutos, pede à justificativa-tecnica que relance a frente de
-- pesquisa cuja invocação morreu sem sinal (`acao: 'vigiar-todas'`, ver
-- `vigiarTodas` e `frentesOrfas`). O vigia da janela só valia com ela aberta e
-- com a sessão de quem olhava boa — com o 401, a frente morta não voltou, e a
-- geração parou "pesquisando na internet".
--
-- A FUNÇÃO TEM verify_jwt = false (config.toml, desde 23/10/2026): com o
-- gateway conferindo o JWT, este cron levava 401 "Invalid JWT" a cada disparo,
-- antes de a função ver o segredo. Quem autoriza é o x-cron-secret, conferido
-- dentro da função.
--
-- Rodar 1x no SQL Editor do Supabase (projeto dnxqajfxmdayqljyiqps). O segredo
-- é copiado do agendamento do Escavador, que já o tem — nada a substituir.
-- ============================================================

do $$
declare
  segredo text;
begin
  select substring(command from $r$'x-cron-secret',\s*'([^']+)'$r$)
    into segredo
  from cron.job where jobname = 'escavador-autos-10min';
  if segredo is null then
    raise exception 'Não achei o segredo no agendamento do Escavador.';
  end if;

  if exists (select 1 from cron.job where jobname = 'justificativa-vigia-2min') then
    perform cron.unschedule('justificativa-vigia-2min');
  end if;

  perform cron.schedule('justificativa-vigia-2min', '*/2 * * * *', format($c$
    select net.http_post(
      url     := 'https://dnxqajfxmdayqljyiqps.supabase.co/functions/v1/justificativa-tecnica',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', %L
      ),
      body    := '{"acao":"vigiar-todas"}'::jsonb
    );
  $c$, segredo));
end $$;

-- Conferir:
--   select jobname, schedule, active from cron.job where jobname = 'justificativa-vigia-2min';
--   select d.status, d.start_time, d.return_message
--   from cron.job_run_details d join cron.job j using (jobid)
--   where j.jobname = 'justificativa-vigia-2min' order by d.start_time desc limit 5;

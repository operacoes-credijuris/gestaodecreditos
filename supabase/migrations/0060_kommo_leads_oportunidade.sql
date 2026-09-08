-- 0060 — kommo_leads.oportunidade: o resumo que quem aprova precisa ler.
--
-- POR QUE GUARDAR. A análise de RPV não é persistida em lugar nenhum: ela vive
-- na memória do navegador de quem a rodou, e as únicas cópias duráveis são a
-- anotação no card e a planilha no Drive. Quem aprova está na coluna de
-- Validação — quase sempre em outra sessão, e muitas vezes outra pessoa. Sem
-- isto, montar o resumo da oportunidade no clique de "Aprovar" exigiria rodar a
-- análise outra vez: três minutos de leitura para reescrever oito linhas que já
-- foram apuradas.
--
-- GUARDA A ENTRADA DO RESUMO — ficha, link do Drive, prazo —, e não o texto
-- pronto. O formato é regra de negócio: mora no código, com teste, e mudá-lo
-- passa a valer para os cards antigos sem reprocessar nada.
alter table public.kommo_leads
  add column if not exists oportunidade jsonb;

comment on column public.kommo_leads.oportunidade is
  'Entrada do resumo da oportunidade (ficha do crédito, link do Drive, prazo aferido), gravada pelo salvar da análise. NÃO INCLUIR no upsert do kommo-sync: o sync espelha o Kommo, que não conhece este campo, e um upsert que o mencione o apagaria a cada sincronização.';

notify pgrst, 'reload schema';

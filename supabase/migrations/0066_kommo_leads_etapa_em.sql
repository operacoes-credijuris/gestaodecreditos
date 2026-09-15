-- 0066 — kommo_leads.etapa_em: desde quando o card está NESTA coluna.
--
-- POR QUE NÃO DAVA PARA DERIVAR DO QUE JÁ EXISTE. O card do Kommo traz
-- `created_at` (quando nasceu) e `updated_at` (última edição de qualquer
-- espécie: responsável, tag, campo, anotação). Nenhum dos dois responde "há
-- quanto tempo este crédito está parado em Revisão", que é a pergunta de quem
-- abre a tela — um card criado em março e movido ontem tem os dois valores
-- errados para essa conta.
--
-- A FONTE É O EVENTO, e não um palpite. O Kommo guarda `lead_status_changed` em
-- /api/v4/events, com o status de origem, o de destino e a hora. O kommo-sync
-- passa a ler esses eventos e a gravar aqui a hora da última entrada na coluna
-- em que o card está agora.
--
-- AS DUAS COLUNAS ANDAM JUNTAS, e a segunda é o que impede a data de mentir.
-- Entre um sync e outro alguém move o card no Kommo; até a próxima passada, a
-- data guardada é de OUTRA coluna. `etapa_status_id` diz a que coluna a data se
-- refere: divergindo de `status_id`, a tela sabe que não sabe, em vez de exibir
-- com confiança uma data que já não vale.
alter table public.kommo_leads
  add column if not exists etapa_em timestamptz,
  add column if not exists etapa_status_id bigint;

comment on column public.kommo_leads.etapa_em is
  'Quando o card entrou na coluna em que está (evento lead_status_changed do Kommo). Só vale se etapa_status_id = status_id.';

comment on column public.kommo_leads.etapa_status_id is
  'A coluna a que etapa_em se refere. Diferente de status_id = o card se moveu depois do último sync e a data ainda não foi apurada.';

-- A tela ordena cada coluna da mais recente para a mais antiga.
create index if not exists kommo_leads_etapa_em_idx
  on public.kommo_leads (etapa_em desc nulls last);

notify pgrst, 'reload schema';

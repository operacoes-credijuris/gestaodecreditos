-- Guarda TODAS as anotações de um card do Kommo, não só a primeira.
--
-- Antes o sync mantinha apenas a nota mais antiga (os dados do crédito escritos
-- pelo comercial ao criar o card) e descartava o resto — então qualquer
-- comentário posterior do comercial nunca chegava ao operacional.
--
-- Por que jsonb e não uma tabela própria: as notas são espelho somente-leitura,
-- sempre lidas junto do card e exibidas como lista. Não há consulta por nota
-- isolada, então uma tabela separada só acrescentaria um join. A coluna `raw`
-- desta mesma tabela já usa jsonb pelo mesmo motivo.
--
-- Formato: array ordenado da mais antiga para a mais recente, cada item
--   { "id": 123, "texto": "...", "criado_em": "2026-06-11T19:53:00Z", "autor": "Nome" }
alter table public.kommo_leads
  add column if not exists notas jsonb not null default '[]'::jsonb;

-- nota_texto CONTINUA existindo e continua sendo a nota mais antiga. Não é
-- redundância com notas[0]: é o campo semântico "dados do crédito", que alimenta
-- a extração do CNJ e a busca textual. Mantê-lo separado evita que uma mudança
-- na forma de exibir o histórico afete o que identifica o crédito.
comment on column public.kommo_leads.nota_texto is
  'Primeira anotação do card: os dados do crédito escritos pelo comercial.';
comment on column public.kommo_leads.notas is
  'Todas as anotações common do card, da mais antiga para a mais recente.';

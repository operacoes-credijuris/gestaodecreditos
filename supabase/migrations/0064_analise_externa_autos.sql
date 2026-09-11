-- 0064 — Os autos que o Claude vem buscar.
--
-- O PROBLEMA QUE ESTA TABELA RESOLVE. No precatório externo, a análise não é
-- feita aqui: é feita numa conversa com o Claude, e essa conversa precisa dos
-- autos. Entregar o ARQUIVO ao aplicativo não é possível — nenhuma das quatro
-- vias existentes alcança um site que o chama de fora. Então o sentido se
-- inverte: em vez de esta plataforma EMPURRAR os autos, o Claude vem BUSCÁ-LOS,
-- por um conector (MCP). Esta tabela é o balcão onde eles ficam esperando.
--
-- O TEXTO, E NÃO O PDF. Quem lê o PDF é o navegador, com pdf.js, como já faz
-- para a análise de RPV — a Edge Function tem teto de CPU e não aguentaria um
-- processo digitalizado. Aqui chega só o texto, que é leve e é o que a IA lê.
--
-- O CÓDIGO É A CHAVE, e é por isso que ele é um uuid: o endpoint do conector
-- responde sem JWT (o aplicativo do Claude não tem como mandar um), então o que
-- protege os autos é o código ser impossível de adivinhar e durar pouco. Ele
-- nasce no clique, vive duas horas e vale para um card só. Sem código, o
-- endpoint não devolve nada — nem diz se o código existiu.
create table if not exists public.analise_externa_autos (
  codigo uuid primary key,
  lead_id bigint not null,
  titulo text not null default '',
  -- [{ nome, paginas, texto }] — um item por PDF do card, na ordem da Kommo.
  arquivos jsonb not null default '[]'::jsonb,
  criado_em timestamptz not null default now(),
  expira_em timestamptz not null default now() + interval '2 hours',
  -- Quando o Claude veio buscar. Não impede uma segunda leitura dentro do
  -- prazo: uma conversa pode reabrir os autos, e negar a segunda seria quebrar
  -- a análise no meio.
  lido_em timestamptz
);

-- Varrer o que venceu é a única leitura por data que esta tabela tem.
create index if not exists analise_externa_autos_expira_idx
  on public.analise_externa_autos (expira_em);

-- SEM POLÍTICA NENHUMA, e isso é a proteção, não um esquecimento: RLS ligada e
-- zero policies significa que nem o anon nem o usuário logado enxergam uma
-- linha. Só o service_role entra — ou seja, só as duas Edge Functions que
-- guardam e entregam os autos.
alter table public.analise_externa_autos enable row level security;

comment on table public.analise_externa_autos is
  'Balcão temporário: o texto dos autos de um card, esperando o Claude vir buscar pelo conector MCP. Some em 2 horas.';

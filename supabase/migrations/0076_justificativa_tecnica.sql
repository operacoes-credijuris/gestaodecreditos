-- 0076 — A justificativa técnica da proposta: uma por card, gerada pela IA,
-- editada por gente e enviada ao Kommo como nota.
--
-- O QUE A TABELA GUARDA. A geração leva minutos e roda em segundo plano, em
-- etapas (lendo o crédito, pesquisando, redigindo), cada uma numa invocação da
-- Edge Function `justificativa-tecnica`. É por esta linha que as etapas
-- conversam, que a janela acompanha o andamento (consulta periódica) e que a
-- edição sobrevive a fechar a janela.
--
-- A LINHA É A TRAVA. Uma geração por card: entrar em 'gerando' é um UPDATE
-- condicional na `tentativa` lida (ou o insert que não pisa em linha que já
-- existe), e cada etapa só grava se a `tentativa` ainda for a dela. O envio tem
-- trava própria (`enviando_desde`), contra o clique duplo e a segunda aba.
--
-- LEITURA PARA QUEM ENTRA, ESCRITA SÓ PELA FUNÇÃO (service_role), como as
-- tabelas do Escavador: a tela lê para mostrar o andamento e o cheque no card;
-- gerar, salvar rascunho e enviar passam pela função, que confere o estado.
--
-- ANTES DESTA MIGRAÇÃO a tela e a função funcionam e dizem "falta rodar a
-- migração 0076" — nada é gerado nem cobrado, e o resto da plataforma não
-- depende desta tabela.
create table if not exists public.justificativa_tecnica (
  kommo_lead_id   bigint primary key,
  pipeline_id     bigint,
  status          text not null default 'gerando'
                  check (status in ('gerando', 'pronta', 'falha', 'enviada')),
  -- A etapa da geração em curso; nula fora de 'gerando'.
  etapa           text check (etapa is null or etapa in ('lendo', 'pesquisando', 'redigindo')),
  -- A identidade da geração: muda a cada "Gerar de novo". É nela que as travas
  -- se apoiam (texto, e não uuid, para um valor torto no corpo da requisição
  -- ser só "não casou", e não um erro de conversão).
  tentativa       text not null default gen_random_uuid()::text,
  -- O texto que a IA entregou, com a lista de fontes no fim.
  texto           text,
  -- A edição de quem revisa (rascunho salvo com debounce). Nula = não editado.
  texto_editado   text,
  rascunho_em     timestamptz,
  -- As fontes citadas no texto, na ordem da numeração: [{ url, titulo }].
  fontes          jsonb not null default '[]'::jsonb,
  -- O dossiê da etapa de pesquisa ({ texto, fontes }), que a redação lê.
  pesquisa        jsonb,
  -- Com que prompt e com que dados a IA trabalhou — para conferir depois.
  prompt_usado    text,
  variaveis       jsonb,
  dominios        text[] not null default '{}',
  erro            text,
  -- O que a geração gastou: chamadas, tokens (entrada, saída, cache), buscas,
  -- páginas abertas e segundos. É o que mede o custo.
  consumo         jsonb not null default '{}'::jsonb,
  criado_por      text,
  criado_em       timestamptz not null default now(),
  gerado_em       timestamptz,
  atualizado_em   timestamptz not null default now(),
  -- A trava do envio: posta enquanto a nota sobe ao Kommo.
  enviando_desde  timestamptz,
  texto_enviado   text,
  enviado_por     text,
  enviado_em      timestamptz,
  -- Os ids das notas no Kommo (mais de um quando o texto foi em partes).
  nota_kommo_ids  jsonb not null default '[]'::jsonb
);

-- O limite de gerações simultâneas conta as vivas: 'gerando' e recentes.
create index if not exists justificativa_tecnica_status_idx
  on public.justificativa_tecnica (status, atualizado_em);

alter table public.justificativa_tecnica enable row level security;

drop policy if exists "justificativa_tecnica_leitura" on public.justificativa_tecnica;
create policy "justificativa_tecnica_leitura" on public.justificativa_tecnica
  for select to authenticated using (true);

-- Sem policy de escrita, de propósito: só a Edge Function (service_role) grava.

comment on table public.justificativa_tecnica is
  'Justificativa técnica da proposta ao cedente, por card do Kommo: gerada pela IA em segundo plano, editada e enviada como nota. Escrita só pela Edge Function justificativa-tecnica.';

-- O PROMPT E OS DOMÍNIOS moram em `prompts_operacao` (migração 0065), nas
-- chaves 'justificativa_tecnica' e 'justificativa_tecnica_dominios' — sem
-- linha, vale o padrão do código e a pesquisa sem restrição de domínio. Nada a
-- criar aqui.

notify pgrst, 'reload schema';

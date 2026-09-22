-- 0068 — Os autos que o Escavador entrega, e o balcão onde eles esperam.
--
-- O QUE MUDA NO FLUXO. Até aqui, os PDFs de um crédito vinham do card do Kommo:
-- o comercial anexava, o navegador lia com pdf.js e o texto ia para o balcão do
-- conector (migração 0064). O Escavador abre uma segunda porta — ele entra no
-- tribunal com o certificado digital e baixa os autos —, e essa porta é
-- ASSÍNCRONA: pede-se a atualização, e a resposta chega minutos ou horas depois,
-- num POST que o Escavador faz na nossa URL. Estas tabelas são o que sobrevive
-- entre o pedido e a chegada.
--
-- POR QUE NÃO GUARDAR SÓ O TEXTO, como a 0064 faz. Porque quem lê PDF aqui é o
-- NAVEGADOR: a Edge Function tem teto de CPU e um processo digitalizado a
-- derruba — foi a razão de o pdf.js morar no front desde o começo. O que a
-- função consegue fazer é o que o navegador não pode: receber o arquivo do
-- Escavador e guardá-lo. O PDF fica no balde, o navegador o lê quando alguém
-- abre o card, e daí para a frente é o caminho que já existe.

-- ============================================================
-- O token que prova que o POST veio do Escavador
-- ============================================================
--
-- A URL de callback é pública por necessidade: o Escavador chama de fora, sem
-- JWT nosso. O que a protege é este token — gerado no painel deles, enviado por
-- eles no header Authorization, e conferido pela função. Mesmo lugar e mesmas
-- regras do token da API: RLS ligada, nenhuma policy, só service_role lê.
alter table public.integracao_escavador_secret
  add column if not exists callback_token text;

comment on column public.integracao_escavador_secret.callback_token is
  'Token gerado no painel do Escavador que valida os callbacks recebidos (header Authorization).';

-- ============================================================
-- Os pedidos de atualização feitos ao Escavador
-- ============================================================
--
-- A CHAVE É O ID DELES, e não um uuid nosso: é esse número que aparece no
-- painel do Escavador, é por ele que se abre chamado, e é ele que volta no
-- callback. Guardar um id próprio ao lado só criaria duas formas de nomear a
-- mesma coisa.
--
-- O PEDIDO SOBREVIVE AO CARD. Sem FK para kommo_leads pelo mesmo motivo de
-- dd_historico: o espelho de cards é descartável e recriado pelo sync, e o
-- pedido já foi pago.
create table if not exists public.escavador_pedido (
  id            bigint primary key,
  numero_cnj    text not null,
  kommo_lead_id bigint,

  -- 'autos' | 'documentos_publicos' — o que se pediu, que decide de qual rota
  -- os documentos serão lidos quando a resposta chegar.
  tipo          text not null default 'autos',
  -- PENDENTE | SUCESSO | NAO_ENCONTRADO | ERRO, como o Escavador os nomeia.
  -- Texto livre de propósito: um estado novo do lado deles não pode fazer a
  -- gravação falhar e perder o registro de um pedido que já foi cobrado.
  status        text not null default 'PENDENTE',
  motivo_erro   text,

  centavos      int not null default 0,
  criado_em     timestamptz not null default now(),
  concluido_em  timestamptz,
  atualizado_em timestamptz not null default now(),
  criado_por    uuid references public.profiles (id) on delete set null
);

create index if not exists escavador_pedido_cnj_idx
  on public.escavador_pedido (numero_cnj);
create index if not exists escavador_pedido_lead_idx
  on public.escavador_pedido (kommo_lead_id);

alter table public.escavador_pedido enable row level security;

-- Leitura para qualquer autenticado: a tela precisa dizer "pedido em andamento
-- desde as 14h" em vez de deixar o botão mudo. A escrita é das funções.
drop policy if exists "escavador_pedido_leitura" on public.escavador_pedido;
create policy "escavador_pedido_leitura" on public.escavador_pedido
  for select to authenticated using (true);

-- ============================================================
-- Os documentos baixados
-- ============================================================
--
-- A CHAVE NATURAL É (processo, key). A `key` é o identificador que o Escavador
-- dá a cada documento, e é com ela que se baixa o PDF. Como única, ela é o que
-- torna o recebimento IDEMPOTENTE: o callback pode chegar duas vezes — a
-- documentação deles fala em retentativas —, e o segundo não duplica arquivo.
create table if not exists public.escavador_documento (
  id           uuid primary key default gen_random_uuid(),
  numero_cnj   text not null,
  pedido_id    bigint references public.escavador_pedido (id) on delete set null,

  chave        text not null,
  nome         text not null default '',
  tipo         text,
  -- Caminho dentro do balde `autos-escavador`. Null significa que o documento
  -- foi listado mas o PDF não desceu — e isso PRECISA ser distinguível de
  -- "não existe", porque é o caso que pede nova tentativa.
  caminho      text,
  bytes        int,
  erro         text,

  criado_em    timestamptz not null default now(),
  baixado_em   timestamptz,

  unique (numero_cnj, chave)
);

create index if not exists escavador_documento_cnj_idx
  on public.escavador_documento (numero_cnj);

alter table public.escavador_documento enable row level security;

drop policy if exists "escavador_documento_leitura" on public.escavador_documento;
create policy "escavador_documento_leitura" on public.escavador_documento
  for select to authenticated using (true);

-- ============================================================
-- Os callbacks recebidos
-- ============================================================
--
-- POR QUE GUARDAR O EVENTO CRU. Primeiro, idempotência: a chave é o uuid que o
-- Escavador manda, então reenvio não refaz trabalho. Segundo, porque o formato
-- exato do evento de atualização de processo não está documentado — a função
-- não depende dele (ela confirma o estado perguntando à API), mas guardar o
-- corpo é o que vai permitir apertar essa leitura quando virmos um de verdade.
create table if not exists public.escavador_callback (
  uuid        text primary key,
  evento      text,
  numero_cnj  text,
  payload     jsonb not null default '{}'::jsonb,
  recebido_em timestamptz not null default now(),
  tratado_em  timestamptz,
  erro        text
);

create index if not exists escavador_callback_recebido_idx
  on public.escavador_callback (recebido_em desc);

alter table public.escavador_callback enable row level security;

-- ============================================================
-- O balde dos PDFs
-- ============================================================
--
-- PRIVADO E SEM POLICY NENHUMA: são autos de processo, e o que os entrega ao
-- navegador é uma URL assinada emitida por Edge Function — o mesmo desenho do
-- anexo do Kommo. Balde próprio, e não o `analises-input`, porque aquele é
-- escopado por usuário (a pasta é o auth.uid) e estes arquivos não são de
-- ninguém em particular: são do processo.
insert into storage.buckets (id, name, public)
values ('autos-escavador', 'autos-escavador', false)
on conflict (id) do nothing;

notify pgrst, 'reload schema';

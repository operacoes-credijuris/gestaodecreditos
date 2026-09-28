-- 0071 — A emissão das certidões pela BullAI, e o que ela devolve.
--
-- O QUE MUDA NO CHECKLIST. Até aqui um item de certidão sabia se tinha sido
-- OBTIDO, e não o que ele dizia: a plataforma não guardava se a certidão veio
-- positiva ou negativa (ver o comentário de `checklistEmTexto`, que proíbe a
-- análise de concluir isso). A BullAI devolve o resultado de cada portal — e ele
-- passa a ter onde morar.
--
-- UM ITEM PODE TER MAIS DE UM PDF. O item "TJ cível e criminal da BA" é uma
-- linha só na planilha e são duas certidões na BullAI; o mesmo com a unificada
-- da Justiça Federal e com a CDT de São Paulo (SEFAZ e PGE). `drive_file_id`
-- continua sendo UM arquivo — é o que a trava de conclusão confere —, e a lista
-- inteira mora em `arquivos`.

alter table public.dd_certidao
  -- negativa | positiva | nada_consta | indeterminada | emitida (sem resultado)
  add column if not exists resultado text,
  add column if not exists arquivos jsonb not null default '[]'::jsonb,
  add column if not exists bullai_job_id text,
  add column if not exists bullai_portais text[] not null default '{}';

comment on column public.dd_certidao.resultado is
  'O que a certidão diz, quando veio da BullAI: negativa, positiva, nada_consta, indeterminada ou emitida (sem resultado declarado).';

-- ============================================================
-- Os pedidos feitos à BullAI
-- ============================================================
--
-- UM PEDIDO É UM DOCUMENTO: a BullAI recebe um CPF (ou um CNPJ) e a lista de
-- portais daquele documento. O cedente e o cônjuge são dois pedidos.
--
-- A CHAVE É O ID DELES, pelo mesmo motivo do Escavador: é por ele que se abre
-- chamado, e é ele que a API devolve.
create table if not exists public.bullai_pedido (
  job_id         text primary key,
  kommo_lead_id  bigint not null,
  sujeito_id     uuid references public.dd_sujeito (id) on delete set null,
  documento      text not null,
  tipo_documento text not null check (tipo_documento in ('CPF', 'CNPJ')),
  -- A chave de cada portal pedido → os itens do checklist que ele atende.
  -- Portal pedido fora do checklist (acrescentado à mão) mapeia para [].
  portais        jsonb not null default '{}'::jsonb,
  status         text not null default 'pending',
  -- Quando a BullAI diz que nada mais vai chegar. É ELE, e não o status, que
  -- manda parar de perguntar: algumas certidões chegam por e-mail horas depois.
  is_final       boolean not null default false,
  portal_runs    jsonb not null default '[]'::jsonb,
  artifacts      jsonb not null default '[]'::jsonb,
  -- Os PDFs que já desceram para o Drive — reconsultar não baixa de novo.
  baixados       text[] not null default '{}',
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),
  criado_por     uuid references public.profiles (id) on delete set null
);

create index if not exists bullai_pedido_lead_idx on public.bullai_pedido (kommo_lead_id);
create index if not exists bullai_pedido_aberto_idx on public.bullai_pedido (is_final) where not is_final;

alter table public.bullai_pedido enable row level security;

-- Leitura para qualquer autenticado: a aba precisa mostrar o andamento. A
-- escrita é da Edge Function.
drop policy if exists "bullai_pedido_leitura" on public.bullai_pedido;
create policy "bullai_pedido_leitura" on public.bullai_pedido
  for select to authenticated using (true);

notify pgrst, 'reload schema';

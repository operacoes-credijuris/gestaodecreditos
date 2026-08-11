-- Migração 0030: modelos de petição.
--
-- Os modelos são escritos por advogado no Google Docs, numa pasta do Drive, e
-- são ESPELHADOS aqui. O Drive segue sendo onde se edita; esta tabela é de onde
-- a plataforma lê.
--
-- POR QUE ESPELHAR, e não ler o Drive na hora de gerar: a leitura do Drive
-- depende de permissão por arquivo, e permissão insuficiente devolve resposta
-- BEM-SUCEDIDA com menos arquivos — não devolve erro. Ao ligar a pasta pela
-- primeira vez, uma consulta trouxe 2 dos 10 modelos sem nenhum aviso. Lendo no
-- ato da geração, esse silêncio viraria "nenhum modelo encontrado" no meio do
-- expediente, sem ninguém saber por quê. Espelhado, a importação é um evento
-- observável: conta quantos achou e a queda fica visível.
--
-- O `conteudo` guarda MARKDOWN, não texto puro: os modelos usam negrito nos
-- títulos das seções e em frases-chave, e o produto final é um PDF que vai ao
-- PJe. Perder o negrito obrigaria a refazê-lo à mão em toda petição, o que anula
-- boa parte do ganho.
create table if not exists public.peticao_templates (
  id             uuid primary key default gen_random_uuid(),
  nome           text not null,
  -- O que a descrição da tarefa precisa conter para este modelo ser sugerido.
  -- É lista, e EXPLÍCITA, em vez de derivada do título: "homologação",
  -- "homologacao" e "homologatória" têm de cair no mesmo modelo, e o título do
  -- arquivo no Drive não é contrato de código — alguém renomeia e a busca para.
  palavras_chave text[] not null default '{}',
  conteudo       text not null default '',
  -- Origem no Drive. UNIQUE porque a importação é reexecutável: sem isso, cada
  -- sincronização criaria uma segunda cópia do mesmo Doc.
  drive_file_id  text unique,
  drive_sync_em  timestamptz,
  -- Modelo aposentado sai da lista sem perder o histórico de quem o usou.
  ativo          boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Sugestão do modelo a partir da descrição da tarefa: a consulta pergunta se
-- ALGUMA palavra-chave está contida no texto, o que em Postgres é varredura do
-- array. GIN torna isso indexado.
create index if not exists peticao_templates_palavras_idx
  on public.peticao_templates using gin (palavras_chave);

alter table public.peticao_templates enable row level security;

-- Leitura e escrita por autenticado, como em investidor_dados: é material
-- operacional que a equipe mantém, não segredo de integração. Se depois se
-- decidir que só administrador edita modelo, é trocar a policy de escrita por
-- `using (public.is_admin())` — a função existe desde a 0001.
drop policy if exists "peticao_templates_select" on public.peticao_templates;
create policy "peticao_templates_select" on public.peticao_templates
  for select to authenticated using (true);

drop policy if exists "peticao_templates_write" on public.peticao_templates;
create policy "peticao_templates_write" on public.peticao_templates
  for all to authenticated using (true) with check (true);

comment on table public.peticao_templates is
  'Modelos de petição espelhados da pasta do Drive. O conteúdo usa {{variaveis}} resolvidas por lib/peticao.ts a partir do crédito.';
comment on column public.peticao_templates.palavras_chave is
  'Termos que, achados na descrição da tarefa, sugerem este modelo. Comparados sem acento e em minúsculas.';

notify pgrst, 'reload schema';

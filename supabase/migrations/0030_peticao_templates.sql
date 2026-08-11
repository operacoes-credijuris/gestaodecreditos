-- Migração 0030: modelos de petição.
--
-- Os 10 modelos nasceram no Google Docs e foram lidos UMA ÚNICA VEZ, na carga
-- inicial (supabase/SEED_PETICAO_TEMPLATES*.sql). Daqui para frente esta tabela é
-- a fonte: a edição acontece na plataforma, e não há credencial do Google, nem
-- sincronização, nem API externa no caminho de gerar uma petição.
--
-- POR QUE NÃO LER O DRIVE NA HORA DE GERAR: a leitura depende de permissão por
-- arquivo, e permissão insuficiente devolve resposta BEM-SUCEDIDA com menos
-- arquivos — não devolve erro. Ao ligar a pasta pela primeira vez, uma consulta
-- trouxe 2 dos 10 modelos sem nenhum aviso. Na geração, esse silêncio viraria
-- "nenhum modelo encontrado" no meio do expediente, sem ninguém saber por quê.
--
-- O `conteudo` guarda MARKDOWN, não texto puro: os modelos usam negrito nos
-- títulos das seções e em frases-chave, e o produto final é um PDF que vai ao
-- PJe. Perder o negrito obrigaria a refazê-lo à mão em toda petição, o que anula
-- boa parte do ganho.
--
-- As lacunas são marcadas com RÓTULOS ENTRE COLCHETES — [NÚMERO DO PROCESSO], e
-- não {{processo_cnj}}. Quem edita o modelo é advogado, e o texto continua
-- legível como petição. O preço é que o rótulo é um contrato entre esta tabela e
-- src/lib/peticao.ts: mudar de um lado sem o outro deixa o campo sem preencher.
create table if not exists public.peticao_templates (
  id             uuid primary key default gen_random_uuid(),
  nome           text not null,
  -- O que a descrição da tarefa precisa conter para este modelo ser sugerido.
  -- É lista, e EXPLÍCITA, em vez de derivada do nome: "homologação",
  -- "homologacao" e "homologatória" têm de cair no mesmo modelo. Também é o que
  -- desempata as três colisões do acervo — "sequestro", "registro público" e
  -- "RPV" aparecem no nome de dois modelos cada.
  palavras_chave text[] not null default '{}',
  conteudo       text not null default '',
  -- Doc de origem. Não é link vivo: serve de identidade estável para a carga
  -- inicial poder ser reexecutada sem duplicar (o nome pode ser editado na
  -- plataforma; este id, não).
  drive_file_id  text unique,
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
  'Modelos de petição em markdown. As lacunas são rótulos entre colchetes, resolvidos por src/lib/peticao.ts a partir do crédito e da ficha do cessionário.';
comment on column public.peticao_templates.palavras_chave is
  'Termos que, achados na descrição da tarefa, sugerem este modelo. Comparados sem acento e em minúsculas.';

notify pgrst, 'reload schema';

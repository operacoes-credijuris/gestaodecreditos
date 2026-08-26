-- Migração 0047: geração de contratos (.docx via gerar-contrato).
--
-- Traz para este banco só o que faltava da funcionalidade de contratos do
-- controledecessoes: as tabelas de origem (investidores/contratos_jobs) NÃO
-- vêm juntas de propósito — este projeto já tem `investidor_dados` (chave:
-- nome normalizado) com CPF/RG/banco/endereço, e criar uma segunda tabela de
-- investidor duplicaria exatamente o que a 0023 evitou ao não misturar com a
-- `investidores` antiga. Ver comentário de topo de
-- supabase/functions/gerar-contrato/index.ts para o resto da adaptação.

-- ---------------------------------------------------------------------------
-- 1. investidor_dados: gênero e complemento de qualificação
-- ---------------------------------------------------------------------------
-- Os templates de contrato precisam do gênero (concordância do texto — "neste
-- ato representada" vs "representado") e de um complemento livre pra estado
-- civil/profissão (PF) ou representante legal (PJ), que a ficha ainda não tem.
-- Mesma dupla de campos que a 0002/0003 do controledecessoes adicionou lá,
-- só que na tabela certa aqui.
alter table public.investidor_dados
  add column if not exists genero text,
  add column if not exists qualificacao_complemento text;

alter table public.investidor_dados
  drop constraint if exists investidor_dados_genero_valido;
alter table public.investidor_dados
  add constraint investidor_dados_genero_valido check (genero is null or genero in ('M', 'F'));

comment on column public.investidor_dados.genero is
  'M ou F — concordância de gênero nos contratos gerados (ex.: "representada" vs "representado"). Null tratado como masculino.';
comment on column public.investidor_dados.qualificacao_complemento is
  'Texto livre para a qualificação do contrato: estado civil e profissão (PF, ex. "casada, empresária") ou representante legal (PJ, ex. "neste ato representada por João da Silva, sócio-administrador").';

-- ---------------------------------------------------------------------------
-- 2. contratos: campos que a geração real precisa e o rascunho de {{var}} não tinha
-- ---------------------------------------------------------------------------
-- job_id agrupa as N linhas (uma por tipo) que uma mesma chamada de
-- gerar-contrato produz — não é chave de nada, só rótulo de lote pra tela.
-- investidor_nome substitui investidor_id pra este fluxo: `contratos.investidor_id`
-- continua existindo (aponta pra `investidores`, tabela do rascunho antigo) mas
-- fica null aqui, porque o investidor real mora em investidor_dados, sem uuid.
alter table public.contratos
  add column if not exists job_id uuid,
  add column if not exists investidor_nome text,
  add column if not exists drive_folder_url text;

comment on column public.contratos.job_id is
  'Agrupa as linhas geradas numa mesma chamada de gerar-contrato (uma linha por tipo de contrato). Não é chave — só rótulo de lote.';
comment on column public.contratos.investidor_nome is
  'Nome do investidor (cessionário), como veio de investidor_dados. Usado pela geração real; investidor_id fica null aqui.';
comment on column public.contratos.drive_folder_url is
  'Link da pasta "2. Contratos assinados" no Drive, onde o .docx gerado foi parar.';

-- Os 5 tipos reais de contrato que gerar-contrato produz, além dos 3 valores
-- do rascunho antigo (mantidos — não há dado para migrar, mas também nenhum
-- motivo pra apagar o que já existe).
alter table public.contratos drop constraint if exists contratos_tipo_check;
alter table public.contratos add constraint contratos_tipo_check check (tipo in (
  'cessao', 'investimento', 'outro',
  'cessao_credito', 'cessao_honorarios_contratuais', 'cessao_honorarios_sucumbenciais',
  'intermediacao', 'procuracao'
));

-- ---------------------------------------------------------------------------
-- 3. Storage: bucket dos 5 modelos .docx
-- ---------------------------------------------------------------------------
-- Upload de INPUT (documentos do cedente/escritório) reaproveita o bucket
-- `contratos` que já existe (0001_init.sql) — não precisa de bucket novo.
-- O bucket de TEMPLATES é novo: os .docx são enviados à mão no painel do
-- Supabase (mesma convenção de modelos-peticoes — quem mantém o modelo é
-- advogado, não quem faz deploy), então só a leitura é liberada pelo app.
insert into storage.buckets (id, name, public)
values ('contratos-templates', 'contratos-templates', false)
on conflict (id) do nothing;

drop policy if exists "contratos_templates_read" on storage.objects;
create policy "contratos_templates_read" on storage.objects
  for select to authenticated using (bucket_id = 'contratos-templates');

notify pgrst, 'reload schema';

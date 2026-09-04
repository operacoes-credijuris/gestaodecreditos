-- Migração 0053: cache da tabela de emolumentos de cartório, por UF e ano.
--
-- O motor de análise de RPV (gerar-analise-rpv) precisa do custo de cartório
-- para precificar: escritura pública de cessão + registro em títulos e
-- documentos. Até aqui esse custo saía de UMA tabela fixa no código — a de
-- Virginópolis-MG —, aplicada a crédito de qualquer estado. Decisão do dono:
-- a tabela passa a ser a DO ESTADO DO TRIBUNAL onde o crédito tramita, e quem
-- a encontra é a IA, por busca web na fonte oficial (Tribunal de Justiça,
-- Corregedoria, sindicato de notários).
--
-- ESTA TABELA É CACHE, e existe por dois motivos que não são "economizar":
--
--   1. TEMPO. A gerar-analise-rpv já faz duas chamadas grandes de IA por
--      análise e roda dentro do teto de tempo de parede da Edge Function.
--      Uma busca web a cada análise (10 a 30 s) é o que faltava para estourar
--      esse teto — e o usuário receberia "erro de rede" no lugar do parecer.
--      Com o cache, só a PRIMEIRA análise de cada UF no ano paga a busca.
--
--   2. CONSISTÊNCIA. Dois créditos de São Paulo analisados no mesmo mês têm de
--      usar a MESMA tabela. Sem cache, duas buscas podem achar fontes
--      diferentes e precificar cartório diferente para o mesmo estado.
--
-- Chave (uf, ano): as tabelas de emolumentos são publicadas por ano-exercício.
-- Virou o ano, a chave muda e a próxima análise busca de novo — não há rotina
-- de expiração para manter.
--
-- O CÓDIGO FUNCIONA SEM ESTA TABELA. Leitura e escrita estão em try/catch na
-- função: se a migração não rodou, cada análise busca na web e segue. Só fica
-- mais lenta. Isto está aqui de propósito, porque migração é passo manual e
-- não pode ser o que impede uma análise de sair.

create table if not exists public.emolumentos_uf (
  uf              char(2) not null,
  ano             int     not null,

  -- A tabela em si, no formato que o motor consome:
  --   {
  --     "escritura": { "faixas": [{"ate": 5000, "valor": 210.55}, ..., {"ate": null, "valor": 1890.00}],
  --                    "observacao": "..." },
  --     "registro":  { "faixas": [...], "observacao": "..." }
  --   }
  -- `ate` null = faixa aberta ("acima de X"). Valores em reais.
  tabela          jsonb   not null,

  -- Onde a IA achou cada parte. Sem fonte, a tabela não entra (regra da função,
  -- não do banco): emolumento é preço público, e número sem procedência num
  -- cálculo de deságio é pior que célula vazia.
  fontes          jsonb   not null default '[]'::jsonb,
  vigencia        text,                      -- como a fonte descreve o período ("2026", "a partir de 01/01/2026")

  atualizado_em   timestamptz not null default now(),
  atualizado_por  text,                      -- 'gerar-analise-rpv' ou o e-mail de quem corrigiu à mão

  primary key (uf, ano),
  constraint emolumentos_uf_uf_maiuscula check (uf = upper(uf))
);

comment on table public.emolumentos_uf is
  'Cache por UF/ano da tabela de emolumentos de cartório (escritura + registro) usada na precificação de RPV. Preenchida pela IA via busca web; pode ser corrigida à mão.';

-- ---------------------------------------------------------------------------
-- RLS: qualquer autenticado LÊ (a tela pode um dia mostrar de onde veio o
-- custo); só a Edge Function ESCREVE (service_role ignora RLS). Não há policy
-- de insert/update de propósito — a tabela alimenta um cálculo de dinheiro, e
-- deixar o navegador gravá-la abriria caminho para um valor errado entrar no
-- deságio sem passar pela função que exige fonte.
-- ---------------------------------------------------------------------------
alter table public.emolumentos_uf enable row level security;

drop policy if exists "emolumentos_uf_select" on public.emolumentos_uf;
create policy "emolumentos_uf_select" on public.emolumentos_uf
  for select to authenticated using (true);

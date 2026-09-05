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
-- ESTA TABELA NÃO É SÓ CACHE: É O QUE TORNA O LEVANTAMENTO POSSÍVEL.
--
--   1. O LEVANTAMENTO É LENTO E SEMPRE SERÁ. Achar o provimento do estado,
--      abrir o PDF anexo e ler as linhas numéricas é uma pesquisa de verdade:
--      leva de dois a cinco minutos. Isso não cabe numa requisição que a
--      pessoa espera na tela — a primeira versão estourava em 140 s e a
--      análise saía sem cartório. Agora a busca roda em SEGUNDO PLANO no
--      servidor (EdgeRuntime.waitUntil) e grava aqui; a tela pergunta a cada
--      poucos segundos se já chegou. Sem esta tabela não há onde o trabalho de
--      fundo depositar o resultado, e a única saída é esperar na requisição.
--
--   2. UMA VEZ POR ESTADO, PARA SEMPRE. São 27 tabelas no país inteiro. Paga-se
--      a pesquisa uma vez por UF no ano e todo preço seguinte sai em
--      microssegundos, porque o que se guarda aqui é a REGRA DE CÁLCULO — as
--      faixas e os acréscimos —, não um valor para um preço específico.
--
--   3. CONSISTÊNCIA. Dois créditos de São Paulo analisados no mesmo mês têm de
--      usar a MESMA tabela. Sem cache, duas buscas podem achar fontes
--      diferentes e precificar cartório diferente para o mesmo estado.
--
-- Chave (uf, ano): as tabelas de emolumentos são publicadas por ano-exercício.
-- Virou o ano, a chave muda e a próxima análise busca de novo — não há rotina
-- de expiração para manter.
--
-- O CÓDIGO NÃO QUEBRA SEM ESTA TABELA. Leitura e escrita estão em try/catch: se
-- a migração não rodou, a função cai no modo antigo (busca dentro da própria
-- requisição) e avisa na tela que é isso que está acontecendo. Mas nesse modo o
-- levantamento provavelmente vai estourar o tempo, e o preço sai sem cartório.

create table if not exists public.emolumentos_uf (
  uf              char(2) not null,
  ano             int     not null,

  -- Em que pé está o levantamento deste estado. A linha nasce 'levantando'
  -- ANTES da pesquisa começar, e é isso que impede duas abas (ou duas análises
  -- do mesmo estado ao mesmo tempo) de dispararem a mesma pesquisa em paralelo.
  --   levantando -> a pesquisa está rodando agora, em segundo plano
  --   pronta     -> `tabela` tem a regra
  --   falhou     -> a pesquisa terminou sem achar; `motivo` diz o quê
  status          text    not null default 'pronta'
                  constraint emolumentos_uf_status check (status in ('levantando', 'pronta', 'falhou')),
  motivo          text,   -- por que falhou, em português, para aparecer na tela

  -- A REGRA DE CÁLCULO no formato que o motor consome. Null enquanto
  -- 'levantando' ou 'falhou'.
  --   {
  --     "regra": {
  --       "escritura": { "faixas":     [{"de":0,"ate":5000,"valor":210.55}, ...,
  --                                     {"de":50000,"ate":null,"fixo":500,"percentual":0.005,"sobre_excedente":true}],
  --                      "acrescimos": [{"nome":"TSNR","percentual":0.002,"base":"valor","teto_emolumento":true},
  --                                     {"nome":"Selo digital","valor":3.50,"base":"valor"}] },
  --       "registro":  { "faixas": [...] }
  --     },
  --     "observacao": "de onde saiu e o que ficou de fora"
  --   }
  -- `ate` null = faixa aberta ("acima de X"). Valores em reais, percentual em
  -- fração. As três formas de tabela do país cabem aqui: valor fixo por faixa,
  -- percentual sobre o valor, e parcela fixa mais percentual sobre o excedente.
  tabela          jsonb,

  -- Onde a IA achou cada parte. Sem fonte, a tabela não entra (regra da função,
  -- não do banco): emolumento é preço público, e número sem procedência num
  -- cálculo de deságio é pior que célula vazia.
  fontes          jsonb   not null default '[]'::jsonb,
  vigencia        text,                      -- como a fonte descreve o período ("2026", "a partir de 01/01/2026")

  atualizado_em   timestamptz not null default now(),
  atualizado_por  text,                      -- 'gerar-analise-rpv' ou o e-mail de quem corrigiu à mão

  primary key (uf, ano),
  constraint emolumentos_uf_uf_maiuscula check (uf = upper(uf)),
  -- 'pronta' sem tabela seria um cache que devolve vazio para sempre, e o
  -- estado só sai de 'levantando' quando a pesquisa termina.
  constraint emolumentos_uf_pronta_tem_tabela check (status <> 'pronta' or tabela is not null)
);

-- ---------------------------------------------------------------------------
-- Se a versão ANTERIOR desta migração já rodou, o `create table if not exists`
-- acima não faz nada e a tabela fica sem `status` nem `motivo` — e aí a função
-- volta a pesquisar dentro da requisição e a estourar o tempo, sem dizer por
-- quê. Estes comandos são idempotentes e acertam os dois casos.
-- ---------------------------------------------------------------------------
alter table public.emolumentos_uf
  add column if not exists status text not null default 'pronta',
  add column if not exists motivo text;

-- `tabela` nasceu NOT NULL na versão anterior; uma linha 'levantando' ainda não
-- tem tabela nenhuma.
alter table public.emolumentos_uf alter column tabela drop not null;

-- O QUE JÁ ESTÁ GRAVADO pode estar no formato ANTIGO. A versão anterior punha a
-- tabela solta em `tabela` ({"escritura":..., "registro":...}); a de agora põe
-- a regra dentro de `tabela->'regra'`, porque o que se guarda deixou de ser uma
-- lista de faixas e passou a ser a regra de cálculo com acréscimos.
--
-- Uma linha velha marcada 'pronta' seria lida como regra vazia e o cache
-- responderia "pronta, sem regra" para sempre: a tela diria que não conseguiu
-- levantar, sem motivo, e nada pesquisaria de novo. Apagar é o certo — a linha
-- não tem dado aproveitável, e a próxima análise daquele estado refaz a
-- pesquisa sozinha.
delete from public.emolumentos_uf
 where tabela is null or not jsonb_exists(tabela, 'regra');

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.emolumentos_uf'::regclass and conname = 'emolumentos_uf_status'
  ) then
    alter table public.emolumentos_uf
      add constraint emolumentos_uf_status check (status in ('levantando', 'pronta', 'falhou'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.emolumentos_uf'::regclass and conname = 'emolumentos_uf_pronta_tem_tabela'
  ) then
    alter table public.emolumentos_uf
      add constraint emolumentos_uf_pronta_tem_tabela check (status <> 'pronta' or tabela is not null);
  end if;
end $$;

comment on table public.emolumentos_uf is
  'Regra de cálculo dos emolumentos de cartório (escritura + registro) por UF/ano, usada na precificação de RPV. Levantada em segundo plano pela IA por busca web; pode ser corrigida à mão. `status` controla o levantamento e evita pesquisas duplicadas.';
comment on column public.emolumentos_uf.status is
  'levantando = pesquisa rodando agora (linha criada antes de começar, serve de trava); pronta = regra em `tabela`; falhou = ver `motivo`.';
comment on column public.emolumentos_uf.atualizado_em is
  'Também é o relógio da trava: uma linha "levantando" parada há mais de alguns minutos é considerada abandonada (worker morto) e a próxima consulta reinicia a pesquisa.';

-- ---------------------------------------------------------------------------
-- RLS: qualquer autenticado LÊ (a tela mostra de onde veio o custo e em que pé
-- está o levantamento); só a Edge Function ESCREVE (service_role ignora RLS).
-- Não há policy de insert/update de propósito — a tabela alimenta um cálculo de
-- dinheiro, e deixar o navegador gravá-la abriria caminho para um valor errado
-- entrar no deságio sem passar pela função que exige fonte.
-- ---------------------------------------------------------------------------
alter table public.emolumentos_uf enable row level security;

drop policy if exists "emolumentos_uf_select" on public.emolumentos_uf;
create policy "emolumentos_uf_select" on public.emolumentos_uf
  for select to authenticated using (true);

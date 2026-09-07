-- Os tetos de RPV, por UF e esfera, com pesquisa pela IA quando faltar.
--
-- ERAM UM MAPA FIXO NO CÓDIGO (TETOS_RPV em gerar-analise-rpv), com 27 estados e
-- as capitais, e um salário mínimo constante ao lado. Dois problemas:
--
--   1. MUDAM TODO ANO, e o código não muda junto. O motor sabia disso e avisava
--      "TABELA DEFASADA" em toda análise depois da virada — um aviso que ninguém
--      pode resolver na hora, repetido até alguém editar o código e fazer
--      deploy. Aviso que não tem ação vira ruído, e ruído se ignora.
--   2. O QUE FALTAVA, FALTAVA EM SILÊNCIO. Município que não é capital, teto
--      municipal de DF (não existe), estado com lei nova: `TETOS_RPV[uf]`
--      devolvia undefined e `checarTetoRPV` retornava null — ou seja, "está
--      dentro do teto". Ausência de dado saía como aprovação.
--
-- AGORA É CACHE COM PESQUISA, o mesmo desenho de emolumentos_uf (0053): a linha
-- que falta nasce 'pesquisando', a IA procura na fonte oficial em segundo plano
-- e grava aqui; a análise seguinte daquele estado já sai com o teto conferido.
-- A análise que disparou a pesquisa NÃO espera — ela avisa que o teto ainda não
-- foi verificado, que é a verdade, em vez de afirmar que o valor está dentro.
--
-- CHAVE (uf, esfera, ano). O ano na chave é o que faz a virada do calendário
-- pedir pesquisa nova sem rotina de expiração para manter: em janeiro não há
-- linha do ano corrente, e a primeira análise de cada estado a cria.
--
-- 'BR'/'federal' é a linha do teto federal — 60 salários mínimos (Lei
-- 10.259/2001, art. 17, §1º). Fica na mesma tabela porque a pergunta é a mesma e
-- quem consulta não deveria precisar saber de duas fontes.
--
-- O SEED ABAIXO É O MAPA QUE ESTAVA NO CÓDIGO, tal como estava, marcado
-- `origem = 'seed'`. Ele continua valendo enquanto ninguém o revisar — a
-- diferença é que agora dá para revisar sem deploy, e a pesquisa da IA sabe
-- distinguir o que ela apurou (`origem = 'busca'`) do que veio herdado.

create table if not exists public.rpv_tetos (
  uf       char(2) not null,
  esfera   text    not null check (esfera in ('federal', 'estadual', 'municipal')),
  ano      int     not null,

  -- O teto em reais. NULL com status 'pronto' é resposta legítima e não é o
  -- mesmo que linha ausente: significa "apurado, e este ente não tem teto
  -- próprio" (o DF não tem municípios) ou "a lei não fixa valor".
  valor    numeric(15,2),

  -- Quando a lei fixa em salários mínimos, e não em reais. Guardado ao lado do
  -- valor porque é o que permite conferir a conta quando o mínimo muda.
  em_salarios numeric(6,2),

  status   text not null default 'pronto'
           check (status in ('pesquisando', 'pronto', 'falhou')),
  motivo   text,          -- por que falhou, em português, para aparecer na tela

  fonte    text,          -- URL ou nome da norma
  vigencia text,          -- "Lei estadual nº 1.234/2025", "EC 62/2009"

  origem   text not null default 'seed'
           check (origem in ('seed', 'busca', 'manual')),

  -- Quando a pesquisa em curso começou. É o que distingue pesquisa viva de
  -- pesquisa morta (worker derrubado no meio) sem precisar de rotina de limpeza.
  pesquisa_desde timestamptz,

  -- Quantas vezes já falhou. O repouso entre tentativas cresce com isto, senão
  -- um estado cuja fonte não existe é pesquisado para sempre, a cada análise.
  falhas   int not null default 0,

  atualizado_em timestamptz not null default now(),
  atualizado_por text,

  primary key (uf, esfera, ano),

  -- 'pronto' sem valor E sem justificativa é o furo que devolveria "sem teto"
  -- para um estado que tem: ou há número, ou há motivo escrito dizendo por que
  -- não há.
  constraint rpv_tetos_pronto_explicado
    check (status <> 'pronto' or valor is not null or motivo is not null)
);

create index if not exists rpv_tetos_pendentes_idx
  on public.rpv_tetos (status) where status in ('pesquisando', 'falhou');

alter table public.rpv_tetos enable row level security;

-- Leitura para qualquer autenticado (a tela mostra o teto no aviso); escrita só
-- pela service_role, porque quem grava é a pesquisa da IA e um teto errado
-- reprova ou aprova crédito.
drop policy if exists "rpv_tetos_select" on public.rpv_tetos;
create policy "rpv_tetos_select" on public.rpv_tetos
  for select to authenticated using (true);

-- ============================================================
-- Seed: o mapa que estava no código, ano 2026
-- ============================================================
insert into public.rpv_tetos (uf, esfera, ano, valor, status, origem, vigencia, motivo, atualizado_por)
select v.uf, v.esfera, v.ano, v.valor, 'pronto', 'seed',
       'tabela do jurídico, exercício 2026',
       case when v.valor is null then 'o mapa herdado não trazia valor para esta esfera' end,
       'migration 0057'
  from (values
  ('AC', 'estadual', 2026, 11347.00),
  ('AC', 'municipal', 2026, 16210.00),
  ('AL', 'estadual', 2026, 8475.55),
  ('AL', 'municipal', 2026, 21073.00),
  ('AM', 'estadual', 2026, 32420.00),
  ('AM', 'municipal', 2026, 24315.00),
  ('AP', 'estadual', 2026, 16210.00),
  ('AP', 'municipal', 2026, 48630.00),
  ('BA', 'estadual', 2026, 16210.00),
  ('BA', 'municipal', 2026, 11010.97),
  ('CE', 'estadual', 2026, 15746.80),
  ('CE', 'municipal', 2026, 8475.55),
  ('DF', 'estadual', 2026, 32420.00),
  ('DF', 'municipal', 2026, null),
  ('ES', 'estadual', 2026, 21827.28),
  ('ES', 'municipal', 2026, 48630.00),
  ('GO', 'estadual', 2026, 16210.00),
  ('GO', 'municipal', 2026, 48630.00),
  ('MA', 'estadual', 2026, 32420.00),
  ('MA', 'municipal', 2026, 8475.55),
  ('MG', 'estadual', 2026, 27345.69),
  ('MG', 'municipal', 2026, 8475.55),
  ('MS', 'estadual', 2026, 27655.50),
  ('MS', 'municipal', 2026, 10099.18),
  ('MT', 'estadual', 2026, 26010.00),
  ('MT', 'municipal', 2026, 8475.55),
  ('PA', 'estadual', 2026, 48630.00),
  ('PA', 'municipal', 2026, 48630.00),
  ('PB', 'estadual', 2026, 16210.00),
  ('PB', 'municipal', 2026, 8475.55),
  ('PE', 'estadual', 2026, 64840.00),
  ('PE', 'municipal', 2026, 48630.00),
  ('PI', 'estadual', 2026, 8475.55),
  ('PI', 'municipal', 2026, 11347.00),
  ('PR', 'estadual', 2026, 24782.81),
  ('PR', 'municipal', 2026, 8537.55),
  ('RJ', 'estadual', 2026, 32420.00),
  ('RJ', 'municipal', 2026, 16210.00),
  ('RN', 'estadual', 2026, 32420.00),
  ('RN', 'municipal', 2026, 16210.00),
  ('RO', 'estadual', 2026, 16210.00),
  ('RO', 'municipal', 2026, 16210.00),
  ('RR', 'estadual', 2026, 27557.00),
  ('RR', 'municipal', 2026, 24315.00),
  ('RS', 'estadual', 2026, 16210.00),
  ('RS', 'municipal', 2026, 48630.00),
  ('SC', 'estadual', 2026, 16210.00),
  ('SC', 'municipal', 2026, 8475.55),
  ('SE', 'estadual', 2026, 8475.55),
  ('SE', 'municipal', 2026, 8475.55),
  ('SP', 'estadual', 2026, 16913.00),
  ('SP', 'municipal', 2026, 31667.41),
  ('TO', 'estadual', 2026, 16210.00),
  ('TO', 'municipal', 2026, 24315.00)
  ) as v(uf, esfera, ano, valor)
 where not exists (
   select 1 from public.rpv_tetos t
    where t.uf = v.uf and t.esfera = v.esfera and t.ano = v.ano
 );

-- O teto federal: 60 salários mínimos (Lei 10.259/2001, art. 17, §1º).
-- Salário mínimo de 2026 = R$ 1.621,00, o mesmo número que estava no código.
insert into public.rpv_tetos (uf, esfera, ano, valor, em_salarios, status, origem, vigencia, atualizado_por)
select 'BR', 'federal', 2026, 97260.00, 60, 'pronto', 'seed',
       'Lei 10.259/2001, art. 17, §1º — 60 × salário mínimo de R$ 1.621,00',
       'migration 0057'
 where not exists (
   select 1 from public.rpv_tetos t
    where t.uf = 'BR' and t.esfera = 'federal' and t.ano = 2026
 );

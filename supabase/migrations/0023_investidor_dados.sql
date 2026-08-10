-- Migração 0023: dados cadastrais dos investidores.
--
-- Alimenta a aba "Dados dos investidores" das Carteiras. Os investidores NÃO têm
-- cadastro próprio no sistema: são os CESSIONÁRIOS distintos que aparecem nos
-- Créditos. Logo, esta tabela não cria investidor nenhum — ela só guarda os
-- dados de quem já existe lá, e a chave é o nome normalizado.
--
-- POR QUE UMA TABELA NOVA, e não a `investidores` que já existe: aquela é um
-- cadastro manual com id próprio, usado pelo painel de Cessões, e não tem
-- vínculo com o campo cessionario dos Créditos. Misturar as duas faria um
-- cadastro responder por dois conceitos diferentes.
--
-- nome_chave: o nome sem acento, sem espaço duplicado e em minúsculas, gerado
-- pelo MESMO normalizador que a tela usa para agrupar (normalizarNome em
-- lib/format.ts). É o que faz "José da Silva" e "jose da  silva" caírem na
-- mesma linha.
create table if not exists public.investidor_dados (
  nome_chave     text primary key,
  -- Nome como foi visto por último, só para exibição e conferência.
  nome_exibicao  text,
  cpf            text,
  rg             text,
  banco          text,
  agencia        text,
  conta          text,
  pix            text,
  endereco       text,
  atualizado_em  timestamptz not null default now(),
  atualizado_por uuid references auth.users(id) on delete set null
);

alter table public.investidor_dados enable row level security;

-- Leitura e escrita por qualquer autenticado, como nos parâmetros de
-- atualização: é dado operacional que a equipe mantém, não segredo de
-- integração. Quem alterou e quando fica registrado.
drop policy if exists "investidor_dados_select" on public.investidor_dados;
create policy "investidor_dados_select" on public.investidor_dados
  for select to authenticated using (true);

drop policy if exists "investidor_dados_write" on public.investidor_dados;
create policy "investidor_dados_write" on public.investidor_dados
  for all to authenticated using (true) with check (true);

comment on table public.investidor_dados is
  'Dados cadastrais (CPF, RG, conta, Pix, endereço) dos investidores. A lista de investidores vem dos cessionários dos Créditos; aqui só se guardam os dados, indexados pelo nome normalizado.';
comment on column public.investidor_dados.nome_chave is
  'Nome normalizado (sem acento, minúsculo, espaços colapsados) — mesma função da tela.';

notify pgrst, 'reload schema';

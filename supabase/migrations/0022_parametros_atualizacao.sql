-- Migração 0022: parâmetros de atualização monetária da carteira.
--
-- Alimentam a coluna "Valor projetado" da carteira do investidor. São GLOBAIS,
-- não por crédito: uma linha só, travada em id = 1 pelo check, no mesmo padrão
-- das tabelas de integração.
--
-- Os percentuais são guardados como o número que se digita na tela (15.00 para
-- 15% a.a.), e não como fração (0.15). Motivo: é o que o operador confere de
-- olho contra o boletim do Banco Central, e converter na leitura é trivial.
--
-- IPCA + 2% NÃO fica aqui: é derivado (ipca_12m_aa + 2) e gravar um derivado
-- abriria a chance de ele discordar da parcela que o originou.
create table if not exists public.parametros_atualizacao (
  id              int primary key default 1 check (id = 1),
  -- SELIC vigente, % ao ano.
  selic_aa        numeric,
  -- IPCA acumulado em 12 meses, % ao ano.
  ipca_12m_aa     numeric,
  -- Competência do relatório. Nasce como a data de hoje na tela e é editável.
  data_referencia date,
  atualizado_em   timestamptz not null default now(),
  atualizado_por  uuid references auth.users(id) on delete set null
);

alter table public.parametros_atualizacao enable row level security;

-- Leitura e ESCRITA por qualquer autenticado. Diferente das integrações, que
-- são só do admin: a SELIC e o IPCA são atualizados todo mês por quem monta o
-- relatório, e exigir o admin para isso emperraria a rotina. A prestação de
-- contas fica em atualizado_por/atualizado_em.
drop policy if exists "parametros_atualizacao_select" on public.parametros_atualizacao;
create policy "parametros_atualizacao_select" on public.parametros_atualizacao
  for select to authenticated using (true);

drop policy if exists "parametros_atualizacao_write" on public.parametros_atualizacao;
create policy "parametros_atualizacao_write" on public.parametros_atualizacao
  for all to authenticated using (true) with check (true);

-- Linha única já existente, para a tela poder só dar update.
insert into public.parametros_atualizacao (id) values (1) on conflict (id) do nothing;

comment on table public.parametros_atualizacao is
  'Parâmetros globais de atualização monetária (SELIC e IPCA) usados na projeção da carteira. Linha única.';
comment on column public.parametros_atualizacao.selic_aa is
  'SELIC vigente em % ao ano, como digitado (15.00 = 15%).';
comment on column public.parametros_atualizacao.ipca_12m_aa is
  'IPCA acumulado 12 meses em % ao ano, como digitado. IPCA + 2% é derivado na leitura.';

notify pgrst, 'reload schema';

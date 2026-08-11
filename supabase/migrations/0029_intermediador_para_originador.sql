-- Migração 0029: "intermediador" passa a se chamar ORIGINADOR.
--
-- É o nome certo do papel, e a hora de corrigir é agora: a coluna nasceu na 0027
-- e está VAZIA, então não há dado para converter nem histórico para preservar.
-- Deixar o banco com um nome e a tela com outro é a armadilha clássica — quem
-- mexer no código daqui a seis meses acha que são duas coisas diferentes.
--
-- ⚠️ ORDEM: rode esta migração junto com o deploy do frontend. Enquanto ela não
-- rodar, salvar crédito falha ("column originador does not exist"), porque a tela
-- nova grava no nome novo.

-- ---------------------------------------------------------------------------
-- 1. processos.intermediador -> processos.originador
-- ---------------------------------------------------------------------------
-- rename column não aceita "if exists", então vai dentro de uma guarda: assim a
-- migração pode ser rodada duas vezes, e também funciona se a 0027 não tiver
-- rodado (aí quem cria a coluna é o add abaixo).
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'processos'
      and column_name = 'intermediador'
  ) then
    alter table public.processos rename column intermediador to originador;
  end if;
end $$;

alter table public.processos
  add column if not exists originador text;

-- ---------------------------------------------------------------------------
-- 2. investidor_dados.tipo: 'intermediador' -> 'originador'
-- ---------------------------------------------------------------------------
-- O check sai primeiro, senão o update bate nele no meio do caminho.
alter table public.investidor_dados
  drop constraint if exists investidor_dados_tipo_check;

update public.investidor_dados
  set tipo = 'originador'
  where tipo = 'intermediador';

alter table public.investidor_dados
  add constraint investidor_dados_tipo_check
  check (tipo in ('investidor', 'originador'));

comment on column public.investidor_dados.tipo is
  'Papel: investidor (cessionário do crédito) ou originador (quem originou a aquisição). Faz parte da chave — a mesma pessoa pode ter os dois papéis, cada um com sua ficha.';

comment on column public.processos.originador is
  'Quem originou a aquisição do crédito. TEXTO, não cadastro: a aba "Dados pessoais e bancários" monta a lista de originadores a partir dos nomes distintos que aparecem aqui e das fichas cadastradas nela.';

notify pgrst, 'reload schema';

-- Verificação depois de rodar:
--   select tipo, count(*) from public.investidor_dados group by tipo;
--     -> nenhuma linha com 'intermediador'
--   select count(*) from public.processos where originador is not null;

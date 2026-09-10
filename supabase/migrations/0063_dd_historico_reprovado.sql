-- Migração 0063: a reprovação de UMA verba, e não do crédito inteiro.
--
-- O QUE ELA RECONHECE. Um card pode ceder duas coisas com DONOS DIFERENTES: o
-- principal, que é do exequente, e os honorários, que são do advogado. São
-- créditos distintos — os honorários destacados (art. 22, §4º da Lei 8.906/94)
-- não respondem pelas dívidas do exequente, e a penhora contra ele não os
-- alcança.
--
-- Até aqui a recusa era do CARD: achada uma execução contra o cedente, o card
-- inteiro ia para Reprovados e os honorários do advogado — que ninguém
-- questionou — morriam junto. Perdia-se um negócio bom por causa de outro ruim
-- que só divide o número do processo com ele.
--
-- Agora a recusa é do TITULAR. Reprovado o cedente, o principal sai da cessão e
-- a análise segue com os honorários; reprovado o advogado, o contrário. O card
-- só vai para Reprovados quando NÃO SOBRA VERBA NENHUMA.
--
-- POR QUE AQUI, e não numa tabela de "verbas reprovadas": a verba e o titular
-- são a mesma coisa vista de dois lados (principal ↔ cedente, honorários ↔
-- advogado), e dd_historico já é uma linha por titular. Uma tabela nova diria a
-- mesma coisa com uma junção a mais.

alter table public.dd_historico
  add column if not exists reprovado_em     timestamptz,
  add column if not exists reprovado_por    uuid references public.profiles (id) on delete set null,
  -- O TEXTO QUE A IA REDIGIU, guardado inteiro. Ele vai para dois lugares que
  -- não se falam: a anotação no card do Kommo, agora, e a linha 10 ou 11 da aba
  -- jurídica da planilha, quando a análise correr. Regravá-lo à mão no segundo
  -- lugar produziria duas versões da mesma razão.
  add column if not exists reprovado_motivo text;

comment on column public.dd_historico.reprovado_em is
  'Quando a verba DESTE titular foi recusada pela due diligence. O crédito do '
  'outro titular segue: o card só vai para Reprovados quando não sobra verba.';

-- REPROVADO SEM APURAÇÃO NÃO QUER DIZER NADA — mesma régua de liberado_em (0062):
-- só se recusa o que foi olhado, e olhar exige que a busca tenha corrido.
alter table public.dd_historico
  drop constraint if exists dd_historico_reprovado_exige_apurado;
alter table public.dd_historico
  add constraint dd_historico_reprovado_exige_apurado
  check (reprovado_em is null or status = 'APURADO');

-- LIBERADO E REPROVADO SÃO OPOSTOS, e um registro com os dois é um registro que
-- não diz nada: a planilha teria de escolher entre "não tem dívida" e "recusado
-- por dívida" sem critério. Quem muda de ideia limpa o outro campo.
alter table public.dd_historico
  drop constraint if exists dd_historico_liberado_ou_reprovado;
alter table public.dd_historico
  add constraint dd_historico_liberado_ou_reprovado
  check (liberado_em is null or reprovado_em is null);

notify pgrst, 'reload schema';

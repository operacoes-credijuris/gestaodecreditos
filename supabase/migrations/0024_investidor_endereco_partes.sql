-- Migração 0024: endereço do investidor em partes.
--
-- A EDIÇÃO passa a ser por campo (logradouro, número, complemento, bairro,
-- cidade, UF, CEP), e a TABELA continua mostrando o endereço em texto corrido,
-- compilado a partir das partes — pronto para colar em contrato.
--
-- Por que em partes, e não parsing do texto: número só com dígito, CEP com
-- formato fixo, UF entre as 27 e cidade entre os 5.571 municípios do IBGE só se
-- garantem se cada um for um campo. Reformatar texto livre corrompe as variações
-- legítimas ("Condomínio Nossa Senhora de Lourdes, Lote 5, Sala 201").
--
-- A coluna `endereco` FICA: guarda o texto como foi digitado antes desta
-- migração e serve de fallback na exibição enquanto um registro não tiver as
-- partes preenchidas. Quando tiver, as partes mandam.
alter table public.investidor_dados
  add column if not exists logradouro  text,
  add column if not exists numero      text,
  add column if not exists complemento text,
  add column if not exists bairro      text,
  add column if not exists cidade      text,
  add column if not exists uf          text,
  add column if not exists cep         text;

-- UF só entre as 27 siglas. Vale null (não informado), mas não vale sigla
-- inventada — é o tipo de erro que passa batido num campo de texto livre.
alter table public.investidor_dados
  drop constraint if exists investidor_dados_uf_valida;
alter table public.investidor_dados
  add constraint investidor_dados_uf_valida check (
    uf is null or uf in (
      'AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA',
      'PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO'
    )
  );

comment on column public.investidor_dados.endereco is
  'Texto corrido legado. A exibição prefere as partes; esta coluna é fallback de registro ainda sem elas.';

notify pgrst, 'reload schema';

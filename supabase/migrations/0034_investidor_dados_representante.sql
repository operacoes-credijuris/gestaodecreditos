-- Migração 0034: representante legal da pessoa jurídica.
--
-- POR QUE O CAMPO EXISTE: pessoa jurídica não assina — quem assina por ela é uma
-- pessoa física. Sem o nome do representante, o contrato de cessão e a petição de
-- homologação ficam sem quem qualificar do lado do cessionário PJ, e o dado
-- acabava vindo por fora da plataforma.
--
-- QUANDO APARECE: só quando o documento tem mais de 11 dígitos, ou seja, quando
-- é CNPJ (ver ehCnpj em lib/format.ts — é o mesmo gatilho que troca a máscara do
-- campo e o rótulo de "CPF" para "CNPJ"). Para pessoa física o campo nem é
-- exibido, e o salvamento grava null aqui: representante de si mesma não existe,
-- e um valor esquecido de quando o documento era CNPJ seria dado errado.
--
-- Anulável de propósito: as fichas existentes de PJ nascem sem representante, e o
-- lugar de preencher é a própria ficha, quando alguém for usá-la.
alter table public.investidor_dados
  add column if not exists representante text;

comment on column public.investidor_dados.representante is
  'Nome do representante legal, só para pessoa jurídica (documento com mais de 11 dígitos). Null em pessoa física.';

notify pgrst, 'reload schema';

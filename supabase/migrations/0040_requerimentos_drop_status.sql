-- Migração 0040: remove o status do requerimento administrativo.
--
-- A coluna nasceu na 0002 (pendente/protocolado/em_analise/deferido/indeferido) e
-- NUNCA chegou à tela: nenhuma listagem, ficha ou formulário a lê ou escreve, então
-- toda linha carrega o default 'pendente' — dado que parece informação e não é.
-- A auditoria visual de hoje apontou a lacuna ao dono, que decidiu EXCLUIR em vez
-- de expor: o desfecho do requerimento se acompanha pelas movimentações, não por um
-- campo digitado.
--
-- Seguro de largar: nada seleciona a coluna pelo nome (o assistente usa select('*'),
-- o frontend nunca teve o campo no tipo). O check constraint cai junto com ela.
alter table public.requerimentos
  drop column if exists status;

notify pgrst, 'reload schema';

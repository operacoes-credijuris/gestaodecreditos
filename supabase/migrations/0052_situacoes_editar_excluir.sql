-- Migração 0052: permite editar (nome/cor) e excluir uma situação do
-- catálogo. A 0051 só previa criar — sem isto não dava pra corrigir o nome
-- ou a cor de uma situação, nem descartar uma criada por engano.
--
-- Excluir é seguro: processos_fase.situacao_id já referencia esta tabela com
-- "on delete set null" (migração 0051), então apagar uma situação em uso só
-- limpa a seleção de quem estava com ela marcada, não quebra nada.
drop policy if exists "fase_situacoes_catalogo_update" on public.processos_fase_situacoes_catalogo;
create policy "fase_situacoes_catalogo_update" on public.processos_fase_situacoes_catalogo
  for update to authenticated using (true) with check (true);

drop policy if exists "fase_situacoes_catalogo_delete" on public.processos_fase_situacoes_catalogo;
create policy "fase_situacoes_catalogo_delete" on public.processos_fase_situacoes_catalogo
  for delete to authenticated using (true);

notify pgrst, 'reload schema';

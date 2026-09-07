-- Migração 0055: o navegador passa a GRAVAR no bucket analises-input.
--
-- POR QUÊ. A análise de RPV só lia PDF com texto selecionável: processo
-- digitalizado (comum em RPV antiga e de juizado) era recusado na porta, e a
-- conta da contadoria escaneada no meio de um processo digital simplesmente não
-- era lida — a IA concluía "não há conta". Não havia caminho para imagem.
--
-- AGORA O NAVEGADOR RENDERIZA AS PÁGINAS DIGITALIZADAS (pdf.js) e as sobe aqui,
-- em {user_id}/{job_id}/processo/; a função gerar-analise-rpv já sabia ler
-- imagens desse prefixo (era o fluxo antigo, por upload) e as manda à IA como
-- parte dos autos. Escolheu-se este caminho, e não OCR no navegador, porque a
-- leitura de tabela numérica pela IA é muito melhor que a de um OCR local — e é
-- a tabela que decide o preço.
--
-- O bucket já existe em produção (buscar-judit grava nele com service_role);
-- o insert é idempotente para ambientes novos. O que faltava eram as POLICIES:
-- sem elas o navegador (anon key + JWT) não grava nada.
--
-- ESCOPO POR PASTA: cada usuário só mexe no que está sob o próprio id. É a
-- mesma pasta que a função monta com o id do JWT, então não há como um usuário
-- injetar página na análise de outro. A limpeza é da função (service_role), mas
-- o delete próprio fica permitido para o navegador poder desfazer um upload.

insert into storage.buckets (id, name, public)
values ('analises-input', 'analises-input', false)
on conflict (id) do nothing;

drop policy if exists "analises_input_insert" on storage.objects;
create policy "analises_input_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'analises-input'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "analises_input_select" on storage.objects;
create policy "analises_input_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'analises-input'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- upsert = insert ou update; o update precisa da policy própria.
drop policy if exists "analises_input_update" on storage.objects;
create policy "analises_input_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'analises-input'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "analises_input_delete" on storage.objects;
create policy "analises_input_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'analises-input'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Migração 0031: o texto do modelo sai do banco e vai para o Storage.
--
-- A 0030 guardava o modelo inteiro na coluna `conteudo`. Mudou de desenho: os
-- dez modelos são arquivos .md no bucket `modelos-peticoes`, e esta tabela passa
-- a ser só o ÍNDICE — nome, palavras-chave e qual arquivo carregar.
--
-- POR QUE O ARQUIVO, e não o texto na coluna: quem mantém modelo de petição é
-- advogado, não quem faz deploy. Com arquivo, trocar um modelo é subir um arquivo
-- pelo painel do Supabase; com coluna, seria editar um textarea de oito mil
-- caracteres ou pedir a alguém que rode um UPDATE.
--
-- `arquivo` é o NOME dentro do bucket, com extensão, exatamente como está lá —
-- inclusive os espaços, que os nomes têm. Não guarda caminho nem URL: o bucket é
-- escolhido no código (lib/peticao.ts), e URL gravada em banco apodrece quando o
-- projeto muda de host.
alter table public.peticao_templates
  add column if not exists arquivo text;

-- O texto não mora mais aqui. Sem o drop, a coluna ficaria com o conteúdo velho
-- de uma carga anterior e alguém acabaria lendo dela por engano — dois lugares
-- respondendo pela mesma pergunta é como a plataforma já se machucou antes.
alter table public.peticao_templates
  drop column if exists conteudo;

-- Um modelo sem arquivo não tem o que gerar. Fica anulável porque a coluna nasce
-- vazia nas linhas que já existirem; a carga logo abaixo preenche.
create unique index if not exists peticao_templates_arquivo_idx
  on public.peticao_templates (arquivo);

comment on table public.peticao_templates is
  'Índice dos modelos de petição. O texto de cada um é um .md no bucket modelos-peticoes; aqui ficam o nome, as palavras que sugerem o modelo e o arquivo a carregar.';
comment on column public.peticao_templates.arquivo is
  'Nome do arquivo no bucket modelos-peticoes, com extensão e com os espaços que o nome tiver.';

notify pgrst, 'reload schema';

-- Carga dos 10 modelos de petição — só o índice.
--
-- O texto de cada modelo é um .md no bucket `modelos-peticoes`. Aqui ficam três
-- coisas: o nome que aparece na tela, o arquivo a carregar, e as palavras que,
-- achadas na descrição da tarefa, sugerem esse modelo.
--
-- Rode DEPOIS das migrações 0030 e 0031. Reexecutável: o conflito é pelo
-- `arquivo`, então rodar de novo atualiza nome e palavras-chave em vez de criar
-- linha repetida.
--
-- AS PALAVRAS-CHAVE resolvem as três colisões do acervo. "sequestro" aparece no
-- nome de dois modelos, "registro público" em dois e "RPV" em dois; por isso o
-- modelo mais específico recebe termos mais longos ("valor atualizado",
-- "dilação", "complementar"), e o desempate é pelo tamanho do termo que casou.
-- Sobrando empate, a janela mostra os candidatos e a pessoa escolhe: pedir
-- sequestro não é juntar planilha para fins de sequestro.
--
-- Os nomes de arquivo estão como no bucket, com espaços. O de comprovação tem um
-- espaço ANTES do ".md" — não é engano de digitação aqui, é o nome que está lá.

insert into public.peticao_templates (nome, arquivo, palavras_chave)
values
  ('Sequestro',
   'sequestro.md',
   array['sequestro','bloqueio de valores','penhora online']),

  ('Levantamento',
   'levantamento.md',
   array['levantamento','levantar valores','alvará de levantamento']),

  ('Juntada de valor atualizado do crédito para fins de sequestro',
   'valor atualizado do credito para fins de sequestro.md',
   array['valor atualizado','planilha de atualização','juntada de valor','atualização do débito']),

  ('Homologação de cessão de crédito de RPV',
   'homologacao de cessao de credito de RPV.md',
   array['homologação','homologar cessão','homologação de cessão','substituição do polo ativo']),

  ('RPV complementar',
   'RPV complementar.md',
   array['rpv complementar','complementar','complementação','pagamento insuficiente','depósito a menor']),

  ('Concordância com os cálculos',
   'concordancia com os calculos.md',
   array['concordância','concordância com os cálculos','cálculos']),

  ('Requer comprovação de pagamento',
   'requer comprovacao de pagamento .md',
   array['comprovação de pagamento','comprovante de pagamento','comprovar pagamento']),

  ('Ilegitimidade passiva do patrono',
   'ilegitimidade passiva do patrono.md',
   array['ilegitimidade','ex-patrono','patrono']),

  ('Juntada de registro público',
   'juntada de registro publico.md',
   array['juntada de registro','juntar registro','registro público juntada','contrato registrado']),

  ('Dilação de prazo para registro público',
   'dilacao de prazo para registro publico.md',
   array['dilação','dilação de prazo','prorrogação de prazo','prazo para registro'])
on conflict (arquivo) do update
  set nome           = excluded.nome,
      palavras_chave = excluded.palavras_chave,
      updated_at     = now();

-- Verificação depois de rodar:
--   select nome, arquivo, array_length(palavras_chave,1) as termos
--     from public.peticao_templates order by nome;
--   -> esperado: 10 linhas, todas com arquivo preenchido.

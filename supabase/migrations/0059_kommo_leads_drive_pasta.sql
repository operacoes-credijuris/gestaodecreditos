-- Migração 0059: a pasta do cedente no Drive, guardada no card.
--
-- PARA QUE SERVE: depois da primeira análise salva, existe no Drive uma pasta
-- por cedente (Análises de crédito / {categoria} / {originador} / {cedente}), e
-- é onde ficam as planilhas daquele processo. Chegar até ela hoje é abrir o
-- Drive e navegar três níveis, ou caçar o link numa anotação antiga do Kommo.
-- Com o id aqui, o TÍTULO DO CARD vira link direto para a pasta.
--
-- NÃO É INFORMAÇÃO, É ATALHO — mesma razão da 0033, que fez isto para
-- public.processos. Um id do Google não diz nada a quem usa a plataforma e não
-- aparece em tela nenhuma: ele só decide se o título é um link ou um texto.
--
-- POR QUE NÃO DERIVAR EM VEZ DE GUARDAR. O caminho parece dedutível — a pasta
-- tem o nome do cedente —, mas o nome que a pasta recebeu é o do credor COMO A
-- IA O LEU NOS AUTOS, em Title Case, e o card guarda o cedente como o comercial
-- o digitou. "Vanderlan Gomes de Morais" e "VANDERLAN G. MORAIS" são o mesmo
-- cedente e pastas diferentes. Além disso, achar a pasta custa três chamadas ao
-- Drive em sequência, o que é aceitável num botão e ruim num título, que parece
-- link e cria expectativa de resposta imediata.
--
-- ANULÁVEL DE PROPÓSITO: os cards já analisados nascem sem pasta resolvida, e o
-- título simplesmente não vira link até a próxima vez que uma análise daquele
-- card for salva. Preferir isso a uma migração de dados que teria de adivinhar
-- o nome da pasta de cada um — exatamente o problema que este campo evita.
--
-- SOBREVIVE À SINCRONIZAÇÃO: o kommo-sync faz upsert com uma lista FIXA de
-- colunas e esta não está nela, então o ON CONFLICT DO UPDATE não a toca. Quem
-- acrescentar coluna ao sync no futuro precisa saber disso — daí o comentário
-- ficar no banco, e não só aqui.
alter table public.kommo_leads
  add column if not exists drive_pasta_id text;

comment on column public.kommo_leads.drive_pasta_id is
  'Cache do id da pasta do cedente no Drive, gravado ao salvar a análise. Uso interno: torna o título do card um link para a pasta. Não exibir em tela, e NÃO incluir no upsert do kommo-sync (ele preservaria nulo por cima do id).';

notify pgrst, 'reload schema';

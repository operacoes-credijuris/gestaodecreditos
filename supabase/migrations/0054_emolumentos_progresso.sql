-- Migração 0054: o levantamento de emolumentos passa a ter etapas, e elas
-- precisam de onde guardar o que já foi feito.
--
-- POR QUE ISTO EXISTE. A Edge Function tem um teto de tempo de parede que nada
-- contorna: 400 s no plano pago, 150 s no gratuito. `EdgeRuntime.waitUntil`
-- deixa o trabalho continuar depois da resposta, mas NÃO estende esse teto.
--
-- A pesquisa da tabela de emolumentos — achar o provimento do estado, abrir o
-- PDF anexo, ler as linhas dos dois atos — passa disso com folga. O worker era
-- morto no meio, a linha ficava presa em 'levantando', a trava de 8 minutos
-- expirava e a tentativa seguinte recomeçava do zero. Um laço que nunca fechava,
-- e na tela só aparecia "a pesquisa passou de 6 minutos".
--
-- Agora cada etapa roda numa INVOCAÇÃO NOVA, com o relógio zerado, e faz uma
-- coisa pequena:
--
--   achar     -> só busca, sem abrir arquivo: onde está o documento oficial
--   escritura -> abre o documento e lê a tabela da escritura
--   registro  -> lê a tabela do registro, e consolida
--
-- Entre uma etapa e a seguinte só viajam os endereços encontrados e o que já
-- foi extraído. É esta coluna que carrega isso. Sem ela não há encadeamento
-- possível — cada invocação começaria sem saber o que a anterior descobriu.
--
-- É o mesmo padrão de invocações encadeadas que advbox-movimentacoes usa para
-- não estourar o limite; a diferença é que lá a fila viaja no corpo da chamada
-- e aqui ela viaja no banco, porque precisa sobreviver a um worker morto.

alter table public.emolumentos_uf
  add column if not exists progresso jsonb;

comment on column public.emolumentos_uf.progresso is
  'Estado do levantamento entre etapas: {"etapa":"achar|escritura|registro","documentos":[urls],"escritura":regra|null,"registro":regra|null,"fontes":[],"vigencia":null,"observacoes":[],"passos":n}. Null quando o levantamento terminou. `passos` corta laço: acima de 6 o levantamento desiste.';

-- Linhas paradas em 'levantando' são de tentativas que morreram no teto de
-- tempo, antes desta migração. Sem progresso elas recomeçariam do zero de
-- qualquer forma; marcar como falhou faz a próxima consulta reiniciar limpo e
-- com um motivo legível, em vez de a tela esperar a trava de 8 minutos vencer.
update public.emolumentos_uf
   set status = 'falhou',
       motivo = 'levantamento interrompido pelo limite de tempo da versão anterior; será refeito em etapas',
       atualizado_em = now() - interval '1 hour'
 where status = 'levantando';

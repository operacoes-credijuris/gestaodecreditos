-- A aba "Dados dos investidores" saiu de dentro das Carteiras e virou aba
-- própria, "Dados pessoais e bancários", que passa a guardar TAMBÉM os dados dos
-- intermediadores. Duas mudanças de dado para isso.

-- ---------------------------------------------------------------------------
-- 1. processos.intermediador — quem intermediou a aquisição do crédito
-- ---------------------------------------------------------------------------
-- POR QUE UMA COLUNA NO CRÉDITO, e não um cadastro à parte: é assim que o
-- investidor já funciona. A lista de investidores da plataforma não é um
-- cadastro — são os CESSIONÁRIOS distintos que aparecem nos Créditos. Fazer o
-- intermediador do mesmo jeito mantém UMA regra para as duas metades da aba: o
-- nome nasce no crédito, e a aba só guarda os dados de quem já existe lá.
--
-- A alternativa considerada era derivar do título do card do Kommo (que é de
-- onde a Análise de Crédito tira o intermediador hoje, com
-- `nome.split(' - ')[0]`). Ficou de fora porque o card vive no funil de análise:
-- inclui quem nunca virou crédito e desaparece quando o card sai do funil, então
-- a ficha bancária de alguém poderia sumir da tela sem nada ter sido apagado.
--
-- Sem NOT NULL nem default: os 95 créditos já cadastrados nascem sem
-- intermediador, e "não informado" é ausência de valor, não string vazia.
alter table public.processos
  add column if not exists intermediador text;

-- Índice não entra: a coluna é lida em varredura completa (a aba monta a lista
-- de nomes distintos percorrendo todos os créditos) e a tabela tem 95 linhas.

-- ---------------------------------------------------------------------------
-- 2. investidor_dados passa a valer para os dois papéis
-- ---------------------------------------------------------------------------
-- A chave era só o nome normalizado. Agora é (tipo, nome_chave), porque a MESMA
-- pessoa pode ser investidora num crédito e intermediadora em outro, e nesse
-- caso cada papel tem ficha própria — decisão do dono. Com a chave antiga, o
-- segundo papel sobrescreveria os dados do primeiro em silêncio.
--
-- O nome da tabela fica `investidor_dados` de propósito, mesmo cobrindo os dois
-- papéis: renomear obrigaria a mexer nas policies, no frontend e no que já está
-- gravado, sem nenhum ganho de comportamento. O `tipo` é que diz o papel.
alter table public.investidor_dados
  add column if not exists tipo text not null default 'investidor';

-- O check aceita só os dois papéis que a aba conhece: linha com tipo inventado
-- não apareceria em nenhuma das visões e seria dado invisível.
alter table public.investidor_dados
  drop constraint if exists investidor_dados_tipo_check;
alter table public.investidor_dados
  add constraint investidor_dados_tipo_check
  check (tipo in ('investidor', 'intermediador'));

-- Troca da chave primária. As linhas que já existem ficam como 'investidor' pelo
-- default acima, então nada precisa ser convertido à mão.
alter table public.investidor_dados
  drop constraint if exists investidor_dados_pkey;
alter table public.investidor_dados
  add primary key (tipo, nome_chave);

-- Verificação depois de rodar:
--   select tipo, count(*) from public.investidor_dados group by tipo;
--     -> esperado: investidor | 21   (as fichas que já existiam)
--   select count(*) from public.processos where intermediador is not null;
--     -> esperado: 0 (a coluna nasce vazia; preenchida pela tela de Créditos)

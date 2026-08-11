-- Migração 0028: investidor_dados passa a poder NASCER sem crédito.
--
-- Nada de estrutura muda aqui — a tabela já aceitava a linha, e o `tipo` veio na
-- 0027. O que muda é a REGRA, e ela estava escrita nos comentários da 0023 ("esta
-- tabela não cria investidor nenhum"), que agora dizem o contrário do que o
-- sistema faz. Comentário errado no banco é pior que comentário nenhum: é onde se
-- olha para entender a tabela sem ler o frontend.
--
-- POR QUE MUDOU: o comercial vem antes do operacional. O investidor é cadastrado
-- para se fazer o CONTRATO, e o crédito só é lançado quando o negócio fecha.
-- Exigir crédito para existir ficha invertia a ordem do trabalho — a ficha
-- gravada ficaria invisível na tela até alguém lançar o crédito.
--
-- A ligação entre a ficha e o crédito continua sendo o NOME NORMALIZADO, e não
-- uma chave estrangeira. É o que o formulário de Créditos passou a proteger, ao
-- oferecer os nomes que já existem nos campos Cessionário e Intermediador.

comment on table public.investidor_dados is
  'Dados cadastrais (CPF, RG, conta, Pix, endereço) de investidores e intermediadores, por papel. A lista tem duas origens: os nomes que aparecem nos Créditos (cessionario/intermediador) e as pessoas cadastradas direto na aba, antes de existir crédito. A ligação é o nome normalizado.';

comment on column public.investidor_dados.nome_exibicao is
  'Nome como foi digitado. Em quem tem crédito serve de conferência (a grafia do crédito é a que aparece na tela); em quem foi cadastrado sem crédito é o ÚNICO nome legível que existe.';

comment on column public.investidor_dados.tipo is
  'Papel: investidor (cessionário do crédito) ou intermediador. Faz parte da chave — a mesma pessoa pode ter os dois papéis, cada um com sua ficha.';

notify pgrst, 'reload schema';

-- O teto municipal é DE CADA MUNICÍPIO, não do estado.
--
-- A 0057 guardou o teto municipal por UF, e o número semeado é o da CAPITAL —
-- foi assim que o mapa nasceu no código. Só que quem fixa o teto da RPV
-- municipal é o próprio município, por lei sua (CF, art. 100, §4º). Comparar um
-- crédito contra o Município de Anápolis com o teto de Goiânia é comparar com a
-- lei errada, e o erro anda para os dois lados:
--
--   • teto da capital MAIOR que o do município → o crédito passa sem alerta, e
--     na hora de receber descobre-se que precisava de renúncia;
--   • teto da capital MENOR → alerta de renúncia num crédito que não precisa,
--     e o comercial negocia para baixo à toa.
--
-- E há um terceiro caso, o mais comum nos municípios pequenos: o que NUNCA
-- legislou segue o piso do ADCT, art. 87 — 30 salários mínimos —, que não tem
-- relação nenhuma com o número da capital.
--
-- ENTÃO O MUNICÍPIO ENTRA NA CHAVE. As linhas que já existem viram a
-- REFERÊNCIA DA CAPITAL (municipio = ''), que continua servindo enquanto a
-- pesquisa do município específico não chega — mas agora o motor SABE que é
-- referência, e o aviso diz isso em vez de afirmar um teto que não foi apurado.

-- ============================================================
-- 1. A coluna e a chave de comparação
-- ============================================================

-- '' (e não NULL) porque a coluna entra na chave primária, e chave não aceita
-- nulo. Vazio quer dizer "não é de um município específico": é a referência da
-- capital nas linhas municipais, e é o valor natural nas linhas estadual e
-- federal, onde a pergunta não se aplica.
alter table public.rpv_tetos
  add column if not exists municipio text not null default '';

-- A chave compara SEM ACENTO E SEM CAIXA. "Anápolis", "ANAPOLIS" e "anápolis"
-- são o mesmo município, e a IA, o Kommo e os autos escrevem dos três jeitos —
-- sem normalizar, o cache guardaria três linhas e pesquisaria três vezes.
-- Coluna gerada, e não normalização na aplicação: a tabela é escrita também
-- pelo SQL Editor, e regra de identidade que mora só no TypeScript é contornada
-- na primeira vez que alguém insere à mão.
alter table public.rpv_tetos
  add column if not exists municipio_chave text
  generated always as (
    lower(translate(
      municipio,
      'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ',
      'AAAAAEEEEIIIIOOOOOUUUUCNaaaaaeeeeiiiiooooouuuucn'
    ))
  ) stored;

-- ============================================================
-- 2. A chave primária passa a incluir o município
-- ============================================================
--
-- Feito em duas etapas e com IF EXISTS porque a 0057 pode ter rodado ou não:
-- este arquivo tem de ser seguro nos dois casos e ao rodar duas vezes.
alter table public.rpv_tetos drop constraint if exists rpv_tetos_pkey;
alter table public.rpv_tetos
  add constraint rpv_tetos_pkey primary key (uf, esfera, municipio_chave, ano);

-- ============================================================
-- 3. As linhas municipais que já existem são da CAPITAL
-- ============================================================
--
-- Elas continuam valendo como referência — é melhor um número com a origem dita
-- do que nenhum número —, mas param de se apresentar como o teto apurado
-- daquele município. `origem = 'capital'` é o que o motor lê para escrever
-- "referência da capital" no aviso em vez de afirmar o valor.
alter table public.rpv_tetos drop constraint if exists rpv_tetos_origem_check;
alter table public.rpv_tetos
  add constraint rpv_tetos_origem_check
  check (origem in ('seed', 'busca', 'manual', 'capital'));

update public.rpv_tetos
   set origem = 'capital',
       motivo = coalesce(motivo, '') ||
                case when coalesce(motivo, '') = '' then '' else ' ' end ||
                'Valor da CAPITAL do estado, herdado do mapa antigo: serve de referência enquanto o teto do município do crédito não for apurado.',
       atualizado_por = 'migration 0058'
 where esfera = 'municipal'
   and municipio = ''
   and origem = 'seed';

-- ============================================================
-- 4. Índice de leitura
-- ============================================================
--
-- A consulta mais frequente é "o teto deste município, e se não houver, o da
-- capital" — duas leituras na mesma UF/esfera/ano. A chave primária já cobre a
-- primeira; este índice cobre a varredura da segunda sem carregar a chave
-- inteira.
create index if not exists rpv_tetos_escopo_idx
  on public.rpv_tetos (uf, esfera, ano);

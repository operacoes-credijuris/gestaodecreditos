-- Due diligence de PROCESSOS JUDICIAIS dos sujeitos do crédito.
--
-- É a segunda frente da diligência, a que a aba "Processos judiciais" da janela
-- de Due diligence ainda mostra como "Ainda não implementado". A primeira
-- frente (certidões) já vive no banco desde a 0042: certidao_catalogo,
-- certidao_regra, dd_sujeito, dd_certidao. As duas respondem perguntas
-- diferentes, e por isso são tabelas diferentes:
--
--   dd_certidao   A CERTIDÃO SAIU? (emitida, válida, arquivada no Drive)
--   dd_processo   O QUE ELA REVELOU? (número, objeto, valor cobrado, estágio)
--
-- Uma certidão positiva não é um risco; um processo com penhora capaz de
-- alcançar o crédito que estamos comprando é. É esta tabela que separa os dois.
--
-- POR QUE ELA NASCE ANTES DA TELA: a análise de crédito de RPV pergunta
-- exatamente isto nas linhas 10 e 11 da aba jurídica — "Histórico do cedente:
-- tem dívida?" e "Histórico do advogado: tem dívida?" — e hoje quem responde é a
-- IA lendo O PROCESSO DA CESSÃO, que não fala das outras dívidas de ninguém. O
-- resultado é um "Não" que significa "não achei nos autos", impresso numa
-- planilha que a pessoa lê como diligência feita. Com estas duas tabelas a
-- resposta passa a vir de onde a apuração acontece, e o motor de RPV já sabe
-- lê-las (ver _shared/dueDiligencia.ts).
--
-- ENQUANTO NINGUÉM ESCREVER AQUI, NADA MUDA. O motor trata tabela vazia — e
-- tabela inexistente, se esta migration não rodar — como "não apurado", e a
-- análise sai como sempre saiu.

-- ============================================================
-- 1. A apuração: de quem, por quem, e se de fato aconteceu
-- ============================================================
--
-- SEPARADA DOS PROCESSOS porque "apurei e nada consta" e "não apurei" são
-- respostas diferentes, e a ausência de linhas em dd_processo não distingue as
-- duas. É o mesmo motivo do `residencia_levantada` na 0042: a lacuna precisa
-- ficar visível, senão vira aprovação por omissão.
create table if not exists public.dd_historico (
  id             uuid primary key default gen_random_uuid(),

  -- Sem FK para kommo_leads, pelo mesmo motivo do dd_sujeito: o espelho de
  -- cards é descartável e recriado pelo sync; a diligência sobrevive ao card.
  kommo_lead_id  bigint not null,

  papel          text not null check (papel in ('CEDENTE','CONJUGE','PJ','ADVOGADO')),

  -- Opcional DE PROPÓSITO. Em RPV não se monta checklist de certidões (a janela
  -- abre sem a aba), então normalmente NÃO EXISTE dd_sujeito para o crédito. E o
  -- advogado costuma ser conhecido só pela OAB: dd_sujeito exige CPF com dígito
  -- verificador válido, e não há CPF de advogado nos autos. Amarrar a apuração
  -- ao sujeito cadastrado inviabilizaria a linha 11 justamente no fluxo que a
  -- pediu.
  sujeito_id     uuid references public.dd_sujeito (id) on delete set null,

  nome           text not null,
  documento      text,          -- só dígitos, quando houver
  oab            text,          -- "GO 12345", para o advogado sem CPF conhecido

  status         text not null default 'PENDENTE'
                 check (status in ('PENDENTE','APURADO','FALHA')),

  fonte          text,          -- 'judit' | 'manual' | 'certidao' | ...
  apurado_em     timestamptz,
  observacao     text,

  criado_por     uuid references public.profiles (id) on delete set null,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),

  -- APURADO sem data é o furo que torna o resto decorativo: alguém marca como
  -- feito, a planilha imprime "Não", e não há como saber de quando é a foto.
  -- Diligência tem prazo de validade como certidão tem.
  constraint dd_historico_apurado_exige_data
    check (status <> 'APURADO' or apurado_em is not null),
  constraint dd_historico_documento_digitos
    check (documento is null or documento ~ '^[0-9]{11}$' or documento ~ '^[0-9]{14}$')
);

-- Um alvo, uma apuração. Índice em vez de constraint porque a identidade do
-- alvo é "o documento, ou a OAB, ou o nome" — nesta ordem —, e constraint de
-- tabela não aceita expressão. Dois advogados no mesmo crédito são dois alvos
-- legítimos; o mesmo advogado apurado duas vezes não é.
create unique index if not exists dd_historico_alvo_uk
  on public.dd_historico (kommo_lead_id, papel, (coalesce(documento, oab, nome)));

create index if not exists dd_historico_lead_idx
  on public.dd_historico (kommo_lead_id, papel);

-- ============================================================
-- 2. O que a apuração achou
-- ============================================================
create table if not exists public.dd_processo (
  id              uuid primary key default gen_random_uuid(),
  historico_id    uuid not null references public.dd_historico (id) on delete cascade,

  -- Repetido aqui, e não só via historico_id, porque toda leitura é por crédito
  -- e o join a mais em cada consulta não paga nada.
  kommo_lead_id   bigint not null,

  numero_processo text not null,
  -- Chave de comparação. O mesmo processo aparece "0001234-56.2020.8.09.0051"
  -- num lugar e "00012345620208090051" noutro; sem normalizar, o de-duplicado
  -- não de-duplica e a planilha lista o mesmo caso duas vezes.
  numero_digitos  text generated always as (regexp_replace(numero_processo, '[^0-9]', '', 'g')) stored,

  tribunal        text,
  objeto          text,          -- "execução fiscal", "reclamação trabalhista"

  -- Em que polo o sujeito figura NESTE processo. Sem isto não dá para responder
  -- "tem dívida?": o cedente que é AUTOR de uma ação não deve nada por ela.
  polo            text not null default 'DESCONHECIDO'
                  check (polo in ('ATIVO','PASSIVO','TERCEIRO','DESCONHECIDO')),

  -- "Há valor sendo cobrado dele?" — a pergunta que o modelo faz. NULL é
  -- resposta legítima e diferente de false: processo achado, valor ainda não
  -- apurado. O motor de RPV trata NULL no polo passivo como dívida (é o lado
  -- conservador) e NULL nos demais polos como indeterminado.
  ha_cobranca     boolean,
  valor_cobrado   numeric(15,2),

  estagio         text,          -- "citação", "penhora", "trânsito em julgado"

  -- O que ameaça ESTA cessão, que não é o mesmo que o tamanho da dívida: uma
  -- execução pequena já em penhora pesa mais que uma grande ainda em citação,
  -- porque é ela que alcança o crédito (fraude à execução).
  risco           text not null default 'NAO_AVALIADO'
                  check (risco in ('NAO_AVALIADO','NENHUM','ATENCAO','ALTO')),
  risco_motivo    text,

  fonte           text,
  url_fonte       text,
  atualizado_em   timestamptz not null default now(),

  unique (historico_id, numero_digitos),

  -- Número sem dígito nenhum não é número de processo, e entraria na chave
  -- única como string vazia — o segundo lixo colidiria com o primeiro.
  constraint dd_processo_numero_tem_digitos
    check (numero_processo ~ '[0-9]')
);

create index if not exists dd_processo_lead_idx on public.dd_processo (kommo_lead_id);
create index if not exists dd_processo_risco_idx on public.dd_processo (risco)
  where risco in ('ATENCAO','ALTO');

-- ============================================================
-- 3. Coerência entre a apuração e o sujeito cadastrado
-- ============================================================
--
-- Quando a apuração APONTA para um dd_sujeito, o papel tem de ser o mesmo. Um
-- CHECK não resolve (precisaria de subconsulta), e sem isto a apuração do
-- cônjuge podia apontar para o cedente e cair na linha 10 da planilha como se
-- fosse dele. Trigger, e não validação no TypeScript, porque a policy abaixo
-- permite escrita a qualquer autenticado: o SQL Editor chega aqui sem passar
-- pelo aplicativo.
create or replace function public.dd_historico_papel_coerente()
returns trigger language plpgsql as $$
declare p text;
begin
  if new.sujeito_id is not null then
    select papel into p from public.dd_sujeito where id = new.sujeito_id;
    if p is not null and p <> new.papel then
      raise exception 'A apuração é de % mas o sujeito % está cadastrado como %',
        new.papel, new.sujeito_id, p;
    end if;
  end if;
  new.atualizado_em := now();
  return new;
end $$;

drop trigger if exists dd_historico_coerencia on public.dd_historico;
create trigger dd_historico_coerencia
  before insert or update on public.dd_historico
  for each row execute function public.dd_historico_papel_coerente();

create or replace function public.dd_processo_touch()
returns trigger language plpgsql as $$
begin
  new.atualizado_em := now();
  return new;
end $$;

drop trigger if exists dd_processo_atualizado on public.dd_processo;
create trigger dd_processo_atualizado
  before insert or update on public.dd_processo
  for each row execute function public.dd_processo_touch();

-- ============================================================
-- 4. RLS
-- ============================================================
--
-- Mesma régua de dd_sujeito/dd_certidao (0042): operacional, autenticado lê e
-- escreve. Não é catálogo nem política — é dado do caso.
alter table public.dd_historico enable row level security;
alter table public.dd_processo  enable row level security;

drop policy if exists "dd_historico_all" on public.dd_historico;
create policy "dd_historico_all" on public.dd_historico
  for all to authenticated using (true) with check (true);

drop policy if exists "dd_processo_all" on public.dd_processo;
create policy "dd_processo_all" on public.dd_processo
  for all to authenticated using (true) with check (true);

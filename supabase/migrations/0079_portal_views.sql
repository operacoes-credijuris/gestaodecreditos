-- 0079 — O que o Portal do Parceiro lê daqui: três objetos no schema `portal` e um
-- papel que só lê eles.
--
-- PARA QUE SERVE. O Portal do Parceiro (repositório Portal-do-Parceiro/portal-parceiro)
-- é a janela do escritório originador: ele sobe crédito e acompanha cada um até o
-- pagamento. A operação continua sendo daqui — o portal não guarda cópia de crédito
-- nenhum, lê na hora. O contrato está em docs/contrato-sistema-gestao.md do portal
-- (versão 0.1, issue #6 de lá); esta migração é a issue #12.
--
-- POR QUE UM SCHEMA PRÓPRIO, E NÃO O public. Tudo que nasce em `public` ganha, pelas
-- permissões padrão do Supabase, acesso para `anon` e `authenticated` — e a API REST
-- publica o que eles enxergam. As views abaixo leem com os direitos de quem as criou
-- (é o que deixa o portal ler sem ter acesso às tabelas); em `public`, isso viraria
-- uma porta para qualquer dono da chave anônima. Em `portal`, que não está na lista
-- de schemas da API, só entra quem recebe `usage` — e só o `portal_reader` recebe.
--
-- O QUE FICA DE FORA, de propósito: CPF/CNPJ, nome da mãe, RG e endereço do cedente
-- (moram em dd_sujeito e não aparecem aqui), o texto livre das notas, links do Drive.
-- O portal mostra ao parceiro só o que é dele mostrar.
--
-- O QUE AINDA NÃO TEM DE ONDE VIR, e sai nulo até ser combinado (pendências do
-- contrato, P4.a e P8 a P13): proposta líquida, mínimo e preço fechado (não existem
-- como número no banco — as cotações são texto em campo do card); motivo da
-- frustração; valor de face antes da compra. As colunas já existem para o portal não
-- mudar quando o dado chegar.

create schema if not exists portal;
comment on schema portal is
  'Leitura do Portal do Parceiro (migração 0079). Fora da API REST; só o portal_reader entra.';

-- ============================================================
-- 1. O mapa de etapas: (funil, coluna) do Kommo -> etapa do portal
-- ============================================================
--
-- É DADO, e não código, pelo mesmo motivo da etapa_visao (0045): coluna nova ou
-- renomeada no Kommo não pode quebrar o portal. Coluna sem linha aqui aparece para o
-- parceiro como 'em_andamento' até alguém classificá-la — com um update, sem deploy.

create table if not exists portal.portal_etapas (
  pipeline_id  bigint not null,
  status_id    bigint not null,
  etapa_portal text   not null
               check (etapa_portal in ('recebido','analise','proposta','due_diligence',
                                       'formalizacao','pagamento','frustrado')),
  primary key (pipeline_id, status_id)
);
comment on table portal.portal_etapas is
  'Mapa (funil, coluna do Kommo) -> etapa do Portal do Parceiro. Coluna sem linha aparece como em_andamento.';

-- A primeira versão do mapa, pelos ids (o nome muda no Kommo; o id, não). As colunas
-- e as fases vêm de colunasRpv.ts e trilhasDoPrecatorio.ts. A ler junto com a tabela:
-- "Diligência" daqui é a da análise (antes de aprovar), e por isso é 'analise'; a
-- due diligence do portal é a validação depois do fechamento (Fechados, e no Externo
-- a Obtenção de documentação).
insert into portal.portal_etapas (pipeline_id, status_id, etapa_portal) values
  -- RPV (13901939)
  (13901939, 107272803, 'analise'),        -- Análise Jurídica-Econômico
  (13901939, 107272807, 'analise'),        -- Revisão e Decisão
  (13901939, 107830027, 'analise'),        -- Diligência
  (13901939, 107830035, 'proposta'),       -- Apresentação / Produção de proposta
  (13901939, 107830039, 'proposta'),       -- Negociação
  (13901939, 107830043, 'due_diligence'),  -- Fechados
  (13901939, 107830051, 'formalizacao'),   -- Elaboração de contratos
  (13901939, 107830059, 'formalizacao'),   -- Protocolo
  (13901939, 107830031, 'frustrado'),      -- Reprovados Operacional
  (13901939, 107830067, 'frustrado'),      -- Não fechado
  (13901939, 112466388, 'frustrado'),      -- Sem resposta
  -- Precatório Interno (14439512)
  (14439512, 111533940, 'analise'),        -- Análise Jurídica e Econômica
  (14439512, 111533944, 'analise'),        -- Revisão
  (14439512, 111533960, 'analise'),        -- Diligência
  (14439512, 111533948, 'proposta'),       -- Produção de proposta
  (14439512, 112466260, 'proposta'),       -- Negociação
  (14439512, 111533952, 'due_diligence'),  -- Fechados
  (14439512, 111693840, 'formalizacao'),   -- Protocolo
  (14439512, 111534108, 'frustrado'),      -- Reprovados
  (14439512, 112382612, 'frustrado'),      -- Não fechados
  (14439512, 112465960, 'frustrado'),      -- Sem resposta
  -- Precatório Externo (14439516), pelas quatro fases de 29/09/2026
  (14439516, 111533968, 'analise'),        -- Qualificação preliminar
  (14439516, 111533972, 'analise'),        -- Revisão da qualificação
  (14439516, 111533996, 'analise'),        -- Diligência
  (14439516, 111533976, 'analise'),        -- Memorando de negociação
  (14439516, 111533980, 'analise'),        -- Encaminhar aos fundos
  (14439516, 111533984, 'analise'),        -- Em precificação
  (14439516, 111533988, 'proposta'),       -- Produção de proposta
  (14439516, 112339984, 'proposta'),       -- Negociação
  (14439516, 111533992, 'due_diligence'),  -- Fechados
  (14439516, 112341608, 'due_diligence'),  -- Obtenção de documentação
  (14439516, 112341612, 'formalizacao'),   -- Aguardando aprovação do fundo
  (14439516, 112341616, 'formalizacao'),   -- Revisão / assinatura da escritura
  (14439516, 112006404, 'pagamento'),      -- Pagos
  (14439516, 111534212, 'frustrado'),      -- Reprovados
  (14439516, 112346344, 'frustrado'),      -- Sem resposta
  (14439516, 111985976, 'frustrado')       -- Não fechado
on conflict (pipeline_id, status_id) do nothing;

-- A coluna de entrada de cada funil (tipo 1 no Kommo) é 'recebido'. Pelo espelho, e
-- não por id escrito à mão: é a única coluna que o Kommo marca.
insert into portal.portal_etapas (pipeline_id, status_id, etapa_portal)
select pipeline_id, status_id, 'recebido'
  from public.kommo_etapa
 where tipo = 1 and pipeline_id in (13901939, 14439512, 14439516)
on conflict (pipeline_id, status_id) do nothing;

-- ============================================================
-- 2. portal_creditos: um crédito por linha
-- ============================================================
--
-- ANTES DA COMPRA o crédito é o card (kommo_leads); DEPOIS, é o processo (processos),
-- com o card junto enquanto ele ainda estiver nos funis. O casamento card <-> processo
-- é pelo CNJ, como a tela já faz (kommo_leads.processo_cnj = processos.numero_cnj).
--
-- O ID: 'k' + kommo_lead_id antes da compra, 'p' + processos.id depois. É o que o
-- portal grava na auditoria dele; muda uma vez, na compra.
--
-- PROCESSO SEM CARD SÓ ENTRA COM ORIGINADOR. Sem o filtro, toda a carteira comprada
-- direto (sem originador) cairia no portal como "crédito sem escritório" para o admin
-- de lá atribuir — e não é de escritório nenhum.
--
-- A ETAPA: pago (data_liquidacao) -> 'pagamento'; comprado (data_aquisicao) ->
-- 'formalizacao'; senão a coluna do card pelo mapa; senão 'em_andamento'. Se o
-- "pagamento" do portal é a liquidação do precatório ou o pagamento ao cedente na
-- escritura está em aberto (P10).
--
-- A CHAVE DO ORIGINADOR: o campo `portal_escritorio` do card, quando existe (os
-- cards que o portal criar o terão); senão o prefixo do título ("Nome - ..."), que é
-- a convenção do comercial; depois da compra, processos.originador. O portal casa
-- essa chave com os escritórios dele pelos apelidos.

create or replace view portal.portal_creditos as
-- DOIS CARDS COM O MESMO CNJ (card reaberto, duplicado pelo comercial) dariam o mesmo
-- processo duas vezes; fica o card sincronizado por último, e o id não se repete.
select distinct on (credito_id) *
from (
with card as (
  select
    k.*,
    k.oportunidade -> 'ficha' as ficha,
    (select nullif(btrim(v -> 'values' -> 0 ->> 'value'), '')
       from jsonb_array_elements(coalesce(k.raw -> 'custom_fields_values', '[]'::jsonb)) v
      where v ->> 'field_name' = 'portal_escritorio'
      limit 1) as campo_escritorio
  from public.kommo_leads k
),
casado as (
  select c.*, p.id as p_id
    from card c
    left join public.processos p on p.numero_cnj = c.processo_cnj
)
select
  case when p.id is not null then 'p' || p.id::text else 'k' || c.kommo_lead_id::text end
                                                           as credito_id,
  c.kommo_lead_id                                          as kommo_lead_id,
  p.id                                                     as processo_id,
  coalesce(p.numero_cnj, c.processo_cnj)                   as numero_processo,
  case
    when coalesce(c.ficha ->> 'tipo', '') ilike '%honor%' then 'Honorário'
    when c.pipeline_id = 13901939 then 'RPV'
    when c.pipeline_id in (14439512, 14439516) then 'Precatório'
  end                                                      as tipo,
  coalesce(p.tribunal, c.ficha ->> 'tribunal')             as tribunal,
  c.ficha ->> 'uf'                                         as uf,
  coalesce(p.entidade_devedora, c.ficha ->> 'entidade_devedora')
                                                           as ente_devedor,
  coalesce(p.cedente, c.ficha ->> 'cedente',
           nullif(btrim(split_part(c.nome, ' - ', 2)), ''))
                                                           as cedente_nome,
  p.valor_face::numeric(14, 2)                             as valor_face,
  case
    when p.data_liquidacao is not null then 'pagamento'
    when p.data_aquisicao is not null then 'formalizacao'
    when c.kommo_lead_id is not null then coalesce(e.etapa_portal, 'em_andamento')
    else 'em_andamento'
  end                                                      as etapa_portal,
  case
    when p.data_liquidacao is not null then p.data_liquidacao::timestamp at time zone 'America/Sao_Paulo'
    when p.data_aquisicao is not null then p.data_aquisicao::timestamp at time zone 'America/Sao_Paulo'
    when c.etapa_status_id = c.status_id then c.etapa_em
  end                                                      as etapa_desde,
  -- A data de entrada decide a adesão que vale no portal: sem card, a da aquisição
  coalesce(c.criado_em,
           p.data_aquisicao::timestamp at time zone 'America/Sao_Paulo',
           p.created_at, c.sincronizado_em)                as criado_em,
  null::numeric(14, 2)                                     as proposta_liquida,
  null::numeric(14, 2)                                     as minimo,
  null::numeric(14, 2)                                     as preco_fechado,
  null::text                                               as motivo_frustracao,
  coalesce(c.campo_escritorio,
           nullif(btrim(split_part(c.nome, ' - ', 1)), ''),
           nullif(btrim(p.originador), ''))                as originador_chave,
  -- O processo é lido na hora; só o card vem de um espelho com idade
  case when c.kommo_lead_id is not null then c.sincronizado_em else now() end
                                                           as sincronizado_em
from casado c
full join public.processos p on p.id = c.p_id
left join portal.portal_etapas e
  on e.pipeline_id = c.pipeline_id and e.status_id = c.status_id
where c.kommo_lead_id is not null
   or nullif(btrim(p.originador), '') is not null
) linhas
order by credito_id, sincronizado_em desc nulls last;

comment on view portal.portal_creditos is
  'Um crédito por linha para o Portal do Parceiro: o card antes da compra, o processo depois. Sem dado pessoal do cedente além do nome.';

-- ============================================================
-- 3. portal_pendencias: o que falta da due diligence, por card
-- ============================================================
--
-- Só as certidões obrigatórias que pedem mão humana (PENDENTE_MANUAL e FALHA) — as
-- que o robô ainda vai emitir não são pendência de ninguém. O sujeito aparece só pelo
-- papel ("do cônjuge"), nunca pelo nome ou documento. Quais destas o PARCEIRO deve
-- providenciar, e não a equipe, está em aberto (P11).

create or replace view portal.portal_pendencias as
select
  c.kommo_lead_id,
  cat.nome_curto
    || coalesce(' (' || coalesce(c.parametros ->> 'municipio', c.parametros ->> 'uf') || ')', '')
    || case s.papel
         when 'CONJUGE' then ' — do cônjuge'
         when 'PJ' then ' — da empresa'
         when 'ADVOGADO' then ' — do advogado'
         else ''
       end                         as item,
  c.status,
  c.atualizado_em                  as desde
from public.dd_certidao c
join public.certidao_catalogo cat on cat.codigo = c.certidao_codigo
join public.dd_sujeito s on s.id = c.sujeito_id
where c.obrigatoria
  and c.status in ('PENDENTE_MANUAL', 'FALHA');

comment on view portal.portal_pendencias is
  'Certidões obrigatórias da due diligence que pedem mão humana, por card, para o Portal do Parceiro. Sem dado do sujeito além do papel.';

-- ============================================================
-- 4. O papel do portal: lê as duas views e nada mais
-- ============================================================
--
-- LOGIN SEM SENHA AQUI: a senha é posta à mão no SQL Editor (alter role ... password)
-- e vai direto para as variáveis do Railway do portal — nunca para o repositório.
-- Somente leitura também na sessão, para o caso de alguém um dia dar um grant a mais.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'portal_reader') then
    create role portal_reader login connection limit 10;
  end if;
end $$;

alter role portal_reader set default_transaction_read_only = on;
alter role portal_reader set search_path = portal;
alter role portal_reader set statement_timeout = '10s';

revoke all on schema portal from public;
grant usage on schema portal to portal_reader;
grant select on portal.portal_creditos, portal.portal_pendencias to portal_reader;

-- Nada do schema portal para a API REST, nem por engano.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on all tables in schema portal from anon, authenticated;
  end if;
end $$;

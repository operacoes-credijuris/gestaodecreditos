-- =====================================================================
-- MIGRATION 0032 — HISTÓRICO DE ALTERAÇÕES DAS OPERAÇÕES
-- Credijuris · Módulo de Inteligência Econômica · Item 3 do briefing
-- ---------------------------------------------------------------------
-- STATUS: PROPOSTA. NÃO EXECUTAR SEM APROVAÇÃO.
--
-- O que faz:
--   1. Cria a tabela public.processos_historico
--   2. Cria o gatilho que preserva silenciosamente o valor anterior
--      sempre que um campo econômico de public.processos muda
--   3. Registra um marco inicial para as 95 operações já existentes
--
-- O que NÃO faz:
--   · não altera nenhuma coluna, valor ou registro de public.processos
--   · não interfere na gravação: o gatilho é AFTER UPDATE e nunca
--     bloqueia, atrasa ou modifica o que o usuário salvou
--   · não escolhe nem sugere novas datas de previsão (item 3, parágrafo
--     final do briefing: a decisão continua 100% humana)
--
-- Rollback completo no fim do arquivo.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Tabela de histórico
-- ---------------------------------------------------------------------
create table if not exists public.processos_historico (
  id                  bigint generated always as identity primary key,
  processo_id         uuid        not null references public.processos(id) on delete cascade,

  tipo                text        not null default 'alteracao'
                                  check (tipo in ('marco_inicial','alteracao')),
  registrado_em       timestamptz not null default now(),

  -- quem alterou (nulo quando a alteração vem de job/SQL, não de usuário)
  alterado_por        uuid,
  alterado_por_email  text,
  origem              text        not null default 'desconhecida',

  -- quais campos mudaram nesta alteração
  campos_alterados    text[]      not null,

  -- atalhos tipados: são as perguntas mais frequentes do item 13.
  -- ficam como colunas date/text para consulta direta, sem parsear jsonb.
  previsao_anterior   date,
  previsao_nova       date,
  dias_deslocamento   integer generated always as (previsao_nova - previsao_anterior) stored,
  status_anterior     text,
  status_novo         text,

  -- auditoria completa: valores antes e depois de todos os campos monitorados
  valores_anteriores  jsonb       not null default '{}'::jsonb,
  valores_novos       jsonb       not null default '{}'::jsonb,

  -- situação do processo no momento da alteração (item 3)
  contexto            jsonb       not null default '{}'::jsonb
);

comment on table public.processos_historico is
  'Histórico imutável de alterações dos campos econômicos de processos. '
  'Gravado exclusivamente pelo gatilho trg_processos_historico. '
  'Nenhum usuário tem permissão de UPDATE ou DELETE.';

create index if not exists idx_processos_historico_processo
  on public.processos_historico (processo_id, registrado_em desc);

create index if not exists idx_processos_historico_previsao
  on public.processos_historico (previsao_nova)
  where previsao_nova is not null;

create index if not exists idx_processos_historico_tipo
  on public.processos_historico (tipo, registrado_em desc);


-- ---------------------------------------------------------------------
-- 2. Função do gatilho
-- ---------------------------------------------------------------------
create or replace function public.processos_registra_historico()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  -- campos econômicos monitorados. Alterar esta lista é a única mudança
  -- necessária para passar a versionar um campo novo.
  k_campos constant text[] := array[
    'expectativa_liquidacao',
    'data_liquidacao',
    'capital_investido',
    'valor_face',
    'ja_recebido',
    'valor_estimado_complementar',
    'data_referencia',
    'indice_atualizacao',
    'status'
  ];

  v_old        jsonb;
  v_new        jsonb := to_jsonb(NEW);
  v_campos     text[] := '{}';
  v_ant        jsonb  := '{}'::jsonb;
  v_nov        jsonb  := '{}'::jsonb;
  v_campo      text;
  v_uid        uuid   := auth.uid();
  v_email      text;
  v_origem     text;
  v_ult_mov    date;
begin
  if TG_OP = 'INSERT' then
    -- Nova operação: grava o marco inicial, que é a previsão original.
    if NEW.expectativa_liquidacao is null then
      return NEW;
    end if;

    select email into v_email from auth.users where id = v_uid;

    insert into public.processos_historico (
      processo_id, tipo, alterado_por, alterado_por_email, origem,
      campos_alterados, previsao_nova, status_novo,
      valores_novos, contexto
    ) values (
      NEW.id, 'marco_inicial', v_uid, v_email,
      case when v_uid is null then 'sistema' else 'aplicacao' end,
      array['expectativa_liquidacao'],
      NEW.expectativa_liquidacao, NEW.status,
      jsonb_build_object(
        'expectativa_liquidacao', NEW.expectativa_liquidacao,
        'status', NEW.status,
        'capital_investido', NEW.capital_investido,
        'valor_face', NEW.valor_face),
      jsonb_build_object('evento', 'criacao_da_operacao')
    );
    return NEW;
  end if;

  -- UPDATE: compara apenas os campos monitorados
  v_old := to_jsonb(OLD);

  foreach v_campo in array k_campos loop
    if (v_old -> v_campo) is distinct from (v_new -> v_campo) then
      v_campos := v_campos || v_campo;
      v_ant    := v_ant || jsonb_build_object(v_campo, v_old -> v_campo);
      v_nov    := v_nov || jsonb_build_object(v_campo, v_new -> v_campo);
    end if;
  end loop;

  -- Nenhum campo econômico mudou: não grava nada.
  -- Edições de vara, comarca, advogado etc. não poluem o histórico.
  if cardinality(v_campos) = 0 then
    return NEW;
  end if;

  select email into v_email from auth.users where id = v_uid;
  v_origem := case when v_uid is null then 'sistema' else 'aplicacao' end;

  -- Situação processual no momento da alteração (item 3).
  -- Silencioso: se a integração falhar, o histórico é gravado assim mesmo.
  begin
    select max(data) into v_ult_mov
    from public.advbox_movimentacoes
    where numero_processo = NEW.numero_cnj;
  exception when others then
    v_ult_mov := null;
  end;

  insert into public.processos_historico (
    processo_id, tipo, alterado_por, alterado_por_email, origem,
    campos_alterados,
    previsao_anterior, previsao_nova,
    status_anterior, status_novo,
    valores_anteriores, valores_novos, contexto
  ) values (
    NEW.id, 'alteracao', v_uid, v_email, v_origem,
    v_campos,
    case when 'expectativa_liquidacao' = any(v_campos)
         then OLD.expectativa_liquidacao end,
    case when 'expectativa_liquidacao' = any(v_campos)
         then NEW.expectativa_liquidacao end,
    OLD.status, NEW.status,
    v_ant, v_nov,
    jsonb_build_object(
      'tribunal',               NEW.tribunal,
      'entidade_devedora',      NEW.entidade_devedora,
      'ultima_movimentacao',    v_ult_mov,
      'dias_desde_movimentacao',
        case when v_ult_mov is not null then (current_date - v_ult_mov) end,
      'ja_liquidado',           (NEW.data_liquidacao is not null)
    )
  );

  return NEW;
exception when others then
  -- Blindagem: falha no histórico NUNCA pode impedir o usuário de salvar.
  -- Registra o problema no log do Postgres e deixa o UPDATE passar.
  raise warning 'processos_registra_historico falhou para % : %', NEW.id, sqlerrm;
  return NEW;
end;
$fn$;

comment on function public.processos_registra_historico() is
  'Preserva o valor anterior dos campos econômicos de processos. '
  'AFTER trigger e à prova de falhas: nunca bloqueia a gravação do usuário.';


-- ---------------------------------------------------------------------
-- 3. Gatilho
-- ---------------------------------------------------------------------
drop trigger if exists trg_processos_historico on public.processos;

create trigger trg_processos_historico
  after insert or update on public.processos
  for each row
  execute function public.processos_registra_historico();


-- ---------------------------------------------------------------------
-- 4. Permissões — histórico é somente leitura para todo mundo
-- ---------------------------------------------------------------------
alter table public.processos_historico enable row level security;

drop policy if exists processos_historico_select on public.processos_historico;
create policy processos_historico_select
  on public.processos_historico
  for select
  to authenticated
  using (is_ativo());

-- Sem policy de INSERT/UPDATE/DELETE: a RLS bloqueia qualquer escrita
-- vinda da aplicação. Só o gatilho (SECURITY DEFINER) grava.
revoke insert, update, delete on public.processos_historico from authenticated;
revoke insert, update, delete on public.processos_historico from anon;
grant  select                  on public.processos_historico to authenticated;


-- ---------------------------------------------------------------------
-- 5. Marco inicial das operações já existentes
-- ---------------------------------------------------------------------
-- Sem isto, uma operação que nunca mais mudar de previsão não teria
-- nenhuma linha de histórico, e o item 13 não saberia qual foi a
-- "previsão original". Registra o estado de hoje como ponto de partida.
--
-- HONESTIDADE METODOLÓGICA: esta linha marca o estado em 11/08/2026,
-- NÃO a previsão original de quando a operação foi adquirida. Toda
-- alteração anterior a esta data já havia sido perdida pelo sistema.
-- O campo contexto->>'observacao' deixa isso explícito para que nenhuma
-- análise futura confunda as duas coisas.
insert into public.processos_historico (
  processo_id, tipo, origem, campos_alterados,
  previsao_nova, status_novo, valores_novos, contexto
)
select
  p.id, 'marco_inicial', 'migracao',
  array['expectativa_liquidacao'],
  p.expectativa_liquidacao, p.status,
  jsonb_build_object(
    'expectativa_liquidacao', p.expectativa_liquidacao,
    'status', p.status,
    'capital_investido', p.capital_investido,
    'valor_face', p.valor_face,
    'ja_recebido', p.ja_recebido,
    'data_liquidacao', p.data_liquidacao),
  jsonb_build_object(
    'evento', 'implantacao_do_modulo',
    'observacao', 'Estado na implantacao do historico. NAO e a previsao '
               || 'original da aquisicao: alteracoes anteriores a esta data '
               || 'nao foram preservadas pelo sistema e sao irrecuperaveis.')
from public.processos p
where p.expectativa_liquidacao is not null
  and not exists (
    select 1 from public.processos_historico h where h.processo_id = p.id
  );

commit;


-- =====================================================================
-- VERIFICAÇÃO PÓS-MIGRATION (rodar depois, separadamente)
-- =====================================================================
/*
-- Deve retornar o número de operações com previsão preenchida
select tipo, count(*) from public.processos_historico group by tipo;

-- Deve confirmar que processos continua intacto: 95 linhas
select count(*) from public.processos;

-- Teste do gatilho SEM alterar dado real: altera e desfaz na mesma
-- transação, que é revertida. Nada é gravado em processos.
begin;
  update public.processos
     set expectativa_liquidacao = expectativa_liquidacao + 1
   where id = (select id from public.processos
                where expectativa_liquidacao is not null limit 1);
  select tipo, campos_alterados, previsao_anterior, previsao_nova,
         dias_deslocamento, origem
    from public.processos_historico
   where tipo = 'alteracao'
   order by registrado_em desc limit 1;
rollback;   -- desfaz tudo, inclusive a linha de histórico
*/


-- =====================================================================
-- ROLLBACK COMPLETO
-- ---------------------------------------------------------------------
-- Remove tudo o que a migration criou e devolve o banco ao estado
-- anterior. ATENÇÃO: apaga o histórico acumulado desde a implantação,
-- que é irrecuperável. Use apenas logo após a migration, se algo der
-- errado. Nenhum dado de public.processos é tocado em momento algum.
-- =====================================================================
/*
begin;
  drop trigger  if exists trg_processos_historico on public.processos;
  drop function if exists public.processos_registra_historico();
  drop table    if exists public.processos_historico;
commit;
*/

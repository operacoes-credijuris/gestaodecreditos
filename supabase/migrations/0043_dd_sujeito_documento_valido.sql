-- Dígito verificador do documento, troca atômica de sujeito, e RLS da view de
-- completude.
--
-- Três coisas que a 0042 deixou em aberto e que a tela do checklist expôs:
--
--   1. A 0042 checava o FORMATO do documento (11 ou 14 dígitos), não o dígito
--      verificador. Um dígito trocado ao digitar continua tendo 11 dígitos.
--   2. Trocar o CPF do cedente exige APAGAR o sujeito antigo (a chave única é
--      (lead, papel, documento), então um upsert com CPF novo deixaria dois
--      cedentes). Feito do navegador, isso são duas requisições: se a segunda
--      falhar, o crédito fica SEM cedente e sem checklist. Vai para uma função.
--   3. v_dd_completude é a primeira view do projeto e roda com os privilégios do
--      dono, não de quem consulta — logo, ignora a RLS das tabelas de baixo.
--
-- Por que o item 1 é grave AQUI e não em outro cadastro qualquer: o CPF do
-- dd_sujeito é o PARÂMETRO de emissão de toda certidão do checklist. Com um
-- dígito errado, cada portal responde "nada consta" — corretamente, porque nada
-- consta para um CPF que não existe — e o dossiê fecha 100% limpo sobre uma
-- pessoa que não existe. É o pior modo de falha do sistema: não parece erro,
-- parece aprovação.

-- ============================================================
-- 1. Dígito verificador
-- ============================================================
--
-- O front-end já valida em cpfCnpjValido (src/lib/format.ts). A validação vem
-- para o banco porque o front não é o único caminho até esta tabela: a policy
-- `dd_sujeito_all` permite escrita a qualquer usuário autenticado, então o SQL
-- Editor do Supabase, um script e uma Edge Function futura chegam aqui sem
-- passar pelo TypeScript. Mesmo raciocínio dos checks de completude da 0042.
--
-- IMMUTABLE porque CHECK constraint exige: o resultado depende só do argumento,
-- nunca do banco nem da hora.

create or replace function public.documento_dv_valido(p_doc text)
returns boolean
language plpgsql
immutable
as $$
declare
  d      text;
  n      int[];
  soma   int := 0;
  resto  int;
  dv1    int;
  dv2    int;
  i      int;
  peso   int;
begin
  if p_doc is null then return true; end if;              -- nulo é assunto do NOT NULL
  d := regexp_replace(p_doc, '\D', '', 'g');

  if length(d) not in (11, 14) then return false; end if;

  -- Sequência de dígito único (000..0, 111..1) passa no módulo 11 por acidente
  -- aritmético e é o "CPF de teste" mais digitado do Brasil. Barrada à mão.
  if d ~ ('^(' || substr(d, 1, 1) || ')\1*$') then return false; end if;

  select array_agg(x::int order by ord)
    into n
    from unnest(string_to_array(d, null)) with ordinality as t(x, ord);

  if length(d) = 11 then
    -- CPF: pesos 10..2 para o 1º DV, 11..2 para o 2º.
    soma := 0;
    for i in 1..9 loop soma := soma + n[i] * (11 - i); end loop;
    resto := soma % 11;
    dv1 := case when resto < 2 then 0 else 11 - resto end;
    if dv1 <> n[10] then return false; end if;

    soma := 0;
    for i in 1..10 loop soma := soma + n[i] * (12 - i); end loop;
    resto := soma % 11;
    dv2 := case when resto < 2 then 0 else 11 - resto end;
    return dv2 = n[11];
  end if;

  -- CNPJ: pesos ciclando 2..9, da direita para a esquerda.
  soma := 0; peso := 2;
  for i in reverse 12..1 loop
    soma := soma + n[i] * peso;
    peso := case when peso = 9 then 2 else peso + 1 end;
  end loop;
  resto := soma % 11;
  dv1 := case when resto < 2 then 0 else 11 - resto end;
  if dv1 <> n[13] then return false; end if;

  soma := 0; peso := 2;
  for i in reverse 13..1 loop
    soma := soma + n[i] * peso;
    peso := case when peso = 9 then 2 else peso + 1 end;
  end loop;
  resto := soma % 11;
  dv2 := case when resto < 2 then 0 else 11 - resto end;
  return dv2 = n[14];
end $$;

comment on function public.documento_dv_valido(text) is
  'Dígito verificador de CPF (11) ou CNPJ (14). Recusa sequência de dígito único.';

-- Pré-voo antes do CHECK. Sem isto, uma linha ruim gravada entre o deploy da
-- 0042 e o desta faria o Postgres abortar a migration inteira com "is violated
-- by some row" — sem dizer QUAL linha. A mensagem abaixo diz.
do $$
declare
  ruins text;
begin
  select string_agg(format('%s (%s, lead %s)', documento, papel, kommo_lead_id), '; ')
    into ruins
    from public.dd_sujeito
   where not public.documento_dv_valido(documento);
  if ruins is not null then
    raise exception
      'dd_sujeito tem documento com dígito verificador inválido: %. '
      'Corrija ou apague estas linhas e rode a migration de novo — o checklist '
      'montado sobre um CPF inexistente fecha limpo sobre pessoa que não existe.',
      ruins;
  end if;
end $$;

alter table public.dd_sujeito
  drop constraint if exists dd_sujeito_documento_dv;

alter table public.dd_sujeito
  add constraint dd_sujeito_documento_dv
  check (public.documento_dv_valido(documento));

-- ============================================================
-- 2. Troca de sujeitos em UMA transação
-- ============================================================
--
-- O que esta função existe para impedir, e que o navegador não consegue
-- impedir sozinho: entre o DELETE do cedente antigo e o INSERT do novo há uma
-- janela. Se o token expirar nela — e expira, porque quem preenche este
-- formulário acabou de esperar um PDF de 200 páginas ser lido — o crédito fica
-- sem cedente NENHUM e sem checklist, com a tela ainda mostrando os dados
-- antigos. Aqui as duas coisas são uma só operação: ou as duas acontecem, ou
-- nenhuma.
--
-- E O CÔNJUGE É APAGADO INCONDICIONALMENTE quando p_conjuge vem nulo. A versão
-- que só apagava "quando havia cônjuge novo" tornava DESMARCAR a caixa um
-- no-op: o cônjuge antigo sobrevivia, as certidões dele continuavam contando
-- como obrigatórias, e o aviso "nenhum cônjuge informado" ficava suprimido para
-- sempre. Ou seja: um checklist com bloco inteiro de pessoa errada, sem sinal.
--
-- security invoker: as policies da 0042 valem normalmente, e auth.uid() é de
-- quem clicou — é dele o registro em criado_por.

create or replace function public.dd_registrar_sujeitos(
  p_lead_id  bigint,
  p_cedente  jsonb,
  p_conjuge  jsonb default null
)
returns jsonb
language plpgsql
security invoker
as $$
declare
  doc_ced  text;
  doc_cnj  text;
  removidas int := 0;
  perdidas  int := 0;
begin
  if p_lead_id is null then
    raise exception 'dd_registrar_sujeitos: kommo_lead_id é obrigatório.';
  end if;

  doc_ced := regexp_replace(coalesce(p_cedente->>'documento', ''), '\D', '', 'g');
  if doc_ced = '' then
    raise exception 'dd_registrar_sujeitos: o CPF do cedente é obrigatório.';
  end if;
  if not public.documento_dv_valido(doc_ced) then
    raise exception 'CPF do cedente inválido (dígito verificador): %', doc_ced;
  end if;

  if p_conjuge is not null then
    doc_cnj := regexp_replace(coalesce(p_conjuge->>'documento', ''), '\D', '', 'g');
    if doc_cnj = '' then
      raise exception 'dd_registrar_sujeitos: cônjuge informado sem CPF.';
    end if;
    if not public.documento_dv_valido(doc_cnj) then
      raise exception 'CPF do cônjuge inválido (dígito verificador): %', doc_cnj;
    end if;
    if doc_cnj = doc_ced then
      raise exception 'O CPF do cônjuge é o mesmo do cedente.';
    end if;
  end if;

  -- Quanto se perde, contado ANTES de apagar, para o relatório de volta. Quem
  -- chamou já confirmou na tela; isto é o registro do que de fato saiu.
  select count(*), count(*) filter (where c.status = 'OBTIDA')
    into removidas, perdidas
    from public.dd_certidao c
    join public.dd_sujeito s on s.id = c.sujeito_id
   where s.kommo_lead_id = p_lead_id
     and (   (s.papel = 'CEDENTE' and s.documento <> doc_ced)
          or (s.papel = 'CONJUGE' and (doc_cnj is null or s.documento <> doc_cnj)));

  delete from public.dd_sujeito
   where kommo_lead_id = p_lead_id
     and (   (papel = 'CEDENTE' and documento <> doc_ced)
          or (papel = 'CONJUGE' and (doc_cnj is null or documento <> doc_cnj)));

  insert into public.dd_sujeito
    (kommo_lead_id, papel, tipo_pessoa, nome, documento, data_nascimento,
     uf_atual, municipio_atual, ufs_anteriores, municipios_anteriores,
     residencia_levantada, fonte_residencia, criado_por)
  values
    (p_lead_id, 'CEDENTE', 'PF',
     p_cedente->>'nome', doc_ced,
     nullif(p_cedente->>'data_nascimento', '')::date,
     nullif(p_cedente->>'uf_atual', ''),
     nullif(p_cedente->>'municipio_atual', ''),
     coalesce((select array_agg(v) from jsonb_array_elements_text(
                 coalesce(p_cedente->'ufs_anteriores', '[]'::jsonb)) as t(v)), '{}'),
     coalesce((select array_agg(v) from jsonb_array_elements_text(
                 coalesce(p_cedente->'municipios_anteriores', '[]'::jsonb)) as t(v)), '{}'),
     coalesce((p_cedente->>'residencia_levantada')::boolean, false),
     nullif(p_cedente->>'fonte_residencia', ''),
     auth.uid())
  on conflict (kommo_lead_id, papel, documento) do update set
    nome                  = excluded.nome,
    data_nascimento       = excluded.data_nascimento,
    uf_atual              = excluded.uf_atual,
    municipio_atual       = excluded.municipio_atual,
    ufs_anteriores        = excluded.ufs_anteriores,
    municipios_anteriores = excluded.municipios_anteriores,
    residencia_levantada  = excluded.residencia_levantada,
    fonte_residencia      = excluded.fonte_residencia;
    -- criado_por FICA DE FORA do update de propósito: a pergunta que se faz
    -- quando sai certidão da pessoa errada é "quem cadastrou este CPF", não
    -- "quem editou o município por último".

  if p_conjuge is not null then
    insert into public.dd_sujeito
      (kommo_lead_id, papel, tipo_pessoa, nome, documento, data_nascimento,
       uf_atual, municipio_atual, ufs_anteriores, municipios_anteriores,
       residencia_levantada, criado_por)
    values
      (p_lead_id, 'CONJUGE', 'PF',
       p_conjuge->>'nome', doc_cnj,
       nullif(p_conjuge->>'data_nascimento', '')::date,
       nullif(p_conjuge->>'uf_atual', ''),
       nullif(p_conjuge->>'municipio_atual', ''),
       '{}', '{}',
       -- SEMPRE false, e não o valor do cedente. O formulário pergunta pelo
       -- histórico DO CEDENTE e não tem campo para o do cônjuge; herdar o
       -- `true` gravaria "levantei" sobre uma pergunta que ninguém fez, e esse
       -- flag é o único interruptor que apaga o aviso da lacuna. Pergunta não
       -- feita não é pergunta respondida.
       false,
       auth.uid())
    on conflict (kommo_lead_id, papel, documento) do update set
      nome            = excluded.nome,
      data_nascimento = excluded.data_nascimento,
      uf_atual        = excluded.uf_atual,
      municipio_atual = excluded.municipio_atual;
  end if;

  return jsonb_build_object(
    'certidoes_removidas', removidas,
    'obtidas_removidas',   perdidas
  );
end $$;

comment on function public.dd_registrar_sujeitos(bigint, jsonb, jsonb) is
  'Grava cedente e cônjuge de um crédito em uma transação, apagando sujeito '
  'substituído. Cônjuge nulo APAGA o cônjuge existente.';

grant execute on function public.dd_registrar_sujeitos(bigint, jsonb, jsonb)
  to authenticated;

-- ============================================================
-- 3. v_dd_completude: RLS de quem consulta, não de quem criou a view
-- ============================================================
--
-- Uma view no Postgres roda, por padrão, com os privilégios de quem a criou — o
-- dono, `postgres`. Consequência: a RLS de dd_certidao e dd_sujeito NÃO se
-- aplica a quem consulta pela view. Hoje isso não muda nada, porque as duas
-- policies da 0042 liberam para todo autenticado. O problema é o dia em que
-- alguém restringir uma delas e a view continuar entregando tudo — a restrição
-- pareceria aplicada e não estaria.
--
-- Dentro de um DO porque `security_invoker` só existe no Postgres 15+. Num banco
-- 14 a instrução seria erro de sintaxe e derrubaria a migration por um reforço
-- que é preventivo, não corretivo.
do $$
begin
  if current_setting('server_version_num')::int >= 150000 then
    execute 'alter view public.v_dd_completude set (security_invoker = true)';
  end if;
end $$;

-- Explícito em vez de depender do default privilege do schema public. Os DOIS
-- papéis: a tela lê como `authenticated`, e gerar-checklist-certidoes lê a mesma
-- view como `service_role` para devolver o placar. Um grant faltando aqui não dá
-- erro visível em nenhum dos dois — dá placar em branco, que é pior.
grant select on public.v_dd_completude to authenticated, service_role;

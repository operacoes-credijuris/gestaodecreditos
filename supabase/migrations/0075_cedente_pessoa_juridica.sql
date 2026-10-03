-- Cedente PESSOA JURÍDICA na gravação dos sujeitos.
--
-- Pedido do dono (03/10/2026): "há cedentes que podem ser pessoa jurídica, então
-- precisa admitir pesquisa por CNPJ além de CPF também". A tabela já aceitava —
-- dd_sujeito tem tipo_pessoa 'PF'|'PJ' e o check que casa o tipo com o tamanho
-- do documento desde a 0042, o motor de regras lê dados_entrada_pj, e a emissão
-- pela BullAI escolhe CNPJ para PJ. O que barrava era esta função: a 0043 grava
-- o cedente com tipo_pessoa 'PF' FIXO, e um CNPJ de 14 dígitos com 'PF' é
-- recusado pelo check dd_sujeito_tipo_bate_documento.
--
-- O QUE MUDA, e só isto:
--   - o tipo do cedente vem de p_cedente->>'tipo_pessoa'; sem ele (a tela
--     antiga, aberta nas abas durante o deploy), sai do tamanho do documento —
--     11 dígitos é PF, como sempre foi;
--   - tipo que não bate com o documento é recusado com mensagem clara (o check
--     da 0042 recusaria de qualquer forma, com mensagem de banco);
--   - cedente PJ não tem cônjuge nem data de nascimento: p_conjuge informado é
--     recusado, e o nascimento é gravado nulo.
-- O resto é a 0043 palavra por palavra: a troca atômica, o cônjuge apagado
-- quando p_conjuge vem nulo, o relatório do que se perdeu, o criado_por fora do
-- update.

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
  doc_ced   text;
  doc_cnj   text;
  tipo_ced  text;
  removidas int := 0;
  perdidas  int := 0;
begin
  if p_lead_id is null then
    raise exception 'dd_registrar_sujeitos: kommo_lead_id é obrigatório.';
  end if;

  doc_ced := regexp_replace(coalesce(p_cedente->>'documento', ''), '\D', '', 'g');
  if doc_ced = '' then
    raise exception 'dd_registrar_sujeitos: o CPF/CNPJ do cedente é obrigatório.';
  end if;

  tipo_ced := upper(coalesce(nullif(trim(p_cedente->>'tipo_pessoa'), ''),
                             case when length(doc_ced) = 14 then 'PJ' else 'PF' end));
  if tipo_ced not in ('PF', 'PJ') then
    raise exception 'dd_registrar_sujeitos: tipo de pessoa do cedente inválido: %', tipo_ced;
  end if;
  if (tipo_ced = 'PF' and length(doc_ced) <> 11) or (tipo_ced = 'PJ' and length(doc_ced) <> 14) then
    raise exception 'O documento do cedente não é % (tem % dígitos).',
      case when tipo_ced = 'PF' then 'um CPF' else 'um CNPJ' end, length(doc_ced);
  end if;
  if not public.documento_dv_valido(doc_ced) then
    raise exception '% do cedente inválido (dígito verificador): %',
      case when tipo_ced = 'PF' then 'CPF' else 'CNPJ' end, doc_ced;
  end if;

  if p_conjuge is not null then
    if tipo_ced = 'PJ' then
      raise exception 'Cedente pessoa jurídica não tem cônjuge.';
    end if;
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
    (p_lead_id, 'CEDENTE', tipo_ced,
     p_cedente->>'nome', doc_ced,
     -- EMPRESA NÃO NASCE: a data de "nascimento" de uma PJ seria a de abertura,
     -- e nenhum portal a pede no lugar da de nascimento.
     case when tipo_ced = 'PF' then nullif(p_cedente->>'data_nascimento', '')::date end,
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
    tipo_pessoa           = excluded.tipo_pessoa,
    nome                  = excluded.nome,
    data_nascimento       = excluded.data_nascimento,
    uf_atual              = excluded.uf_atual,
    municipio_atual       = excluded.municipio_atual,
    ufs_anteriores        = excluded.ufs_anteriores,
    municipios_anteriores = excluded.municipios_anteriores,
    residencia_levantada  = excluded.residencia_levantada,
    fonte_residencia      = excluded.fonte_residencia;
    -- criado_por FICA DE FORA do update de propósito (ver a 0043).

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
       -- SEMPRE false: a tela não pergunta o histórico do cônjuge (ver a 0043).
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
  'Grava cedente (PF ou PJ, por p_cedente.tipo_pessoa ou pelo tamanho do documento) '
  'e cônjuge de um crédito em uma transação, apagando sujeito substituído. Cônjuge '
  'nulo APAGA o cônjuge existente; cedente PJ não aceita cônjuge.';

grant execute on function public.dd_registrar_sujeitos(bigint, jsonb, jsonb)
  to authenticated;

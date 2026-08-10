-- Duas falhas de segurança encontradas na auditoria da plataforma.
--
-- FALHA 1 — QUALQUER USUÁRIO PODIA SE PROMOVER A ADMINISTRADOR.
-- A policy profiles_update (0001) permite ao usuário editar a própria linha:
--     using (id = auth.uid() or public.is_admin())
-- A intenção era deixá-lo corrigir o próprio nome. Mas a policy vale para a
-- LINHA INTEIRA, não para colunas, então nada impedia um PATCH em
-- /rest/v1/profiles?id=eq.<meu-id> com {"role":"admin"} — e is_admin() lê
-- exatamente profiles.role, então o usuário passava a ser admin também do lado
-- servidor, ganhando as Edge Functions de admin (criar usuário, gravar tokens
-- de API). RLS não sabe comparar valor antigo com novo; quem faz isso é
-- trigger. É por isso que a proteção vem por trigger e não por policy.
--
-- FALHA 2 — "DESATIVAR USUÁRIO" NÃO DESATIVAVA NADA.
-- profiles.ativo era gravado pela tela de Configurações e lido somente para
-- pintar o selo "Inativo". Nenhuma policy consultava a coluna e o app só
-- checava se havia sessão. Ou seja: o desligado continuava entrando e lendo
-- tudo — dado de investidor, valor de crédito, cadastro — até alguém trocar a
-- senha dele na mão. Agora a coluna vale de verdade, no banco.

-- ---------------------------------------------------------------------------
-- is_ativo(): o acesso do usuário está liberado?
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER para poder ler profiles sem cair na RLS de profiles
-- (mesmo motivo de is_admin()).
--
-- O coalesce cai em TRUE quando não há linha em profiles, e isso é deliberado:
--   a) a service_role das Edge Functions não tem auth.uid(), e travá-la aqui
--      derrubaria toda a sincronização (ADVBOX, DJEN, Kommo, resumos);
--   b) um usuário sem linha de perfil é defeito de cadastro, não desligamento,
--      e trancar a plataforma por causa disso é pior que o risco que evita.
-- Só bloqueia quem tem ativo = false EXPLÍCITO, que é a ação consciente do
-- administrador.
create or replace function public.is_ativo()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(
    (select p.ativo from public.profiles p where p.id = auth.uid()),
    true
  );
$$;

-- ---------------------------------------------------------------------------
-- Trigger que protege as colunas de privilégio de profiles
-- ---------------------------------------------------------------------------
create or replace function public.profiles_protege_privilegio()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- auth.uid() nulo = service_role (Edge Functions admin-create-user e
  -- admin-update-user, que já verificam admin no servidor antes de escrever).
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;

  -- Usuário comum na própria linha: pode mexer no nome, e mais nada.
  if new.role  is distinct from old.role
     or new.ativo is distinct from old.ativo
     or new.email is distinct from old.email
     or new.id    is distinct from old.id then
    raise exception
      'Somente o administrador altera perfil, situação de acesso ou e-mail.';
  end if;

  return new;
end $$;

drop trigger if exists profiles_protege_privilegio on public.profiles;
create trigger profiles_protege_privilegio
  before update on public.profiles
  for each row execute function public.profiles_protege_privilegio();

-- ---------------------------------------------------------------------------
-- Toda tabela de negócio passa a exigir usuário ATIVO
-- ---------------------------------------------------------------------------
-- Tabelas em que qualquer autenticado faz tudo (o "auth_all" de 0001, mais as
-- que vieram depois). Só entra a condição de ativo; o resto continua igual.
do $$
declare t text;
begin
  foreach t in array array[
    'analises_credito','processos','publicacoes','tarefas','contatos_serventias',
    'investidores','cessoes','investimentos','contrato_templates','contratos',
    'requerimentos','apensos'
  ] loop
    execute format('drop policy if exists "auth_all" on public.%I;', t);
    execute format(
      'create policy "auth_all" on public.%I
         for all to authenticated
         using (public.is_ativo()) with check (public.is_ativo());', t);
  end loop;
end $$;

-- Tabelas de espelho: leitura por autenticado, escrita só pela service_role.
do $$
declare r record;
begin
  for r in
    select * from (values
      ('djen_publicacoes',      'djen_pub_select'),
      ('advbox_movimentacoes',  'advbox_mov_select'),
      ('advbox_processo_status','advbox_ps_select'),
      ('advbox_tarefas',        'advbox_tarefas_select'),
      ('kommo_leads',           'kommo_leads_select'),
      ('carteira_resumos',      'carteira_resumos_select')
    ) as v(tabela, policy)
  loop
    execute format('drop policy if exists %I on public.%I;', r.policy, r.tabela);
    execute format(
      'create policy %I on public.%I
         for select to authenticated using (public.is_ativo());', r.policy, r.tabela);
  end loop;
end $$;

-- "Tratada" da publicação: marcação da própria equipe, segue liberada a quem
-- está ativo.
drop policy if exists "djen_pub_update" on public.djen_publicacoes;
create policy "djen_pub_update" on public.djen_publicacoes
  for update to authenticated
  using (public.is_ativo()) with check (public.is_ativo());

drop policy if exists "kommo_interna_all" on public.kommo_analise_interna;
create policy "kommo_interna_all" on public.kommo_analise_interna
  for all to authenticated
  using (public.is_ativo()) with check (public.is_ativo());

drop policy if exists "parametros_atualizacao_select" on public.parametros_atualizacao;
create policy "parametros_atualizacao_select" on public.parametros_atualizacao
  for select to authenticated using (public.is_ativo());

drop policy if exists "parametros_atualizacao_write" on public.parametros_atualizacao;
create policy "parametros_atualizacao_write" on public.parametros_atualizacao
  for all to authenticated
  using (public.is_ativo()) with check (public.is_ativo());

drop policy if exists "investidor_dados_select" on public.investidor_dados;
create policy "investidor_dados_select" on public.investidor_dados
  for select to authenticated using (public.is_ativo());

drop policy if exists "investidor_dados_write" on public.investidor_dados;
create policy "investidor_dados_write" on public.investidor_dados
  for all to authenticated
  using (public.is_ativo()) with check (public.is_ativo());

drop policy if exists "integracoes_select" on public.integracoes;
create policy "integracoes_select" on public.integracoes
  for select to authenticated using (public.is_ativo());

drop policy if exists "integracoes_write" on public.integracoes;
create policy "integracoes_write" on public.integracoes
  for all to authenticated
  using (public.is_admin() and public.is_ativo())
  with check (public.is_admin() and public.is_ativo());

-- profiles_select fica DE FORA da regra de ativo, de propósito: o app precisa
-- ler a própria linha para descobrir que está desativado e dizer isso na tela.
-- Sem esta exceção o desligado veria a plataforma inteira vazia, sem entender
-- por quê, e abriria chamado achando que o sistema quebrou.

-- Verificação depois de rodar (esperado: uma linha por policy, todas com
-- is_ativo na expressão, e o trigger listado):
--   select tablename, policyname, qual from pg_policies
--    where schemaname = 'public' order by tablename, policyname;
--   select tgname from pg_trigger where tgrelid = 'public.profiles'::regclass;

-- Complemento da 0025. A conferência das policies mostrou quatro linhas de
-- profiles sem is_ativo(), e eu só havia previsto UMA delas.
--
-- profiles_select fica de fora DE PROPÓSITO, e continua assim: o app precisa ler
-- a própria linha para descobrir que está desativado e dizer isso na tela. Sem
-- essa exceção o desligado veria a plataforma inteira vazia, sem entender por
-- quê, e abriria chamado achando que o sistema quebrou.
--
-- As outras três eram descuido meu, e a mais grave é profiles_insert. O caminho
-- da falha: administrador desligado -> chama admin-create-user -> a Edge Function
-- verificava só role = 'admin' -> cria conta NOVA e ATIVA -> volta por ela com
-- acesso total. Ou seja, dava para desfazer o próprio desligamento. Bloquear as
-- tabelas de negócio (0025) não fecha isso, porque as Edge Functions escrevem
-- com service_role e não passam por RLS. O lado servidor foi corrigido junto,
-- em _shared/auth.ts (isAdmin passou a exigir ativo, e getCallerAtivo virou o
-- portão de toda function que serve dado ao app).
--
-- profiles_delete: administrador desligado apagando perfil de quem ficou.
-- profiles_update: administrador desligado reativando a si mesmo, que era o
-- caminho mais curto de todos.

-- Usuário comum segue podendo corrigir o próprio nome (o trigger
-- profiles_protege_privilegio da 0025 é que impede role/ativo/e-mail/id), mas
-- agora só enquanto o acesso estiver liberado.
drop policy if exists "profiles_update" on public.profiles;
create policy "profiles_update" on public.profiles
  for update to authenticated
  using ((id = auth.uid() or public.is_admin()) and public.is_ativo())
  with check ((id = auth.uid() or public.is_admin()) and public.is_ativo());

drop policy if exists "profiles_insert" on public.profiles;
create policy "profiles_insert" on public.profiles
  for insert to authenticated
  with check (public.is_admin() and public.is_ativo());

drop policy if exists "profiles_delete" on public.profiles;
create policy "profiles_delete" on public.profiles
  for delete to authenticated
  using (public.is_admin() and public.is_ativo());

-- Conferência (esperado: profiles_insert, profiles_update e profiles_delete em
-- 'ok', e SOMENTE profiles_select em 'FALTA', que é a exceção explicada acima):
--   select tablename, policyname,
--          case when coalesce(qual,'') like '%is_ativo%'
--                 or coalesce(with_check,'') like '%is_ativo%'
--               then 'ok' else 'FALTA' end as exige_ativo
--     from pg_policies where schemaname = 'public'
--    order by exige_ativo, tablename;

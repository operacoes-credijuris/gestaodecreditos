-- Migração 0036: as tabelas das petições passam a exigir usuário ATIVO.
--
-- As policies da 0030 e da 0035 nasceram com `using (true)`, que é o padrão que a
-- 0025 tirou de toda a plataforma. Ficaram as duas únicas exceções — e não são
-- exceções de propósito, são as tabelas que entraram depois da regra.
--
-- POR QUE ISSO É BURACO, e não formalidade: desativar um usuário em Configurações
-- NÃO mexe no Supabase Auth. O JWT dele continua valendo e pode ser renovado. A
-- tela barra, mas a API REST responde ao token — e com `using (true)` responderia
-- com os modelos de petição (know-how da casa) e com os panoramas dos casos, que
-- são resumo do processo do cliente. É justamente a pessoa que acabou de ser
-- cortada que teria motivo para tentar.
--
-- is_ativo() devolve true quando não há linha em profiles (ver 0025), então a
-- service_role das Edge Functions continua passando: quem escreve o panorama é a
-- peticao-ia, e ela não é afetada.

-- ---------------------------------------------------------------------------
-- peticao_templates — leitura e escrita pela equipe
-- ---------------------------------------------------------------------------
drop policy if exists "peticao_templates_select" on public.peticao_templates;
create policy "peticao_templates_select" on public.peticao_templates
  for select to authenticated using (public.is_ativo());

drop policy if exists "peticao_templates_write" on public.peticao_templates;
create policy "peticao_templates_write" on public.peticao_templates
  for all to authenticated
  using (public.is_ativo()) with check (public.is_ativo());

-- ---------------------------------------------------------------------------
-- peticao_panorama — só leitura pelo cliente; escrita segue só na service_role
-- ---------------------------------------------------------------------------
drop policy if exists "peticao_panorama_select" on public.peticao_panorama;
create policy "peticao_panorama_select" on public.peticao_panorama
  for select to authenticated using (public.is_ativo());

notify pgrst, 'reload schema';

-- Verificação depois de rodar — a MESMA consulta da 0025, agora cobrindo as duas
-- tabelas novas. Tem de voltar zero:
--
--   select count(*) as policies_sem_ativo
--   from pg_policies
--   where schemaname = 'public'
--     and tablename in ('peticao_templates', 'peticao_panorama')
--     and coalesce(qual, '') not like '%is_ativo%';

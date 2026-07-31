-- Migração 0017: credencial da Anthropic, usada pelo assistente de dados.
--
-- Por que uma tabela e não um secret das Edge Functions: o token do ADVBOX e o
-- do Kommo já são gravados assim, pela tela de Configurações. Guardar este num
-- lugar diferente obrigaria o admin a saber que ESTA integração se configura
-- fora do sistema — e a trocar a chave num painel separado das outras.

-- 'anthropic' passa a ser um serviço válido de integração.
-- Mesmo cuidado da migração 0014: o check tem nome gerado pelo Postgres, então
-- descobrimos e derrubamos qualquer check da tabela que mencione "servico" em
-- vez de supor o nome — um `drop constraint if exists` errado passaria calado
-- e o insert de 'anthropic' quebraria só em produção.
do $$
declare c record;
begin
  for c in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'integracoes'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%servico%'
  loop
    execute format('alter table public.integracoes drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.integracoes add constraint integracoes_servico_check
  check (servico in ('advbox', 'djen', 'kommo', 'anthropic'));

-- Chave de API da Anthropic. Mesmo padrão do ADVBOX e do Kommo: RLS ligada e
-- NENHUMA policy, ou seja, inacessível ao cliente por construção — só a
-- service_role das Edge Functions consegue ler.
create table if not exists public.integracao_anthropic_secret (
  id             int primary key default 1 check (id = 1),
  token          text,
  atualizado_em  timestamptz not null default now(),
  atualizado_por uuid
);

alter table public.integracao_anthropic_secret enable row level security;

notify pgrst, 'reload schema';

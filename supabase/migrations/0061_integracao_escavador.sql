-- Migração 0061: credencial do ESCAVADOR, a fonte da due diligence de processos.
--
-- O QUE ELA DESTRAVA. A migration 0056 criou dd_historico e dd_processo e o
-- motor de RPV já sabe lê-las (_shared/dueDiligencia.ts), mas NINGUÉM ESCREVE
-- NELAS: a aba "Processos judiciais" da janela de Due diligence mostra "Ainda
-- não implementado" porque faltava a fonte. As duas perguntas do questionário —
-- linha 10 "Histórico do cedente: tem dívida?" e linha 11 "Histórico do
-- advogado: tem dívida?" — continuam sendo respondidas pela IA lendo O PROCESSO
-- DA CESSÃO, que não fala das dívidas de ninguém.
--
-- POR QUE O ESCAVADOR, E NÃO A JUDIT que já temos. A Judit lê OS AUTOS de um
-- processo conhecido, e é dela que sai o texto da análise de RPV — isso não
-- muda. A diligência faz a pergunta inversa ("que processos há desta pessoa"),
-- e no caso do ADVOGADO a Judit não tem como responder: dívida se procura por
-- CPF, e nos autos o advogado só tem OAB. O Escavador liga uma coisa à outra
-- (/advogado/resumo devolve o CPF a partir da OAB), e é essa ligação que dá à
-- linha 11 a primeira fonte que ela já teve.
--
-- 'escavador' passa a ser um serviço válido de integração.
-- Mesmo cuidado das migrações 0014 e 0017: o check tem nome gerado pelo
-- Postgres, então descobrimos e derrubamos qualquer check da tabela que
-- mencione "servico" em vez de supor o nome — um `drop constraint if exists`
-- errado passaria calado e o insert de 'escavador' quebraria só em produção.
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
  check (servico in ('advbox', 'djen', 'kommo', 'anthropic', 'escavador'));

-- Token de acesso pessoal do Escavador. Mesmo padrão do ADVBOX, do Kommo e da
-- Anthropic: RLS ligada e NENHUMA policy, ou seja, inacessível ao cliente por
-- construção — só a service_role das Edge Functions consegue ler.
--
-- E não como VITE_*: variável de ambiente do front é assada no bundle público.
-- Este token gasta crédito por requisição; vazá-lo é deixar a conta aberta.
create table if not exists public.integracao_escavador_secret (
  id             int primary key default 1 check (id = 1),
  token          text,
  atualizado_em  timestamptz not null default now(),
  atualizado_por uuid
);

alter table public.integracao_escavador_secret enable row level security;

-- ============================================================
-- O que cada apuração custou
-- ============================================================
--
-- A API é PAGA POR REQUISIÇÃO, e o preço vem no header `Creditos-Utilizados`
-- de cada resposta, em centavos. Sem registrar, o gasto só aparece na fatura —
-- depois, agregado, sem dizer qual card o consumiu. Estamos em período de
-- teste: a pergunta "quanto custa diligenciar um crédito" precisa ter resposta
-- antes de a rotina virar automática.
--
-- Tabela à parte, e não coluna em dd_historico, porque uma apuração faz VÁRIAS
-- chamadas (o resumo, as páginas, a identidade do advogado) e porque a consulta
-- que interessa é por período, não por crédito.
create table if not exists public.escavador_consumo (
  id            uuid primary key default gen_random_uuid(),

  -- Sem FK para kommo_leads, pelo mesmo motivo de dd_historico: o espelho de
  -- cards é descartável e recriado pelo sync; o gasto já aconteceu.
  kommo_lead_id bigint,
  historico_id  uuid references public.dd_historico (id) on delete set null,

  operacao      text not null,   -- 'envolvido' | 'advogado' | 'resumo' | 'saldo'
  alvo          text,            -- CPF/CNPJ ou OAB consultada, para conferência
  centavos      int  not null default 0,
  requisicoes   int  not null default 0,
  processos     int  not null default 0,

  erro          text,
  criado_por    uuid references public.profiles (id) on delete set null,
  criado_em     timestamptz not null default now()
);

create index if not exists escavador_consumo_data_idx
  on public.escavador_consumo (criado_em desc);
create index if not exists escavador_consumo_lead_idx
  on public.escavador_consumo (kommo_lead_id);

-- Leitura para qualquer autenticado (é despesa da casa, não segredo); a escrita
-- é da Edge Function, que usa service_role e não passa por policy.
alter table public.escavador_consumo enable row level security;

drop policy if exists "escavador_consumo_leitura" on public.escavador_consumo;
create policy "escavador_consumo_leitura" on public.escavador_consumo
  for select to authenticated using (true);

notify pgrst, 'reload schema';

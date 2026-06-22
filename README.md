# Credijuris — Sistema de Gestão de Cessões de Créditos

Sistema interno da Credijuris reunindo os setores **Comercial** e **Operacional**,
com uma camada de **Gestão Estratégica** consolidando os dois. Integra com
**ADVBOX** (API) e **DJEN/Comunica PJe** (publicações).

- **Frontend:** React + TypeScript + Vite + Tailwind CSS (SPA, `HashRouter`).
- **Backend:** Supabase (Postgres + Auth + RLS + Storage + Edge Functions).
- **Hospedagem:** GitHub Pages (build estático via GitHub Actions).

## Estrutura de páginas

- **Gestão Estratégica** — KPIs e gráficos dos dois setores.
- **Comercial**
  - Geração de Contratos (modelos com variáveis `{{...}}` + geração/impressão)
  - Carteiras de Investidores (consolidado da operação + carteira individual; gestão de investidores e cessões)
- **Operacional**
  - Análise de Crédito
  - Execução Processual: Publicações e Movimentações · Tarefas ADVBOX · Processos · Serventias e Gabinetes
- **Configurações** (somente administrador) — token ADVBOX, parâmetros DJEN, gestão de usuários.

> **Acesso:** todo usuário autenticado vê o sistema inteiro. Apenas o
> administrador (`operacoes@credijuris.com`) cadastra usuários e edita as
> integrações.

---

## 1. Pré-requisitos

- Node.js 20+
- Conta/projeto no [Supabase](https://supabase.com)
- [Supabase CLI](https://supabase.com/docs/guides/cli) (para migração e Edge Functions)

## 2. Configuração local

```bash
npm install
cp .env.example .env   # no Windows: copy .env.example .env
```

Preencha o `.env` com os dados do seu projeto Supabase (em
*Project Settings → API*):

```
VITE_SUPABASE_URL=https://SEU-PROJETO.supabase.co
VITE_SUPABASE_ANON_KEY=sua-chave-anon-publica
```

Rode em desenvolvimento:

```bash
npm run dev
```

## 3. Configurar o Supabase

### 3.1. Aplicar o banco de dados

**Opção A — pelo painel:** abra *SQL Editor*, cole o conteúdo de
[`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql) e execute.

**Opção B — pela CLI:**

```bash
supabase link --project-ref <ref-do-seu-projeto>
supabase db push
```

### 3.2. Criar o usuário administrador

Em *Authentication → Users → Add user*, crie:

- **E-mail:** `operacoes@credijuris.com`
- **Senha:** defina uma senha
- Marque **Auto Confirm User**

O sistema marca esse e-mail como **administrador** automaticamente (via trigger).
Os demais usuários são criados depois, dentro do app, na página **Configurações**.

> Em *Authentication → Providers → Email*, **desative** "Enable Signups" para que
> ninguém se cadastre sozinho (o cadastro é feito só pelo admin).

### 3.3. Implantar as Edge Functions

A chave `service_role` já está disponível dentro das funções automaticamente —
não é preciso configurar segredos manualmente.

```bash
supabase functions deploy admin-create-user
supabase functions deploy salvar-token-advbox
supabase functions deploy advbox-sync
supabase functions deploy djen-consulta
```

### 3.4. Integrações (na página Configurações)

- **ADVBOX:** informe a *URL base* da API e o *token Bearer* (gerado em
  *Configurações → Integrações e API* na sua conta ADVBOX). O token é guardado
  no servidor e nunca exposto ao navegador.
- **DJEN:** informe as OABs e/ou números de processo a monitorar, tribunais e a
  janela de dias. Use o botão **Sincronizar DJEN** em *Publicações e Movimentações*.

> O mapeamento dos campos da ADVBOX em `supabase/functions/advbox-sync` é
> defensivo e pode precisar de ajuste fino conforme a resposta real da sua conta.

## 4. Publicar no GitHub Pages

1. Suba o repositório para o GitHub (branch `main`).
2. Em *Settings → Secrets and variables → Actions*, crie os secrets:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
3. Em *Settings → Pages*, em **Source** selecione **GitHub Actions**.
4. A cada `push` na `main`, o workflow
   [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) compila e publica.

O app usa `HashRouter`, então as rotas funcionam no GitHub Pages sem
configuração extra de servidor.

## 5. Scripts

| Comando           | Descrição                          |
| ----------------- | ---------------------------------- |
| `npm run dev`     | Servidor de desenvolvimento        |
| `npm run build`   | Type-check + build de produção     |
| `npm run preview` | Pré-visualiza o build              |
| `npm run lint`    | Verificação de tipos (tsc)         |

## 6. Estrutura do projeto

```
src/
  components/      UI custom + layout (sidebar, topbar)
  contexts/        AuthContext
  lib/             supabase, crud, queries, format, labels, functions
  pages/           estrategica / comercial / operacional / configuracoes
supabase/
  migrations/      0001_init.sql (tabelas, RLS, triggers, storage)
  functions/       admin-create-user, salvar-token-advbox, advbox-sync, djen-consulta
```

## Segurança

- A chave `anon` é pública por design e protegida por **RLS**.
- O **token do ADVBOX** fica em tabela sem acesso ao cliente; só as Edge Functions
  (service_role) o leem.
- **Criação de usuários** e **gravação do token** exigem usuário administrador,
  validado dentro das Edge Functions.

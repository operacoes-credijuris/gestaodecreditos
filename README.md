# Credijuris — Sistema de Gestão de Cessões de Créditos

Sistema interno da Credijuris reunindo os setores **Comercial** e **Operacional**,
com uma camada de **Gestão Estratégica** consolidando os dois. Integra com
**ADVBOX** (tarefas e movimentações), **DJEN/Comunica PJe** (publicações),
**Kommo** (funil de análise), **Judit** (due diligence), **Anthropic** (análise de
crédito, resumo de carteira e redação de petições) e **Google Drive** (arquivo das
análises e das petições geradas).

- **Frontend:** React + TypeScript + Vite + Tailwind CSS (SPA, `HashRouter`).
- **Backend:** Supabase (Postgres + Auth + RLS + Storage + Edge Functions).
- **Hospedagem:** GitHub Pages (build estático via GitHub Actions).

## Estrutura de páginas

- **Gestão Estratégica** — KPIs e gráficos dos dois setores.
- **Comercial**
  - Carteiras de Investimento — consolidado da operação e carteira individual, com valor projetado
  - Dados cadastrais — dados pessoais e bancários de **investidores** e **originadores**, nas duas visões
  - Geração de Contratos — modelos com variáveis `{{...}}`
- **Operacional**
  - Análise de Crédito — cards do Kommo, análise automática do PDF e movimentação do funil
  - Publicações e Movimentações · Tarefas · Créditos · Requerimentos administrativos · Contatos
- **Configurações** (somente administrador) — token ADVBOX, parâmetros DJEN, chave Anthropic,
  conta Kommo, gestão de usuários.

Em qualquer tela, o botão no canto inferior direito abre o **assistente de
dados**: responde perguntas sobre o que está cadastrado. Só faz leitura, e sob as
permissões de quem perguntou.

### Petições

A partir de uma tarefa, em **Tarefas**, a plataforma gera a petição em `.docx`:
sugere o modelo pelo tipo da tarefa, monta um panorama do caso por IA, preenche a
qualificação das partes com os **Dados cadastrais** e salva o arquivo na pasta do
crédito no Drive (ou baixa, quando o Drive não está configurado).

Os modelos são arquivos `.md` no bucket `modelos-peticoes` do Storage; a tabela
`peticao_templates` é só o índice. Trocar um modelo é subir um arquivo — não exige
deploy.

> **Acesso:** todo usuário autenticado vê o sistema inteiro. Apenas o
> administrador (`contato@credijuris.com`) cadastra usuários e edita as
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

**Opção A — pelo painel:** abra *SQL Editor* e execute os arquivos de
[`supabase/migrations/`](supabase/migrations) **na ordem numérica**, de `0001` em
diante. A `0001_init.sql` cria o essencial; as seguintes acrescentam tabelas e
colunas, e cada uma explica no cabeçalho por que existe.

**Opção B — pela CLI:**

```bash
supabase link --project-ref <ref-do-seu-projeto>
supabase db push
```

Fora das migrações, há scripts que se rodam **à mão**, uma vez, direto no
*SQL Editor* (não entram no `db push`):

| Script                        | Para quê                                                 |
| ----------------------------- | -------------------------------------------------------- |
| `SEED_PETICAO_TEMPLATES.sql`  | Carga inicial do índice dos 10 modelos de petição         |
| `CRON_DJEN_PUBLICACOES.sql`   | Agenda a sincronização das publicações                    |
| `CRON_ADVBOX_TAREFAS.sql`     | Agenda a sincronização das tarefas                        |
| `CRON_ADVBOX_MOVIMENTACOES.sql` | Agenda a sincronização das movimentações                |
| `CRON_CARTEIRA_RESUMO.sql`    | Agenda o resumo semanal da carteira (IA)                  |

> Os `CRON_*` levam um `__CRON_SECRET__` de marcador: troque pelo valor real ao
> colar. O segredo não é versionado.

### 3.2. Criar o usuário administrador

Em *Authentication → Users → Add user*, crie:

- **E-mail:** `contato@credijuris.com`
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
supabase functions deploy
```

> O deploy também acontece automaticamente a cada push na `main`, via
> [`.github/workflows/deploy-functions.yml`](.github/workflows/deploy-functions.yml).

### 3.4. Integrações (na página Configurações)

- **ADVBOX:** informe a *URL base* da API e o *token Bearer* (gerado em
  *Configurações → Integrações e API* na sua conta ADVBOX). O token é guardado
  no servidor e nunca exposto ao navegador.
- **DJEN:** informe as OABs e/ou números de processo a monitorar, tribunais e a
  janela de dias. Use o botão **Sincronizar DJEN** em *Publicações e Movimentações*.
- **Anthropic:** informe a chave de API (gerada em *console.anthropic.com → API
  Keys*). É o que liga o assistente de dados — o botão no canto inferior direito
  de qualquer tela. Sem a chave, o assistente responde dizendo que falta
  configurar; o resto do sistema não é afetado.

## 4. Publicar no GitHub Pages

1. Suba o repositório para o GitHub (branch `main`).
2. Em *Settings → Secrets and variables → Actions*, crie:
   - **Secrets:** `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`
   - **Variables:** `VITE_GOOGLE_CLIENT_ID` — é *variable*, não secret, porque é
     público por design (fica visível no código do site; quem protege o acesso são
     as origens autorizadas no Google Cloud e o login de cada pessoa). **Sem ele o
     build passa**, e a petição gerada baixa em vez de subir para o Drive.
3. Em *Settings → Pages*, em **Source** selecione **GitHub Actions**.
4. A cada `push` na `main`, o workflow
   [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) compila e publica.

O app usa `HashRouter`, então as rotas funcionam no GitHub Pages sem
configuração extra de servidor.

## 5. Scripts

| Comando                    | Descrição                                     |
| -------------------------- | --------------------------------------------- |
| `npm run dev`              | Servidor de desenvolvimento                   |
| `npm run build`            | Type-check + build de produção                |
| `npm run preview`          | Pré-visualiza o build                         |
| `npm run lint`             | Verificação de tipos do site (tsc)            |
| `npm run check:functions`  | Verificação de tipos das Edge Functions (Deno) |

> `npm run lint` cobre apenas `src/`. As Edge Functions rodam em **Deno**, não em
> Node, então precisam de `check:functions` — que exige o
> [Deno](https://deno.com) instalado (`winget install DenoLand.Deno`). O mesmo
> passo roda no CI antes do deploy das funções.
>
> As funções importam o cliente do Supabase com especificador `npm:` e **versão
> fixa** (`_shared/auth.ts`). Para atualizar, troque a versão lá de propósito e
> rode `npm run check:functions`.

## 6. Estrutura do projeto

```
src/
  components/      UI custom + layout (sidebar, topbar)
  contexts/        AuthContext
  lib/             supabase, crud, queries, format, labels, functions
                   pessoas    — investidores e originadores, das duas origens
                   projecao   — atualização monetária da carteira
                   peticao*   — modelo, layout, .docx e pasta de destino
                   drive      — acesso ao Google Drive pelo navegador
  pages/           estrategica / comercial / operacional / configuracoes
supabase/
  migrations/      0001 em diante, na ordem (tabelas, RLS, triggers, storage)
  functions/       Edge Functions (ADVBOX, DJEN, Kommo, Judit, petição, IA,
                   gestão de usuários)
  *.sql            scripts de execução manual (seed e agendamentos)
```

## Segurança

- A chave `anon` é pública por design e protegida por **RLS**.
- O **token do ADVBOX** fica em tabela sem acesso ao cliente; só as Edge Functions
  (service_role) o leem.
- **Criação de usuários** e **gravação do token** exigem usuário administrador,
  validado dentro das Edge Functions.

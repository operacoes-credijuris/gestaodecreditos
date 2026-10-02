// Os endereços da plataforma, como DADOS — o espelho do `src/App.tsx`.
//
// O APP NÃO LÊ ESTA LISTA, DE PROPÓSITO. Fazer o App montar as rotas a partir
// daqui exigiria reescrever o arquivo por onde passa TODA tela, todo dia, só
// para prender o comportamento antes do redesenho — exatamente o tipo de mudança
// que esta etapa existe para evitar. E não daria garantia maior: o par
// "chave → componente" continuaria precisando de conferência por texto, porque
// importar o App no Vitest (ambiente node) puxa todas as telas, com pdf.js,
// gráficos e o cliente do Supabase.
//
// Então o App fica como está, e o `rotas.test.ts` faz duas coisas:
//   1. lê o `App.tsx` como TEXTO e confere que cada rota de lá está aqui, com a
//      mesma tela e o mesmo guarda, e vice-versa (a mesma "catraca" do
//      `assistente.test.ts`). Mexeu numa rota no App sem mexer aqui, o teste
//      falha;
//   2. passa os endereços de hoje pelo `matchRoutes` do react-router sobre ESTA
//      lista e compara com a tabela congelada no próprio teste. Mexeu aqui sem
//      querer, o teste falha também.
//
// Mudança de rota DE PROPÓSITO (ex.: a etapa 3, que aninha o Quadro numa
// moldura) atualiza os três lugares — App, esta lista e a tabela do teste — e
// diz no commit por quê.

import { INICIO } from './navigation'

/**
 * Quem pode abrir o endereço — o que acontece ANTES de a tela aparecer.
 * - `nenhuma`: aberto a qualquer um (só o login);
 * - `sessao`: dentro do layout, atrás do `ProtectedRoute`: sem sessão vai ao
 *   login (lembrando o endereço pedido); conta desativada vê o aviso;
 * - `admin`: o mesmo `ProtectedRoute` do layout e, por dentro, o `AdminRoute`:
 *   quem não é administrador volta ao início.
 */
export type Guarda = 'nenhuma' | 'sessao' | 'admin'

/**
 * A tela, pelo caminho do módulo em `src/pages` (sem extensão). É a chave
 * ESTÁVEL: o nome com que o App importa o componente pode mudar sem a tela
 * mudar; o módulo, não.
 */
export type Tela =
  | 'Login'
  | 'NotFound'
  | 'inteligencia/VisaoGeral'
  | 'inteligencia/Performance'
  | 'inteligencia/Previsoes'
  | 'inteligencia/Recortes'
  | 'comercial/CarteirasInvestidores'
  | 'comercial/GeracaoContratos'
  | 'comercial/DadosPessoaisBancarios'
  | 'operacional/AnaliseCredito'
  | 'operacional/execucao/PublicacoesMovimentacoes'
  | 'operacional/execucao/TarefasAdvbox'
  | 'operacional/execucao/Processos'
  | 'operacional/execucao/Requerimentos'
  | 'operacional/execucao/ContatosServentias'
  | 'configuracoes/Configuracoes'

interface RotaBase {
  /**
   * Como está no `<Route path>`. A raiz `'/'` é a rota `index` do layout, e
   * `'*'` é a da página não encontrada (DENTRO do layout, com a barra lateral).
   */
  caminho: string
  guarda: Guarda
}

/**
 * Ou abre uma tela, ou redireciona. Todo redirecionamento de hoje é
 * `<Navigate replace>`: o endereço antigo some do histórico, e o Voltar não
 * prende a pessoa num vaivém.
 */
export type Rota =
  | (RotaBase & { tela: Tela; redireciona?: never })
  | (RotaBase & { redireciona: string; tela?: never })

/** Na ordem em que aparecem no `App.tsx` (o react-router não depende dela). */
export const ROTAS: readonly Rota[] = [
  { caminho: '/login', guarda: 'nenhuma', tela: 'Login' },

  { caminho: '/', guarda: 'sessao', redireciona: INICIO },
  // A Gestão Estratégica saiu (30/09/2026): o endereço salvo em favorito ou
  // histórico leva ao início.
  { caminho: '/estrategica', guarda: 'sessao', redireciona: INICIO },

  // Quadro Econômico (as rotas seguem em /inteligencia)
  { caminho: '/inteligencia', guarda: 'sessao', tela: 'inteligencia/VisaoGeral' },
  { caminho: '/inteligencia/performance', guarda: 'sessao', tela: 'inteligencia/Performance' },
  { caminho: '/inteligencia/previsoes', guarda: 'sessao', tela: 'inteligencia/Previsoes' },
  { caminho: '/inteligencia/recortes', guarda: 'sessao', tela: 'inteligencia/Recortes' },
  // O módulo continua em pages/comercial; só o endereço mudou de setor.
  { caminho: '/inteligencia/carteiras', guarda: 'sessao', tela: 'comercial/CarteirasInvestidores' },

  // Comercial
  { caminho: '/comercial/contratos', guarda: 'sessao', tela: 'comercial/GeracaoContratos' },
  // Endereço antigo das Carteiras: links salvos continuam funcionando.
  { caminho: '/comercial/carteiras', guarda: 'sessao', redireciona: '/inteligencia/carteiras' },
  { caminho: '/comercial/dados-pessoais', guarda: 'sessao', tela: 'comercial/DadosPessoaisBancarios' },

  // Operacional
  { caminho: '/operacional/analise', guarda: 'sessao', tela: 'operacional/AnaliseCredito' },
  {
    caminho: '/operacional/execucao/publicacoes',
    guarda: 'sessao',
    tela: 'operacional/execucao/PublicacoesMovimentacoes',
  },
  { caminho: '/operacional/execucao/tarefas', guarda: 'sessao', tela: 'operacional/execucao/TarefasAdvbox' },
  { caminho: '/operacional/execucao/processos', guarda: 'sessao', tela: 'operacional/execucao/Processos' },
  {
    caminho: '/operacional/execucao/requerimentos',
    guarda: 'sessao',
    tela: 'operacional/execucao/Requerimentos',
  },
  {
    caminho: '/operacional/execucao/contatos',
    guarda: 'sessao',
    tela: 'operacional/execucao/ContatosServentias',
  },

  // Configurações: a única tela com `AdminRoute` (a gestão de usuários fica
  // dentro dela).
  { caminho: '/configuracoes', guarda: 'admin', tela: 'configuracoes/Configuracoes' },

  // Endereço desconhecido: a 404 dentro do layout, não um redirecionamento
  // silencioso ao início.
  { caminho: '*', guarda: 'sessao', tela: 'NotFound' },
]

import {
  FileSignature,
  IdCard,
  SquareKanban,
  Newspaper,
  ListChecks,
  Wallet,
  Landmark,
  BookUser,
  Settings,
  PieChart,
  type LucideIcon,
} from 'lucide-react'

/** Uma aba de uma tela-moldura: tem endereço próprio, mas não tem item no menu. */
export interface NavAba {
  label: string
  to: string
}

export interface NavLeaf {
  label: string
  to: string
  icon: LucideIcon
  /**
   * As abas, quando o item abre uma MOLDURA (hoje só o Quadro econômico). Cada
   * aba é um endereço próprio — favorito, histórico e Voltar continuam valendo —
   * e o item fica aceso em todas elas (ver `itemAtivo`). A primeira aba é a do
   * próprio `to`: é ela que abre quando se clica no item.
   */
  abas?: readonly NavAba[]
  /**
   * O nome NO MENU, quando o inteiro quebra em duas linhas na largura do menu
   * ("Publicações e movimentações" → "Publicações"). Só o menu o usa: o título
   * da tela, o caminho no topo, a aba do navegador e a dica do menu recolhido
   * continuam com o `label` inteiro. Aprovado pelo dono em 03/10/2026.
   */
  rotuloCurto?: string
  /**
   * 8px de respiro ANTES do item: começa um grupo novo dentro da seção, sem
   * título (auditoria visual, §1). Em Operacional: a rotina (Publicações,
   * Tarefas), a consulta (Créditos, Requerimentos, Contatos) e a leitura
   * (Quadro econômico).
   */
  respiro?: boolean
}

export interface NavSection {
  /** Título do grupo (setor). null = item solto no topo. */
  title: string | null
  items: NavLeaf[]
}

// O MENU DA ETAPA 3 DO REDESENHO (02/10/2026), como na amostra aprovada:
//
// - A ANÁLISE DE CRÉDITO FICA NO TOPO, FORA DAS SEÇÕES: comercial e operacional
//   trabalham juntos nela, e é a tela em que a plataforma abre (`INICIO`). Sob o
//   título de um setor, parecia ser só daquele setor.
// - Depois, Comercial e Operacional, cada um na ordem do trabalho. Configurações
//   fica no rodapé (`NAV_CONFIG`), só para administrador.
// - O QUADRO ECONÔMICO É UM ITEM SÓ, dentro de Operacional (decisão do dono).
//   Era uma seção inteira, com cinco itens para a mesma carteira; agora são as
//   cinco abas de uma moldura (`pages/inteligencia/Moldura.tsx`). Os endereços
//   NÃO mudaram: cada aba mantém o que tinha como tela, em /inteligencia/*.
// - Rótulos só com a inicial maiúscula ("Geração de contratos"), como o resto
//   do texto da plataforma.
//
// A GESTÃO ESTRATÉGICA SAIU DO MENU em 30/09/2026, a pedido da equipe. Era
// também a página inicial; o início passou a ser a Análise de Crédito (ver
// `INICIO`).
//
// O Quadro econômico fica por ÚLTIMO em Operacional porque não é um passo do
// trabalho: é a leitura do que o trabalho produziu. Vem depois dele, não antes.
//
// O nome é deliberado. "Quadro" é palavra de observação: o módulo retrata a
// carteira com os dados que existem e diz quando não dá para concluir. Não
// aponta caminho, não decide, não prevê o andamento do processo.
/**
 * A página em que a plataforma abre: depois do login, na raiz, no "voltar ao
 * início" da página não encontrada e quando alguém sem permissão tenta abrir
 * Configurações.
 */
export const INICIO = '/operacional/analise'

/**
 * As abas do Quadro econômico, NA ORDEM DAS PERGUNTAS: como está a carteira, o
 * que vem, o que já rendeu, onde o capital está e, por fim, o recorte de cada
 * investidor.
 *
 * Como itens do menu, iam em ORDEM ALFABÉTICA: numa lista vertical, quem procura
 * um item procura pelo nome. Lado a lado, como abas da mesma carteira, cinco
 * nomes se leem de uma vez, e a sequência das perguntas passa a valer mais que
 * a busca.
 *
 * Carteiras é a quinta: o módulo continua em `pages/comercial`, o endereço em
 * /inteligencia/carteiras, e o antigo /comercial/carteiras segue redirecionando
 * para ele (App.tsx).
 */
export const ABAS_DO_QUADRO: readonly NavAba[] = [
  { label: 'Visão geral', to: '/inteligencia' },
  { label: 'Previsões', to: '/inteligencia/previsoes' },
  { label: 'Performance', to: '/inteligencia/performance' },
  { label: 'Recortes', to: '/inteligencia/recortes' },
  { label: 'Carteiras', to: '/inteligencia/carteiras' },
]

export const NAVIGATION: NavSection[] = [
  {
    // SEM TÍTULO: o item solto no topo (ver o porquê no começo do arquivo).
    title: null,
    items: [
      { label: 'Análise de crédito', to: '/operacional/analise', icon: SquareKanban },
    ],
  },
  {
    title: 'Comercial',
    // ORDEM = a do trabalho: o cadastro das pessoas vem antes e a geração de
    // contratos fica por último, porque é o passo que CONSOME o anterior
    // (não se gera contrato de quem ainda não tem ficha).
    items: [
      // Carteiras de Investimento saiu daqui para o Quadro Econômico: não é
      // cadastro nem venda, é relatório econômico por investidor.
      {
        label: 'Dados cadastrais',
        to: '/comercial/dados-pessoais',
        icon: IdCard,
      },
      { label: 'Geração de contratos', to: '/comercial/contratos', icon: FileSignature },
    ],
  },
  {
    // Execução Processual deixou de ser seção própria: eram dois títulos para
    // um setor só. As rotas seguem em /operacional/execucao/* — mudar URL
    // quebraria links salvos sem ganho nenhum.
    title: 'Operacional',
    items: [
      {
        label: 'Publicações e movimentações',
        rotuloCurto: 'Publicações',
        to: '/operacional/execucao/publicacoes',
        icon: Newspaper,
      },
      {
        label: 'Tarefas',
        to: '/operacional/execucao/tarefas',
        icon: ListChecks,
      },
      {
        label: 'Créditos',
        to: '/operacional/execucao/processos',
        // A CARTEIRA (Wallet): era FolderKanban, que sugeria quadro de etapas —
        // e o quadro de etapas é a Análise de crédito.
        icon: Wallet,
        respiro: true,
      },
      {
        label: 'Requerimentos administrativos',
        rotuloCurto: 'Requerimentos',
        to: '/operacional/execucao/requerimentos',
        // Landmark (o órgão público): o ClipboardList de antes era quase igual
        // ao ListChecks de Tarefas, dois itens acima.
        icon: Landmark,
      },
      {
        label: 'Contatos',
        to: '/operacional/execucao/contatos',
        // BookUser: os contatos têm e-mail, não só telefone.
        icon: BookUser,
      },
      {
        label: 'Quadro econômico',
        to: '/inteligencia',
        icon: PieChart,
        abas: ABAS_DO_QUADRO,
        respiro: true,
      },
    ],
  },
]

export const NAV_CONFIG: NavLeaf = {
  label: 'Configurações',
  to: '/configuracoes',
  icon: Settings,
}

/** Todos os itens do menu, Configurações inclusive (o Sidebar só o desenha para administrador). */
export const ITENS_DO_MENU: readonly NavLeaf[] = [
  ...NAVIGATION.flatMap((s) => s.items),
  NAV_CONFIG,
]

/**
 * O caminho como o react-router o compara: sem diferença de maiúsculas e sem a
 * barra do fim. `/Operacional/Analise/` abre a Análise (ver rotas.test.ts);
 * então acende o mesmo item, mostra o mesmo caminho no topo e o mesmo título.
 */
function normalizarCaminho(pathname: string): string {
  return pathname.toLowerCase().replace(/\/+$/, '') || '/'
}

/** O endereço é o próprio `to` ou fica embaixo dele. */
function casa(pathname: string, to: string): boolean {
  return pathname === to || pathname.startsWith(`${to}/`)
}

/** Os endereços que pertencem ao item: o dele e, numa moldura, os das abas. */
export function enderecosDoItem(item: NavLeaf): readonly string[] {
  return item.abas ? [item.to, ...item.abas.map((a) => a.to)] : [item.to]
}

/**
 * O item fica aceso neste endereço? SÓ POR IGUALDADE com um dos endereços que
 * ele DECLARA (`enderecosDoItem`), nunca por prefixo.
 *
 * O DEFEITO QUE ISTO NÃO PODE TRAZER DE VOLTA (corrigido em e9c405e): o NavLink
 * sem `end` acende por prefixo, e "Visão Geral" (/inteligencia) ficava aceso
 * junto com as quatro subtelas do Quadro — dois itens marcados ao mesmo tempo.
 * O `end` consertou, mas agora o Quadro é UM item que precisa acender nas cinco
 * abas, justamente o que o `end` impede. Voltar ao prefixo traria o defeito de
 * volta para qualquer item que algum dia ganhe um vizinho embaixo do endereço
 * dele. A lista explícita não depende disso: endereço que nenhum item declara
 * (a página não encontrada em /inteligencia/recortes/x, por exemplo) não acende
 * nada.
 */
export function itemAcende(item: NavLeaf, pathname: string): boolean {
  const p = normalizarCaminho(pathname)
  return enderecosDoItem(item).includes(p)
}

/**
 * O item aceso no menu — o `to` dele —, ou null quando nenhum está. É o que o
 * Sidebar marca; o navegacao.test.ts confere que cada endereço de tela acende
 * UM item, e só um.
 */
export function itemAtivo(pathname: string): string | null {
  return ITENS_DO_MENU.find((i) => itemAcende(i, pathname))?.to ?? null
}

/** Onde a pessoa está: o setor, o item do menu e, numa moldura, a aba. */
export interface NavLocation {
  /** O título da seção; null para o item solto no topo e para Configurações. */
  section: string | null
  leaf: NavLeaf
  /** A aba aberta, quando o item é uma moldura; senão null. */
  aba: NavAba | null
}

/**
 * Resolve a rota atual para (seção, página, aba) — usado pelo caminho no topo e
 * pelo título da aba do navegador.
 *
 * Vence o caminho MAIS ESPECÍFICO, não o primeiro que casa. A diferença não é
 * teórica: `/inteligencia` é prefixo de `/inteligencia/performance`, e enquanto
 * a busca devolvia o primeiro casamento, o cabeçalho e o título da aba diziam
 * "Visão Geral" em todas as quatro subtelas do Quadro Econômico. Com o Quadro
 * numa moldura, a mesma regra escolhe a ABA: a Visão geral (/inteligencia) vem
 * primeiro em `ABAS_DO_QUADRO` e é prefixo das outras quatro.
 *
 * Ordenar o menu resolveria por tabela, mas deixaria a correção do cabeçalho
 * dependendo da ordem dos itens — qualquer reordenação futura traria o defeito
 * de volta, e em silêncio. Escolher o mais longo é indiferente à ordem.
 */
export function findNavLocation(pathname: string): NavLocation | null {
  const p = normalizarCaminho(pathname)
  const achado =
    resolverNav(NAVIGATION, p) ??
    (casa(p, NAV_CONFIG.to) ? { section: null, leaf: NAV_CONFIG } : null)
  if (!achado) return null
  return { ...achado, aba: achado.leaf.abas ? maisEspecifico(achado.leaf.abas, p) : null }
}

/** Entre os que casam com o endereço, o de caminho mais longo; a ordem da lista não importa. */
function maisEspecifico<T extends { to: string }>(itens: readonly T[], pathname: string): T | null {
  let melhor: T | null = null
  for (const item of itens) {
    if (casa(pathname, item.to) && (!melhor || item.to.length > melhor.to.length)) melhor = item
  }
  return melhor
}

/**
 * O casamento em si, separado para poder ser testado contra um menu montado
 * de propósito na pior ordem possível.
 *
 * Recebe as seções em vez de ler `NAVIGATION` porque, com o menu já em ordem
 * alfabética, o defeito original não se manifesta mais — um teste que usasse
 * o menu real passaria mesmo com a lógica errada de volta, e foi exatamente
 * o que aconteceu na primeira tentativa de escrever esse teste.
 *
 * Um item de moldura casa por QUALQUER endereço dele (o seu e os das abas):
 * uma aba fora do caminho do item, se algum dia existir, ainda leva a ele.
 */
export function resolverNav(
  secoes: readonly NavSection[],
  pathname: string,
): { section: string | null; leaf: NavLeaf } | null {
  let melhor: { section: string | null; leaf: NavLeaf; comprimento: number } | null = null
  for (const section of secoes) {
    for (const leaf of section.items) {
      for (const endereco of enderecosDoItem(leaf)) {
        if (casa(pathname, endereco) && (!melhor || endereco.length > melhor.comprimento)) {
          melhor = { section: section.title, leaf, comprimento: endereco.length }
        }
      }
    }
  }
  return melhor && { section: melhor.section, leaf: melhor.leaf }
}

/**
 * O caminho no topo: setor › item › aba, o que existir. A Análise de crédito,
 * solta no topo do menu, e Configurações, no rodapé, não têm setor: o caminho é
 * só o nome da tela. Endereço sem lugar no menu (a página não encontrada): vazio.
 */
export function caminhoNoTopo(pathname: string): string[] {
  const nav = findNavLocation(pathname)
  if (!nav) return []
  return [nav.section, nav.leaf.label, nav.aba?.label].filter((p): p is string => !!p)
}

/**
 * O título da aba do navegador ("Tarefas — Credijuris"). Numa moldura, é o nome
 * da ABA do Quadro, não o do item: com o Quadro aberto em várias abas do
 * navegador, cada uma precisa dizer o que mostra ("Previsões — Credijuris").
 */
export function tituloDaAba(pathname: string): string {
  const nav = findNavLocation(pathname)
  return nav ? `${(nav.aba ?? nav.leaf).label} — Credijuris` : 'Credijuris — Gestão de Créditos'
}

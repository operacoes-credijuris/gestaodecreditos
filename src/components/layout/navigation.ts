import {
  LayoutDashboard,
  FileSignature,
  IdCard,
  Wallet,
  ScanSearch,
  Newspaper,
  ListChecks,
  FolderKanban,
  ClipboardList,
  Phone,
  Settings,
  Brain,
  Gauge,
  CalendarClock,
  PieChart,
  type LucideIcon,
} from 'lucide-react'

export interface NavLeaf {
  label: string
  to: string
  icon: LucideIcon
}

export interface NavSection {
  /** Título do grupo (setor). null = item solto no topo. */
  title: string | null
  items: NavLeaf[]
}

// Hierarquia exatamente conforme o escopo:
// Gestão Estratégica (topo) > Comercial > Operacional (com Execução Processual)
// > Quadro Econômico > Configurações
//
// Quadro Econômico fica por ÚLTIMO entre os setores porque não é um setor: é a
// leitura do que os outros três produziram. Vem depois do trabalho, não antes.
//
// O nome é deliberado. "Quadro" é palavra de observação: o módulo retrata a
// carteira com os dados que existem e diz quando não dá para concluir. Não
// aponta caminho, não decide, não prevê o andamento do processo.
export const NAVIGATION: NavSection[] = [
  {
    title: null,
    items: [
      {
        label: 'Gestão Estratégica',
        to: '/estrategica',
        icon: LayoutDashboard,
      },
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
      { label: 'Geração de Contratos', to: '/comercial/contratos', icon: FileSignature },
    ],
  },
  {
    // Execução Processual deixou de ser seção própria: eram dois títulos para
    // um setor só. As rotas seguem em /operacional/execucao/* — mudar URL
    // quebraria links salvos sem ganho nenhum.
    title: 'Operacional',
    items: [
      { label: 'Análise de Crédito', to: '/operacional/analise', icon: ScanSearch },
      {
        label: 'Publicações e Movimentações',
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
        icon: FolderKanban,
      },
      {
        label: 'Requerimentos administrativos',
        to: '/operacional/execucao/requerimentos',
        icon: ClipboardList,
      },
      {
        label: 'Contatos',
        to: '/operacional/execucao/contatos',
        icon: Phone,
      },
    ],
  },
  {
    title: 'Quadro Econômico',
    // ORDEM ALFABÉTICA, ao contrário das outras seções, que seguem a ordem do
    // trabalho. Aqui não há sequência: são cinco leituras independentes da
    // mesma carteira, e quem procura uma delas procura pelo nome.
    items: [
      { label: 'Carteiras de Investimento', to: '/inteligencia/carteiras', icon: Wallet },
      { label: 'Performance', to: '/inteligencia/performance', icon: Gauge },
      { label: 'Previsões', to: '/inteligencia/previsoes', icon: CalendarClock },
      { label: 'Recortes', to: '/inteligencia/recortes', icon: PieChart },
      { label: 'Visão Geral', to: '/inteligencia', icon: Brain },
    ],
  },
]

export const NAV_CONFIG: NavLeaf = {
  label: 'Configurações',
  to: '/configuracoes',
  icon: Settings,
}

/**
 * Resolve a rota atual para (seção, página) — usado por breadcrumb e title.
 *
 * Vence o caminho MAIS ESPECÍFICO, não o primeiro que casa. A diferença não é
 * teórica: `/inteligencia` é prefixo de `/inteligencia/performance`, e enquanto
 * a busca devolvia o primeiro casamento, o cabeçalho e o título da aba diziam
 * "Visão Geral" em todas as quatro subtelas do Quadro Econômico.
 *
 * Ordenar o menu resolveria por tabela, mas deixaria a correção do cabeçalho
 * dependendo da ordem dos itens — qualquer reordenação futura traria o defeito
 * de volta, e em silêncio. Escolher o mais longo é indiferente à ordem.
 */
export function findNavLocation(pathname: string): {
  section: string | null
  leaf: NavLeaf
} | null {
  const achado = resolverNav(NAVIGATION, pathname)
  if (achado) return achado
  if (pathname === NAV_CONFIG.to || pathname.startsWith(`${NAV_CONFIG.to}/`)) {
    return { section: null, leaf: NAV_CONFIG }
  }
  return null
}

/**
 * O casamento em si, separado para poder ser testado contra um menu montado
 * de propósito na pior ordem possível.
 *
 * Recebe as seções em vez de ler `NAVIGATION` porque, com o menu já em ordem
 * alfabética, o defeito original não se manifesta mais — um teste que usasse
 * o menu real passaria mesmo com a lógica errada de volta, e foi exatamente
 * o que aconteceu na primeira tentativa de escrever esse teste.
 */
export function resolverNav(
  secoes: readonly NavSection[],
  pathname: string,
): { section: string | null; leaf: NavLeaf } | null {
  let melhor: { section: string | null; leaf: NavLeaf } | null = null
  for (const section of secoes) {
    for (const leaf of section.items) {
      if (pathname === leaf.to || pathname.startsWith(`${leaf.to}/`)) {
        if (!melhor || leaf.to.length > melhor.leaf.to.length) {
          melhor = { section: section.title, leaf }
        }
      }
    }
  }
  return melhor
}

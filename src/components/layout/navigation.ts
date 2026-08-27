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
  ShieldAlert,
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
    items: [
      { label: 'Visão Geral', to: '/inteligencia', icon: Brain },
      { label: 'Performance', to: '/inteligencia/performance', icon: Gauge },
      { label: 'Previsões', to: '/inteligencia/previsoes', icon: CalendarClock },
      { label: 'Recortes', to: '/inteligencia/recortes', icon: PieChart },
      // Logo depois de Recortes de propósito: Recortes COMPARA investidores em
      // agregado, esta tela ABRE um investidor. É o mesmo corte, em profundidade.
      { label: 'Carteiras de Investimento', to: '/inteligencia/carteiras', icon: Wallet },
      { label: 'Revisão de Dados', to: '/inteligencia/anomalias', icon: ShieldAlert },
    ],
  },
]

export const NAV_CONFIG: NavLeaf = {
  label: 'Configurações',
  to: '/configuracoes',
  icon: Settings,
}

/** Resolve a rota atual para (seção, página) — usado por breadcrumb e title. */
export function findNavLocation(pathname: string): {
  section: string | null
  leaf: NavLeaf
} | null {
  for (const section of NAVIGATION) {
    for (const leaf of section.items) {
      if (pathname === leaf.to || pathname.startsWith(`${leaf.to}/`)) {
        return { section: section.title, leaf }
      }
    }
  }
  if (pathname.startsWith(NAV_CONFIG.to)) {
    return { section: null, leaf: NAV_CONFIG }
  }
  return null
}

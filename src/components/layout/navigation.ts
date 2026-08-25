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
// > Inteligência Econômica > Configurações
//
// Inteligência Econômica fica por ÚLTIMO entre os setores porque não é um setor:
// é a leitura do que os outros três produziram. Vem depois do trabalho, não antes.
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
    // ORDEM = a do trabalho: a carteira e o cadastro das pessoas vêm antes, e a
    // geração de contratos fica por último, porque é o passo que CONSOME o que os
    // dois anteriores produziram (não se gera contrato de quem ainda não tem ficha).
    items: [
      { label: 'Carteiras de Investimento', to: '/comercial/carteiras', icon: Wallet },
      // Era a terceira aba das Carteiras. Virou item próprio, logo abaixo dela,
      // porque não é carteira — e passou a cobrir investidores E originadores.
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
    title: 'Inteligência Econômica',
    items: [
      { label: 'Visão Geral', to: '/inteligencia', icon: Brain },
      { label: 'Performance', to: '/inteligencia/performance', icon: Gauge },
      { label: 'Previsões', to: '/inteligencia/previsoes', icon: CalendarClock },
      { label: 'Recortes', to: '/inteligencia/recortes', icon: PieChart },
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

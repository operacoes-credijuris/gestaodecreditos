import {
  LayoutDashboard,
  FileSignature,
  Wallet,
  Handshake,
  ScanSearch,
  Newspaper,
  ListChecks,
  FolderKanban,
  ClipboardList,
  Phone,
  Settings,
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
// Gestão Estratégica (topo) > Comercial > Operacional (com Execução Processual) > Configurações
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
    items: [
      { label: 'Cessões', to: '/comercial/cessoes', icon: Handshake },
      { label: 'Geração de Contratos', to: '/comercial/contratos', icon: FileSignature },
      { label: 'Carteiras de Investidores', to: '/comercial/carteiras', icon: Wallet },
    ],
  },
  {
    title: 'Operacional',
    items: [
      { label: 'Análise de Crédito', to: '/operacional/analise', icon: ScanSearch },
    ],
  },
  {
    title: 'Execução Processual',
    items: [
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
        label: 'Requerimentos',
        to: '/operacional/execucao/requerimentos',
        icon: ClipboardList,
      },
      {
        label: 'Contatos de Serventias',
        to: '/operacional/execucao/contatos',
        icon: Phone,
      },
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

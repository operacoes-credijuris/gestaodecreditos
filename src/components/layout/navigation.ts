import {
  LayoutDashboard,
  FileSignature,
  Wallet,
  ScanSearch,
  Gavel,
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
        label: 'Tarefas ADVBOX',
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
        label: 'Contatos',
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

export const ICON_GAVEL = Gavel

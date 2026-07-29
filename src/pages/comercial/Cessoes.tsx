import { PageHeader } from '@/components/ui/PageHeader'
import { CessoesPanel } from './CessoesPanel'

/**
 * Cessões como página própria do menu Comercial (antes vivia escondida como
 * 4ª aba de Carteiras de Investidores).
 */
export default function Cessoes() {
  return (
    <div>
      <PageHeader title="Cessões" />
      <CessoesPanel />
    </div>
  )
}

import { Link } from 'react-router-dom'
import { Compass } from 'lucide-react'
import { Card } from '@/components/ui/Card'

/** Página exibida para rotas inexistentes (em vez de redirecionar em silêncio). */
export default function NotFound() {
  return (
    <div className="flex justify-center pt-16">
      <Card className="flex max-w-md flex-col items-center gap-3 p-10 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-50">
          <Compass className="h-7 w-7 text-brand-600" />
        </div>
        <h1 className="text-2xl font-bold text-slate-800">
          Página não encontrada
        </h1>
        <p className="text-sm text-slate-500">
          O endereço acessado não existe ou foi movido. Confira o link ou volte
          para o início.
        </p>
        <Link
          to="/estrategica"
          className="mt-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700"
        >
          Ir para a Gestão Estratégica
        </Link>
      </Card>
    </div>
  )
}

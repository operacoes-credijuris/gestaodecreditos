import { FlaskConical } from 'lucide-react'
import { ehBeta } from '@/lib/canal'

/**
 * A faixa que anuncia a versão beta. Na versão oficial não desenha nada.
 *
 * O LINK LEVA À MESMA TELA na versão oficial: a beta mora em /beta/, então
 * a oficial é a pasta de cima, com o mesmo endereço depois do "#" (o
 * HashRouter guarda a tela ali). A sessão é a mesma nas duas — o login vale
 * para ambas, e sair de uma sai das duas.
 */
export function FaixaBeta({ fixa = false }: { fixa?: boolean }) {
  if (!ehBeta) return null
  return (
    <div
      role="note"
      className={`flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-amber-300 bg-amber-100 px-4 py-1.5 text-sm text-amber-900 ${
        fixa ? 'fixed inset-x-0 top-0 z-50' : ''
      }`}
    >
      <FlaskConical className="h-4 w-4 shrink-0" aria-hidden />
      <span>
        <strong>Versão beta</strong> — mesmos dados e mesmo Kommo da oficial: o que se faz aqui é real.
      </span>
      <a
        href="../"
        onClick={(e) => {
          e.preventDefault()
          window.location.href = '../' + window.location.hash
        }}
        className="font-medium underline underline-offset-2 hover:text-amber-950"
      >
        Abrir na versão oficial
      </a>
    </div>
  )
}

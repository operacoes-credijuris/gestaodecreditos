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
      className={`flex flex-wrap items-center justify-center gap-x-s3 gap-y-s1 border-b border-aviso-borda bg-aviso-fundo px-s4 py-s1.5 text-sm text-aviso ${
        fixa ? 'fixed inset-x-0 top-0 z-50' : ''
      }`}
    >
      <FlaskConical className="h-[16px] w-[16px] shrink-0" aria-hidden />
      <span>
        <strong>Versão beta</strong> — mesmos dados e mesmo Kommo da oficial: o que se faz aqui é real.
      </span>
      <a
        href="../"
        onClick={(e) => {
          e.preventDefault()
          window.location.href = '../' + window.location.hash
        }}
        className="font-semibold underline underline-offset-2 hover:text-texto"
      >
        Abrir na versão oficial
      </a>
    </div>
  )
}

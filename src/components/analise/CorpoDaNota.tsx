// O TEXTO DE UMA NOTA NO HISTÓRICO DO CARD, com o lápis que a edita (20/10/2026,
// pedido do dono). A edição vai ao Kommo pela `kommo-editar-nota`, na MESMA nota
// (sem criar outra); o rodapé passa a dizer quem editou e quando. Só as notas de
// texto de gente se editam (ver `notaEditavel`).
import { useState, type ReactNode } from 'react'
import { Pencil } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { KommoNota } from '@/lib/types'
import { Button } from '@/components/ui/Button'
import { Textarea } from '@/components/ui/Field'
import { corpoEditavel, notaEditavel } from '../../../supabase/functions/_shared/edicaoDeNota.ts'

export function CorpoDaNota({
  nota,
  corpo,
  children,
  onEditar,
}: {
  nota: KommoNota
  /** O texto a mostrar (a nota inteira, com o rodapé). */
  corpo: string
  /** O texto já desenhado (com os links clicáveis). */
  children: ReactNode
  /** Salva o corpo novo; LANÇA com a mensagem quando falha. Sem ele, não há lápis. */
  onEditar?: (nota: KommoNota, corpoNovo: string) => Promise<void>
}) {
  const [editando, setEditando] = useState(false)
  const [texto, setTexto] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const pode = !!onEditar && notaEditavel(nota)

  const abrir = () => {
    setTexto(corpoEditavel(corpo))
    setErro(null)
    setEditando(true)
  }
  const salvar = async () => {
    if (!onEditar || salvando) return
    const novo = texto.trim()
    if (!novo) {
      setErro('O texto não pode ficar vazio.')
      return
    }
    if (novo === corpoEditavel(corpo)) {
      setEditando(false)
      return
    }
    setSalvando(true)
    setErro(null)
    try {
      await onEditar(nota, novo)
      setEditando(false)
    } catch (e) {
      setErro((e as Error)?.message ?? String(e))
    } finally {
      setSalvando(false)
    }
  }

  if (editando) {
    return (
      <div className="mt-s1">
        <Textarea
          autoFocus
          rows={Math.min(12, Math.max(3, texto.split('\n').length + 1))}
          value={texto}
          aria-label="Texto da nota"
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && !salvando) {
              e.stopPropagation()
              setEditando(false)
            }
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void salvar()
          }}
          disabled={salvando}
        />
        <p className="mt-s1 text-xs text-texto-3">
          Muda a mesma nota no Kommo; o rodapé registra quem editou e quando.
        </p>
        {erro && (
          <p role="alert" className="mt-s1 text-corpo text-perigo">
            {erro}
          </p>
        )}
        <div className="mt-s2 flex flex-wrap justify-end gap-s2">
          <Button size="sm" variant="ghost" onClick={() => setEditando(false)} disabled={salvando}>
            Cancelar
          </Button>
          <Button size="sm" onClick={() => void salvar()} loading={salvando}>
            Salvar
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="group relative">
      <pre
        className={cn(
          'mt-0.5 whitespace-pre-wrap break-words font-sans text-corpo',
          nota.automatica ? 'text-texto-3' : 'text-texto-2',
          pode && 'pr-s8',
        )}
      >
        {children}
      </pre>
      {pode && (
        <button
          type="button"
          onClick={abrir}
          title="Editar o texto desta nota"
          aria-label="Editar o texto desta nota"
          className="absolute right-0 top-0 grid h-[24px] w-[24px] place-items-center rounded-controle text-texto-3 opacity-70 transition-opacity after:absolute after:-inset-[6px] hover:bg-superficie-3 hover:text-marca-texto hover:opacity-100 focus-visible:opacity-100"
        >
          <Pencil className="h-[14px] w-[14px]" aria-hidden />
        </button>
      )}
    </div>
  )
}

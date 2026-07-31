import { useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Input } from './Field'

export interface OpcaoCombo {
  id: number
  /** Linha principal. Também é o que a busca casa. */
  titulo: string
  /** Linha secundária, menor e cinza. Entra na busca quando existe. */
  subtitulo?: string | null
}

/**
 * Casa por PALAVRA, em qualquer ordem: "cumprimento" encontra "Elaborar
 * cumprimento de sentença", e "sentença cumprimento" também. Buscar por prefixo
 * obrigaria a lembrar como a opção começa, que é justamente o que não se lembra
 * numa lista de dezenas de tipos de tarefa.
 */
function casa(opcao: OpcaoCombo, consulta: string): boolean {
  const alvo = `${opcao.titulo} ${opcao.subtitulo ?? ''}`.toLowerCase()
  return consulta
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((palavra) => alvo.includes(palavra))
}

/** Lista suspensa compartilhada pelos dois comboboxes. */
function Lista({
  opcoes,
  destaque,
  onDestacar,
  onEscolher,
  vazio,
}: {
  opcoes: OpcaoCombo[]
  destaque: number
  onDestacar: (i: number) => void
  onEscolher: (o: OpcaoCombo) => void
  vazio: string
}) {
  if (opcoes.length === 0) {
    return (
      <div className="absolute z-20 mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500 shadow-lg">
        {vazio}
      </div>
    )
  }
  return (
    <ul className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg scrollbar-thin">
      {opcoes.map((o, i) => (
        <li key={o.id}>
          <button
            type="button"
            // onMouseDown e não onClick: o clique precisa registrar antes do
            // blur do input, senão a lista fecha e a escolha se perde.
            onMouseDown={(e) => {
              e.preventDefault()
              onEscolher(o)
            }}
            onMouseEnter={() => onDestacar(i)}
            className={cn(
              'block w-full px-3 py-1.5 text-left',
              i === destaque ? 'bg-brand-50' : 'hover:bg-slate-50',
            )}
          >
            <div
              className={cn(
                'text-sm',
                i === destaque ? 'text-brand-700' : 'text-slate-700',
              )}
            >
              {o.titulo}
            </div>
            {o.subtitulo && (
              <div className="text-xs text-slate-500">{o.subtitulo}</div>
            )}
          </button>
        </li>
      ))}
    </ul>
  )
}

/** Navegação por teclado comum aos dois comboboxes. */
function useTeclado(
  qtd: number,
  aberto: boolean,
  abrir: () => void,
  fechar: () => void,
  escolherIndice: (i: number) => void,
) {
  const [destaque, setDestaque] = useState(0)
  useEffect(() => setDestaque(0), [qtd])

  function onKeyDown(e: React.KeyboardEvent) {
    if (!aberto && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      abrir()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setDestaque((h) => Math.min(h + 1, qtd - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setDestaque((h) => Math.max(h - 1, 0))
    } else if (e.key === 'Enter') {
      if (aberto && qtd > 0) {
        e.preventDefault()
        escolherIndice(destaque)
      }
    } else if (e.key === 'Escape') {
      fechar()
    }
  }
  return { destaque, setDestaque, onKeyDown }
}

/** Fecha a lista ao clicar fora. */
function useCliqueFora(aberto: boolean, fechar: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!aberto) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) fechar()
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [aberto, fechar])
  return ref
}

/**
 * Seleção única com busca. O texto digitado filtra; escolher fixa a opção.
 */
export function Combobox({
  opcoes,
  valor,
  onChange,
  placeholder,
  vazio = 'Nada encontrado.',
  limite = 50,
}: {
  opcoes: OpcaoCombo[]
  /** Id selecionado, ou null. */
  valor: number | null
  onChange: (id: number | null) => void
  placeholder?: string
  vazio?: string
  limite?: number
}) {
  const [aberto, setAberto] = useState(false)
  const [busca, setBusca] = useState('')
  const selecionada = opcoes.find((o) => o.id === valor) ?? null

  const filtradas = useMemo(() => {
    const q = busca.trim()
    return (q ? opcoes.filter((o) => casa(o, q)) : opcoes).slice(0, limite)
  }, [opcoes, busca, limite])

  const escolher = (o: OpcaoCombo) => {
    onChange(o.id)
    setBusca('')
    setAberto(false)
  }
  const { destaque, setDestaque, onKeyDown } = useTeclado(
    filtradas.length,
    aberto,
    () => setAberto(true),
    () => setAberto(false),
    (i) => filtradas[i] && escolher(filtradas[i]),
  )
  const boxRef = useCliqueFora(aberto, () => setAberto(false))

  // Com opção escolhida o input mostra o título dela; ao focar, esvazia para a
  // pessoa digitar outra busca sem precisar apagar o texto antes.
  const textoInput = aberto ? busca : (selecionada?.titulo ?? '')

  return (
    <div ref={boxRef} className="relative">
      <Input
        value={textoInput}
        autoComplete="off"
        placeholder={placeholder}
        onChange={(e) => {
          setBusca(e.target.value)
          setAberto(true)
        }}
        onFocus={() => {
          setBusca('')
          setAberto(true)
        }}
        onKeyDown={onKeyDown}
      />
      {selecionada?.subtitulo && !aberto && (
        <p className="mt-1 text-xs text-slate-500">{selecionada.subtitulo}</p>
      )}
      {aberto && (
        <Lista
          opcoes={filtradas}
          destaque={destaque}
          onDestacar={setDestaque}
          onEscolher={escolher}
          vazio={vazio}
        />
      )}
    </div>
  )
}

/**
 * Seleção múltipla com busca. Os escolhidos viram fichas removíveis acima do
 * campo; a lista esconde quem já foi escolhido.
 */
export function MultiCombobox({
  opcoes,
  valores,
  onChange,
  placeholder,
  vazio = 'Nada encontrado.',
  limite = 50,
}: {
  opcoes: OpcaoCombo[]
  valores: number[]
  onChange: (ids: number[]) => void
  placeholder?: string
  vazio?: string
  limite?: number
}) {
  const [aberto, setAberto] = useState(false)
  const [busca, setBusca] = useState('')

  const escolhidas = valores
    .map((id) => opcoes.find((o) => o.id === id))
    .filter((o): o is OpcaoCombo => !!o)

  const filtradas = useMemo(() => {
    const q = busca.trim()
    return opcoes
      .filter((o) => !valores.includes(o.id))
      .filter((o) => (q ? casa(o, q) : true))
      .slice(0, limite)
  }, [opcoes, valores, busca, limite])

  const adicionar = (o: OpcaoCombo) => {
    onChange([...valores, o.id])
    setBusca('')
    // Segue aberto: escolher vários seguidos é o caso comum.
  }
  const { destaque, setDestaque, onKeyDown } = useTeclado(
    filtradas.length,
    aberto,
    () => setAberto(true),
    () => setAberto(false),
    (i) => filtradas[i] && adicionar(filtradas[i]),
  )
  const boxRef = useCliqueFora(aberto, () => setAberto(false))

  return (
    <div ref={boxRef} className="relative">
      {escolhidas.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1.5">
          {escolhidas.map((o) => (
            <span
              key={o.id}
              className="inline-flex items-center gap-1 rounded-full bg-brand-50 py-0.5 pl-2.5 pr-1 text-xs font-medium text-brand-700 ring-1 ring-inset ring-brand-100"
            >
              {o.titulo}
              <button
                type="button"
                onClick={() => onChange(valores.filter((v) => v !== o.id))}
                aria-label={`Remover ${o.titulo}`}
                className="rounded-full p-0.5 text-brand-400 hover:bg-brand-100 hover:text-brand-700"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <Input
        value={busca}
        autoComplete="off"
        placeholder={placeholder}
        onChange={(e) => {
          setBusca(e.target.value)
          setAberto(true)
        }}
        onFocus={() => setAberto(true)}
        onKeyDown={(e) => {
          // Backspace no campo vazio remove a última ficha — atalho esperado
          // em campos de ficha.
          if (e.key === 'Backspace' && !busca && valores.length > 0) {
            onChange(valores.slice(0, -1))
            return
          }
          onKeyDown(e)
        }}
      />
      {aberto && (
        <Lista
          opcoes={filtradas}
          destaque={destaque}
          onDestacar={setDestaque}
          onEscolher={adicionar}
          vazio={vazio}
        />
      )}
    </div>
  )
}

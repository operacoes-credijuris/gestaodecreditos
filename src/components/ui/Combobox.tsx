import { useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { normalizarBusca, onlyDigits } from '@/lib/format'
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
 *
 * SEM ACENTO NOS DOIS LADOS. Só na consulta não resolveria — a lista é acentuada,
 * e é ela que precisa ser achada. Medido antes da correção: dos 5.571 municípios
 * do IBGE, 2.384 não retornavam nada quando o nome era digitado sem acento, e a
 * tela dizia "Nenhuma cidade encontrada nesta UF" com a cidade ali na lista.
 * "goiania", "brasilia", "sao paulo", "belem" e "uberlandia" todos falhavam. O
 * mesmo valia para investidor: "jose" não achava "José".
 *
 * E CASAMENTO POR DÍGITO como alternativa, para número de processo: o CNJ na tela
 * está formatado (5001234-56.2024.8.13.0000) e quem cola o número cru, ou digita
 * só um pedaço dele, não casava com nada. normalizarBusca sozinha não cobre isso,
 * porque a pontuação continua no meio.
 */
function casa(opcao: OpcaoCombo, consulta: string): boolean {
  const texto = `${opcao.titulo} ${opcao.subtitulo ?? ''}`
  const alvo = normalizarBusca(texto)
  const alvoDigitos = onlyDigits(texto)
  return normalizarBusca(consulta)
    .split(/\s+/)
    .filter(Boolean)
    .every((palavra) => {
      if (alvo.includes(palavra)) return true
      const d = onlyDigits(palavra)
      // 3+ dígitos para "1" ou "24" não casarem meia lista de processos.
      return d.length >= 3 && alvoDigitos.includes(d)
    })
}

/** Lista suspensa compartilhada pelos dois comboboxes. */
function Lista({
  opcoes,
  destaque,
  onDestacar,
  onEscolher,
  vazio,
  truncada,
}: {
  opcoes: OpcaoCombo[]
  destaque: number
  onDestacar: (i: number) => void
  onEscolher: (o: OpcaoCombo) => void
  vazio: string
  /** Bateu no limite: há mais opções do que as exibidas. */
  truncada?: boolean
}) {
  const ulRef = useRef<HTMLUListElement>(null)

  // Rola o item destacado para a vista. Sem isto, navegar com as setas numa
  // lista de 853 municípios movia um destaque invisível: o foco descia e a
  // lista ficava parada nos primeiros itens.
  useEffect(() => {
    if (destaque < 0 || !ulRef.current) return
    ulRef.current.children[destaque]?.scrollIntoView({ block: 'nearest' })
  }, [destaque])

  if (opcoes.length === 0) {
    return (
      <div className="absolute z-20 mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600 shadow-lg">
        {vazio}
      </div>
    )
  }
  return (
    <ul
      ref={ulRef}
      className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg scrollbar-thin"
    >
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
              <div className="text-xs text-slate-600">{o.subtitulo}</div>
            )}
          </button>
        </li>
      ))}
      {/* Corte silencioso fazia quem rolava até o fim concluir que a opção não
          existe: sem busca, a lista de MG mostrava 50 de 853 e terminava em
          "Arinos", sem Belo Horizonte e sem dizer que havia mais. */}
      {truncada && (
        <li className="border-t border-slate-100 px-3 py-1.5 text-xs text-slate-600">
          Mostrando os {opcoes.length} primeiros. Digite para refinar.
        </li>
      )}
    </ul>
  )
}

/**
 * Navegação por teclado comum aos dois comboboxes.
 *
 * NASCE COM -1, "nada destacado", e não com 0. Antes, abrir a lista já deixava a
 * primeira opção destacada, e Enter a escolhia: quem tinha "Uberlândia" salvo,
 * clicava no campo só para reler e apertava Enter, saía com "Abadia dos
 * Dourados", o primeiro de 853. Enter agora só escolhe o que a pessoa destacou
 * com as setas, ou o primeiro resultado de uma busca que ela mesma digitou.
 */
function useTeclado(
  qtd: number,
  /** Consulta atual: reseta o destaque quando o conjunto filtrado muda. */
  chave: string,
  aberto: boolean,
  abrir: () => void,
  fechar: () => void,
  escolherIndice: (i: number) => void,
) {
  const [destaque, setDestaque] = useState(-1)
  // `chave` junto de `qtd`: só a contagem não bastava. Com o corte em 50, digitar
  // uma letra troca a lista inteira mantendo 50 itens, então o destaque ficava
  // parado no índice antigo e Enter escolhia um município que não era o que
  // estava sob os olhos.
  useEffect(() => setDestaque(-1), [qtd, chave])

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
      if (!aberto) return
      // preventDefault mesmo sem escolher: o combobox costuma viver dentro de
      // <form>, e deixar o Enter borbulhar submeteria o formulário no meio da
      // escolha.
      e.preventDefault()
      if (qtd > 0 && destaque >= 0) escolherIndice(destaque)
      else if (qtd > 0 && chave.trim()) escolherIndice(0)
      else fechar()
    } else if (e.key === 'Escape') {
      // Lista FECHADA: o Escape é do modal, não daqui. Sem esta guarda o
      // combobox consumia a tecla de qualquer jeito.
      if (!aberto) return
      // Lista aberta: fecha só ela. Sem o stopPropagation o keydown borbulhava
      // até o listener de document do Modal, que fechava o formulário inteiro —
      // quem abria a lista de responsáveis para conferir e apertava Esc perdia
      // a tarefa que estava digitando, sem confirmação nenhuma.
      e.stopPropagation()
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
    busca,
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
        <p className="mt-1 text-xs text-slate-600">{selecionada.subtitulo}</p>
      )}
      {aberto && (
        <Lista
          opcoes={filtradas}
          destaque={destaque}
          onDestacar={setDestaque}
          onEscolher={escolher}
          vazio={vazio}
          truncada={filtradas.length === limite}
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
    busca,
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
          truncada={filtradas.length === limite}
        />
      )}
    </div>
  )
}

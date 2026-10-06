// A CAIXA DO "ANOTAR" de cada card da Análise de crédito: o texto e, desde
// 05/10/2026 (pedido do dono), os ARQUIVOS — escolhidos no computador ("Anexar
// arquivo", vários de uma vez), arrastados para a caixa ou colados com Ctrl+V.
//
// O BOTÃO E A MOLDURA continuam na página (`BotaoDeAnotacao`, na Análise); aqui
// ficam o estado (`useAnotacaoDoCard`) e o miolo (`CaixaDeAnotacao`). O estado
// mora no botão, e não na caixa: fechar a caixa (clique fora, Esc) não pode
// levar os arquivos escolhidos.
//
// A ORDEM DAS CHAMADAS e as mensagens de falha parcial moram em
// lib/anexosDaAnotacao.ts (testadas): o texto pela kommo-anotar, uma vez; cada
// arquivo pela kommo-anexo-enviar, sem texto. O que entrou sai da lista; o que
// não entrou fica, para tentar de novo sem repetir nada.
//
// O RASCUNHO É SÓ DO TEXTO (como antes, `rascunhoDoCard.ts`). Arquivo não cabe no
// armazenamento do navegador: saindo da página, ele sai da lista — e a caixa
// diz isso quando há arquivo nela.
import { useRef, useState, type ClipboardEvent, type DragEvent } from 'react'
import { AlertTriangle, FileText, Image as ImageIcon, Paperclip, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Tecla } from '@/components/ui/Tecla'
import { useToast } from '@/components/ui/Toast'
import { CaixaDeAviso } from '@/components/analise/Pecas'
import { cn } from '@/lib/cn'
import { enviarArquivo } from '@/lib/enviarArquivo'
import { apagarRascunho, guardarRascunho, rascunhoGuardado } from '@/lib/rascunhoDoCard'
import {
  type AnexoDaAnotacao,
  type EstadoDoAnexo,
  acrescentarAnexos,
  enviarAnotacao,
  nomearColado,
  resumoDaAnotacao,
  tamanhoLegivel,
} from '@/lib/anexosDaAnotacao'

type AvisoDaCaixa = { tom: 'sucesso' | 'aviso' | 'perigo'; texto: string }

export interface AnotacaoDoCard {
  texto: string
  setTexto: (v: string) => void
  anexos: readonly AnexoDaAnotacao[]
  acrescentar: (arquivos: File[]) => void
  tirar: (chave: string) => void
  /** Envia; true quando nada ficou para trás (a caixa pode fechar). */
  enviar: () => Promise<boolean>
  enviando: boolean
  aviso: AvisoDaCaixa | null
  /** Há texto ou arquivo esperando — o botão fica marcado. */
  temRascunho: boolean
}

/**
 * O estado da anotação de um card. `onEnviarTexto` é a gravação da nota de
 * texto da página (kommo-anotar, o cache do card e o aviso) — LANÇA na falha.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useAnotacaoDoCard(leadId: number, onEnviarTexto: (texto: string) => Promise<void>): AnotacaoDoCard {
  // O RASCUNHO SOBREVIVE AO CARD (ver rascunhoDoCard.ts): trocar de etapa,
  // filtrar ou sincronizar desmonta o botão, e o texto ia junto, sem aviso.
  const [texto, setTextoNaTela] = useState(() => rascunhoGuardado(leadId, 'anotacao')?.texto ?? '')
  const [anexos, setAnexos] = useState<AnexoDaAnotacao[]>([])
  const [enviando, setEnviando] = useState(false)
  const [aviso, setAviso] = useState<AvisoDaCaixa | null>(null)
  // A TRAVA DO DUPLO CLIQUE, num ref: o `enviando` só desliga o botão no próximo
  // render, e o segundo clique (ou o Ctrl+Enter repetido) cabe antes dele.
  const emVoo = useRef(false)
  const toast = useToast()

  const setTexto = (v: string) => {
    setTextoNaTela(v)
    guardarRascunho(leadId, 'anotacao', v)
  }

  const acrescentar = (novos: File[]) => {
    if (emVoo.current || novos.length === 0) return
    const agora = new Date()
    const { lista, recusados } = acrescentarAnexos(
      anexos,
      novos.map((a, i) => nomearColado(a, agora, i + 1)),
    )
    setAnexos(lista)
    setAviso(recusados.length ? { tom: 'aviso', texto: `Ficou fora da lista: ${recusados.join(' ')}` } : null)
  }

  const tirar = (chave: string) => {
    if (emVoo.current) return
    setAnexos((l) => l.filter((a) => a.chave !== chave))
    setAviso(null)
  }

  const mudarEstado = (chave: string, estado: EstadoDoAnexo) =>
    setAnexos((l) => l.map((a) => (a.chave === chave ? { ...a, estado } : a)))

  // A ANOTAÇÃO DESTA RODADA JÁ ENTROU (o texto, ou a linha de "anexado"): numa
  // nova tentativa só com os arquivos que falharam, não se escreve outra linha.
  const textoSubiu = useRef(false)

  async function enviar(): Promise<boolean> {
    if (emVoo.current) return false
    const textoJaNoCard = textoSubiu.current
    if (!texto.trim() && anexos.length === 0) return false
    emVoo.current = true
    setEnviando(true)
    setAviso(null)
    // O QUE FALHOU ANTES volta para a fila: esta tentativa é para ele.
    const fila = anexos.map((a) => ({ ...a, estado: { fase: 'esperando' } as EstadoDoAnexo }))
    setAnexos(fila)
    try {
      const r = await enviarAnotacao(
        texto,
        fila,
        {
          anotar: async (t) => {
            await onEnviarTexto(t)
            textoSubiu.current = true
            // O TEXTO ENTROU: sai da caixa e do rascunho já, antes dos arquivos.
            // Se um arquivo falhar, enviar de novo não repete a nota.
            setTextoNaTela('')
            apagarRascunho(leadId, 'anotacao')
          },
          anexar: (arquivo, onProgresso) =>
            enviarArquivo<{ aviso?: string | null }>(
              'kommo-anexo-enviar',
              arquivo,
              // `x-texto` VAZIO: a função só grava nota de texto quando há texto,
              // e o texto já foi, uma vez, pela kommo-anotar.
              { 'x-lead-id': String(leadId), 'x-nome': encodeURIComponent(arquivo.name), 'x-texto': '' },
              onProgresso,
            ),
        },
        mudarEstado,
        { textoJaNoCard },
      )
      // O QUE ENTROU SAI DA LISTA; o que falhou fica, com o motivo. Com o texto
      // recusado, nenhum arquivo foi tentado — todos ficam como estavam.
      if (r.erroDoTexto) setAnexos(fila)
      else {
        const falharam = new Set(r.falhas.map((f) => f.chave))
        setAnexos((l) => l.filter((a) => falharam.has(a.chave)))
      }
      const resumo = resumoDaAnotacao(r)
      if (resumo.completo) {
        textoSubiu.current = false
        // O AVISO DO TEXTO é o da página; aqui, só quando houve arquivo.
        if (r.enviados.length) (resumo.tom === 'sucesso' ? toast.success : toast.error)(resumo.texto)
        return true
      }
      setAviso({ tom: resumo.tom, texto: resumo.texto })
      return false
    } finally {
      emVoo.current = false
      setEnviando(false)
    }
  }

  return {
    texto,
    setTexto,
    anexos,
    acrescentar,
    tirar,
    enviar,
    enviando,
    aviso,
    temRascunho: texto.trim().length > 0 || anexos.length > 0,
  }
}

// O "Ctrl + Enter" usa a tecla da casa (`ui/Tecla`), a mesma do topo e da busca
// das listas (revisão visual 2) — havia aqui uma cópia de classes.

/** O que a linha do arquivo diz à direita, conforme o envio anda. */
function situacao(e: EstadoDoAnexo): string | null {
  if (e.fase === 'enviando') return `${e.pct}%`
  if (e.fase === 'gravando') return 'gravando…'
  if (e.fase === 'falhou') return 'não entrou'
  return null
}

function LinhaDoAnexo({
  anexo,
  enviando,
  onTirar,
}: {
  anexo: AnexoDaAnotacao
  enviando: boolean
  onTirar: () => void
}) {
  const { arquivo, estado } = anexo
  const Icone = arquivo.type.startsWith('image/') ? ImageIcon : FileText
  const falhou = estado.fase === 'falhou'
  const andando = estado.fase === 'enviando' || estado.fase === 'gravando'
  const sit = situacao(estado)
  return (
    <li
      className={cn(
        'min-w-0 rounded-controle py-s1 pl-s2 pr-s1',
        falhou ? 'border border-perigo-borda bg-perigo-fundo' : 'bg-superficie-2',
      )}
      title={falhou ? `${arquivo.name}: ${estado.erro}` : arquivo.name}
    >
      <div className="flex items-center gap-s2 text-corpo text-texto">
        {falhou ? (
          <AlertTriangle className="h-[16px] w-[16px] flex-none text-perigo" aria-hidden />
        ) : (
          <Icone className="h-[16px] w-[16px] flex-none text-texto-3" aria-hidden />
        )}
        <span className="min-w-0 flex-1 truncate">{arquivo.name}</span>
        <span className={cn('whitespace-nowrap text-xs tabular-nums', falhou ? 'font-semibold text-perigo' : 'text-texto-3')}>
          {sit ?? tamanhoLegivel(arquivo.size)}
        </span>
        <button
          type="button"
          onClick={onTirar}
          disabled={enviando}
          className="grid h-controle-sm w-controle-sm flex-none place-items-center rounded-controle text-texto-3 hover:bg-superficie-3 hover:text-perigo disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-texto-3"
          aria-label={`Tirar ${arquivo.name}`}
          title={`Tirar ${arquivo.name}`}
        >
          <X className="h-[14px] w-[14px]" aria-hidden />
        </button>
      </div>
      {andando && (
        <div className="mb-s1 mr-s1 mt-s1 h-1 overflow-hidden rounded-full bg-superficie-3" aria-hidden>
          <div
            className={cn('h-full rounded-full bg-marca-viva transition-all duration-200', estado.fase === 'gravando' && 'animate-pulse')}
            style={{ width: `${estado.fase === 'enviando' ? estado.pct : 100}%` }}
          />
        </div>
      )}
    </li>
  )
}

/**
 * O miolo da caixa: o texto, a lista de arquivos, o aviso e o rodapé ("Anexar
 * arquivo" à esquerda, "Enviar" à direita). `onFeito` fecha a caixa quando nada
 * ficou para trás.
 */
export function CaixaDeAnotacao({
  anotacao: a,
  classeDoBotao,
  onFeito,
}: {
  anotacao: AnotacaoDoCard
  /** A altura dos botões do card (o `BTN` da página). */
  classeDoBotao?: string
  onFeito: () => void
}) {
  const entrada = useRef<HTMLInputElement>(null)
  const [arrastando, setArrastando] = useState(false)
  const pode = !a.enviando && (a.texto.trim().length > 0 || a.anexos.length > 0)

  async function enviar() {
    if (await a.enviar()) onFeito()
  }

  const temArquivos = (e: DragEvent) => [...e.dataTransfer.types].includes('Files')
  const sobre = (e: DragEvent) => {
    if (!temArquivos(e) || a.enviando) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setArrastando(true)
  }
  const saiu = (e: DragEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setArrastando(false)
  }
  const soltou = (e: DragEvent) => {
    if (!temArquivos(e)) return
    e.preventDefault()
    setArrastando(false)
    a.acrescentar([...e.dataTransfer.files])
  }
  // COLAR UM PRINT anexa a imagem. Com TEXTO junto na área de transferência
  // (copiar células do Excel ou um trecho do Word traz também uma imagem), vale
  // o texto: colar texto continua colando texto.
  const colou = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const arquivos = [...e.clipboardData.files]
    if (!arquivos.length || e.clipboardData.getData('text/plain')) return
    e.preventDefault()
    a.acrescentar(arquivos)
  }

  return (
    <div className="relative" onDragEnter={sobre} onDragOver={sobre} onDragLeave={saiu} onDrop={soltou}>
      <textarea
        autoFocus
        rows={4}
        value={a.texto}
        aria-label="Anotação"
        disabled={a.enviando}
        onChange={(e) => a.setTexto(e.target.value)}
        onPaste={colou}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') void enviar()
        }}
        placeholder="Ex.: Cedente enviou o RG; falta o comprovante de endereço."
        className="min-h-[96px] w-full resize-y rounded-campo border border-borda-controle bg-superficie px-s3 py-s2 text-corpo text-texto placeholder:text-texto-3 focus:border-anel focus:outline-none focus:ring-[3px] focus:ring-anel/20 disabled:bg-superficie-3"
      />

      {a.anexos.length > 0 && (
        <ul className="mt-s2 grid max-h-[188px] grid-cols-[minmax(0,1fr)] gap-s1 overflow-y-auto" aria-label="Arquivos da anotação">
          {a.anexos.map((x) => (
            <LinhaDoAnexo key={x.chave} anexo={x} enviando={a.enviando} onTirar={() => a.tirar(x.chave)} />
          ))}
        </ul>
      )}

      {a.aviso && (
        <CaixaDeAviso tom={a.aviso.tom} role={a.aviso.tom === 'sucesso' ? 'status' : 'alert'} className="mt-s2 text-sm">
          {a.aviso.texto}
        </CaixaDeAviso>
      )}

      <p className="mt-s2 text-xs text-texto-3">
        {a.anexos.length > 0 ? (
          'Até 100 MB por arquivo. Só o texto fica no rascunho: saindo da página, os arquivos saem da lista.'
        ) : (
          <>
            <Tecla>Ctrl</Tecla> + <Tecla>Enter</Tecla> envia · arraste ou cole (Ctrl+V)
            arquivos aqui, até 100 MB cada
          </>
        )}
      </p>

      <input
        ref={entrada}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          a.acrescentar([...(e.target.files ?? [])])
          e.target.value = ''
        }}
      />
      <div className="mt-s2 flex items-center justify-between gap-s2">
        <Button
          size="sm"
          variant="secondary"
          className={classeDoBotao}
          icon={<Paperclip className="h-[16px] w-[16px] flex-none" aria-hidden />}
          onClick={() => entrada.current?.click()}
          disabled={a.enviando}
          title="Escolher arquivos no computador (vários de uma vez)"
        >
          Anexar arquivo
        </Button>
        <Button size="sm" className={classeDoBotao} onClick={() => void enviar()} loading={a.enviando} disabled={!pode}>
          Enviar
        </Button>
      </div>

      {arrastando && (
        <div
          className="pointer-events-none absolute -inset-1 grid place-items-center rounded-campo border-2 border-dashed border-marca-viva bg-superficie/90 text-corpo font-semibold text-marca-texto"
          aria-hidden
        >
          <span className="inline-flex items-center gap-s2">
            <Paperclip className="h-[16px] w-[16px]" aria-hidden />
            Solte para anexar
          </span>
        </div>
      )}
    </div>
  )
}

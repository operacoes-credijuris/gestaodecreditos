import { useEffect, useRef, useState } from 'react'
import { RefreshCw, X } from 'lucide-react'
import { useToast } from '@/components/ui/Toast'
import { haDialogoAberto } from '@/lib/dialogo'
import { perguntaDeDescarteAberta } from '@/lib/descarte'
import { estadoDasJanelas, janelasAbertas } from '@/lib/janelasAbertas'
import {
  ADIAMENTO_MS,
  deveConferir,
  entradaCarregada,
  entradaDoHtml,
  haVersaoNova,
  INTERVALO_DA_CONFERENCIA_MS,
} from '@/lib/versaoNova'

/** O aviso quando há janela com algo digitado: recarregar levaria isso embora. */
const AVISO_DE_JANELA_ALTERADA =
  'Salve ou feche a janela aberta antes de recarregar — o que foi digitado nela ainda não foi salvo.'

/**
 * "HÁ UMA VERSÃO NOVA — RECARREGAR" (revisão de qualidade de vida, 03/10/2026).
 *
 * Confere o index.html publicado de 5 em 5 minutos com a aba à vista, e ao
 * voltar para a aba (a regra está em lib/versaoNova.ts). Achando versão nova,
 * mostra a faixa logo abaixo do topo, no meio — longe dos avisos e do
 * assistente, que moram embaixo à direita — e ESPERA: quem decide a hora é a
 * pessoa. O X ("lembrar depois") esconde por meia hora.
 *
 * SÓ NA VERSÃO PUBLICADA: no `vite dev` não há arquivo de entrada com hash, e o
 * próprio Vite recarrega o que muda.
 */
export function AvisoDeVersaoNova() {
  const toast = useToast()
  const [nova, setNova] = useState(false)
  const [adiadoAte, setAdiadoAte] = useState(0)
  const [, refazer] = useState(0)
  const ultima = useRef<number | null>(null)

  useEffect(() => {
    if (!import.meta.env.PROD) return
    const carregada = entradaCarregada()
    if (!carregada) return
    let achou = false
    let cancelado = false
    const controle = new AbortController()

    async function conferir() {
      const agora = Date.now()
      if (achou || !deveConferir(agora, ultima.current, document.visibilityState === 'visible')) return
      ultima.current = agora
      try {
        // SEM CACHE, e com o `?v=` para nenhum intermediário devolver o velho.
        const url = new URL('index.html', document.baseURI)
        url.searchParams.set('v', String(agora))
        const r = await fetch(url, { cache: 'no-store', signal: controle.signal })
        if (!r.ok) return
        const publicada = entradaDoHtml(await r.text())
        if (!cancelado && haVersaoNova(carregada, publicada)) {
          achou = true
          setNova(true)
        }
      } catch {
        /* sem rede: confere na próxima vez */
      }
    }

    const t = window.setInterval(conferir, INTERVALO_DA_CONFERENCIA_MS)
    const aoVoltar = () => void conferir()
    document.addEventListener('visibilitychange', aoVoltar)
    window.addEventListener('focus', aoVoltar)
    return () => {
      cancelado = true
      controle.abort()
      window.clearInterval(t)
      document.removeEventListener('visibilitychange', aoVoltar)
      window.removeEventListener('focus', aoVoltar)
    }
  }, [])

  // O "DEPOIS" VENCE SOZINHO: passado o adiamento, a faixa volta.
  useEffect(() => {
    if (!adiadoAte) return
    const t = window.setTimeout(() => refazer((n) => n + 1), Math.max(0, adiadoAte - Date.now()) + 50)
    return () => window.clearTimeout(t)
  }, [adiadoAte])

  if (!nova || Date.now() < adiadoAte) return null

  function recarregar() {
    // JANELA COM ALGO DIGITADO: a mesma regra do Ctrl+K — avisa e não recarrega.
    // (As telas com trabalho em andamento fora de janela, como a Análise de
    // crédito, têm a guarda do `beforeunload`, que o navegador pergunta.)
    const estado = estadoDasJanelas(janelasAbertas(), haDialogoAberto(), perguntaDeDescarteAberta())
    if (estado === 'alterada') {
      toast.info(AVISO_DE_JANELA_ALTERADA)
      return
    }
    window.location.reload()
  }

  return (
    // CENTRADA POR FLEX, e não por `translate`: a animação de entrada também usa
    // `transform`, e uma apagaria a outra.
    <div className="pointer-events-none fixed inset-x-0 top-[76px] z-[55] flex justify-center px-3">
      <div
        role="status"
        className="animate-fade-in pointer-events-auto flex w-full max-w-[460px] items-center gap-3 rounded-2xl bg-texto py-2.5 pl-4 pr-2 text-superficie shadow-nivel-2"
      >
        <RefreshCw className="h-5 w-5 shrink-0 text-flutuante-info" aria-hidden />
        <p className="flex-1 text-corpo">Há uma versão nova da plataforma.</p>
        <button
          type="button"
          onClick={recarregar}
          className="shrink-0 rounded-controle border border-superficie/35 px-2.5 py-1 text-sm font-bold text-superficie transition-colors hover:bg-superficie/15"
        >
          Recarregar
        </button>
        <button
          type="button"
          onClick={() => setAdiadoAte(Date.now() + ADIAMENTO_MS)}
          aria-label="Lembrar depois"
          title="Lembrar daqui a meia hora"
          className="grid h-[28px] w-[28px] shrink-0 place-items-center rounded-controle text-superficie/75 transition-colors hover:bg-superficie/15 hover:text-superficie"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  )
}

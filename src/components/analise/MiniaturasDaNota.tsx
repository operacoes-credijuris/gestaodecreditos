// A MINIATURA DA IMAGEM ANEXADA a uma anotação (06/10/2026, pedido do dono): à
// DIREITA do texto, para não ocupar a largura; clicando, o visualizador.
//
// CARREGAR SEM PESAR:
//   - o link se pede SÓ quando a miniatura chega perto da tela
//     (IntersectionObserver) — a lista da Análise tem dezenas de cards, e nenhum
//     deles pede nada enquanto ninguém rola até ele;
//   - o pedido passa pelo cache da página (lib/linksDosAnexos.ts): o mesmo
//     arquivo no card e no histórico é uma ida só, e no máximo duas ao mesmo
//     tempo;
//   - a miniatura usa a PRÉVIA do drive quando ele a tem (bem menor que a foto
//     do celular), e cai no arquivo inteiro se a prévia não vier ou não abrir;
//   - o visualizador usa o arquivo inteiro.
//
// O LINK DO KOMMO ABRE NUM <img> DIRETO: é o mesmo endereço que a análise já
// baixa com `fetch` no navegador (CORS liberado), e um <img> nem precisa de CORS.
import { useEffect, useMemo, useRef, useState } from 'react'
import { ImageOff } from 'lucide-react'
import { VisualizadorDeImagem, type ImagemDoVisualizador } from '@/components/ui/VisualizadorDeImagem'
import { cn } from '@/lib/cn'
import { nomeDoAnexo } from '@/lib/historicoDeNotas'
import { linksDosAnexos } from '@/lib/linksDosAnexos'
import type { KommoNota } from '@/lib/types'

/**
 * Fica `true` (e não volta) quando o elemento chega a 200px da tela. Sem
 * IntersectionObserver (navegador velho, teste), `true` de cara.
 */
function useNaTela<T extends Element>(ref: React.RefObject<T | null>): boolean {
  const [visto, setVisto] = useState(false)
  useEffect(() => {
    if (visto) return
    const el = ref.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') {
      setVisto(true)
      return
    }
    const obs = new IntersectionObserver(
      (entradas) => {
        if (entradas.some((e) => e.isIntersecting)) {
          setVisto(true)
          obs.disconnect()
        }
      },
      { rootMargin: '200px 0px' },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [ref, visto])
  return visto
}

type Estado =
  | { fase: 'esperando' }
  | { fase: 'carregando' }
  | { fase: 'pronta'; src: string; daPrevia: boolean; download: string }
  | { fase: 'falhou' }

/** As imagens da anotação no visualizador: o link pedido só quando cada uma aparece. */
function paraOVisualizador(imagens: readonly KommoNota[]): ImagemDoVisualizador[] {
  return imagens.map((a) => {
    const uuid = a.arquivo_uuid as string
    return {
      chave: uuid,
      nome: nomeDoAnexo(a),
      obter: async (forcar?: boolean) => {
        if (forcar) linksDosAnexos.esquecer(uuid)
        return (await linksDosAnexos.obter(uuid)).download
      },
    }
  })
}

/**
 * A miniatura das imagens de uma anotação: a primeira à vista, "+N" no selo
 * quando há mais. `imagens` vem de `grupoDeMiniaturas` (lib/previaDoAnexo.ts):
 * todas com `arquivo_uuid`.
 *
 * `tamanho`: `p` (48px) na linha da última anotação do card, que é um resumo e
 * não pode crescer; `m` (80px) no histórico aberto.
 */
export function MiniaturasDaNota({
  imagens,
  selo,
  tamanho = 'm',
  className,
}: {
  imagens: readonly KommoNota[]
  selo: string | null
  tamanho?: 'p' | 'm'
  className?: string
}) {
  const botao = useRef<HTMLButtonElement>(null)
  const naTela = useNaTela(botao)
  const [estado, setEstado] = useState<Estado>({ fase: 'esperando' })
  const [aberto, setAberto] = useState(false)
  const [tentativa, setTentativa] = useState(0)
  const primeira = imagens[0]
  const uuid = primeira?.arquivo_uuid ?? null
  const nome = primeira ? nomeDoAnexo(primeira) : ''
  const nomes = imagens.map(nomeDoAnexo)

  useEffect(() => {
    if (!naTela || !uuid) return
    let vivo = true
    setEstado({ fase: 'carregando' })
    linksDosAnexos.obter(uuid).then(
      (l) => vivo && setEstado({ fase: 'pronta', src: l.miniatura || l.download, daPrevia: !!l.miniatura, download: l.download }),
      () => vivo && setEstado({ fase: 'falhou' }),
    )
    return () => {
      vivo = false
    }
  }, [naTela, uuid, tentativa])

  const [carregou, setCarregou] = useState<string | null>(null)
  const noVisualizador = useMemo(() => paraOVisualizador(imagens), [imagens])
  if (!primeira || !uuid) return null

  const falhou = estado.fase === 'falhou'
  const src = estado.fase === 'pronta' ? estado.src : null
  const mostrada = src !== null && carregou === src

  function tentarDeNovo() {
    if (uuid) linksDosAnexos.esquecer(uuid)
    setCarregou(null)
    setTentativa((t) => t + 1)
  }

  const rotulo = imagens.length > 1 ? `Ver imagem ${nome} e mais ${imagens.length - 1}` : `Ver imagem ${nome}`

  return (
    <>
      <button
        ref={botao}
        type="button"
        onClick={() => {
          // FALHOU: "Abrir" tenta de novo, e abre — o visualizador mostra o
          // andamento (e o erro, se repetir) em tamanho legível.
          if (falhou) tentarDeNovo()
          setAberto(true)
        }}
        aria-label={rotulo}
        title={falhou ? `Não carregou — clique para tentar de novo (${nomes.join(', ')})` : nomes.join(', ')}
        className={cn(
          'group relative flex-none overflow-hidden rounded-campo border border-borda bg-superficie-2 transition-shadow hover:shadow-nivel-2 focus-visible:ring-2 focus-visible:ring-anel focus-visible:ring-offset-2 focus:outline-none',
          tamanho === 'p' ? 'h-s12 w-s12' : 'h-[80px] w-[80px]',
          className,
        )}
      >
        {falhou ? (
          <span className="flex h-full w-full flex-col items-center justify-center gap-s0.5 text-texto-3 group-hover:text-marca-texto">
            <ImageOff className={tamanho === 'p' ? 'h-[16px] w-[16px]' : 'h-[20px] w-[20px]'} aria-hidden />
            <span className="text-xs font-semibold">Abrir</span>
          </span>
        ) : (
          <>
            {!mostrada && <span className="skeleton absolute inset-0" aria-hidden />}
            {src && (
              <img
                key={src}
                src={src}
                alt={nome}
                loading="lazy"
                decoding="async"
                draggable={false}
                onLoad={() => setCarregou(src)}
                onError={() => {
                  // A PRÉVIA NÃO ABRIU: o arquivo inteiro, que é o mesmo link
                  // que a análise baixa. Esse também não: o link pode ter
                  // vencido — sai do cache, e o "Abrir" pede outro.
                  if (estado.fase === 'pronta' && estado.daPrevia) {
                    setEstado({ ...estado, src: estado.download, daPrevia: false })
                  } else {
                    linksDosAnexos.esquecer(uuid)
                    setEstado({ fase: 'falhou' })
                  }
                }}
                className={cn(
                  'h-full w-full object-cover transition-opacity duration-150',
                  mostrada ? 'opacity-100' : 'opacity-0',
                )}
              />
            )}
          </>
        )}
        {selo && (
          <span className="absolute bottom-s1 right-s1 rounded-full bg-veu/75 px-s1.5 text-xs font-semibold tabular-nums text-white" aria-hidden>
            {selo}
          </span>
        )}
      </button>
      <VisualizadorDeImagem aberto={aberto} imagens={noVisualizador} onFechar={() => setAberto(false)} />
    </>
  )
}

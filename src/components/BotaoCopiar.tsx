// Copiar com um clique o que se copia o tempo todo — o número do processo, os
// dados de uma ficha, o link da pasta (revisão de qualidade de vida, 03/10/2026).
//
// POR QUE EXISTE: o número CNJ tem ponto e hífen, e o duplo clique seleciona só
// um pedaço dele; nas linhas e nas fichas que abrem ao clique, arrastar para
// selecionar abre a ficha. Copiar era o gesto mais repetido e o mais chato.
//
// FORA DE ui/, de propósito: os componentes de ui/ são de toda a plataforma, com
// outra frente cuidando deles. Isto serve ao Comercial e ao Operacional.
//
// PELA ÁREA DE TRANSFERÊNCIA DE VERDADE; onde o navegador não deixa (contexto não
// seguro, permissão negada), o aviso diz como fazer à mão — calar a falha
// deixaria a pessoa colar o que estava antes, como em Contatos.
import { useEffect, useRef, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useToast } from '@/components/ui/Toast'

/**
 * Copia um texto e avisa. Devolve se deu certo, para quem quiser trocar o ícone.
 *
 * @param aviso o que vai no aviso de sucesso ("Número copiado.").
 */
export function useCopiarTexto() {
  const toast = useToast()
  return async (texto: string, aviso: string): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(texto)
      toast.success(aviso)
      return true
    } catch {
      toast.error('O navegador não liberou a área de transferência. Selecione o texto e copie com Ctrl+C.')
      return false
    }
  }
}

/**
 * O botão de ícone que copia. Discreto (cinza, do tamanho do texto), com o
 * "✓" por um instante depois do clique, além do aviso — o olho está no botão.
 *
 * NÃO DEIXA O CLIQUE SUBIR: ele mora em linhas e cartões que abrem ficha ou
 * expandem ao clique, e copiar não pode abrir nada.
 */
export function BotaoCopiar({
  valor,
  rotulo,
  aviso,
  className,
}: {
  /** O texto que vai para a área de transferência. */
  valor: string
  /** Nome acessível e dica do botão: "Copiar o número do processo". */
  rotulo: string
  /** O aviso de sucesso: "Número copiado.". */
  aviso: string
  className?: string
}) {
  const copiar = useCopiarTexto()
  const [copiado, setCopiado] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])

  return (
    <button
      type="button"
      aria-label={rotulo}
      title={rotulo}
      onClick={async (e) => {
        e.stopPropagation()
        e.preventDefault()
        if (await copiar(valor, aviso)) {
          setCopiado(true)
          window.clearTimeout(timer.current)
          timer.current = window.setTimeout(() => setCopiado(false), 1500)
        }
      }}
      // 24px de alvo (h-8 = 24px na escala de 3px por unidade), ícone de 12px.
      className={cn(
        'inline-grid h-8 w-8 flex-none place-items-center rounded-controle text-texto-3 transition-colors hover:bg-superficie-3 hover:text-texto focus:outline-none focus-visible:ring-2 focus-visible:ring-anel',
        className,
      )}
    >
      {copiado ? (
        <Check className="h-4 w-4 text-sucesso" aria-hidden="true" />
      ) : (
        <Copy className="h-4 w-4" aria-hidden="true" />
      )}
    </button>
  )
}

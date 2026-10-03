// Copiar para a área de transferência (revisão de qualidade de vida, 03/10/2026).
//
// CADA TELA TINHA O SEU `navigator.clipboard.writeText` com o seu aviso — o
// número do processo na Análise, o telefone nos Contatos, a mensagem do
// WhatsApp no Assistente. Aqui fica a parte que é igual em todos: tentar a área
// de transferência moderna, cair no jeito antigo quando ela não está disponível
// e dizer se deu certo. O botão (components/ui/BotaoCopiar.tsx) usa isto.
//
// NUNCA LANÇA: devolve se copiou. Calar a falha deixaria a pessoa colar o que
// estava antes na área de transferência, achando que era o que pediu.

/** O que do navegador esta lógica usa (o teste passa um de mentira). */
export interface AmbienteDaCopia {
  clipboard?: { writeText(texto: string): Promise<void> } | null
  /** O jeito antigo (textarea + execCommand), para quando o moderno falha. */
  copiarAntigo?: (texto: string) => boolean
}

function copiarPeloJeitoAntigo(texto: string): boolean {
  if (typeof document === 'undefined') return false
  const area = document.createElement('textarea')
  area.value = texto
  area.setAttribute('readonly', '')
  // FORA DA VISTA, mas no documento: o execCommand só copia a seleção de um
  // elemento presente na página. Fixo, para não rolar a tela até ele.
  area.style.position = 'fixed'
  area.style.top = '-1000px'
  area.style.opacity = '0'
  const foco = document.activeElement as HTMLElement | null
  document.body.appendChild(area)
  area.select()
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }
  area.remove()
  // O FOCO VOLTA para onde estava (o botão de copiar, um campo): selecionar o
  // textarea o tirou de lá.
  foco?.focus?.({ preventScroll: true })
  return ok
}

function ambientePadrao(): AmbienteDaCopia {
  return {
    clipboard: typeof navigator !== 'undefined' ? navigator.clipboard : null,
    copiarAntigo: copiarPeloJeitoAntigo,
  }
}

/**
 * Copia o texto. Devolve `true` se copiou.
 *
 * PRIMEIRO A ÁREA DE TRANSFERÊNCIA MODERNA; recusada (aba sem foco, permissão,
 * página fora de HTTPS), o jeito antigo. Texto vazio não copia nada — e diz que
 * não copiou.
 */
export async function copiarTexto(texto: string, ambiente: AmbienteDaCopia = ambientePadrao()): Promise<boolean> {
  if (!texto) return false
  try {
    if (ambiente.clipboard) {
      await ambiente.clipboard.writeText(texto)
      return true
    }
  } catch {
    /* segue para o jeito antigo */
  }
  try {
    return ambiente.copiarAntigo?.(texto) ?? false
  } catch {
    return false
  }
}

/** O aviso de quando o navegador não deixou copiar: diz o que fazer à mão. */
export const AVISO_DE_COPIA_RECUSADA =
  'O navegador não liberou a área de transferência. Selecione o texto e copie com Ctrl+C.'

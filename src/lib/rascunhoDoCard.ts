// O RASCUNHO DE CADA CARD: a anotação, a mensagem do desfecho e o motivo do
// "não fechou" que alguém começou a escrever e não enviou.
//
// EXISTE PORQUE O TEXTO SUMIA SEM PERGUNTAR. A caixa do "Anotar" vive dentro do
// card, e o card sai da tela ao trocar de etapa, filtrar, buscar ou sincronizar
// — e o texto ia junto, sem aviso. As janelas de desfecho perguntam antes de
// descartar, mas um F5 ou a aba fechada levavam o motivo de uma reprovação
// escrito pela metade.
//
// SÓ GUARDA TEXTO, NUNCA AGE. Recuperar o rascunho põe o texto de volta no
// campo; enviar, mover o card ou anotar no Kommo continuam pedindo o clique de
// sempre. Descartar de propósito (o "Descartar" da pergunta) apaga o rascunho, e
// o envio bem-sucedido também.
//
// NO NAVEGADOR, como as preferências (`preferencias.ts`): é conveniência de
// quem escreveu, naquele computador. TUDO EM try/catch — sem armazenamento, a
// tela funciona igual, só sem lembrar.
//
// RASCUNHO VELHO NÃO VOLTA: passados `PRAZO_DO_RASCUNHO_DIAS`, o texto
// provavelmente é sobre uma situação que já mudou, e reaparecer num campo seria
// convite a enviá-lo sem reler.
import type { Armazenamento } from './preferencias'

/** Prefixo das chaves: o mesmo das preferências, para não colidir com outras telas. */
const PREFIXO = 'credijuris.rascunho.'

export const PRAZO_DO_RASCUNHO_DIAS = 14
const DIA = 86_400_000

/**
 * O lugar do rascunho dentro do card. A mensagem de desfecho leva as saídas da
 * janela no nome: o motivo escrito para reprovar não pode reaparecer na janela
 * de aprovar o mesmo card.
 */
export type LugarDoRascunho = string

export function chaveDoRascunho(leadId: number, lugar: LugarDoRascunho): string {
  return `${PREFIXO}${leadId}.${lugar}`
}

export interface Rascunho {
  texto: string
  /** Quando foi escrito pela última vez (ms desde 1970). */
  em: number
}

/**
 * O rascunho guardado, conferido: JSON quebrado, de outro formato, vazio ou
 * vencido dão null.
 */
export function lerRascunho(cru: string | null | undefined, agora: number = Date.now()): Rascunho | null {
  if (!cru) return null
  let v: unknown
  try {
    v = JSON.parse(cru)
  } catch {
    return null
  }
  if (!v || typeof v !== 'object') return null
  const { texto, em } = v as Record<string, unknown>
  if (typeof texto !== 'string' || !texto.trim() || typeof em !== 'number' || !Number.isFinite(em)) return null
  if (agora - em > PRAZO_DO_RASCUNHO_DIAS * DIA) return null
  return { texto, em }
}

/** O texto que vai para o navegador; null quando não há o que guardar (apaga). */
export function textoDoRascunho(texto: string, agora: number = Date.now()): string | null {
  return texto.trim() ? JSON.stringify({ texto, em: agora }) : null
}

function armazenamentoPadrao(): Armazenamento | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

/** O rascunho deste lugar do card, ou null. O vencido é apagado ao ser lido. */
export function rascunhoGuardado(
  leadId: number,
  lugar: LugarDoRascunho,
  armazenamento: Armazenamento | null = armazenamentoPadrao(),
): Rascunho | null {
  try {
    const chave = chaveDoRascunho(leadId, lugar)
    const cru = armazenamento?.getItem(chave) ?? null
    const r = lerRascunho(cru)
    if (cru && !r) armazenamento?.removeItem(chave)
    return r
  } catch {
    return null
  }
}

/** Guarda o texto; vazio (ou só espaço) apaga. Falhar é silencioso. */
export function guardarRascunho(
  leadId: number,
  lugar: LugarDoRascunho,
  texto: string,
  armazenamento: Armazenamento | null = armazenamentoPadrao(),
): void {
  try {
    const chave = chaveDoRascunho(leadId, lugar)
    const v = textoDoRascunho(texto)
    if (v === null) armazenamento?.removeItem(chave)
    else armazenamento?.setItem(chave, v)
  } catch {
    /* sem armazenamento: o rascunho vale só enquanto o campo existir */
  }
}

export function apagarRascunho(
  leadId: number,
  lugar: LugarDoRascunho,
  armazenamento: Armazenamento | null = armazenamentoPadrao(),
): void {
  try {
    armazenamento?.removeItem(chaveDoRascunho(leadId, lugar))
  } catch {
    /* idem */
  }
}

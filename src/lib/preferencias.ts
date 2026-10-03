// Preferências de cada pessoa, guardadas NO NAVEGADOR dela: o menu recolhido e
// se as novidades desta versão já foram vistas.
//
// NO NAVEGADOR, E NÃO NO PERFIL (decisão da onda 3 do redesenho): são escolhas de
// tela, que não valem nada fora daquele computador, e guardá-las no banco seria
// uma gravação a cada clique e uma migração para algo que se perde sem dano.
//
// TUDO EM try/catch: em janela anônima, com o armazenamento bloqueado ou cheio, o
// navegador lança erro no acesso. A tela tem de funcionar igual, só sem lembrar.

/** O que o `localStorage` oferece e esta lógica usa (o teste passa um de mentira). */
export interface Armazenamento {
  getItem(chave: string): string | null
  setItem(chave: string, valor: string): void
  removeItem(chave: string): void
}

/** Prefixo das chaves, para não colidir com o que outras telas já guardam. */
const PREFIXO = 'credijuris.'

export const PREF_MENU_RECOLHIDO = 'menu.recolhido'
export const PREF_NOVIDADES_VISTAS = 'novidades.vistas'

function armazenamentoPadrao(): Armazenamento | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

/** Lê uma preferência; sem ela (ou sem armazenamento), devolve o padrão. */
export function lerPreferencia<T>(
  chave: string,
  padrao: T,
  armazenamento: Armazenamento | null = armazenamentoPadrao(),
): T {
  try {
    const v = armazenamento?.getItem(PREFIXO + chave)
    return v === null || v === undefined ? padrao : (JSON.parse(v) as T)
  } catch {
    return padrao
  }
}

/** Grava uma preferência. Falhar é silencioso: a escolha vale só nesta visita. */
export function gravarPreferencia<T>(
  chave: string,
  valor: T,
  armazenamento: Armazenamento | null = armazenamentoPadrao(),
): void {
  try {
    armazenamento?.setItem(PREFIXO + chave, JSON.stringify(valor))
  } catch {
    /* sem armazenamento: segue sem lembrar */
  }
}

/**
 * Dá para guardar? As novidades só abrem sozinhas quando dá para lembrar que já
 * foram vistas — sem isso, abririam a cada visita.
 */
export function armazenamentoDisponivel(
  armazenamento: Armazenamento | null = armazenamentoPadrao(),
): boolean {
  if (!armazenamento) return false
  try {
    const k = PREFIXO + 'teste'
    armazenamento.setItem(k, '1')
    armazenamento.removeItem(k)
    return true
  } catch {
    return false
  }
}

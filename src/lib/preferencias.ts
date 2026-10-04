// Preferências de cada pessoa, guardadas NO NAVEGADOR dela: o menu recolhido e
// se as novidades desta versão já foram vistas.
//
// NO NAVEGADOR, E NÃO NO PERFIL (decisão da onda 3 do redesenho): são escolhas de
// tela, que não valem nada fora daquele computador, e guardá-las no banco seria
// uma gravação a cada clique e uma migração para algo que se perde sem dano.
//
// TUDO EM try/catch: em janela anônima, com o armazenamento bloqueado ou cheio, o
// navegador lança erro no acesso. A tela tem de funcionar igual, só sem lembrar.

import { useCallback, useState } from 'react'

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
/** A última aba aberta do Quadro econômico (o endereço dela). */
export const PREF_QUADRO_ABA = 'quadro.aba'

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

// ─── Lembrar a última escolha (revisão de qualidade de vida, 03/10/2026) ─────
//
// A aba do Quadro, o recorte, a seção das Configurações: escolhas de tela que a
// pessoa refazia a cada visita. Guardadas aqui, voltam como ela deixou.
//
// SEMPRE COM VALIDAÇÃO: o que está guardado pode ser de uma versão antiga (uma
// seção que mudou de nome) ou lixo. Valor que não é uma das opções de hoje vale
// o padrão — nunca uma tela num estado que não existe.

/** Lê a preferência e confere: fora das opções aceitas, o padrão. */
export function lerPreferenciaValida<T>(
  chave: string,
  padrao: T,
  aceita: (v: unknown) => v is T,
  armazenamento?: Armazenamento | null,
): T {
  const v = lerPreferencia<unknown>(chave, padrao, armazenamento)
  return aceita(v) ? v : padrao
}

/** O validador de "uma destas opções" (para `lerPreferenciaValida`/`usePreferencia`). */
export function umaDas<T extends string>(opcoes: readonly T[]): (v: unknown) => v is T {
  return (v: unknown): v is T => typeof v === 'string' && (opcoes as readonly string[]).includes(v)
}

/**
 * O `useState` que lembra: começa no que estava guardado (validado) e grava a
 * cada troca. Falhando o armazenamento, vale só nesta visita.
 */
export function usePreferencia<T>(
  chave: string,
  padrao: T,
  aceita: (v: unknown) => v is T,
): [T, (v: T) => void] {
  const [valor, setValor] = useState(() => lerPreferenciaValida(chave, padrao, aceita))
  const mudar = useCallback(
    (v: T) => {
      gravarPreferencia(chave, v)
      setValor(v)
    },
    [chave],
  )
  return [valor, mudar]
}

// ─── O menu lateral recolhido (auditoria visual, 03/10/2026; AP3 aprovado) ──

/**
 * Abaixo desta largura de janela (px), o menu começa RECOLHIDO para quem ainda
 * não escolheu. A 1280px, o menu aberto de 240px deixava 1040px para a página,
 * e as tabelas de Créditos, Dados cadastrais e Carteiras quebravam.
 */
export const LARGURA_DO_MENU_ABERTO_POR_PADRAO = 1366

/**
 * O menu começa recolhido? A ESCOLHA DA PESSOA VENCE SEMPRE: quem abriu ou
 * recolheu o menu (pelo botão ou pelo "[") fica com o que escolheu, em qualquer
 * largura. Sem escolha guardada (`null`, ou um valor que não é sim/não), decide
 * a largura da janela.
 */
export function menuComecaRecolhido(larguraDaJanela: number, guardado: unknown): boolean {
  if (typeof guardado === 'boolean') return guardado
  return larguraDaJanela < LARGURA_DO_MENU_ABERTO_POR_PADRAO
}

/** O estado inicial do menu nesta visita: a escolha guardada ou, sem ela, a largura. */
export function lerMenuRecolhido(
  larguraDaJanela: number = typeof window === 'undefined' ? Infinity : window.innerWidth,
  armazenamento?: Armazenamento | null,
): boolean {
  return menuComecaRecolhido(larguraDaJanela, lerPreferencia<unknown>(PREF_MENU_RECOLHIDO, null, armazenamento))
}

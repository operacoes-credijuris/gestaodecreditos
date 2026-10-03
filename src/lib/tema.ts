// O tema da plataforma: Claro (o padrão), Escuro ou Do sistema.
//
// QUEM PINTA são as variáveis de src/index.css: o claro no `:root`, o escuro em
// `:root[data-tema='escuro']`. Aqui só se decide se o atributo vai ou não no
// <html>, e se guarda a escolha.
//
// A ESCOLHA FICA NO NAVEGADOR (lib/preferencias.ts), como o menu recolhido: é
// escolha de tela, que não vale nada fora daquele computador.
//
// SEM PISCAR: o index.html tem um script pequeno que lê a mesma chave e põe o
// atributo ANTES do primeiro desenho — sem ele, quem escolheu o escuro veria a
// tela branca por um instante a cada abertura, até o React carregar. Ele repete
// a regra de `resolverTema` em JavaScript puro (lá não há módulo); o teste
// tema.test.ts confere que os dois falam da mesma chave e do mesmo atributo.
//
// CLARO POR PADRÃO, como na amostra (base.js, `aplicarTema('light')`): a equipe
// inteira usa a plataforma no claro, e quem nunca escolheu nada continua nele —
// mesmo com o sistema no escuro. "Do sistema" é uma escolha, não o ponto de
// partida.

import { useSyncExternalStore } from 'react'
import { gravarPreferencia, lerPreferencia, type Armazenamento } from './preferencias'

export type PreferenciaDeTema = 'claro' | 'escuro' | 'sistema'
export type Tema = 'claro' | 'escuro'

/** A chave em lib/preferencias.ts (gravada como `credijuris.tema`). */
export const PREF_TEMA = 'tema'
/** O atributo no <html> que liga o escuro (o seletor de index.css). */
export const ATRIBUTO_DO_TEMA = 'data-tema'
/** A pergunta ao sistema operacional, para o "Do sistema". */
export const CONSULTA_DO_SISTEMA = '(prefers-color-scheme: dark)'

/** As três opções, na ordem do menu do usuário. */
export const OPCOES_DE_TEMA: ReadonlyArray<{ chave: PreferenciaDeTema; rotulo: string }> = [
  { chave: 'claro', rotulo: 'Claro' },
  { chave: 'escuro', rotulo: 'Escuro' },
  { chave: 'sistema', rotulo: 'Do sistema' },
]

/**
 * A cor da barra do navegador no celular (`<meta name="theme-color">`): no claro,
 * o azul de cabeçalho que o index.html já declara; no escuro, o fundo do menu.
 */
export const COR_DA_BARRA: Record<Tema, string> = { claro: '#075278', escuro: '#0a1622' }

/** Qualquer coisa que não seja uma das três (valor velho, lixo) vale o claro. */
export function normalizarPreferencia(valor: unknown): PreferenciaDeTema {
  return valor === 'escuro' || valor === 'sistema' ? valor : 'claro'
}

/** O tema que se vê: a escolha, e no "Do sistema" o que o sistema disser. */
export function resolverTema(preferencia: PreferenciaDeTema, sistemaEscuro: boolean): Tema {
  if (preferencia === 'sistema') return sistemaEscuro ? 'escuro' : 'claro'
  return preferencia
}

/**
 * O botão da lua/sol do topo: troca o que se VÊ. Quem estava no "Do sistema"
 * passa a uma escolha fixa — o contrário do que via —, porque apertar o botão
 * e nada mudar (o sistema continua mandando) seria um botão quebrado.
 */
export function alternarTema(visto: Tema): PreferenciaDeTema {
  return visto === 'escuro' ? 'claro' : 'escuro'
}

/** A escolha guardada (sem ela, ou sem armazenamento: o claro). */
export function lerPreferenciaDeTema(armazenamento?: Armazenamento | null): PreferenciaDeTema {
  // `undefined` cai no padrão de lerPreferencia: o localStorage de verdade.
  return normalizarPreferencia(lerPreferencia<unknown>(PREF_TEMA, 'claro', armazenamento))
}

// ─── No navegador ───────────────────────────────────────────────────────────

interface Estado {
  preferencia: PreferenciaDeTema
  tema: Tema
}

let estado: Estado = { preferencia: 'claro', tema: 'claro' }
let iniciado = false
let consulta: MediaQueryList | null = null
const ouvintes = new Set<() => void>()

function sistemaEscuro(): boolean {
  try {
    return consulta?.matches ?? false
  } catch {
    return false
  }
}

/** Põe (ou tira) o atributo no <html> e acerta a cor da barra do navegador. */
function aplicarNoDocumento(tema: Tema) {
  if (typeof document === 'undefined') return
  const raiz = document.documentElement
  // SEM ATRIBUTO NO CLARO, e não `data-tema="claro"`: o claro é o `:root` puro,
  // exatamente o de antes do modo escuro existir.
  if (tema === 'escuro') raiz.setAttribute(ATRIBUTO_DO_TEMA, 'escuro')
  else raiz.removeAttribute(ATRIBUTO_DO_TEMA)
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', COR_DA_BARRA[tema])
}

function atualizar(preferencia: PreferenciaDeTema) {
  const tema = resolverTema(preferencia, sistemaEscuro())
  if (preferencia !== estado.preferencia || tema !== estado.tema) {
    estado = { preferencia, tema }
    ouvintes.forEach((f) => f())
  }
  aplicarNoDocumento(tema)
}

/**
 * Liga o tema: lê a escolha, aplica, e passa a ouvir o sistema (para o "Do
 * sistema" acompanhar AO VIVO a troca do sistema para o escuro ao anoitecer) e
 * as outras abas (escolheu numa, as outras seguem). Chamado uma vez no main.tsx;
 * chamar de novo não faz nada.
 */
export function iniciarTema() {
  if (iniciado || typeof window === 'undefined') return
  iniciado = true
  try {
    consulta = window.matchMedia?.(CONSULTA_DO_SISTEMA) ?? null
    consulta?.addEventListener?.('change', () => atualizar(estado.preferencia))
  } catch {
    consulta = null // navegador antigo: o "Do sistema" vale o claro
  }
  window.addEventListener('storage', (e) => {
    if (e.key === null || e.key.endsWith('.' + PREF_TEMA)) atualizar(lerPreferenciaDeTema())
  })
  atualizar(lerPreferenciaDeTema())
}

/** Escolhe o tema, guarda e aplica na hora. */
export function escolherTema(preferencia: PreferenciaDeTema) {
  gravarPreferencia(PREF_TEMA, preferencia)
  atualizar(preferencia)
}

function assinar(f: () => void) {
  ouvintes.add(f)
  return () => {
    ouvintes.delete(f)
  }
}
const lerEstado = () => estado

/** O tema para a tela: a escolha, o que se vê e como trocar. */
export function useTema() {
  const { preferencia, tema } = useSyncExternalStore(assinar, lerEstado, lerEstado)
  return { preferencia, tema, escolher: escolherTema }
}

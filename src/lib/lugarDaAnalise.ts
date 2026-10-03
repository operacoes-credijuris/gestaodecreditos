// ONDE A PESSOA ESTAVA NA ANÁLISE DE CRÉDITO: o funil, a destinação do
// precatório (Interno/Externo) e a etapa. A amostra aprovada lembra isso entre
// visitas (ajuda.js, "preferências por pessoa"), e quem volta à tela cai na
// coluna em que trabalhava, não sempre na Análise do RPV.
//
// NO NAVEGADOR DE QUEM USA, como a densidade: é conveniência, não dado. Sem
// armazenamento (janela anônima, bloqueio), a tela abre no padrão e não insiste.
//
// O QUE FOI GUARDADO PODE TER ENVELHECIDO — uma coluna renomeada, um funil que
// saiu —, então a leitura confere cada campo e descarta o que não reconhece. A
// etapa é só uma chave: se ela não existir mais, a página cai na primeira etapa
// com função (`abaAtual`), que é a mesma regra de quando nada foi guardado.
//
// O `?card=` DO ENDEREÇO MANDA MAIS QUE ISTO: ele é lido depois e leva ao funil,
// à destinação e à etapa do card pedido.
import { FUNIL_PRECATORIO, FUNIL_RPV, SUBDIVISAO_PADRAO, SUBDIVISOES_PRECATORIO } from './kommo'
import type { SubdivisaoPrecatorio } from './kommo'

/** Onde o navegador guarda o lugar. */
export const CHAVE_DO_LUGAR = 'analise.lugar'

export interface LugarDaAnalise {
  funil: number
  destinacao: SubdivisaoPrecatorio
  /** A chave da etapa (`Aba.key`); vazia quer dizer "a primeira com função". */
  etapa: string
}

export const LUGAR_PADRAO: LugarDaAnalise = { funil: FUNIL_RPV, destinacao: SUBDIVISAO_PADRAO, etapa: '' }

/**
 * O lugar guardado, conferido campo a campo. Texto ausente, JSON quebrado ou de
 * outro formato dão o padrão; um campo que não se reconhece volta ao padrão
 * sozinho, sem levar os outros junto.
 */
export function lerLugar(cru: string | null | undefined): LugarDaAnalise {
  if (!cru) return LUGAR_PADRAO
  let v: unknown
  try {
    v = JSON.parse(cru)
  } catch {
    return LUGAR_PADRAO
  }
  if (!v || typeof v !== 'object') return LUGAR_PADRAO
  const o = v as Record<string, unknown>
  const funil = o.funil === FUNIL_RPV || o.funil === FUNIL_PRECATORIO ? (o.funil as number) : LUGAR_PADRAO.funil
  const destinacao = SUBDIVISOES_PRECATORIO.some((s) => s.key === o.destinacao)
    ? (o.destinacao as SubdivisaoPrecatorio)
    : LUGAR_PADRAO.destinacao
  // A ETAPA SÓ VALE NO FUNIL EM QUE FOI GUARDADA: se o funil caiu no padrão, a
  // chave dela não quer dizer nada aqui.
  const etapa = typeof o.etapa === 'string' && funil === o.funil ? o.etapa : ''
  return { funil, destinacao, etapa }
}

/** O texto que vai para o navegador. */
export function textoDoLugar(l: LugarDaAnalise): string {
  return JSON.stringify({ funil: l.funil, destinacao: l.destinacao, etapa: l.etapa })
}

/** Lê do navegador; sem acesso, o padrão. */
export function lugarGuardado(): LugarDaAnalise {
  try {
    return lerLugar(window.localStorage.getItem(CHAVE_DO_LUGAR))
  } catch {
    return LUGAR_PADRAO
  }
}

/** Grava no navegador; sem acesso, a tela segue sem lembrar. */
export function guardarLugar(l: LugarDaAnalise): void {
  try {
    window.localStorage.setItem(CHAVE_DO_LUGAR, textoDoLugar(l))
  } catch {
    /* sem armazenamento: vale só nesta visita */
  }
}

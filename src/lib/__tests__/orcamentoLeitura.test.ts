import { describe, it, expect } from 'vitest'
import {
  planoDeLeitura,
  capNotas,
  JANELA_TOKENS,
  MAX_IMAGENS,
  MAX_NOTAS_CHARS,
  MAX_TEXTO_CHARS,
  PISO_IMAGENS,
  TOKENS_POR_IMAGEM,
} from '../../../supabase/functions/_shared/orcamentoLeitura.ts'

/**
 * O orçamento conjunto de texto e imagem.
 *
 * O defeito que ele conserta: os dois tetos existiam separados — 360 mil
 * caracteres de um lado, 60 imagens do outro — e ninguém somava. Somados davam
 * ~294 mil tokens numa janela de 200 mil, e o pedido voltava HTTP 400 DEPOIS de
 * o navegador ter passado minutos renderizando e subindo as páginas.
 */

const cabe = (p: { tokensEstimados: number }) => p.tokensEstimados <= JANELA_TOKENS

describe('nunca estoura a janela', () => {
  it('o pior caso de todos — texto cheio, 60 imagens, anotações cheias', () => {
    const p = planoDeLeitura({
      charsTexto: 2_000_000, imagensPedidas: 200, charsNotas: 50_000,
    })
    expect(cabe(p)).toBe(true)
    expect(p.apertou).toBe(true)
  })

  it('varredura: nenhuma combinação de texto e imagem passa da janela', () => {
    for (const chars of [0, 50_000, 200_000, 360_000, 900_000]) {
      for (const imgs of [0, 5, 12, 30, 60, 120]) {
        const p = planoDeLeitura({ charsTexto: chars, imagensPedidas: imgs, charsNotas: 7_000 })
        expect(cabe(p), `${chars} chars × ${imgs} imagens`).toBe(true)
        expect(p.maxImagens).toBeLessThanOrEqual(Math.min(imgs, MAX_IMAGENS))
        expect(p.maxCharsTexto).toBeLessThanOrEqual(Math.min(chars, MAX_TEXTO_CHARS))
      }
    }
  })
})

describe('quem não disputa, leva tudo', () => {
  it('processo digital puro: os 360 mil caracteres cabem', () => {
    const p = planoDeLeitura({ charsTexto: 500_000, imagensPedidas: 0, charsNotas: 0 })
    expect(p.maxCharsTexto).toBe(MAX_TEXTO_CHARS)
    expect(p.maxImagens).toBe(0)
  })

  it('processo inteiramente escaneado: as 60 páginas cabem', () => {
    const p = planoDeLeitura({ charsTexto: 0, imagensPedidas: 80, charsNotas: 0 })
    expect(p.maxImagens).toBe(MAX_IMAGENS)
  })

  it('processo pequeno não é cortado em nada', () => {
    const p = planoDeLeitura({ charsTexto: 40_000, imagensPedidas: 6, charsNotas: 1_200 })
    expect(p.maxCharsTexto).toBe(40_000)
    expect(p.maxImagens).toBe(6)
    expect(p.apertou).toBe(false)
  })
})

describe('a ordem de preferência no aperto', () => {
  it('o híbrido comum passa inteiro: a conta escaneada cabe junto do texto cheio', () => {
    // É o caso que mais aparece — processo digital com a conta da contadoria
    // em imagem. Oito páginas estão dentro do piso e não disputam com o texto.
    const p = planoDeLeitura({ charsTexto: 400_000, imagensPedidas: 8, charsNotas: 7_000 })
    expect(p.maxImagens).toBe(8)
    expect(p.maxCharsTexto).toBe(MAX_TEXTO_CHARS)
  })

  it('o piso de imagens é reservado ANTES de o texto escolher', () => {
    // Com texto suficiente para tomar a janela inteira, as páginas do piso
    // continuam entrando: são a conta e o requisitório, que decidem o preço.
    const p = planoDeLeitura({ charsTexto: 5_000_000, imagensPedidas: 60, charsNotas: 7_000 })
    expect(p.maxImagens).toBeGreaterThanOrEqual(PISO_IMAGENS)
  })

  it('acima do piso, o texto tem preferência — e o resto vira imagem', () => {
    const p = planoDeLeitura({ charsTexto: 360_000, imagensPedidas: 60, charsNotas: 7_000 })
    expect(p.maxCharsTexto).toBe(MAX_TEXTO_CHARS)
    expect(p.maxImagens).toBeGreaterThan(PISO_IMAGENS)
    expect(p.maxImagens).toBeLessThan(60)
  })

  it('menos texto libera mais imagem, na proporção da janela', () => {
    const cheio = planoDeLeitura({ charsTexto: 360_000, imagensPedidas: 60, charsNotas: 0 })
    const magro = planoDeLeitura({ charsTexto: 60_000, imagensPedidas: 60, charsNotas: 0 })
    expect(magro.maxImagens).toBeGreaterThan(cheio.maxImagens)
  })
})

describe('as anotações do card', () => {
  it('sete mil caracteres, decisão do dono — e o teto entra na conta da janela', () => {
    expect(MAX_NOTAS_CHARS).toBe(7_000)
    const semNotas = planoDeLeitura({ charsTexto: 360_000, imagensPedidas: 60, charsNotas: 0 })
    const comNotas = planoDeLeitura({ charsTexto: 360_000, imagensPedidas: 60, charsNotas: 7_000 })
    expect(comNotas.tokensEstimados).toBeGreaterThan(semNotas.tokensEstimados - TOKENS_POR_IMAGEM * 2)
    expect(cabe(comNotas)).toBe(true)
  })

  it('anotação curta passa inteira', () => {
    const t = 'PARCELA CEDIDA: principal; HONORÁRIOS C.: 30%'
    expect(capNotas(t)).toBe(t)
  })

  it('anotação longa guarda o COMEÇO e o FIM — o combinado e o estado de hoje', () => {
    const inicio = 'PARCELA CEDIDA: principal'
    const fim = 'cedente confirmou ontem'
    const t = inicio + 'x'.repeat(MAX_NOTAS_CHARS * 2) + fim
    const r = capNotas(t)
    expect(r.length).toBeLessThan(t.length)
    expect(r.startsWith(inicio)).toBe(true)
    expect(r.endsWith(fim)).toBe(true)
    expect(r).toContain('OMITIDO POR TAMANHO')
  })

  it('anotação enorme não come a janela: entra capada na conta', () => {
    const p = planoDeLeitura({ charsTexto: 100_000, imagensPedidas: 10, charsNotas: 900_000 })
    expect(cabe(p)).toBe(true)
    expect(p.maxCharsTexto).toBe(100_000)
    expect(p.maxImagens).toBe(10)
  })
})

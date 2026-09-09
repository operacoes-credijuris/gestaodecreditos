import { describe, it, expect } from 'vitest'
import {
  TITULO_DO_DESFECHO,
  garantirTitulo,
} from '../../../supabase/functions/_shared/desfecho.ts'

/**
 * A PRIMEIRA LINHA DA ANOTAÇÃO É FIXA.
 *
 * É o que faz a coluna do CRM ficar legível de cima a baixo: todo card do mesmo
 * desfecho abre igual, e quem varre o funil reconhece o que aconteceu sem ler o
 * parágrafo. Um modelo que parafraseia — "Crédito recusado", "Recusa do
 * crédito", "Reprovação" — quebra o padrão, e ninguém revisa anotação de card a
 * card para descobrir.
 *
 * Por isso o título é pedido no prompt E garantido no código: pedir sozinho
 * depende da obediência do modelo em cada chamada.
 */
const RECUSA = TITULO_DO_DESFECHO.reprovado

describe('garantirTitulo', () => {
  it('o modelo obedeceu: nada muda', () => {
    const texto = `${RECUSA}\n\nO cedente responde a execução fiscal.\n\nO risco é de penhora.`
    expect(garantirTitulo(texto, RECUSA)).toBe(texto)
  })

  it('caixa e pontuação não contam como título diferente', () => {
    for (const cabeca of ['CRÉDITO RECUSADO', 'crédito recusado', 'Crédito Recusado.', '**Crédito Recusado**']) {
      const r = garantirTitulo(`${cabeca}\n\nO corpo.`, RECUSA)
      expect(r.split('\n')[0], cabeca).toBe(cabeca)
      // Não duplicou: o corpo continua logo abaixo, sem um segundo título.
      expect(r.split(RECUSA).length - 1, cabeca).toBeLessThanOrEqual(1)
    }
  })

  it('sem título nenhum, o título entra na frente', () => {
    expect(garantirTitulo('O cedente responde a execução.', RECUSA)).toBe(
      `${RECUSA}\n\nO cedente responde a execução.`,
    )
  })

  // O CASO QUE APARECE DE VERDADE: o modelo escreve o título de OUTRO desfecho,
  // ou a grafia antiga. Somar os dois deixaria o card abrindo com dois títulos,
  // que é pior do que qualquer um deles sozinho.
  it('título de outra grafia é substituído, não somado', () => {
    const r = garantirTitulo('Crédito Reprovado\n\nO corpo da anotação.', RECUSA)
    expect(r).toBe(`${RECUSA}\n\nO corpo da anotação.`)
    expect(r).not.toMatch(/Reprovado/)
  })

  it('título de outro desfecho também é substituído', () => {
    const r = garantirTitulo(
      `${TITULO_DO_DESFECHO.diligencia}\n\nFalta a conta da contadoria.`,
      RECUSA,
    )
    expect(r).toBe(`${RECUSA}\n\nFalta a conta da contadoria.`)
  })

  it('linha em branco antes do título não confunde a leitura', () => {
    expect(garantirTitulo(`\n\n${RECUSA}\n\nO corpo.`, RECUSA)).toBe(`${RECUSA}\n\nO corpo.`)
  })

  it('os três desfechos têm título próprio e nenhum se repete', () => {
    const titulos = Object.values(TITULO_DO_DESFECHO)
    expect(new Set(titulos).size).toBe(titulos.length)
    for (const t of titulos) expect(t.trim()).toBe(t)
  })
})

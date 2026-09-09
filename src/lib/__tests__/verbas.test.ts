import { describe, it, expect } from 'vitest'
import {
  decidirVerbas,
  temVerbaNegociavel,
  verbasDitadasNoChat,
  type DecisaoDeVerbas,
} from '../../../supabase/functions/_shared/verbas.ts'

/**
 * QUAIS VERBAS ESTÃO SENDO COMPRADAS.
 *
 * A tradução do "PARCELA CEDIDA" do card no conjunto que entra na conta morava
 * dentro da Edge Function, e um dos ramos dela RECUSA a análise inteira —
 * "honorários" sem dizer quais, num processo que tem os dois. Nenhum tinha caso
 * escrito.
 */
const autos: { contratuais: number; sucumbenciais: number; pctCard: number | null } = {
  contratuais: 0, sucumbenciais: 0, pctCard: null,
}

/** Só as decisões (o ramo de erro tem forma própria). */
const decidir = (tipo: string, o: Partial<typeof autos> = {}) =>
  decidirVerbas(tipo, { ...autos, ...o }) as DecisaoDeVerbas

describe('decidirVerbas', () => {
  it('principal, apenas', () => {
    const r = decidir('principal', { contratuais: 8_000, sucumbenciais: 5_000 })
    expect(r.verbas).toEqual({ principal: true, contratuais: false, sucumbenciais: false })
    expect(r.tipoCredito).toBe('Crédito principal — apenas')
  })

  it('principal + honorários leva os dois tipos', () => {
    const r = decidir('ambos')
    expect(r.verbas).toEqual({ principal: true, contratuais: true, sucumbenciais: true })
  })

  it('sucumbenciais, apenas', () => {
    const r = decidir('sucumbenciais', { sucumbenciais: 5_000 })
    expect(r.verbas).toEqual({ principal: false, contratuais: false, sucumbenciais: true })
    expect(r.tipoCredito).toBe('Honorários sucumbenciais — apenas')
  })

  // O CASO RARO QUE PRECISA SER DITO: o card pede contratuais e o processo TEM
  // sucumbenciais. Eles entram — cede-se o honorário que existe —, mas quem
  // fecha precisa saber que está comprando as duas verbas.
  it('contratuais com sucumbenciais nos autos avisa', () => {
    const r = decidir('contratuais', { contratuais: 8_000, sucumbenciais: 5_000 })
    expect(r.verbas.sucumbenciais).toBe(true)
    expect(r.sucumbNaoPrevistos).toBe(5_000)
  })

  it('contratuais sem sucumbenciais não avisa nada', () => {
    expect(decidir('contratuais', { contratuais: 8_000 }).sucumbNaoPrevistos).toBeUndefined()
  })

  // "HONORÁRIOS" SEM DIZER QUAIS. A maioria das RPVs vem do juizado especial,
  // onde não há sucumbência em primeiro grau (art. 55 da Lei 9.099/95): ali
  // existe UM honorário só, e a palavra não é ambígua. Bloquear antes de ler os
  // autos recusava a maioria dos casos por uma ambiguidade que não havia.
  describe('"honorários" sem dizer quais', () => {
    it('só contratuais: resolve pelos autos', () => {
      const r = decidir('indefinido', { contratuais: 8_000 })
      expect(r.honorariosResolvido).toBe('contratuais')
      expect(r.tipoCredito).toBe('Honorários contratuais + sucumbenciais')
    })

    it('o percentual do card prova que há contratual', () => {
      const r = decidir('indefinido', { contratuais: 0, pctCard: 30 })
      expect(r.honorariosResolvido).toBe('contratuais')
    })

    it('só sucumbenciais: resolve pelos autos', () => {
      const r = decidir('indefinido', { sucumbenciais: 5_000 })
      expect(r.honorariosResolvido).toBe('sucumbenciais')
      expect(r.tipoCredito).toBe('Honorários sucumbenciais — apenas')
    })

    // AS DUAS EXISTEM: aí a escolha é real e muda o preço — os contratuais saem
    // de dentro do principal, os sucumbenciais vêm por fora, pagos pelo vencido.
    // Não há como adivinhar, e o palpite não apareceria no resultado.
    it('as duas existem: recusa, com os dois números', () => {
      const r = decidirVerbas('indefinido', { contratuais: 8_000, sucumbenciais: 5_000, pctCard: null })
      expect('erro' in r && r.erro).toBe('honorarios_ambiguos')
      expect('erro' in r && r.contratuais).toBe(8_000)
      expect('erro' in r && r.sucumbenciais).toBe(5_000)
    })

    it('nenhuma das duas: segue, sem resolver nada', () => {
      const r = decidir('indefinido')
      expect('erro' in r).toBe(false)
      expect(r.honorariosResolvido).toBe('contratuais')
    })
  })

  // CAMPO EM BRANCO NÃO É "PRINCIPAL": o automático assume o principal porque é
  // o caso comum, mas assumir em silêncio custa caro — uma cessão só de
  // honorários sairia precificada com o crédito principal dentro, e a análise
  // não teria como saber que errou.
  describe('o automático', () => {
    it('sem honorário nos autos, é o principal, e avisa que assumiu', () => {
      const r = decidir('auto')
      expect(r.verbas).toEqual({ principal: true, contratuais: false, sucumbenciais: false })
      expect(r.parcelaNaoInformada).toBe(true)
    })

    it('com honorário destacado, leva os honorários também', () => {
      const r = decidir('auto', { contratuais: 8_000 })
      expect(r.verbas.contratuais).toBe(true)
      expect(r.tipoCredito).toBe('Crédito principal + Honorários')
      expect(r.parcelaNaoInformada).toBe(true)
    })

    it('rótulo desconhecido cai no automático, e não em erro', () => {
      expect(decidir('coisa que ninguém escreveu').parcelaNaoInformada).toBe(true)
    })
  })
})

describe('verbasDitadasNoChat', () => {
  // O SELETOR E O CHAT DISPUTAM A MESMA DECISÃO, e o chat perde quando a pessoa
  // clica depois. Aqui é o outro lado: sem o chat vencer o card, "tira os
  // sucumbenciais" era gravado, reportado como aplicado, e o preço saía com eles.
  it('o chat vence o card', () => {
    const doCard = decidir('auto')
    const r = verbasDitadasNoChat(doCard, { principal: false, contratuais: true, sucumbenciais: false })
    expect(r.verbas).toEqual({ principal: false, contratuais: true, sucumbenciais: false })
    expect(r.tipoCredito).not.toBe(doCard.tipoCredito)
  })

  // E APAGA O AVISO DE CAMPO EM BRANCO: quem ditou as verbas no chat resolveu
  // exatamente o que o aviso pedia.
  it('ditar no chat apaga o aviso de parcela não informada', () => {
    const r = verbasDitadasNoChat(decidir('auto'), { principal: true, contratuais: false, sucumbenciais: false })
    expect(r.parcelaNaoInformada).toBe(false)
  })

  it('sem nada ditado, a decisão do card fica intacta', () => {
    const doCard = decidir('auto')
    expect(verbasDitadasNoChat(doCard, null)).toEqual(doCard)
    expect(verbasDitadasNoChat(doCard, undefined)).toEqual(doCard)
  })
})

describe('temVerbaNegociavel', () => {
  const TUDO = { principal: true, contratuais: true, sucumbenciais: true }
  const SO_PRINCIPAL = { principal: true, contratuais: false, sucumbenciais: false }
  const SO_SUCUMB = { principal: false, contratuais: false, sucumbenciais: true }
  const SO_CONTRAT = { principal: false, contratuais: true, sucumbenciais: false }

  it('principal com líquido positivo serve', () => {
    expect(temVerbaNegociavel(SO_PRINCIPAL, {
      bruto: 100_000, ir: 10_000, inss: 5_000, contratuais: 20_000, sucumbenciais: 0,
    })).toBe(true)
  })

  // BRUTO CHEIO NÃO É CRÉDITO se as retenções e o honorário o consomem inteiro:
  // é uma conta que fecha em nada, e a planilha afirmaria zero.
  it('principal cujo líquido some não serve', () => {
    expect(temVerbaNegociavel(SO_PRINCIPAL, {
      bruto: 30_000, ir: 5_000, inss: 0, contratuais: 26_000, sucumbenciais: 0,
    })).toBe(false)
  })

  it('honorários que o card pede e o processo não tem: não serve', () => {
    expect(temVerbaNegociavel(SO_CONTRAT, {
      bruto: 100_000, ir: 0, inss: 0, contratuais: 0, sucumbenciais: 5_000,
    })).toBe(false)
    expect(temVerbaNegociavel(SO_SUCUMB, {
      bruto: 100_000, ir: 0, inss: 0, contratuais: 8_000, sucumbenciais: 0,
    })).toBe(false)
  })

  it('sucumbenciais sozinhos bastam quando são o negócio', () => {
    expect(temVerbaNegociavel(SO_SUCUMB, {
      bruto: 0, ir: 0, inss: 0, contratuais: 0, sucumbenciais: 5_000,
    })).toBe(true)
  })

  it('uma verba basta, mesmo com as outras vazias', () => {
    expect(temVerbaNegociavel(TUDO, {
      bruto: 0, ir: 0, inss: 0, contratuais: 8_000, sucumbenciais: 0,
    })).toBe(true)
  })

  it('nada em nada não serve', () => {
    expect(temVerbaNegociavel(TUDO, {
      bruto: 0, ir: 0, inss: 0, contratuais: 0, sucumbenciais: 0,
    })).toBe(false)
  })

  it('número ilegível não vira crédito', () => {
    expect(temVerbaNegociavel(TUDO, {
      bruto: NaN, ir: NaN, inss: NaN, contratuais: NaN, sucumbenciais: NaN,
    })).toBe(false)
  })
})

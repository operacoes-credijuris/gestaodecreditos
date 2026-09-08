import { describe, it, expect } from 'vitest'
import {
  SERIE_DO_INDICE,
  competencia,
  ehIndiceConhecido,
  fatorAcumulado,
  fatorPlausivel,
  janelaSgs,
  pontosMensais,
  recalcularPorIndice,
  urlSgs,
} from '../../../supabase/functions/_shared/indicesBcb.ts'

/**
 * Os índices oficiais, e a armadilha que este arquivo existe para travar.
 *
 * TR e poupança têm série DIÁRIA por aniversário (226 e 195) — a que se acha
 * primeiro procurando no SGS. Sete anos dela dão 2.604 pontos, a requisição leva
 * de 17 a 21 segundos, e compor os 2.604 como se fossem taxas mensais dá um
 * número absurdo com cara de plausível. As séries mensais (7811 e 196) devolvem
 * o mesmo valor em 300 ms.
 *
 * O erro seria SILENCIOSO: ninguém refaz uma variação acumulada à mão para
 * conferir, e um fator grande é tão crível quanto um pequeno. Daí o teste.
 */
describe('índices do BCB', () => {
  /** Resposta real do SGS para a série 7478 (IPCA-15), formato preservado. */
  const IPCA15_2015 = [
    { data: '01/01/2015', valor: '0.89' },
    { data: '01/02/2015', valor: '1.33' },
    { data: '01/03/2015', valor: '1.24' },
  ]

  /** Como o SGS devolve série DIÁRIA: com dataFim, um ponto por dia útil. */
  const TR_DIARIA = [
    { data: '01/01/2015', dataFim: '01/02/2015', valor: '0.0878' },
    { data: '02/01/2015', dataFim: '02/02/2015', valor: '0.0831' },
    { data: '03/01/2015', dataFim: '03/02/2015', valor: '0.1005' },
  ]

  describe('a leitura da resposta', () => {
    it('lê competência e variação de uma série mensal', () => {
      const p = pontosMensais(IPCA15_2015)
      expect(p).toHaveLength(3)
      expect(p[0]).toEqual({ ano: 2015, mes: 1, pct: 0.89 })
      expect(p[2]).toEqual({ ano: 2015, mes: 3, pct: 1.24 })
    })

    it('RECUSA série diária em vez de compor errado', () => {
      // O ponto do teste: falhar aqui é o desfecho bom. Composta como mensal,
      // uma série diária de sete anos multiplica ~2.600 taxas e devolve um
      // número que ninguém tem como desconfiar.
      expect(() => pontosMensais(TR_DIARIA)).toThrow(/DIÁRIA/)
      expect(() => pontosMensais(TR_DIARIA)).toThrow(/7811/)
    })

    it('aceita vírgula decimal, que é como o BCB às vezes devolve', () => {
      expect(pontosMensais([{ data: '01/05/2020', valor: '0,38' }])[0].pct).toBe(0.38)
    })

    it('ordena do mais antigo para o mais novo, seja qual for a ordem da resposta', () => {
      const p = pontosMensais([
        { data: '01/03/2015', valor: '1.24' },
        { data: '01/01/2015', valor: '0.89' },
        { data: '01/12/2014', valor: '0.79' },
      ])
      expect(p.map((x) => `${x.mes}/${x.ano}`)).toEqual(['12/2014', '1/2015', '3/2015'])
    })

    it('descarta ponto sem valor numérico em vez de virar NaN na composição', () => {
      const p = pontosMensais([
        { data: '01/01/2015', valor: '0.89' },
        { data: '01/02/2015', valor: '' },
        { data: '01/03/2015', valor: '1.24' },
      ])
      expect(p).toHaveLength(2)
    })

    it('resposta que não é lista falha em vez de devolver vazio', () => {
      expect(() => pontosMensais({ erro: 'algo' })).toThrow(/não é uma lista/)
    })
  })

  describe('a composição', () => {
    it('COMPÕE e não soma', () => {
      // 0,89% + 1,33% + 1,24% = 3,46% somados. Compostos dão mais, e a
      // diferença cresce com o número de meses.
      const f = fatorAcumulado(pontosMensais(IPCA15_2015), { ano: 2015, mes: 1 }, { ano: 2015, mes: 3 })
      expect(f.fator).toBeCloseTo(1.0089 * 1.0133 * 1.0124, 10)
      expect((f.fator - 1) * 100).toBeGreaterThan(3.46)
      expect(f.meses).toBe(3)
    })

    it('reproduz o acumulado real do IPCA-15 de 2015 a 2021', () => {
      // Conferido contra a API: 84 pontos, 50,87% acumulados de 01/2015 a
      // 12/2021. Aqui vai uma amostra fechada com o mesmo método; o valor
      // exato depende da série inteira, então o que se fixa é a ORDEM DE
      // GRANDEZA da composição sobre sete anos de inflação de dois dígitos
      // acumulados.
      const doze = Array.from({ length: 12 }, (_, i) => ({
        data: `01/${String(i + 1).padStart(2, '0')}/2015`,
        valor: '0.85',
      }))
      const f = fatorAcumulado(pontosMensais(doze), { ano: 2015, mes: 1 }, { ano: 2015, mes: 12 })
      expect(f.meses).toBe(12)
      expect((f.fator - 1) * 100).toBeCloseTo(10.7, 1) // 0,85% ao mês por 12 meses
    })

    it('corta pelo período pedido, ignorando o que a série trouxe a mais', () => {
      const f = fatorAcumulado(pontosMensais(IPCA15_2015), { ano: 2015, mes: 2 }, { ano: 2015, mes: 2 })
      expect(f.meses).toBe(1)
      expect(f.fator).toBeCloseTo(1.0133, 10)
      expect(f.de).toBe('02/2015')
      expect(f.ate).toBe('02/2015')
    })

    it('avisa quando a série não cobre o período inteiro, em vez de calar', () => {
      // O caso real: índice que só começa depois do termo inicial do título.
      const f = fatorAcumulado(pontosMensais(IPCA15_2015), { ano: 2014, mes: 1 }, { ano: 2015, mes: 3 })
      expect(f.incompleto).toMatch(/começa em 01\/2015/)
      expect(f.meses).toBe(3)
    })

    it('avisa quando falta mês NO MEIO do período', () => {
      const f = fatorAcumulado(
        pontosMensais([
          { data: '01/01/2015', valor: '0.89' },
          { data: '01/03/2015', valor: '1.24' },
        ]),
        { ano: 2015, mes: 1 },
        { ano: 2015, mes: 3 },
      )
      expect(f.incompleto).toMatch(/faltam 1 mês/)
    })

    it('período invertido falha', () => {
      expect(() =>
        fatorAcumulado(pontosMensais(IPCA15_2015), { ano: 2015, mes: 3 }, { ano: 2015, mes: 1 }),
      ).toThrow(/anterior ao inicial/)
    })

    it('período sem nenhum mês na série falha em vez de devolver fator 1', () => {
      // Fator 1 seria "o índice não variou", que é uma afirmação; o certo é
      // dizer que não se sabe.
      expect(() =>
        fatorAcumulado(pontosMensais(IPCA15_2015), { ano: 2030, mes: 1 }, { ano: 2030, mes: 6 }),
      ).toThrow(/nenhum mês no período/)
    })
  })

  describe('o recálculo por proporção', () => {
    const fator = (pct: number, meses = 84): ReturnType<typeof fatorAcumulado> => ({
      fator: 1 + pct / 100,
      meses,
      de: '01/2015',
      ate: '12/2021',
      incompleto: null,
    })

    it('troca o índice da conta pelo do título', () => {
      // O caso do Tema 810: a conta usou TR (declarada inconstitucional) e o
      // título/lei pedem IPCA-E. TR de sete anos rende quase nada; IPCA-E rende
      // 50%. O crédito da conta está SUBESTIMADO nesse caso.
      const r = recalcularPorIndice({
        base: 100_000,
        indiceTitulo: 'IPCA-E',
        indiceConta: 'TR',
        fatorTitulo: fator(50.87),
        fatorConta: fator(3.4),
      })
      expect(r.valor).toBeCloseTo((100_000 * 1.5087) / 1.034, 6)
      expect(r.aviso).toBeNull()
    })

    it('a memória traz os dois índices, as séries, os meses e a operação', () => {
      const r = recalcularPorIndice({
        base: 84_320.1,
        indiceTitulo: 'IPCA-E',
        indiceConta: 'SELIC',
        fatorTitulo: fator(50.87),
        fatorConta: fator(68.2),
      })
      // Sem a memória o número não é conferível, e o que não se confere não se
      // usa para pagar — daí ela ser parte do contrato desta função.
      expect(r.memoria).toContain('Banco Central')
      expect(r.memoria).toContain('IPCA-E')
      expect(r.memoria).toContain(String(SERIE_DO_INDICE['IPCA-E']))
      expect(r.memoria).toContain(String(SERIE_DO_INDICE.SELIC))
      expect(r.memoria).toContain('84 meses')
      expect(r.memoria).toContain('50,87%')
      // Aplicando SELIC (mais alta) onde cabia IPCA-E, a conta inflou: o
      // revisado tem de ser MENOR que a base.
      expect(r.valor).toBeLessThan(84_320.1)
    })

    it('carrega o aviso de série incompleta para quem chama', () => {
      const r = recalcularPorIndice({
        base: 50_000,
        indiceTitulo: 'INPC',
        indiceConta: 'TR',
        fatorTitulo: { ...fator(30), incompleto: 'a série começa em 06/2016, depois do termo inicial pedido' },
        fatorConta: fator(3),
      })
      expect(r.aviso).toMatch(/não cobre o período inteiro/)
      expect(r.aviso).toMatch(/06\/2016/)
    })

    it('base não positiva falha', () => {
      expect(() =>
        recalcularPorIndice({
          base: 0, indiceTitulo: 'IPCA', indiceConta: 'TR',
          fatorTitulo: fator(10), fatorConta: fator(1),
        }),
      ).toThrow(/positiva/)
    })

    it('fator absurdo falha em vez de entrar no preço', () => {
      // Série trocada ou valores em outra base dariam fator de milhares. Este
      // número multiplica o crédito: absurdo aqui não estraga um campo,
      // estraga o preço.
      expect(() =>
        recalcularPorIndice({
          base: 10_000, indiceTitulo: 'IPCA', indiceConta: 'TR',
          fatorTitulo: fator(999_900), fatorConta: fator(1),
        }),
      ).toThrow(/fora da faixa plausível/)
      expect(fatorPlausivel(1.5087)).toBe(true)
      expect(fatorPlausivel(80)).toBe(false)
      expect(fatorPlausivel(NaN)).toBe(false)
    })
  })

  describe('as competências e a URL', () => {
    it('lê MM/AAAA e AAAA-MM', () => {
      expect(competencia('01/2015')).toEqual({ ano: 2015, mes: 1 })
      expect(competencia('1/2015')).toEqual({ ano: 2015, mes: 1 })
      expect(competencia('2015-01')).toEqual({ ano: 2015, mes: 1 })
    })

    it('recusa o que não é competência', () => {
      // Mês 13 e ano de 1900 aparecem quando a IA lê data errada; virar
      // competência válida faria a janela sair torta sem erro nenhum.
      expect(competencia('13/2015')).toBeNull()
      expect(competencia('01/1900')).toBeNull()
      expect(competencia('março de 2015')).toBeNull()
      expect(competencia('')).toBeNull()
      expect(competencia(null)).toBeNull()
    })

    it('a janela vai do dia 1 ao ÚLTIMO dia do mês final', () => {
      // Fevereiro é o teste: 28 em ano comum, 29 em bissexto. Fixar 30 ou 31
      // devolveria erro do SGS, e fixar 28 perderia o dia 29.
      expect(janelaSgs({ ano: 2015, mes: 1 }, { ano: 2015, mes: 2 })).toEqual({
        dataInicial: '01/01/2015', dataFinal: '28/02/2015',
      })
      expect(janelaSgs({ ano: 2020, mes: 1 }, { ano: 2020, mes: 2 })).toEqual({
        dataInicial: '01/01/2020', dataFinal: '29/02/2020',
      })
      expect(janelaSgs({ ano: 2021, mes: 12 }, { ano: 2021, mes: 12 })).toEqual({
        dataInicial: '01/12/2021', dataFinal: '31/12/2021',
      })
    })

    it('monta a URL do SGS', () => {
      const u = urlSgs(7478, janelaSgs({ ano: 2015, mes: 1 }, { ano: 2021, mes: 12 }))
      expect(u).toContain('bcdata.sgs.7478')
      expect(u).toContain('dataInicial=01/01/2015')
      expect(u).toContain('dataFinal=31/12/2021')
    })

    it('só os índices da lista são aceitos', () => {
      expect(ehIndiceConhecido('IPCA-E')).toBe(true)
      expect(ehIndiceConhecido('POUPANCA')).toBe(true)
      // Nomes que a IA poderia inventar não podem virar série nenhuma.
      expect(ehIndiceConhecido('IPCA-15')).toBe(false)
      expect(ehIndiceConhecido('CDI')).toBe(false)
      expect(ehIndiceConhecido('')).toBe(false)
      expect(ehIndiceConhecido(undefined)).toBe(false)
    })

    it('TR e poupança apontam para as séries MENSAIS', () => {
      // A trava do erro de 20 segundos: 226 e 195 são as diárias.
      expect(SERIE_DO_INDICE.TR).toBe(7811)
      expect(SERIE_DO_INDICE.POUPANCA).toBe(196)
      expect(Object.values(SERIE_DO_INDICE)).not.toContain(226)
      expect(Object.values(SERIE_DO_INDICE)).not.toContain(195)
    })
  })
})

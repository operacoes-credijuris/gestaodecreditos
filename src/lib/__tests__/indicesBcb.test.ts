import { describe, it, expect } from 'vitest'
import {
  acumular,
  acumularFixo,
  chaveDaBusca,
  competencia,
  ehIndiceDeSerie,
  ehIndiceDeclarado,
  ehRegime,
  fatorPlausivel,
  INDICE_FIXO,
  janelaSgs,
  mesesEntre,
  pontosMensais,
  recalcularItem,
  regimeDoIndice,
  regimePadrao,
  SERIE_DO_INDICE,
  urlSgs,
  type Acumulado,
} from '../../../supabase/functions/_shared/indicesBcb.ts'

/**
 * Os índices oficiais, e as três armadilhas que este arquivo existe para travar.
 *
 *   1. SÉRIE DIÁRIA. TR e poupança têm série por aniversário (226 e 195) — a que
 *      se acha primeiro no SGS. Sete anos dela dão 2.604 pontos, a requisição
 *      leva de 17 a 21 segundos, e compor os 2.604 como taxas mensais dá um
 *      número absurdo com cara de plausível.
 *   2. REGIME. Correção capitaliza; juros de mora contra a Fazenda, não. Trocar
 *      um pelo outro erra sempre para o lado de inflar o crédito.
 *   3. VAZIO NÃO É ZERO. `Number('')` é 0, e o BCB devolve valor "" em mês não
 *      publicado.
 *
 * Os três erros seriam SILENCIOSOS: ninguém refaz uma variação acumulada à mão
 * para conferir, e um fator grande é tão crível quanto um pequeno.
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

  const c = (mes: number, ano: number) => ({ ano, mes })

  describe('a leitura da resposta', () => {
    it('lê competência e variação de uma série mensal', () => {
      const p = pontosMensais(IPCA15_2015)
      expect(p).toHaveLength(3)
      expect(p[0]).toEqual({ ano: 2015, mes: 1, pct: 0.89 })
      expect(p[2]).toEqual({ ano: 2015, mes: 3, pct: 1.24 })
    })

    it('RECUSA série diária em vez de acumular errado', () => {
      // Falhar aqui é o desfecho bom: o outro é um número de ordem de grandeza
      // errada que ninguém tem como desconfiar.
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

    it('VAZIO NÃO É ZERO: mês sem valor publicado não entra como "não variou"', () => {
      // Number('') é 0 e passa por Number.isFinite. Entrando como ponto, o mês
      // vira 0% E a conferência de meses faltantes não acusa nada — um mês de
      // inflação desaparece sem rastro.
      const p = pontosMensais([
        { data: '01/01/2015', valor: '0.89' },
        { data: '01/02/2015', valor: '' },
        { data: '01/03/2015', valor: '1.24' },
      ])
      expect(p).toHaveLength(2)
      // E o buraco aparece como aviso, que é o ponto de descartar em vez de zerar.
      expect(acumular(p, c(1, 2015), c(3, 2015), 'composto').incompleto).toMatch(/faltam 1 mês/)
    })

    it('resposta que não é lista falha em vez de devolver vazio', () => {
      expect(() => pontosMensais({ erro: 'algo' })).toThrow(/não é uma lista/)
    })
  })

  describe('os dois regimes', () => {
    it('COMPOSTO compõe: correção monetária capitaliza', () => {
      const f = acumular(pontosMensais(IPCA15_2015), c(1, 2015), c(3, 2015), 'composto')
      expect(f.fator).toBeCloseTo(1.0089 * 1.0133 * 1.0124, 10)
      expect(f.regime).toBe('composto')
    })

    it('SIMPLES soma: juros de mora contra a Fazenda não capitalizam', () => {
      const f = acumular(pontosMensais(IPCA15_2015), c(1, 2015), c(3, 2015), 'simples')
      expect(f.fator).toBeCloseTo(1 + (0.89 + 1.33 + 1.24) / 100, 10)
      expect(f.regime).toBe('simples')
    })

    it('composto é sempre MAIOR que simples, e a diferença cresce com o prazo', () => {
      // É por isso que trocar um pelo outro erra sempre para o lado de inflar.
      const doze = Array.from({ length: 84 }, (_, i) => ({
        data: `01/${String((i % 12) + 1).padStart(2, '0')}/${2015 + Math.floor(i / 12)}`,
        valor: '0.60',
      }))
      const p = pontosMensais(doze)
      const comp = acumular(p, c(1, 2015), c(12, 2021), 'composto')
      const simp = acumular(p, c(1, 2015), c(12, 2021), 'simples')
      expect(comp.meses).toBe(84)
      expect(comp.fator).toBeGreaterThan(simp.fator)
      // 0,6% ao mês por 84 meses: 50,4% simples, ~65% composto.
      expect((simp.fator - 1) * 100).toBeCloseTo(50.4, 1)
      expect((comp.fator - 1) * 100).toBeGreaterThan(64)
    })

    it('o padrão da natureza segue a prática judicial, não a conveniência', () => {
      expect(regimePadrao('correcao')).toBe('composto')
      expect(regimePadrao('juros')).toBe('simples')
    })

    it('só os dois regimes são aceitos', () => {
      expect(ehRegime('composto')).toBe(true)
      expect(ehRegime('simples')).toBe(true)
      expect(ehRegime('linear')).toBe(false)
      expect(ehRegime(undefined)).toBe(false)
    })
  })

  describe('a acumulação', () => {
    it('corta pelo período pedido, ignorando o que a série trouxe a mais', () => {
      const f = acumular(pontosMensais(IPCA15_2015), c(2, 2015), c(2, 2015), 'composto')
      expect(f.meses).toBe(1)
      expect(f.fator).toBeCloseTo(1.0133, 10)
      expect(f.de).toBe('02/2015')
      expect(f.ate).toBe('02/2015')
    })

    it('avisa quando a série não cobre o período inteiro, em vez de calar', () => {
      const f = acumular(pontosMensais(IPCA15_2015), c(1, 2014), c(3, 2015), 'composto')
      expect(f.incompleto).toMatch(/começa em 01\/2015/)
      expect(f.meses).toBe(3)
    })

    // O RESTO DO ESQUEMA USA DATA COMPLETA, e o modelo devolve "12/05/2019"
    // num termo de consectário com a mesma naturalidade com que devolve
    // "05/2019". O item era descartado — e em silêncio, o que era pior.
    it('aceita a data completa, nos dois formatos', () => {
      expect(competencia('12/05/2019')).toEqual({ ano: 2019, mes: 5 })
      expect(competencia('1/5/2019')).toEqual({ ano: 2019, mes: 5 })
      expect(competencia('2019-05-12')).toEqual({ ano: 2019, mes: 5 })
    })

    it('data completa com mês impossível continua sendo null', () => {
      expect(competencia('12/13/2019')).toBe(null)
      expect(competencia('2019-13-12')).toBe(null)
      expect(competencia('12/05/1899')).toBe(null)
    })

    // CHAVE HERDADA NÃO É ÍNDICE: `'constructor' in SERIE_DO_INDICE` é
    // verdadeiro, o type guard promovia a string e SERIE_DO_INDICE[v] devolvia
    // uma FUNÇÃO — a URL do SGS saía "bcdata.sgs.function toString()…".
    it('o protótipo não é uma série', () => {
      expect(ehIndiceDeSerie('constructor')).toBe(false)
      expect(ehIndiceDeSerie('toString')).toBe(false)
      expect(ehIndiceDeSerie('hasOwnProperty')).toBe(false)
      expect(ehIndiceDeSerie('__proto__')).toBe(false)
      expect(ehIndiceDeSerie('IPCA-E')).toBe(true)
    })

    // O BURACO INTERNO SE DIZ MESMO COM FALTA NA PONTA. Era `&& !faltas.length`:
    // a falta da ponta já explicava a diferença, e o mês do meio — que faz o
    // fator sair errado sem parecer errado — ficava invisível.
    it('acusa o buraco do meio junto com a falta da ponta', () => {
      const pontos = [
        { ano: 2015, mes: 2, pct: 1 },
        // 03/2015 falta
        { ano: 2015, mes: 4, pct: 1 },
      ]
      const f = acumular(pontos, c(1, 2015), c(4, 2015), 'composto')
      expect(f.incompleto).toMatch(/come[çc]a em 02\/2015/)
      expect(f.incompleto).toMatch(/DENTRO do trecho coberto/)
    })

    // VARIAÇÃO NEGATIVA COMPÕE PARA BAIXO — IGP-M deflacionário existe, e um
    // fator abaixo de 1 é resultado legítimo, não erro.
    it('mês negativo derruba o fator abaixo de 1', () => {
      const pontos = [
        { ano: 2015, mes: 1, pct: -0.5 },
        { ano: 2015, mes: 2, pct: -0.5 },
      ]
      const f = acumular(pontos, c(1, 2015), c(2, 2015), 'composto')
      expect(f.fator).toBeLessThan(1)
      expect(f.fator).toBeCloseTo(0.995 * 0.995, 10)
    })

    it('período invertido falha', () => {
      expect(() => acumular(pontosMensais(IPCA15_2015), c(3, 2015), c(1, 2015), 'composto'))
        .toThrow(/anterior ao inicial/)
    })

    it('período sem nenhum mês na série falha em vez de devolver fator 1', () => {
      // Fator 1 seria "o índice não variou", que é uma afirmação; o certo é
      // dizer que não se sabe.
      expect(() => acumular(pontosMensais(IPCA15_2015), c(1, 2030), c(6, 2030), 'composto'))
        .toThrow(/nenhum mês no período/)
    })

    it('conta os meses do período, inclusive as duas pontas', () => {
      expect(mesesEntre(c(1, 2015), c(12, 2021))).toBe(84)
      expect(mesesEntre(c(3, 2015), c(3, 2015))).toBe(1)
    })
  })

  describe('a taxa fixa', () => {
    it('1% ao mês simples por 24 meses dá 24%', () => {
      // O caso do art. 406 do Código Civil, o mais comum em condenação antiga.
      const f = acumularFixo(1, c(1, 2015), c(12, 2016), 'simples')
      expect(f.meses).toBe(24)
      expect(f.fator).toBeCloseTo(1.24, 10)
    })

    it('1% ao mês composto por 24 meses dá mais que 24%', () => {
      const f = acumularFixo(1, c(1, 2015), c(12, 2016), 'composto')
      expect(f.fator).toBeCloseTo(Math.pow(1.01, 24), 10)
      expect(f.fator).toBeGreaterThan(1.26)
    })

    it('taxa fora do razoável falha', () => {
      // 50% ao mês num título é erro de leitura (percentual anual lido como
      // mensal, ou vírgula fora de lugar), e multiplicaria o crédito.
      expect(() => acumularFixo(50, c(1, 2015), c(12, 2016), 'simples')).toThrow(/fora do razoável/)
      expect(() => acumularFixo(-1, c(1, 2015), c(12, 2016), 'simples')).toThrow(/fora do razoável/)
    })

    it('não precisa de série nenhuma, e por isso não avisa incompleto', () => {
      expect(acumularFixo(0.5, c(1, 2015), c(6, 2015), 'simples').incompleto).toBeNull()
    })
  })

  describe('o recálculo de um item', () => {
    const ac = (pct: number, regime: 'composto' | 'simples' = 'composto', meses = 84): Acumulado => ({
      fator: 1 + pct / 100, regime, meses, de: '01/2015', ate: '12/2021', incompleto: null,
    })

    it('troca o índice da conta pelo do título, na correção', () => {
      // Tema 810: a conta usou TR (declarada inconstitucional) e o título pede
      // IPCA-E. A TR de sete anos rende quase nada; o crédito está SUBESTIMADO,
      // e o delta sai positivo.
      const r = recalcularItem({
        natureza: 'correcao', base: 100_000,
        titulo: { indice: 'IPCA-E', acumulado: ac(50.87) },
        conta: { indice: 'TR', acumulado: ac(3.4) },
      })
      expect(r.valorTitulo).toBeCloseTo(150_870, 6)
      expect(r.valorConta).toBeCloseTo(103_400, 6)
      expect(r.delta).toBeGreaterThan(0)
      expect(r.memoria).toContain('a conta subestimou')
    })

    it('delta NEGATIVO quando a conta inflou — e é o que mexe no preço', () => {
      // SELIC aplicada onde cabia IPCA-E: a conta cobra mais do que o título
      // mandava, e corrigir DERRUBA o valor.
      const r = recalcularItem({
        natureza: 'correcao', base: 84_320.1,
        titulo: { indice: 'IPCA-E', acumulado: ac(50.87) },
        conta: { indice: 'SELIC', acumulado: ac(68.2) },
      })
      expect(r.delta).toBeLessThan(0)
      expect(r.memoria).toContain('a conta inflou o crédito')
    })

    it('MESMO ÍNDICE, PERÍODOS DIFERENTES: é assim que o erro de TERMO se conserta', () => {
      // O caso que motivou o módulo: juros do dano emergente contados do evento
      // danoso quando o título os fixou da citação. Mesma taxa, período maior —
      // e o delta é exatamente o efeito do termo errado.
      const r = recalcularItem({
        natureza: 'juros', base: 40_000,
        titulo: { indice: 'POUPANCA', acumulado: { ...ac(18, 'simples', 36), de: '05/2019', ate: '04/2022' } },
        conta: { indice: 'POUPANCA', acumulado: { ...ac(30, 'simples', 60), de: '05/2017', ate: '04/2022' } },
      })
      expect(r.natureza).toBe('juros')
      expect(r.delta).toBeCloseTo(40_000 * 0.18 - 40_000 * 0.3, 6)
      expect(r.delta).toBeLessThan(0)
      expect(r.memoria).toContain('JUROS')
      expect(r.memoria).toContain('05/2019')
      expect(r.memoria).toContain('05/2017')
    })

    it('a memória diz o regime, porque ele muda o número', () => {
      const r = recalcularItem({
        natureza: 'juros', base: 10_000,
        titulo: { indice: 'POUPANCA', acumulado: ac(20, 'simples') },
        conta: { indice: 'POUPANCA', acumulado: ac(25, 'composto') },
      })
      expect(r.memoria).toContain('simples, sem capitalização')
      expect(r.memoria).toContain('capitalizada')
    })

    it('a memória traz as séries do SGS, para o número ser conferível na fonte', () => {
      const r = recalcularItem({
        natureza: 'correcao', base: 50_000,
        titulo: { indice: 'INPC', acumulado: ac(40) },
        conta: { indice: 'IGP-M', acumulado: ac(55) },
      })
      expect(r.memoria).toContain('Banco Central')
      expect(r.memoria).toContain(String(SERIE_DO_INDICE.INPC))
      expect(r.memoria).toContain(String(SERIE_DO_INDICE['IGP-M']))
      expect(r.memoria).toContain('84 meses')
    })

    it('taxa fixa aparece na memória como taxa fixa, e não como série', () => {
      const r = recalcularItem({
        natureza: 'juros', base: 20_000,
        titulo: { indice: INDICE_FIXO, acumulado: ac(12, 'simples', 12) },
        conta: { indice: 'SELIC', acumulado: ac(18, 'simples', 12) },
      })
      expect(r.memoria).toContain('taxa fixa')
    })

    it('carrega o aviso de série incompleta para quem chama', () => {
      const r = recalcularItem({
        natureza: 'correcao', base: 50_000,
        titulo: { indice: 'INPC', acumulado: { ...ac(30), incompleto: 'a série começa em 06/2016, depois do termo inicial pedido' } },
        conta: { indice: 'TR', acumulado: ac(3) },
      })
      expect(r.aviso).toMatch(/não cobre o período inteiro/)
      expect(r.aviso).toMatch(/06\/2016/)
    })

    it('base não positiva falha', () => {
      expect(() => recalcularItem({
        natureza: 'correcao', base: 0,
        titulo: { indice: 'IPCA', acumulado: ac(10) }, conta: { indice: 'TR', acumulado: ac(1) },
      })).toThrow(/positiva/)
    })

    it('fator absurdo falha em vez de entrar no preço', () => {
      expect(() => recalcularItem({
        natureza: 'correcao', base: 10_000,
        titulo: { indice: 'IPCA', acumulado: ac(999_900) }, conta: { indice: 'TR', acumulado: ac(1) },
      })).toThrow(/fora da faixa plausível/)
      expect(fatorPlausivel(1.5087)).toBe(true)
      expect(fatorPlausivel(80)).toBe(false)
      expect(fatorPlausivel(NaN)).toBe(false)
    })
  })

  describe('o regime de acumulação', () => {
    // A SELIC É EXCEÇÃO. Sob a EC 113/2021 ela substitui correção E juros de uma
    // vez, e o Manual de Cálculos da Justiça Federal a acumula por SOMA SIMPLES.
    // Classificada pela leitura como "correcao", ela caía no composto — e a
    // diferença, em alguns anos, passa de pontos percentuais inteiros, sempre
    // para o lado de inflar o crédito.
    it('Selic é simples mesmo declarada como correção', () => {
      expect(regimeDoIndice('correcao', 'SELIC')).toBe('simples')
      expect(regimeDoIndice('juros', 'SELIC')).toBe('simples')
    })

    it('os demais índices seguem a natureza', () => {
      expect(regimeDoIndice('correcao', 'IPCA-E')).toBe(regimePadrao('correcao'))
      expect(regimeDoIndice('juros', 'IPCA-E')).toBe(regimePadrao('juros'))
      expect(regimeDoIndice('correcao')).toBe(regimePadrao('correcao'))
    })
  })

  describe('as competências, a URL e a deduplicação', () => {
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
      // Fevereiro é o teste: 28 em ano comum, 29 em bissexto.
      expect(janelaSgs(c(1, 2015), c(2, 2015))).toEqual({ dataInicial: '01/01/2015', dataFinal: '28/02/2015' })
      expect(janelaSgs(c(1, 2020), c(2, 2020))).toEqual({ dataInicial: '01/01/2020', dataFinal: '29/02/2020' })
      expect(janelaSgs(c(12, 2021), c(12, 2021))).toEqual({ dataInicial: '01/12/2021', dataFinal: '31/12/2021' })
    })

    it('monta a URL do SGS', () => {
      const u = urlSgs(7478, janelaSgs(c(1, 2015), c(12, 2021)))
      expect(u).toContain('bcdata.sgs.7478')
      expect(u).toContain('dataInicial=01/01/2015')
      expect(u).toContain('dataFinal=31/12/2021')
    })

    it('a mesma série no mesmo período tem a mesma chave, e se busca uma vez', () => {
      // Correção e juros pelo mesmo índice no mesmo período são dois itens e uma
      // requisição — o recálculo pode ter até seis itens.
      const j = janelaSgs(c(1, 2015), c(12, 2021))
      expect(chaveDaBusca(196, j)).toBe(chaveDaBusca(196, j))
      expect(chaveDaBusca(196, j)).not.toBe(chaveDaBusca(7811, j))
      expect(chaveDaBusca(196, j)).not.toBe(chaveDaBusca(196, janelaSgs(c(1, 2016), c(12, 2021))))
    })

    it('só os índices da lista são aceitos, e FIXO não é série', () => {
      expect(ehIndiceDeSerie('IPCA-E')).toBe(true)
      expect(ehIndiceDeSerie(INDICE_FIXO)).toBe(false)
      expect(ehIndiceDeclarado(INDICE_FIXO)).toBe(true)
      // Nomes que a IA poderia inventar não podem virar série nenhuma.
      expect(ehIndiceDeclarado('IPCA-15')).toBe(false)
      expect(ehIndiceDeclarado('CDI')).toBe(false)
      expect(ehIndiceDeclarado('')).toBe(false)
      expect(ehIndiceDeclarado(undefined)).toBe(false)
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

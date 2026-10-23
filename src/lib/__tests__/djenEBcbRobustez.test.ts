/**
 * DJEN E BANCO CENTRAL: O QUE SE PERDIA CALADO (23/10/2026).
 *
 * DJEN — sem `count` a paginação parava na primeira página; máscara vazia
 * descartava a intimação; `dias_retroativos` não numérico derrubava a função; e
 * o erro da poda do cache era jogado fora.
 * BCB — com um índice gravado e o outro não, a data de referência andava para o
 * mês do que deu certo, por cima de um índice velho.
 *
 * A lógica pura é exercitada; o que mora no `index.ts` é conferido pelo código.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  contagemDaResposta,
  DIAS_MAXIMO,
  DIAS_PADRAO,
  diasRetroativos,
  fimDaPaginacao,
  numeroDoItem,
} from '../../../supabase/functions/djen-publicacoes/regras'
import { dataDeReferencia } from '../../../supabase/functions/parametros-bcb/referencia'

const ler = (rel: string) =>
  readFileSync(join(__dirname, '..', '..', '..', 'supabase', 'functions', rel), 'utf8').replace(
    /\r\n/g,
    '\n',
  )

describe('DJEN: paginação sem contagem', () => {
  it('contagem ausente é null, não 0', () => {
    expect(contagemDaResposta({ items: [] })).toBeNull()
    expect(contagemDaResposta({ count: null })).toBeNull()
    expect(contagemDaResposta({ count: 'abc' })).toBeNull()
    expect(contagemDaResposta(null)).toBeNull()
    expect(contagemDaResposta({ count: 250 })).toBe(250)
    expect(contagemDaResposta({ count: '250' })).toBe(250)
  })

  /** O laço do buscarPorOab, com páginas falsas. */
  const paginar = (totalDeItens: number, comContagem: boolean) => {
    const POR = 100
    let lidos = 0
    let paginas = 0
    for (let p = 1; p <= 30; p++) {
      paginas++
      const veio = Math.max(0, Math.min(POR, totalDeItens - (p - 1) * POR))
      lidos += veio
      const total = contagemDaResposta(comContagem ? { count: totalDeItens } : {})
      if (fimDaPaginacao(veio, lidos, total, POR)) break
    }
    return { lidos, paginas }
  }

  it('sem contagem, segue enquanto a página vier cheia (o antigo parava em 100)', () => {
    expect(paginar(250, false)).toEqual({ lidos: 250, paginas: 3 })
    // Múltiplo exato: a página vazia seguinte é o fim.
    expect(paginar(200, false)).toEqual({ lidos: 200, paginas: 3 })
  })

  it('com contagem, para ao alcançá-la sem pedir a página vazia', () => {
    expect(paginar(200, true)).toEqual({ lidos: 200, paginas: 2 })
    expect(paginar(250, true)).toEqual({ lidos: 250, paginas: 3 })
  })

  it('contagem zero contradizendo uma página cheia não encerra', () => {
    expect(fimDaPaginacao(100, 100, 0, 100)).toBe(false)
    expect(fimDaPaginacao(40, 40, 0, 100)).toBe(true)
  })

  it('a função usa as regras, e não `Number(j?.count ?? 0)`', () => {
    const f = ler('djen-publicacoes/index.ts')
    expect(f).not.toContain('count: Number(j?.count ?? 0)')
    expect(f).toContain('count: contagemDaResposta(j),')
    expect(f).toContain('if (fimDaPaginacao(r.items.length, items.length, total, POR_PAGINA)) {')
  })
})

describe('DJEN: número do processo', () => {
  it('máscara vazia cai no número sem máscara', () => {
    expect(numeroDoItem({ numeroprocessocommascara: '', numero_processo: '00012345620208260100' })).toBe(
      '00012345620208260100',
    )
    expect(numeroDoItem({ numeroprocessocommascara: '   ', numero_processo: '123' })).toBe('123')
  })

  it('máscara presente vence', () => {
    expect(
      numeroDoItem({ numeroprocessocommascara: '0001234-56.2020.8.26.0100', numero_processo: '1' }),
    ).toBe('0001234-56.2020.8.26.0100')
  })

  it('nenhum dos dois → null', () => {
    expect(numeroDoItem({ numeroprocessocommascara: '', numero_processo: null })).toBeNull()
    expect(numeroDoItem({})).toBeNull()
  })

  it('recorte e gravação usam numeroDoItem', () => {
    const f = ler('djen-publicacoes/index.ts')
    expect(f).toContain('const numero = onlyDigits(numeroDoItem(it))')
    expect(f).toContain('numero_processo: numeroDoItem(it),')
    expect(f).not.toContain('(it.numeroprocessocommascara as string) ??')
  })
})

describe('DJEN: dias_retroativos validado', () => {
  it('ausente → padrão, sem aviso', () => {
    expect(diasRetroativos(undefined)).toEqual({ dias: DIAS_PADRAO, ajuste: null })
    expect(diasRetroativos('')).toEqual({ dias: DIAS_PADRAO, ajuste: null })
  })

  it('não numérico → padrão, com aviso (o antigo lançava RangeError)', () => {
    const r = diasRetroativos('trinta')
    expect(r.dias).toBe(DIAS_PADRAO)
    expect(r.ajuste).toMatch(/ilegível/)
    // A janela calculada com ele não lança mais.
    expect(() => new Date(Date.now() - r.dias * 86400000).toISOString()).not.toThrow()
  })

  it('número válido passa; texto numérico e vírgula também', () => {
    expect(diasRetroativos(45)).toEqual({ dias: 45, ajuste: null })
    expect(diasRetroativos('60')).toEqual({ dias: 60, ajuste: null })
    expect(diasRetroativos('15,0').dias).toBe(15)
  })

  it('fora da faixa é limitado, com aviso', () => {
    expect(diasRetroativos(0).dias).toBe(1)
    expect(diasRetroativos(-10).dias).toBe(1)
    expect(diasRetroativos(10_000).dias).toBe(DIAS_MAXIMO)
    expect(diasRetroativos(10_000).ajuste).toMatch(/fora da faixa/)
    expect(diasRetroativos(Infinity).dias).toBe(DIAS_PADRAO)
  })

  it('a função usa a validação', () => {
    const f = ler('djen-publicacoes/index.ts')
    expect(f).not.toContain('const dias = Number(cfg.dias_retroativos ?? 30)')
    expect(f).toContain('diasRetroativos(cfg.dias_retroativos)')
  })
})

describe('DJEN: erro da poda do cache', () => {
  it('é capturado e vai para o diagnóstico e o resumo', () => {
    const f = ler('djen-publicacoes/index.ts')
    expect(f).toContain("const { error: erroPoda } = await svc\n      .from('djen_publicacoes')\n      .delete()")
    expect(f).toContain('poda_falhou: podaFalhou,')
    expect(f).toContain("(podaFalhou ? ' · LIMPEZA DO CACHE FALHOU' : '')")
  })
})

describe('BCB: data de referência só anda com os dois índices gravados', () => {
  it('os dois gravados: último dia do mês mais antigo', () => {
    expect(dataDeReferencia({ ano: 2026, mes: 9 }, { ano: 2026, mes: 8 })).toBe('2026-08-31')
    expect(dataDeReferencia({ ano: 2026, mes: 1 }, { ano: 2026, mes: 2 })).toBe('2026-01-31')
    expect(dataDeReferencia({ ano: 2024, mes: 2 }, { ano: 2024, mes: 2 })).toBe('2024-02-29')
    expect(dataDeReferencia({ ano: 2025, mes: 12 }, { ano: 2026, mes: 1 })).toBe('2025-12-31')
  })

  it('só um gravado: não mexe (null = a coluna fica como está)', () => {
    expect(dataDeReferencia({ ano: 2026, mes: 9 }, null)).toBeNull()
    expect(dataDeReferencia(null, { ano: 2026, mes: 9 })).toBeNull()
    expect(dataDeReferencia(null, null)).toBeNull()
  })

  it('a função só põe data_referencia no update quando a regra devolve data', () => {
    const f = ler('parametros-bcb/index.ts')
    expect(f).not.toContain('const comps = [compSelic, compIpca].filter(Boolean)')
    expect(f).toContain('const dataRef = dataDeReferencia(compSelic, compIpca)')
    expect(f).toContain('if (dataRef) mudancas.data_referencia = dataRef')
  })
})

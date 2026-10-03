import { afterEach, describe, expect, it, vi } from 'vitest'
import { FUNIL_PRECATORIO, FUNIL_RPV } from '@/lib/kommo'
import {
  CHAVE_DO_LUGAR,
  guardarLugar,
  LUGAR_PADRAO,
  lerLugar,
  lugarGuardado,
  textoDoLugar,
} from '@/lib/lugarDaAnalise'

/**
 * O LUGAR LEMBRADO ENTRE VISITAS (amostra, ajuda.js): funil, destinação e
 * etapa. O que se guardou pode ter envelhecido, e o navegador pode não deixar
 * guardar — nos dois casos a tela abre no padrão, sem quebrar.
 */
describe('lugar da Análise de crédito', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('vai e volta pelo texto', () => {
    const l = { funil: FUNIL_PRECATORIO, destinacao: 'externo' as const, etapa: 'ext-precificacao' }
    expect(lerLugar(textoDoLugar(l))).toEqual(l)
  })

  it('nada guardado, JSON quebrado ou de outro formato: o padrão', () => {
    expect(lerLugar(null)).toEqual(LUGAR_PADRAO)
    expect(lerLugar('')).toEqual(LUGAR_PADRAO)
    expect(lerLugar('{quebrado')).toEqual(LUGAR_PADRAO)
    expect(lerLugar('"texto"')).toEqual(LUGAR_PADRAO)
    expect(lerLugar('null')).toEqual(LUGAR_PADRAO)
    expect(LUGAR_PADRAO.funil).toBe(FUNIL_RPV)
    expect(LUGAR_PADRAO.etapa).toBe('')
  })

  it('campo que não se reconhece volta ao padrão sozinho', () => {
    expect(lerLugar(JSON.stringify({ funil: FUNIL_PRECATORIO, destinacao: 'outra', etapa: 'int-x' }))).toEqual({
      funil: FUNIL_PRECATORIO,
      destinacao: LUGAR_PADRAO.destinacao,
      etapa: 'int-x',
    })
  })

  // A CHAVE DA ETAPA É DO FUNIL: 'pendentes' do RPV não quer dizer nada no
  // precatório, e vice-versa.
  it('funil desconhecido leva a etapa junto', () => {
    expect(lerLugar(JSON.stringify({ funil: 123, destinacao: 'interno', etapa: 'int-x' }))).toEqual({
      funil: FUNIL_RPV,
      destinacao: 'interno',
      etapa: '',
    })
  })

  it('sem acesso ao armazenamento, lê o padrão e grava sem quebrar', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => {
          throw new Error('bloqueado')
        },
        setItem: () => {
          throw new Error('bloqueado')
        },
      },
    })
    expect(lugarGuardado()).toEqual(LUGAR_PADRAO)
    expect(() => guardarLugar(LUGAR_PADRAO)).not.toThrow()
  })

  it('com armazenamento, grava na chave da Análise e lê de volta', () => {
    const guardado = new Map<string, string>()
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (k: string) => guardado.get(k) ?? null,
        setItem: (k: string, v: string) => void guardado.set(k, v),
      },
    })
    const l = { funil: FUNIL_PRECATORIO, destinacao: 'interno' as const, etapa: 'int-y' }
    guardarLugar(l)
    expect(guardado.has(CHAVE_DO_LUGAR)).toBe(true)
    expect(lugarGuardado()).toEqual(l)
  })
})

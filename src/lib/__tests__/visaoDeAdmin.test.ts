// A REGRA DE LANÇAMENTO DA ONDA 4 DO REDESENHO (02/10/2026): todo botão novo que
// move card (ou leva ao contrato) aparece SÓ PARA ADMINISTRADOR. O campo é
// `soAdmin`, e quem filtra é `abaParaQuemVe`, por onde `abasDoFunil` passa toda aba.
//
// Mover card no Kommo dispara as automações e não se desfaz; a beta usa o Kommo
// de verdade. Estes testes prendem que quem não é admin não vê nada disso — em
// funil nenhum, aba nenhuma — e que o padrão de `abasDoFunil` é o seguro.

import { describe, it, expect } from 'vitest'
import {
  abaParaQuemVe,
  abasDoFunil,
  CONCLUIR_REVISAO_RPV,
  FUNIL_PRECATORIO,
  FUNIL_RPV,
  SANAR_RPV,
  visivelPara,
  type Aba,
  type AcaoTela,
} from '@/lib/kommo'
import { espelhoDosTresFunis } from './fixtures/kanbans'

const TODAS = (opcoes?: { admin?: boolean }) => [
  ...abasDoFunil(FUNIL_RPV, espelhoDosTresFunis(), null, opcoes),
  ...abasDoFunil(FUNIL_PRECATORIO, espelhoDosTresFunis(), 'interno', opcoes),
  ...abasDoFunil(FUNIL_PRECATORIO, espelhoDosTresFunis(), 'externo', opcoes),
]

/** Tudo o que a aba carrega marcado `soAdmin`. */
const doAdmin = (a: Aba) => [
  ...a.acoes.filter((x) => x.soAdmin),
  ...(a.concluir ?? []),
  ...[a.negociacao?.fechado, a.negociacao?.naoFechou, a.negociacao?.semResposta].filter(Boolean),
  ...(a.gerarContrato ? [a.gerarContrato] : []),
]

describe('soAdmin — quem não é admin não vê os botões da onda 4', () => {
  it('sem dizer `admin`, nenhuma aba de nenhum funil traz nada de admin', () => {
    for (const a of TODAS()) {
      expect(doAdmin(a), a.key).toEqual([])
      expect(a.negociacao, a.key).toBeUndefined()
      expect(a.gerarContrato, a.key).toBeUndefined()
      expect(a.concluir, a.key).toBeUndefined()
    }
  })

  it('com `admin: false` é igual a não dizer nada', () => {
    expect(TODAS({ admin: false })).toEqual(TODAS())
  })

  it('o admin vê os botões novos, e nenhuma aba chega com `concluir` cru', () => {
    const abas = TODAS({ admin: true })
    expect(abas.some((a) => a.negociacao)).toBe(true)
    expect(abas.some((a) => a.gerarContrato)).toBe(true)
    expect(abas.some((a) => a.acoes.some((x) => x.label === 'Sanar' && x.soAdmin))).toBe(true)
    for (const a of abas) expect(a.concluir, a.key).toBeUndefined()
  })

  it('a Revisão do RPV: três botões no card para quem não é admin; o Concluir para o admin', () => {
    const rev = (admin: boolean) => abasDoFunil(FUNIL_RPV, espelhoDosTresFunis(), null, { admin }).find((a) => a.key === 'validacao')!
    expect(rev(false).desfechoAgrupado).toBeFalsy()
    expect(rev(false).acoes.map((a) => a.label)).toEqual(['Aprovar', 'Diligência', 'Reprovar'])
    expect(rev(true).desfechoAgrupado).toBe(true)
    expect(rev(true).acoes).toEqual(CONCLUIR_REVISAO_RPV)
  })

  it('a descrição da coluna muda só para quem tem o botão novo', () => {
    const dil = (admin: boolean) => abasDoFunil(FUNIL_RPV, espelhoDosTresFunis(), null, { admin }).find((a) => a.key === 'diligencia')!
    expect(dil(false).descricao).toMatch(/o comercial move o card de volta/)
    expect(dil(true).descricao).toMatch(/volta para a Revisão/)
  })
})

describe('visivelPara e abaParaQuemVe', () => {
  const comum: AcaoTela = { statusId: 1, label: 'Comum', variant: 'primary', papel: 'aprovar' }

  it('visivelPara tira o soAdmin de quem não é admin, e só ele', () => {
    expect(visivelPara([comum, SANAR_RPV], false)).toEqual([comum])
    expect(visivelPara([comum, SANAR_RPV], true)).toEqual([comum, SANAR_RPV])
  })

  it('abaParaQuemVe num objeto montado à mão', () => {
    const aba: Aba = {
      key: 'x',
      label: 'X',
      statusIds: [9],
      descricaoVazia: '',
      acoes: [comum, SANAR_RPV],
      negociacao: { fechado: { ...SANAR_RPV, label: 'Fechado!', papel: 'fechar' } },
      gerarContrato: { soAdmin: true },
    }
    const naoAdmin = abaParaQuemVe(aba, false)
    expect(naoAdmin.acoes).toEqual([comum])
    expect('negociacao' in naoAdmin).toBe(false)
    expect('gerarContrato' in naoAdmin).toBe(false)
    const admin = abaParaQuemVe(aba, true)
    expect(admin.acoes).toEqual([comum, SANAR_RPV])
    expect(admin.negociacao?.fechado?.label).toBe('Fechado!')
    expect(admin.gerarContrato).toEqual({ soAdmin: true })
  })
})

// A REGRA DE LANÇAMENTO DA ONDA 4 DO REDESENHO (02/10/2026): todo botão novo que
// move card (ou leva ao contrato) nasce marcado `soAdmin`, e quem filtra é
// `abaParaQuemVe`, por onde `abasDoFunil` passa toda aba.
//
// MUDOU DE PROPÓSITO EM 03/10/2026, por decisão do dono: os botões novos da onda 4
// valem para TODO MUNDO (`BOTOES_NOVOS_PARA_TODOS`). O mecanismo continua —
// `soAdmin` marca o que foi lançado assim, `visivelPara` ainda o filtra, e serve
// ao próximo lançamento por etapas —, mas com a chave ligada quem não é admin vê
// exatamente o que o admin vê. Estes testes prendem as duas metades: a chave
// ligada, e o mecanismo intacto por baixo dela.

import { describe, it, expect } from 'vitest'
import {
  abaParaQuemVe,
  abasDoFunil,
  BOTOES_NOVOS_PARA_TODOS,
  CONCLUIR_REVISAO_RPV,
  DESCRICAO_DA_COLUNA,
  FUNIL_PRECATORIO,
  FUNIL_RPV,
  SANAR_RPV,
  ST_DILIGENCIA,
  ST_ELABORACAO_CONTRATOS,
  visivelPara,
  type Aba,
  type AcaoTela,
} from '@/lib/kommo'
import { NEGOCIACAO_RPV } from '../../../supabase/functions/_shared/colunasRpv.ts'
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

// MUDOU DE PROPÓSITO EM 03/10/2026 (decisão do dono): era "quem não é admin não
// vê os botões da onda 4"; agora quem não é admin vê o mesmo que o admin.
describe('BOTOES_NOVOS_PARA_TODOS — os botões da onda 4 para todo mundo', () => {
  // A CHAVE ESTÁ LIGADA. Desligá-la volta a regra de antes (só admin) e muda o
  // que a equipe vê; quem desligar tem de mudar este teste e saber por quê.
  it('a chave está ligada', () => {
    expect(BOTOES_NOVOS_PARA_TODOS).toBe(true)
  })

  it('quem não é admin vê exatamente o que o admin vê, em todo funil e toda aba', () => {
    expect(TODAS({ admin: false })).toEqual(TODAS({ admin: true }))
  })

  it('sem dizer `admin`, o mesmo — o padrão de `abasDoFunil` também vê os botões novos', () => {
    expect(TODAS()).toEqual(TODAS({ admin: true }))
  })

  it('quem não é admin vê os botões novos, e nenhuma aba chega com `concluir` cru', () => {
    const abas = TODAS({ admin: false })
    expect(abas.some((a) => a.negociacao)).toBe(true)
    expect(abas.some((a) => a.gerarContrato)).toBe(true)
    expect(abas.some((a) => a.acoes.some((x) => x.label === 'Sanar' && x.soAdmin))).toBe(true)
    expect(abas.some((a) => doAdmin(a).length > 0)).toBe(true)
    for (const a of abas) expect(a.concluir, a.key).toBeUndefined()
  })

  it('a Revisão do RPV: o Concluir para todos, no lugar dos três botões do card', () => {
    const rev = (admin: boolean) =>
      abasDoFunil(FUNIL_RPV, espelhoDosTresFunis(), null, { admin }).find((a) => a.key === 'validacao')!
    for (const admin of [false, true]) {
      expect(rev(admin).desfechoAgrupado, String(admin)).toBe(true)
      expect(rev(admin).acoes, String(admin)).toEqual(CONCLUIR_REVISAO_RPV)
    }
  })

  // A FRASE DA COLUNA PARA QUEM TEM O BOTÃO NOVO (`DESCRICAO_PARA_ADMIN`) vale
  // agora para todos: ela diz o que o botão faz, e todos têm o botão.
  it('a descrição da coluna é a do botão novo, para todos', () => {
    const rpv = (admin: boolean) => abasDoFunil(FUNIL_RPV, espelhoDosTresFunis(), null, { admin })
    for (const admin of [false, true]) {
      const porId = (id: number) => rpv(admin).find((a) => a.statusIds[0] === id)!.descricao
      expect(porId(ST_DILIGENCIA), `Diligência · ${admin}`).toMatch(/volta para a Revisão/)
      expect(porId(ST_DILIGENCIA)).not.toBe(DESCRICAO_DA_COLUNA[ST_DILIGENCIA])
      expect(porId(NEGOCIACAO_RPV.coluna), `Negociação · ${admin}`).toMatch(/marque no card: fechado, não fechou ou sem resposta/)
      expect(porId(ST_ELABORACAO_CONTRATOS), `Elaboração · ${admin}`).toMatch(/O botão do card abre a Geração de contratos/)
    }
    const dil = abasDoFunil(FUNIL_PRECATORIO, espelhoDosTresFunis(), 'interno', { admin: false }).find(
      (a) => a.key === 'int-diligencia',
    )!
    expect(dil.descricao).toMatch(/Sanada, o crédito volta para a Revisão/)
  })
})

describe('visivelPara e abaParaQuemVe', () => {
  const comum: AcaoTela = { statusId: 1, label: 'Comum', variant: 'primary', papel: 'aprovar' }

  // O MECANISMO CONTINUA: `visivelPara` sozinho, sem a chave, ainda tira o
  // `soAdmin` de quem não é admin — é o que o próximo lançamento por etapas usa.
  it('visivelPara tira o soAdmin de quem não é admin, e só ele', () => {
    expect(visivelPara([comum, SANAR_RPV], false)).toEqual([comum])
    expect(visivelPara([comum, SANAR_RPV], true)).toEqual([comum, SANAR_RPV])
  })

  // MUDOU DE PROPÓSITO EM 03/10/2026 (decisão do dono): com a chave ligada,
  // `abaParaQuemVe` entrega a quem não é admin o mesmo objeto que ao admin.
  it('abaParaQuemVe num objeto montado à mão: com a chave ligada, o mesmo para os dois', () => {
    const aba: Aba = {
      key: 'x',
      label: 'X',
      statusIds: [9],
      descricaoVazia: '',
      acoes: [comum, SANAR_RPV],
      negociacao: { fechado: { ...SANAR_RPV, label: 'Fechado!', papel: 'fechar' } },
      gerarContrato: { soAdmin: true },
    }
    const admin = abaParaQuemVe(aba, true)
    expect(admin.acoes).toEqual([comum, SANAR_RPV])
    expect(admin.negociacao?.fechado?.label).toBe('Fechado!')
    expect(admin.gerarContrato).toEqual({ soAdmin: true })
    expect(abaParaQuemVe(aba, false)).toEqual(admin)
  })

  it('abaParaQuemVe troca o Concluir pelos botões do card, para todos', () => {
    const aba: Aba = {
      key: 'y',
      label: 'Y',
      statusIds: [10],
      descricaoVazia: '',
      acoes: [comum],
      concluir: CONCLUIR_REVISAO_RPV,
    }
    for (const admin of [false, true]) {
      const v = abaParaQuemVe(aba, admin)
      expect(v.acoes, String(admin)).toEqual(CONCLUIR_REVISAO_RPV)
      expect(v.desfechoAgrupado, String(admin)).toBe(true)
      expect('concluir' in v, String(admin)).toBe(false)
    }
  })
})

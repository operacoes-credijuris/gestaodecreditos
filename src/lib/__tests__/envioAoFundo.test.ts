// O envio a um fundo na Remessa aos fundos: a ORDEM das chamadas, a cotação do
// BTG (05/10/2026) e o que se diz em cada falha. Ver lib/envioAoFundo.ts.

import { describe, it, expect } from 'vitest'
import { registrarEnvioAoFundo, type PassosDoEnvio } from '../envioAoFundo'
import type { AtoDoEnvio } from '../../../supabase/functions/_shared/trilhasDoPrecatorio.ts'
import type { Cotacao } from '../../../supabase/functions/_shared/cotacaoDoFundo.ts'
import { TRILHAS_PRECATORIO } from '../../../supabase/functions/_shared/trilhasDoPrecatorio.ts'
import { ETIQUETAS_DA_PRECIFICACAO } from '../../../supabase/functions/_shared/etiquetasDoFundo.ts'

const remessa = TRILHAS_PRECATORIO.flatMap((t) => t.abas).find((a) => a.envioAosFundos)!.envioAosFundos!
const btg = remessa.fundos.find((f) => f.fundo === 'BTG')!
const pjus = remessa.fundos.find((f) => f.fundo === 'PJus')!
const ato = (f: typeof btg, etiqueta: string): AtoDoEnvio => f.atos.find((a) => a.etiqueta === etiqueta)!

const COTADO_BTG = ato(btg, 'Cotado BTG')
const REPROVADO_BTG = ato(btg, 'Reprovado BTG')
const ENVIADO_PJUS = ato(pjus, 'Enviado PJus')

const LIMITADA: Cotacao = { propostaCentavos: 85_000_000, comissao: { modalidade: 'limitada', centavos: 4_000_000 } }
// O spread de 06/10/2026: 5% sobre o valor líquido validado (R$ 800.000,00).
const SPREAD: Cotacao = {
  propostaCentavos: 85_000_000,
  comissao: { modalidade: 'spread', percentualCentesimos: 500, baseCentavos: 80_000_000 },
}

/** Passos de mentira que anotam a ordem em que foram chamados. */
function passosFalsos(o: {
  tagsDepois?: string[]
  falhaAnotar?: string
  falhaEtiquetar?: string
  falhaMover?: string
  /** A função respondeu sem `cotacao` (a anterior a 05/10/2026). */
  semConfirmarCotacao?: boolean
} = {}) {
  const chamadas: string[] = []
  const cotacoesEnviadas: (Cotacao | null)[] = []
  const passos: PassosDoEnvio = {
    anotar: async () => {
      chamadas.push('anotar')
      if (o.falhaAnotar) throw new Error(o.falhaAnotar)
    },
    etiquetar: async (c) => {
      chamadas.push('etiquetar')
      cotacoesEnviadas.push(c)
      if (o.falhaEtiquetar) throw new Error(o.falhaEtiquetar)
      return { tags: o.tagsDepois ?? [], cotacaoGravada: c !== null && !o.semConfirmarCotacao }
    },
    mover: async () => {
      chamadas.push('mover')
      if (o.falhaMover) throw new Error(o.falhaMover)
    },
  }
  return { passos, chamadas, cotacoesEnviadas }
}

const todosFeitos = (tags: string[]) => tags.includes('Cotado BTG') && tags.includes('Enviado PJus')
const base = { destino: 'Em precificação', todosFeitos, anotacaoFeita: false }

describe('a trilha: só o "Cotado BTG" pede a cotação', () => {
  it('o "Cotado BTG" pede; o "Reprovado BTG" e os atos da PJus não', () => {
    expect(remessa.fundos.flatMap((f) => f.atos.filter((a) => a.pedeCotacao).map((a) => a.etiqueta))).toEqual([
      'Cotado BTG',
    ])
  })

  it('todo ato que pede a cotação é um "Cotado" da lista — o único a que a kommo-etiquetar junta a cotação', () => {
    for (const a of remessa.fundos.flatMap((f) => f.atos).filter((a) => a.pedeCotacao)) {
      expect(ETIQUETAS_DA_PRECIFICACAO.find((e) => e.nome === a.etiqueta)?.ato, a.etiqueta).toBe('Cotado')
      expect(a.reprova, a.etiqueta).toBeFalsy()
    }
  })
})

describe('registrarEnvioAoFundo — "Cotado BTG" com a cotação', () => {
  it('anota, grava a cotação COM a etiqueta (num pedido só) e, com todos os fundos feitos, move — nessa ordem', async () => {
    const f = passosFalsos({ tagsDepois: ['Cotado BTG', 'Enviado PJus'] })
    const andamento: string[] = []
    const r = await registrarEnvioAoFundo({
      ...base, fundo: 'BTG', ato: COTADO_BTG, cotacao: LIMITADA, passos: f.passos, onAndamento: (t) => andamento.push(t),
    })
    expect(f.chamadas).toEqual(['anotar', 'etiquetar', 'mover'])
    expect(f.cotacoesEnviadas).toEqual([LIMITADA])
    expect(r).toEqual({ tags: ['Cotado BTG', 'Enviado PJus'], cotacao: 'R$ 850.000,00 / R$ 40.000,00', movido: true })
    expect(andamento).toEqual([
      'Gravando a cotação no campo BTG e a etiqueta "Cotado BTG"…',
      'Movendo o card para Em precificação…',
    ])
  })

  it('com Spread, o texto é "final / comissão (Spread de P%)", sobre o líquido; faltando a PJus, o card não se move', async () => {
    const f = passosFalsos({ tagsDepois: ['Cotado BTG'] })
    const r = await registrarEnvioAoFundo({ ...base, fundo: 'BTG', ato: COTADO_BTG, cotacao: SPREAD, passos: f.passos })
    expect(f.chamadas).toEqual(['anotar', 'etiquetar'])
    expect(f.cotacoesEnviadas).toEqual([SPREAD])
    expect(r).toEqual({
      tags: ['Cotado BTG'],
      cotacao: 'R$ 810.000,00 / R$ 40.000,00 (Spread de 5%)',
      movido: false,
      faltamFundos: true,
    })
  })

  it('a tela nova não manda spread SEM percentual (só a aba antiga o manda, e o servidor ainda o aceita)', async () => {
    const f = passosFalsos({ tagsDepois: ['Cotado BTG'] })
    await expect(
      registrarEnvioAoFundo({
        ...base, fundo: 'BTG', ato: COTADO_BTG, cotacao: { propostaCentavos: 100, comissao: { modalidade: 'spread' } }, passos: f.passos,
      }),
    ).rejects.toThrow(/informe o percentual. Nada foi enviado ao Kommo/)
    expect(f.chamadas).toEqual([])
  })

  it('a tela nova não manda spread SEM o valor líquido validado (a aba de 05/10/2026 o manda, e o servidor ainda o aceita)', async () => {
    const f = passosFalsos({ tagsDepois: ['Cotado BTG'] })
    await expect(
      registrarEnvioAoFundo({
        ...base, fundo: 'BTG', ato: COTADO_BTG,
        cotacao: { propostaCentavos: 85_000_000, comissao: { modalidade: 'spread', percentualCentesimos: 500 } },
        passos: f.passos,
      }),
    ).rejects.toThrow(/informe o valor líquido validado. Nada foi enviado ao Kommo/)
    expect(f.chamadas).toEqual([])
  })

  it('comissão que alcança a proposta: recusada antes de qualquer chamada', async () => {
    const f = passosFalsos({ tagsDepois: ['Cotado BTG'] })
    await expect(
      registrarEnvioAoFundo({
        ...base, fundo: 'BTG', ato: COTADO_BTG,
        cotacao: { propostaCentavos: 4_000_000, comissao: { modalidade: 'spread', percentualCentesimos: 500, baseCentavos: 80_000_000 } },
        passos: f.passos,
      }),
    ).rejects.toThrow(/a proposta final precisa ser maior que zero.*Nada foi enviado ao Kommo/)
    expect(f.chamadas).toEqual([])
  })

  it('SEM A COTAÇÃO (ou incompleta), nada vai ao Kommo — nem a anotação', async () => {
    for (const c of [
      null,
      { propostaCentavos: 0, comissao: { modalidade: 'spread' } },
      { propostaCentavos: 100, comissao: { modalidade: 'limitada', centavos: 0 } },
    ] as (Cotacao | null)[]) {
      const f = passosFalsos({ tagsDepois: ['Cotado BTG', 'Enviado PJus'] })
      await expect(
        registrarEnvioAoFundo({ ...base, fundo: 'BTG', ato: COTADO_BTG, cotacao: c, passos: f.passos }),
      ).rejects.toThrow(/Nada foi enviado ao Kommo/)
      expect(f.chamadas).toEqual([])
    }
  })

  it('A GRAVAÇÃO DO CAMPO FALHA: o card não se move, e a mensagem diz que a anotação está lá e o resto não', async () => {
    const f = passosFalsos({
      tagsDepois: ['Cotado BTG', 'Enviado PJus'],
      falhaEtiquetar: 'Falta no Kommo o campo "BTG" no grupo "Cotações/propostas" do card. A etiqueta não foi posta.',
    })
    const erro = await registrarEnvioAoFundo({
      ...base, fundo: 'BTG', ato: COTADO_BTG, cotacao: LIMITADA, passos: f.passos,
    }).catch((e: Error) => e)
    expect(f.chamadas).toEqual(['anotar', 'etiquetar'])
    expect((erro as Error).message).toBe(
      'A anotação está no card, mas a cotação (campo BTG) e a etiqueta "Cotado BTG" não entraram: ' +
        'Falta no Kommo o campo "BTG" no grupo "Cotações/propostas" do card. A etiqueta não foi posta. ' +
        'O card não se moveu. Confirme de novo — a anotação não se repete.',
    )
  })

  it('A FUNÇÃO NÃO CONFIRMA O CAMPO (versão antiga, sem `cotacao` na resposta): não move, e diz o que entrou', async () => {
    const f = passosFalsos({ tagsDepois: ['Cotado BTG', 'Enviado PJus'], semConfirmarCotacao: true })
    const erro = await registrarEnvioAoFundo({
      ...base, fundo: 'BTG', ato: COTADO_BTG, cotacao: LIMITADA, passos: f.passos,
    }).catch((e: Error) => e)
    expect(f.chamadas).toEqual(['anotar', 'etiquetar'])
    expect((erro as Error).message).toMatch(/^A etiqueta "Cotado BTG" entrou, mas a função não confirmou a gravação do campo BTG/)
    expect((erro as Error).message).toContain('R$ 850.000,00 / R$ 40.000,00')
    expect((erro as Error).message).toContain('O card não se moveu')
  })

  it('A ANOTAÇÃO FALHA: nem a cotação nem a etiqueta são pedidas', async () => {
    const f = passosFalsos({ falhaAnotar: 'HTTP 502' })
    await expect(
      registrarEnvioAoFundo({ ...base, fundo: 'BTG', ato: COTADO_BTG, cotacao: LIMITADA, passos: f.passos }),
    ).rejects.toThrow(
      'A anotação não subiu para o Kommo: HTTP 502 A cotação não foi gravada, a etiqueta não entrou e o card não se moveu.',
    )
    expect(f.chamadas).toEqual(['anotar'])
  })

  it('A ANOTAÇÃO JÁ SUBIU (nova tentativa): só a cotação com a etiqueta, e o movimento', async () => {
    const f = passosFalsos({ tagsDepois: ['Cotado BTG', 'Enviado PJus'] })
    await registrarEnvioAoFundo({
      ...base, anotacaoFeita: true, fundo: 'BTG', ato: COTADO_BTG, cotacao: LIMITADA, passos: f.passos,
    })
    expect(f.chamadas).toEqual(['etiquetar', 'mover'])
  })

  it('O MOVIMENTO FALHA DEPOIS DE TUDO GRAVADO: não é erro do envio — devolve o motivo para o aviso', async () => {
    const f = passosFalsos({ tagsDepois: ['Cotado BTG', 'Enviado PJus'], falhaMover: 'Kommo fora do ar' })
    const r = await registrarEnvioAoFundo({ ...base, fundo: 'BTG', ato: COTADO_BTG, cotacao: LIMITADA, passos: f.passos })
    expect(r).toEqual({
      tags: ['Cotado BTG', 'Enviado PJus'],
      cotacao: 'R$ 850.000,00 / R$ 40.000,00',
      movido: false,
      faltamFundos: false,
      erroAoMover: 'Kommo fora do ar',
    })
  })
})

describe('registrarEnvioAoFundo — os atos sem cotação ficam como eram', () => {
  it('"Reprovado BTG" NÃO pede valor: o que se digitou na janela não vai ao Kommo', async () => {
    const f = passosFalsos({ tagsDepois: ['Reprovado BTG', 'Enviado PJus'] })
    const r = await registrarEnvioAoFundo({
      ...base, todosFeitos: () => true, fundo: 'BTG', ato: REPROVADO_BTG, cotacao: LIMITADA, passos: f.passos,
    })
    expect(f.cotacoesEnviadas).toEqual([null])
    expect(f.chamadas).toEqual(['anotar', 'etiquetar', 'mover'])
    expect(r.cotacao).toBeNull()
  })

  it('"Reprovado BTG" sem valor nenhum também segue', async () => {
    const f = passosFalsos({ tagsDepois: ['Reprovado BTG'] })
    await registrarEnvioAoFundo({ ...base, fundo: 'BTG', ato: REPROVADO_BTG, cotacao: null, passos: f.passos })
    expect(f.chamadas).toEqual(['anotar', 'etiquetar'])
  })

  it('"Enviado PJus" segue sem valor, com a mensagem de sempre quando a etiqueta falha', async () => {
    const f = passosFalsos({ falhaEtiquetar: 'Kommo recusou a etiqueta (HTTP 400).' })
    await expect(
      registrarEnvioAoFundo({ ...base, fundo: 'PJus', ato: ENVIADO_PJUS, cotacao: null, passos: f.passos }),
    ).rejects.toThrow(
      'A anotação está no card, mas a etiqueta "Enviado PJus" não entrou: Kommo recusou a etiqueta (HTTP 400). ' +
        'Confirme de novo — a anotação não se repete.',
    )
    expect(f.cotacoesEnviadas).toEqual([null])
  })

  it('"Enviado PJus" com a anotação falhando diz só isso', async () => {
    const f = passosFalsos({ falhaAnotar: 'rede' })
    await expect(
      registrarEnvioAoFundo({ ...base, fundo: 'PJus', ato: ENVIADO_PJUS, cotacao: null, passos: f.passos }),
    ).rejects.toThrow(/^A anotação não subiu para o Kommo: rede$/)
  })
})

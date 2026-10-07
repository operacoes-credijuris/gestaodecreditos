// O envio a um fundo na Remessa aos fundos: a ORDEM das chamadas, a cotação do
// BTG (05/10/2026) e o que se diz em cada falha. Ver lib/envioAoFundo.ts.

import { describe, it, expect } from 'vitest'
import { registrarEnvioAoFundo, type PassosDoEnvio } from '../envioAoFundo'
import type { AtoDoEnvio } from '../../../supabase/functions/_shared/trilhasDoPrecatorio.ts'
import type { Cotacao } from '../../../supabase/functions/_shared/cotacaoDoFundo.ts'
import {
  atosDaAba,
  desfechoDoFundo,
  fundosFeitos,
  TRILHAS_PRECATORIO,
} from '../../../supabase/functions/_shared/trilhasDoPrecatorio.ts'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ETIQUETAS_DA_PRECIFICACAO } from '../../../supabase/functions/_shared/etiquetasDoFundo.ts'

const remessa = TRILHAS_PRECATORIO.flatMap((t) => t.abas).find((a) => a.envioAosFundos)!.envioAosFundos!
const btg = remessa.fundos.find((f) => f.fundo === 'BTG')!
const pjus = remessa.fundos.find((f) => f.fundo === 'PJus')!
const ato = (f: typeof btg, etiqueta: string): AtoDoEnvio => f.atos.find((a) => a.etiqueta === etiqueta)!

const COTADO_BTG = ato(btg, 'Cotado BTG')
const REPROVADO_BTG = ato(btg, 'Reprovado BTG')
const ENVIADO_PJUS = ato(pjus, 'Enviado PJus')
const ENVIADO_BTG = ato(btg, 'Enviado BTG')

// O SPREAD NO ENVIO, PRESO NUM FUNDO QUE O ACEITA — MUDOU DE PROPÓSITO EM
// 07/10/2026: o BTG não tem spread (a comissão dele é sempre limitada), e os
// testes do spread que usavam o "Cotado BTG" passaram para um ato de mentira da
// PX Ativos. A regra (percentual, base, conta) é a mesma para qualquer fundo.
const COTADO_PX: AtoDoEnvio = { etiqueta: 'Cotado PX Ativos', nota: 'Crédito enviado à PX Ativos.', pedeCotacao: true }

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

  // O VAREJO DO BTG SEM SPREAD (07/10/2026): nem a anotação sobe.
  it('no BTG, spread é recusado antes de qualquer chamada — a comissão do BTG é sempre limitada', async () => {
    const f = passosFalsos({ tagsDepois: ['Cotado BTG'] })
    await expect(
      registrarEnvioAoFundo({ ...base, fundo: 'BTG', ato: COTADO_BTG, cotacao: SPREAD, passos: f.passos }),
    ).rejects.toThrow(/O BTG não trabalha com spread.*Nada foi enviado ao Kommo/)
    expect(f.chamadas).toEqual([])
  })

  it('com Spread (num fundo que o aceita), o texto é "final / comissão (Spread de P%)", sobre o líquido; faltando fundos, o card não se move', async () => {
    const f = passosFalsos({ tagsDepois: ['Cotado PX Ativos'] })
    const r = await registrarEnvioAoFundo({ ...base, fundo: 'PX Ativos', ato: COTADO_PX, cotacao: SPREAD, passos: f.passos })
    expect(f.chamadas).toEqual(['anotar', 'etiquetar'])
    expect(f.cotacoesEnviadas).toEqual([SPREAD])
    expect(r).toEqual({
      tags: ['Cotado PX Ativos'],
      cotacao: 'R$ 810.000,00 / R$ 40.000,00 (Spread de 5%)',
      movido: false,
      faltamFundos: true,
    })
  })

  it('a tela nova não manda spread SEM percentual (só a aba antiga o manda, e o servidor ainda o aceita)', async () => {
    const f = passosFalsos({ tagsDepois: ['Cotado BTG'] })
    await expect(
      registrarEnvioAoFundo({
        ...base, fundo: 'PX Ativos', ato: COTADO_PX, cotacao: { propostaCentavos: 100, comissao: { modalidade: 'spread' } }, passos: f.passos,
      }),
    ).rejects.toThrow(/informe o percentual. Nada foi enviado ao Kommo/)
    expect(f.chamadas).toEqual([])
  })

  it('a tela nova não manda spread SEM o valor líquido validado (a aba de 05/10/2026 o manda, e o servidor ainda o aceita)', async () => {
    const f = passosFalsos({ tagsDepois: ['Cotado BTG'] })
    await expect(
      registrarEnvioAoFundo({
        ...base, fundo: 'PX Ativos', ato: COTADO_PX,
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
        ...base, fundo: 'PX Ativos', ato: COTADO_PX,
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

/**
 * AS ABAS DO ENVIO AO BTG (07/10/2026): VAREJO, a plataforma do banco, que cota
 * na hora ("Cotado BTG", com a cotação); ATACADO, acima de uns R$ 10 milhões,
 * mandado por e-mail ("Enviado BTG", sem cotação, como o "Enviado PJus"). A
 * reprovação vale nas duas, à esquerda do rodapé.
 */
describe('as abas do envio ao BTG', () => {
  const nomes = (atos: AtoDoEnvio[]) => atos.map((a) => a.etiqueta)

  it('Varejo (a que abre) e Atacado, com a explicação do atacado', () => {
    expect(btg.abas?.map((a) => [a.key, a.rotulo])).toEqual([
      ['varejo', 'Varejo'],
      ['atacado', 'Atacado'],
    ])
    expect(btg.abas?.[0].explicacao).toBeUndefined()
    expect(btg.abas?.[1].explicacao).toBe(
      'Crédito de atacado: o BTG analisa fora da plataforma e responde depois (por e-mail).',
    )
  })

  it('no Varejo, o botão é "Cotado BTG" (pede a cotação); no Atacado, "Enviado BTG" (não pede)', () => {
    const varejo = atosDaAba(btg, 'varejo')
    const atacado = atosDaAba(btg, 'atacado')
    // À DIREITA DO RODAPÉ, o ato da aba; À ESQUERDA, a reprovação, nas duas.
    expect(nomes(varejo.filter((a) => !a.reprova))).toEqual(['Cotado BTG'])
    expect(nomes(atacado.filter((a) => !a.reprova))).toEqual(['Enviado BTG'])
    expect(nomes(varejo.filter((a) => a.reprova))).toEqual(['Reprovado BTG'])
    expect(nomes(atacado.filter((a) => a.reprova))).toEqual(['Reprovado BTG'])
    expect(varejo.some((a) => a.pedeCotacao)).toBe(true)
    expect(atacado.some((a) => a.pedeCotacao)).toBe(false)
  })

  it('todo ato com aba aponta para uma aba do fundo, e o "Enviado BTG" é uma etiqueta "Enviado" da casa', () => {
    const chaves = (btg.abas ?? []).map((a) => a.key)
    for (const a of btg.atos) if (a.aba !== undefined) expect(chaves, a.etiqueta).toContain(a.aba)
    expect(ETIQUETAS_DA_PRECIFICACAO.find((e) => e.nome === 'Enviado BTG')?.ato).toBe('Enviado')
  })

  it('fundo sem abas (a PJus) mostra todos os atos, como sempre', () => {
    expect(pjus.abas).toBeUndefined()
    expect(nomes(atosDaAba(pjus, null))).toEqual(['Enviado PJus', 'Reprovado PJus'])
  })

  // A JANELA USA AS ABAS DA TRILHA, e não uma lista própria: os botões saem de
  // `atosDaAba`, as abas do `ui/Tabs`, e a cotação começa das comissões do fundo.
  it('a janela do envio monta as abas e os botões a partir da trilha', () => {
    const tela = readFileSync(
      fileURLToPath(new URL('../../pages/operacional/AnaliseCredito.tsx', import.meta.url)),
      'utf8',
    )
    expect(tela).toContain('const atos = atosDaAba(fundo, aba)')
    expect(tela).toContain('<Tabs')
    expect(tela).toContain('useCotacaoEmEdicao(atual, liquido, fundo.fundo)')
    expect(tela).toContain('rodapeInicio={atos.some((a) => a.reprova)')
  })
})

describe('registrarEnvioAoFundo — o Atacado grava "Enviado BTG" sem cotação', () => {
  it('a cotação digitada no Varejo NÃO vai: só a anotação e a etiqueta, e o card segue com a PJus feita', async () => {
    const f = passosFalsos({ tagsDepois: ['Enviado BTG', 'Enviado PJus'] })
    const andamento: string[] = []
    const r = await registrarEnvioAoFundo({
      ...base,
      todosFeitos: (tags) => fundosFeitos(remessa.fundos, tags),
      fundo: 'BTG',
      ato: ENVIADO_BTG,
      cotacao: LIMITADA,
      passos: f.passos,
      onAndamento: (t) => andamento.push(t),
    })
    expect(f.chamadas).toEqual(['anotar', 'etiquetar', 'mover'])
    expect(f.cotacoesEnviadas).toEqual([null])
    expect(r).toEqual({ tags: ['Enviado BTG', 'Enviado PJus'], cotacao: null, movido: true })
    expect(andamento[0]).toBe('Pondo a etiqueta "Enviado BTG"…')
  })

  it('a nota do atacado diz que foi por e-mail', () => {
    expect(ENVIADO_BTG.nota).toMatch(/atacado.*e-mail/)
    expect(ENVIADO_BTG.pedeCotacao).toBeFalsy()
  })
})

/**
 * O CHECK DO BTG NA REMESSA (07/10/2026): vale com "Cotado BTG" (varejo),
 * "Enviado BTG" (atacado) ou "Reprovado BTG". Com o da PJus, o card vai para Em
 * precificação.
 */
describe('o check da Remessa vale com Enviado ou Cotado', () => {
  it('cada desfecho do BTG faz o check', () => {
    expect(desfechoDoFundo(btg, ['Cotado BTG'])?.etiqueta).toBe('Cotado BTG')
    expect(desfechoDoFundo(btg, ['Enviado BTG'])?.etiqueta).toBe('Enviado BTG')
    expect(desfechoDoFundo(btg, [' enviado  btg '])?.etiqueta).toBe('Enviado BTG')
    expect(desfechoDoFundo(btg, ['Reprovado BTG'])?.etiqueta).toBe('Reprovado BTG')
    expect(desfechoDoFundo(btg, ['Enviado PJus', 'Sem proposta'])).toBeNull()
    expect(desfechoDoFundo(btg, null)).toBeNull()
  })

  it('com os dois fundos feitos, o card segue — com Enviado ou com Cotado no BTG', () => {
    expect(fundosFeitos(remessa.fundos, ['Cotado BTG', 'Enviado PJus'])).toBe(true)
    expect(fundosFeitos(remessa.fundos, ['Enviado BTG', 'Enviado PJus'])).toBe(true)
    expect(fundosFeitos(remessa.fundos, ['Enviado BTG', 'Reprovado PJus'])).toBe(true)
    expect(fundosFeitos(remessa.fundos, ['Enviado BTG'])).toBe(false)
    expect(fundosFeitos(remessa.fundos, ['Enviado PJus'])).toBe(false)
  })
})

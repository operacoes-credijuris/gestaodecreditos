import { describe, it, expect } from 'vitest'
import {
  aplicarDiligenciaNoM2,
  historicoDoCredito,
  textoDosAutos,
  type ApuracaoDD,
  type HistoricoDePapel,
  type ProcessoDD,
} from '../../../supabase/functions/_shared/dueDiligencia.ts'

/**
 * aplicarDiligenciaNoM2 roda em TODAS as ações de gerar-analise-rpv ('analisar',
 * 'documento', 'reprecificar', cada rodada do chat, 'salvar') sobre o m2 que ela
 * mesma escreveu na passada anterior — o objeto `dados` dá a volta pelo
 * navegador e reentra. Por isso o complemento da coluna D tem de ser
 * RECONSTRUÍDO de uma linha de base, e não crescer: antes desta correção a
 * célula saía "Due diligence: B; nos autos: Due diligence: B; nos autos: A",
 * uma camada por ação, e ia assim para a planilha no Drive.
 *
 * A propriedade fixada aqui é a do invariante: f(f(m2)) === f(m2).
 */

const apuracao = (p: Partial<ApuracaoDD> & { id: string; papel: string }): ApuracaoDD => ({
  nome: 'Fulano de Tal',
  status: 'APURADO',
  apurado_em: '2026-09-01T12:00:00Z',
  ...p,
})

const proc = (p: Partial<ProcessoDD> & { historico_id: string; numero_processo: string }): ProcessoDD => ({
  polo: 'PASSIVO',
  ha_cobranca: true,
  ...p,
})

const so = (m2: Record<string, unknown>, linha: string) =>
  m2[linha] as { resposta?: string; complemento?: string }

const B = '0001234-56.2020.8.09.0051'
const A = '0007777-77.2021.8.09.0051'

const ddAchouB = () =>
  historicoDoCredito(
    [apuracao({ id: 'a', papel: 'CEDENTE', nome: 'Maria' })],
    [proc({ historico_id: 'a', numero_processo: B, objeto: 'execução fiscal', estagio: 'penhora' })],
  )

const ddNadaConsta = () => historicoDoCredito([apuracao({ id: 'a', papel: 'CEDENTE', nome: 'Maria' })], [])

const contar = (texto: string | undefined, trecho: string) => (texto ?? '').split(trecho).length - 1

/** Simula a viagem do `dados` pelo navegador: cada ação reaplica sobre o m2 anterior. */
function passadas(m2: Record<string, unknown>, hs: HistoricoDePapel[], travadas: string[], vezes: number) {
  const saidas: ReturnType<typeof aplicarDiligenciaNoM2>[] = []
  let atual = m2
  for (let i = 0; i < vezes; i++) {
    const r = aplicarDiligenciaNoM2(atual, hs, travadas)
    saidas.push(r)
    atual = r.m2
  }
  return saidas
}

describe('aplicar a diligência de novo sobre o próprio resultado não muda nada', () => {
  it('diligência achou B e a IA citou A nos autos: a segunda passada é igual à primeira', () => {
    const m2 = { '10': { resposta: 'Sim', complemento: `penhora noticiada — ${A}` } }
    const [p1, p2] = passadas(m2, ddAchouB(), [], 2)
    expect(p2.m2).toEqual(p1.m2)
    expect(p2.notas).toEqual(p1.notas)
    const c = so(p1.m2, '10').complemento
    expect(c).toBe(`Due diligence: ${B} (execução fiscal — penhora); nos autos: penhora noticiada — ${A}`)
    expect(contar(so(p2.m2, '10').complemento, 'Due diligence:')).toBe(1)
    expect(contar(so(p2.m2, '10').complemento, 'nos autos:')).toBe(1)
  })

  it('diligência não achou nada e a IA disse "Sim" com texto: "nos autos:" aparece uma vez só', () => {
    const m2 = { '10': { resposta: 'Sim', complemento: 'penhora no rosto dos autos' } }
    const [p1, p2] = passadas(m2, ddNadaConsta(), [], 2)
    expect(p2.m2).toEqual(p1.m2)
    expect(p2.notas).toEqual(p1.notas)
    expect(so(p1.m2, '10')).toEqual({ resposta: 'Sim', complemento: 'nos autos: penhora no rosto dos autos' })
  })

  it('linha travada em "Não" pelo chat com dívida apurada: o marcador de conflito não se duplica', () => {
    const m2 = { '10': { resposta: 'Não', complemento: '' } }
    const [p1, p2] = passadas(m2, ddAchouB(), ['10'], 2)
    expect(p2.m2).toEqual(p1.m2)
    expect(p2.notas).toEqual(p1.notas)
    expect(so(p2.m2, '10').resposta).toBe('Não')
    expect(contar(so(p2.m2, '10').complemento, 'A DUE DILIGENCE ENCONTROU DÍVIDA')).toBe(1)
    expect(so(p2.m2, '10').complemento).toContain(B)
  })

  it('linha travada em "Não" com a IA citando A: o conflito e o "nos autos" saem uma vez cada', () => {
    const m2 = { '10': { resposta: 'Não', complemento: `execução noticiada — ${A}` } }
    const [p1, p2] = passadas(m2, ddAchouB(), ['10'], 2)
    expect(p2.m2).toEqual(p1.m2)
    const c = so(p2.m2, '10').complemento
    expect(contar(c, 'A DUE DILIGENCE ENCONTROU DÍVIDA')).toBe(1)
    expect(contar(c, 'nos autos:')).toBe(1)
    expect(c).toContain(A)
    expect(c).toContain(B)
  })

  it("'analisar' → 'reprecificar' → 'salvar' (três passadas) dá o mesmo que uma", () => {
    const m2 = { '10': { resposta: 'Sim', complemento: A }, '11': { resposta: 'Não', complemento: '' } }
    const hs = historicoDoCredito(
      [apuracao({ id: 'a', papel: 'CEDENTE' }), apuracao({ id: 'b', papel: 'ADVOGADO' })],
      [proc({ historico_id: 'a', numero_processo: B })],
    )
    const [p1, , p3] = passadas(m2, hs, [], 3)
    expect(p3.m2).toEqual(p1.m2)
    expect(p3.notas).toEqual(p1.notas)
    expect(p3.escritas).toEqual(p1.escritas)
  })

  it('o caso comum (IA sem texto, diligência achou) continua igual ao de sempre', () => {
    const m2 = { '10': { resposta: 'Não' } }
    const [p1, p2] = passadas(m2, ddAchouB(), [], 2)
    expect(p2.m2).toEqual(p1.m2)
    expect(so(p1.m2, '10')).toEqual({ resposta: 'Sim', complemento: `Due diligence: ${B} (execução fiscal — penhora)` })
  })
})

describe('textoDosAutos devolve só o que a IA escreveu', () => {
  it('texto cru da IA volta inteiro', () => {
    expect(textoDosAutos(`penhora — ${A}`)).toBe(`penhora — ${A}`)
    expect(textoDosAutos('')).toBe('')
    expect(textoDosAutos(undefined)).toBe('')
  })

  it('a parte da diligência é descartada — ela é reescrita da fonte a cada passada', () => {
    expect(textoDosAutos(`Due diligence: ${B}`)).toBe('')
    expect(textoDosAutos(`Due diligence: ${B}; nos autos: penhora — ${A}`)).toBe(`penhora — ${A}`)
    expect(
      textoDosAutos(`⚠️ A DUE DILIGENCE ENCONTROU DÍVIDA (resposta "Não" mantida a pedido de quem revisou) — ${B}`),
    ).toBe('')
    expect(
      textoDosAutos(
        `⚠️ A DUE DILIGENCE ENCONTROU DÍVIDA (resposta "Não" mantida a pedido de quem revisou) — ${B}; nos autos: ${A}`,
      ),
    ).toBe(A)
  })

  it('"nos autos:" sozinho volta ao texto de dentro', () => {
    expect(textoDosAutos('nos autos: penhora no rosto dos autos')).toBe('penhora no rosto dos autos')
  })

  it('a diligência que mudou entre passadas não deixa rastro: a célula segue a apuração nova', () => {
    // Passada 1 com B; a apuração é refeita e agora só acha C. O B antigo não
    // pode sobreviver na coluna D como se a IA o tivesse lido nos autos.
    const m2 = { '10': { resposta: 'Sim', complemento: A } }
    const p1 = aplicarDiligenciaNoM2(m2, ddAchouB())
    const C = '0009999-99.2022.8.09.0051'
    const hsNovo = historicoDoCredito(
      [apuracao({ id: 'a', papel: 'CEDENTE' })],
      [proc({ historico_id: 'a', numero_processo: C })],
    )
    const p2 = aplicarDiligenciaNoM2(p1.m2, hsNovo)
    expect(so(p2.m2, '10').complemento).toBe(`Due diligence: ${C}; nos autos: ${A}`)
  })
})

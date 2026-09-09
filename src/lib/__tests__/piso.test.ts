import { describe, it, expect } from 'vitest'
import { avaliarPiso, PISO_NEGOCIO } from '../../../supabase/functions/_shared/piso.ts'
import {
  aplicarAuditoria,
  montarParcelas,
} from '../../../supabase/functions/_shared/precificacao.ts'

/**
 * O PISO DO NEGÓCIO, e os quatro desfechos dele.
 *
 * A decisão morava dentro da Edge Function e não tinha uma asserção — sendo que
 * cada desfecho muda o que quem está com o card aberto pode fazer em seguida:
 * reprovar cedo fecha a janela, recusar o salvar mantém a análise viva com a
 * oferta de liberar, liberar deixa registro no aviso, e só avisar não interrompe
 * a conversa do chat.
 */
const brl = (n: number) =>
  n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const base = {
  tudoSomado: 27_000,
  tipoCredito: 'Crédito principal — apenas',
  liberado: false,
  brl,
}

describe('avaliarPiso', () => {
  it('no mínimo ou acima, passa sem dizer nada', () => {
    expect(avaliarPiso({ ...base, negociado: PISO_NEGOCIO, acao: 'salvar' })).toEqual({ desfecho: 'ok' })
    expect(avaliarPiso({ ...base, negociado: 50_000, acao: 'analisar' })).toEqual({ desfecho: 'ok' })
  })

  // SEM VALOR NÃO É ABAIXO DO PISO: é outro problema, e quem cuida dele é a
  // guarda de "sem verba nenhuma". Tratar como piso daria a mensagem errada.
  it('valor zero ou negativo não é caso de piso', () => {
    expect(avaliarPiso({ ...base, negociado: 0, acao: 'salvar' })).toEqual({ desfecho: 'ok' })
    expect(avaliarPiso({ ...base, negociado: -1, acao: 'salvar' })).toEqual({ desfecho: 'ok' })
    expect(avaliarPiso({ ...base, negociado: NaN, acao: 'salvar' })).toEqual({ desfecho: 'ok' })
  })

  // REPROVA CEDO SÓ QUANDO NÃO HÁ SAÍDA: nenhuma troca de cenário salva um
  // crédito cujo total, comprando tudo, não alcança o mínimo — e a leitura do
  // documento custaria uma chamada de IA por nada.
  it('nem somando tudo alcança: reprova na primeira leitura', () => {
    const r = avaliarPiso({ ...base, negociado: 15_000, tudoSomado: 17_000, acao: 'analisar' })
    expect(r.desfecho).toBe('reprovado')
    expect(r.desfecho === 'ok' ? '' : r.motivo).toMatch(/Nem somando todas as verbas/)
  })

  // SOMANDO TUDO ALCANÇA: a análise SEGUE, para o seletor de cenário existir na
  // tela. Era aqui o beco sem saída — o motivo dizia "troque o cenário aqui na
  // janela" numa tela que não tinha seletor, e a única saída era corrigir no
  // Kommo e reler os autos.
  it('somando tudo alcança: segue com aviso, mesmo em analisar', () => {
    const r = avaliarPiso({ ...base, negociado: 15_000, tudoSomado: 27_000, acao: 'analisar' })
    expect(r.desfecho).toBe('aviso')
    expect(r.desfecho === 'ok' ? '' : r.motivo).toMatch(/Somando TODAS as verbas/)
    expect(r.desfecho === 'ok' ? '' : r.motivo).toMatch(/troque o cenário aqui na janela/)
  })

  it('salvar sem liberação é erro: a planilha não sai', () => {
    const r = avaliarPiso({ ...base, negociado: 15_000, acao: 'salvar' })
    expect(r.desfecho).toBe('erro')
  })

  // LIBERADO À MÃO: a barreira é da CASA, não da lei, e quem analisa vê o que a
  // regra não vê. O que não pode é passar em silêncio.
  it('salvar com liberação segue, e marca que foi liberado', () => {
    const r = avaliarPiso({ ...base, negociado: 15_000, acao: 'salvar', liberado: true })
    expect(r.desfecho).toBe('aviso')
    expect(r.desfecho === 'aviso' && r.liberado).toBe(true)
  })

  // A LIBERAÇÃO É POR CHAMADA. Em 'refinar' e 'reprecificar' ela não se aplica:
  // essas ações não geram documento, e derrubar o que está na tela no meio de
  // uma conversa seria pior que avisar.
  it('refinar e reprecificar só avisam, e não contam como liberação', () => {
    for (const acao of ['refinar', 'reprecificar']) {
      const r = avaliarPiso({ ...base, negociado: 15_000, acao, liberado: true })
      expect(r.desfecho).toBe('aviso')
      expect(r.desfecho === 'aviso' && r.liberado).toBe(false)
    }
  })

  // A RÉGUA É O LÍQUIDO DOS AUTOS, NÃO O DEPOIS DA AUDITORIA.
  //
  // A versão anterior media o Y3 da calibragem, que é o líquido JÁ REDUZIDO ao
  // cenário conservador — e aí o mínimo da casa barrava crédito por causa de uma
  // conclusão NOSSA. Um crédito de R$ 22 mil nos autos que a auditoria estima em
  // R$ 17 mil não é um crédito abaixo do mínimo: é um crédito acima do mínimo com
  // uma divergência apontada, e quem analisa pode não concordar com o corte.
  //
  // Este teste monta os dois números com as funções de verdade e fixa a regra: o
  // dos autos decide se o negócio pode existir; o reduzido decide o preço.
  describe('a régua é o líquido dos autos', () => {
    const VERBAS = { principal: true, contratuais: false, sucumbenciais: false }
    const AUTOS = {
      brutoTotal: 26_000, ir: 3_000, inss: 0, contratuaisBrutos: 0, sucumbenciaisBrutos: 0,
    }
    const liquido = (v: typeof AUTOS) =>
      montarParcelas({ ...v, verbas: VERBAS }).reduce((s, p) => s + p.liquido, 0)

    it('os autos acima do mínimo passam, mesmo com a auditoria derrubando', () => {
      const dosAutos = liquido(AUTOS)
      // A auditoria estima o bruto conservador em R$ 18 mil: o líquido cai abaixo.
      const auditado = liquido(aplicarAuditoria(AUTOS, 18_000).valores)
      expect(dosAutos).toBeGreaterThan(PISO_NEGOCIO)
      expect(auditado).toBeLessThan(PISO_NEGOCIO)
      // A régua olha os autos: passa.
      expect(avaliarPiso({ ...base, negociado: dosAutos, acao: 'salvar' }).desfecho).toBe('ok')
      // E fica registrado o que a régua antiga fazia: barrava o salvar.
      expect(avaliarPiso({ ...base, negociado: auditado, acao: 'salvar' }).desfecho).toBe('erro')
    })

    it('os autos abaixo do mínimo continuam barrando', () => {
      const magro = { ...AUTOS, brutoTotal: 19_000 }
      expect(liquido(magro)).toBeLessThan(PISO_NEGOCIO)
      expect(avaliarPiso({
        ...base, negociado: liquido(magro), tudoSomado: liquido(magro), acao: 'analisar',
      }).desfecho).toBe('reprovado')
    })

    it('auditoria sem corte não muda a régua', () => {
      const semCorte = aplicarAuditoria(AUTOS, null)
      expect(semCorte.aplicada).toBe(false)
      expect(liquido(semCorte.valores)).toBe(liquido(AUTOS))
    })
  })

  it('a mensagem cita o que está sendo comprado', () => {
    const r = avaliarPiso({
      ...base, negociado: 15_000, acao: 'salvar', tipoCredito: 'Honorários sucumbenciais — apenas',
    })
    expect(r.desfecho === 'ok' ? '' : r.motivo).toContain('Honorários sucumbenciais — apenas')
  })

  it('sem rótulo, a mensagem não sai truncada', () => {
    const r = avaliarPiso({ ...base, negociado: 15_000, acao: 'salvar', tipoCredito: null })
    expect(r.desfecho === 'ok' ? '' : r.motivo).toContain('verbas do negócio')
  })
})

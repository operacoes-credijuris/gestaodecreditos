import { describe, it, expect } from 'vitest'
import {
  assinarNota,
  ehNotaNossa,
  MARCA_NOTA,
} from '../../../supabase/functions/_shared/notaCredijuris.ts'

/**
 * A marca que separa a nota do sistema da nota escrita por gente.
 *
 * Testada porque ela sustenta sozinha uma regra que já quebrou em produção: a
 * anotação da análise voltou a ser `common` — o único tipo em que o feed do
 * Kommo preserva as quebras de linha — e é só esta marca que impede o sync de
 * trazê-la de volta como se fosse cadastro do comercial. Falhando aqui, a
 * análise volta a ler o próprio resultado e a confirmar a si mesma.
 */
describe('notaCredijuris', () => {
  it('assina no fim, separada por linha em branco', () => {
    expect(assinarNota('Crédito Reprovado')).toBe(`Crédito Reprovado\n\n${MARCA_NOTA}`)
  })

  it('reconhece o que assinou', () => {
    expect(ehNotaNossa(assinarNota('qualquer coisa'))).toBe(true)
  })

  // IDEMPOTENTE: o mesmo texto passa por aqui mais de uma vez — análise
  // reescrita, texto que já vinha assinado de outra ação — e duas assinaturas
  // no rodapé denunciam o remendo em vez do registro.
  it('não assina duas vezes', () => {
    const uma = assinarNota('Crédito Reprovado')
    expect(assinarNota(uma)).toBe(uma)
  })

  it('não assina texto vazio, que nem vira nota', () => {
    expect(assinarNota('   ')).toBe('')
    expect(assinarNota('')).toBe('')
  })

  // O QUE O COMERCIAL ESCREVE TEM DE PASSAR. Um falso positivo aqui apaga do
  // espelho a anotação de uma pessoa, e a análise seguinte deixa de ler o que
  // ela avisou sobre o crédito.
  it('não confunde nota de gente com a nossa', () => {
    expect(ehNotaNossa('Cliente ligou. Crédito da Credijuris, análise pendente.')).toBe(false)
    expect(ehNotaNossa('mandei a análise automática pro cedente')).toBe(false)
    expect(ehNotaNossa('')).toBe(false)
    expect(ehNotaNossa(null)).toBe(false)
    expect(ehNotaNossa(undefined)).toBe(false)
  })

  // A marca sobrevive a quem edita a nota no Kommo e apaga o travessão, ou a
  // um cliente que o troque por hífen: o reconhecimento não depende dele.
  it('reconhece mesmo sem o travessão do começo', () => {
    expect(ehNotaNossa('Texto.\n\nCredijuris · nota automática da análise')).toBe(true)
    expect(ehNotaNossa('Texto.\n\n- Credijuris · nota automática da análise')).toBe(true)
  })
})

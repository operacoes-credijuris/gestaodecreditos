import { describe, it, expect } from 'vitest'
import {
  assinarNota,
  ehNotaNossa,
  MARCA_NOTA,
} from '../../../supabase/functions/_shared/notaCredijuris.ts'
import { anotacoesDaAnalise, resumoDaOportunidade } from '../anotacaoKommo.ts'

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

  // AS NOTAS DE ANTES DA MARCA (13/08 a 07/09 de 2026) continuam no feed dos
  // cards que ainda estão em análise, e o espelho as traria de volta como
  // cadastro do comercial. Os textos abaixo saem das MESMAS funções que os
  // escreveram — se a forma mudar, o teste muda com ela.
  it('reconhece a ficha antiga, sem marca nenhuma', () => {
    const [ficha] = anotacoesDaAnalise({
      ficha: { tipo: 'RPV', processo: '5001234-56.2026.8.09.0051', parcela_cedida: 'Principal' },
    })
    expect(ficha).not.toContain(MARCA_NOTA)
    expect(ehNotaNossa(ficha)).toBe(true)
  })

  it('reconhece o veredito antigo, aprovado e recusado', () => {
    const [, aprovado] = anotacoesDaAnalise({ ficha: { tipo: 'RPV' }, link: 'https://drive/x' })
    expect(ehNotaNossa(aprovado)).toBe(true)
    const [recusado] = anotacoesDaAnalise({ reprovado: true, motivo: 'sem valor nos autos' })
    expect(ehNotaNossa(recusado)).toBe(true)
    const [, concluida] = anotacoesDaAnalise({
      ficha: { tipo: 'RPV' },
      veredito: '✅ ANÁLISE JURÍDICA CONCLUÍDA.',
    })
    expect(ehNotaNossa(concluida)).toBe(true)
  })

  it('reconhece o resumo antigo da oportunidade', () => {
    const r = resumoDaOportunidade({ ficha: { tipo: 'RPV', cedente: 'Fulano' }, link: 'https://drive/y' })
    expect(ehNotaNossa(r)).toBe(true)
  })

  // UM RÓTULO SÓ É COISA QUE GENTE ESCREVE. Exigir dois é o que separa a
  // ficha do sistema do bilhete de um colega que copiou o número do processo.
  it('um rótulo isolado continua sendo nota de gente', () => {
    expect(ehNotaNossa('PROCESSO: 5001234-56.2026.8.09.0051 — cedente vem amanhã')).toBe(false)
    expect(ehNotaNossa('Tipo: RPV\nProcesso: 5001234-56')).toBe(false)
  })

  // E A MARCA CONTINUA SENDO POSTA nas notas novas: assinarNota olha a
  // assinatura, não o reconhecimento largo, senão uma nota nova no formato de
  // sempre sairia sem marca — e o legado voltaria a se criar sozinho.
  it('assina a nota nova mesmo quando a forma é a legada', () => {
    const [ficha] = anotacoesDaAnalise({ ficha: { tipo: 'RPV', processo: '5001234-56' } })
    expect(assinarNota(ficha)).toBe(`${ficha}\n\n${MARCA_NOTA}`)
  })
})

import { describe, it, expect } from 'vitest'
import {
  alvosDaCessao,
  lacunasDaLeitura,
  normalizarTitulares,
  verbasQueSobram,
  type TitularLido,
} from '../../../supabase/functions/_shared/titularesDaCessao.ts'
import { classificarParcelaCedida } from '../kommo'

/**
 * DE QUEM É A PARCELA QUE ESTAMOS COMPRANDO.
 *
 * A diligência custa consulta paga por titular, e apurar o titular errado é pior
 * que não apurar: produz um "nada consta" sobre quem não é parte do negócio, e
 * ele se lê na planilha como diligência feita.
 *
 * A régua é do direito, não do texto dos autos: o principal é do exequente, os
 * honorários são do advogado. Numa cessão só de honorários quem cede é o próprio
 * advogado — e é aí que confundir cedente com exequente faz a linha 10 do
 * questionário falar de uma pessoa e a 11 de outra, quando as duas falam da mesma.
 */
describe('alvosDaCessao', () => {
  it('só o principal: apura o exequente, e não o advogado', () => {
    const a = alvosDaCessao('principal')
    expect(a.papeis).toEqual(['CEDENTE'])
    expect(a.cedenteEhOAdvogado).toBe(false)
  })

  // AS TRÊS FORMAS DE CEDER HONORÁRIO levam ao mesmo titular. E em todas quem
  // vende é o advogado: o "cedente" do título do card é ele.
  it('honorários, em qualquer forma: apura o advogado, que é quem cede', () => {
    for (const p of ['contratuais', 'sucumbenciais', 'honorarios'] as const) {
      const a = alvosDaCessao(p)
      expect(a.papeis, p).toEqual(['ADVOGADO'])
      expect(a.cedenteEhOAdvogado, p).toBe(true)
    }
  })

  it('principal e honorários: dois titulares', () => {
    const a = alvosDaCessao('ambos')
    expect(a.papeis).toEqual(['CEDENTE', 'ADVOGADO'])
    expect(a.cedenteEhOAdvogado).toBe(false)
  })

  // NA DÚVIDA, OS DOIS. Deixar um titular de fora é deixar de apurar quem talvez
  // responda pelo crédito; apurar a mais custa uma consulta.
  it('parcela indefinida ou ausente cobre os dois', () => {
    for (const p of ['indefinido', 'auto', '', 'qualquer coisa nova']) {
      expect(alvosDaCessao(p).papeis, p).toEqual(['CEDENTE', 'ADVOGADO'])
    }
  })

  it('toda parcela diz em uma frase por que apura quem apura', () => {
    for (const p of ['principal', 'ambos', 'honorarios', 'contratuais', 'sucumbenciais', 'auto'] as const) {
      expect(alvosDaCessao(p).porque.length, p).toBeGreaterThan(30)
      expect(alvosDaCessao(p).verbas, p).toBeTruthy()
    }
  })

  // O VOCABULÁRIO É UM SÓ. Quem classifica o texto do título é
  // `classificarParcelaCedida`; se ela passar a devolver um rótulo que este
  // módulo não conhece, a apuração cai no ramo genérico em silêncio.
  it('fala a mesma língua que a leitura do título do card', () => {
    const casos: Record<string, string[]> = {
      principal: ['Crédito Principal', 'principal'],
      ambos: ['Principal + honorários'],
      honorarios: ['contratuais e sucumbenciais'],
      sucumbenciais: ['Honorários sucumbenciais'],
      contratuais: ['Honorários contratuais'],
      indefinido: ['Honorários'],
      auto: [''],
    }
    for (const [esperado, textos] of Object.entries(casos)) {
      for (const t of textos) {
        expect(classificarParcelaCedida(t), t).toBe(esperado)
        // E o rótulo tem de ser um dos que alvosDaCessao trata por nome — o
        // ramo genérico existe para o desconhecido, não para o previsto.
        expect(alvosDaCessao(classificarParcelaCedida(t)).papeis.length, t).toBeGreaterThan(0)
      }
    }
  })
})

describe('normalizarTitulares', () => {
  const um = (o: Record<string, unknown>) => normalizarTitulares([o])[0]

  it('lê o que a IA devolveu no formato do cadastro', () => {
    expect(
      um({
        papel: 'cedente',
        nome: '  Maria  das   Dores Silva ',
        documento: '123.456.789-00',
        tipo_pessoa: 'PF',
        evidencia: 'Requerente: MARIA DAS DORES SILVA, CPF 123.456.789-00',
      }),
    ).toEqual({
      papel: 'CEDENTE',
      nome: 'Maria das Dores Silva',
      documento: '12345678900',
      oab: '',
      tipoPessoa: 'PF',
      evidencia: 'Requerente: MARIA DAS DORES SILVA, CPF 123.456.789-00',
    })
  })

  // DOCUMENTO INVENTADO É O PIOR DEFEITO POSSÍVEL AQUI: manda a diligência
  // procurar dívida de outra pessoa, e a consulta é cobrada igual. Um CPF que
  // não tem onze dígitos não é um CPF.
  it('documento com tamanho errado vira vazio, e o nome sobrevive', () => {
    const t = um({ papel: 'CEDENTE', nome: 'Fulano', documento: '123456' })
    expect(t.documento).toBe('')
    expect(t.nome).toBe('Fulano')
  })

  it('CNPJ é reconhecido e marca a pessoa como jurídica', () => {
    const t = um({ papel: 'CEDENTE', nome: 'Construtora X', documento: '12.345.678/0001-95' })
    expect(t).toMatchObject({ documento: '12345678000195', tipoPessoa: 'PJ' })
  })

  it('a OAB só existe no advogado', () => {
    expect(um({ papel: 'CEDENTE', nome: 'Fulano', oab: 'GO 12345' }).oab).toBe('')
    expect(um({ papel: 'ADVOGADO', nome: 'Dra. Beltrana', oab: 'go 12345' }).oab).toBe('GO 12345')
  })

  it('papel que não existe no cadastro não entra', () => {
    expect(normalizarTitulares([{ papel: 'PERITO', nome: 'Fulano', documento: '12345678900' }]))
      .toEqual([])
    expect(normalizarTitulares([{ papel: 'CONJUGE', nome: 'Fulana' }])).toEqual([])
  })

  it('linha sem nome, sem documento e sem OAB é descartada', () => {
    expect(normalizarTitulares([{ papel: 'ADVOGADO', nome: '', documento: '', oab: '' }]))
      .toEqual([])
  })

  // Um papel, um titular: quem cede é UM, e apurar o escritório inteiro
  // multiplicaria a conta da API por gente que não é parte do negócio.
  it('não repete o mesmo titular', () => {
    const lista = normalizarTitulares([
      { papel: 'ADVOGADO', nome: 'Dra. Beltrana', documento: '12345678900' },
      { papel: 'ADVOGADO', nome: 'BELTRANA', documento: '12345678900' },
    ])
    expect(lista).toHaveLength(1)
  })

  it('entrada que não é lista não quebra', () => {
    for (const v of [null, undefined, 'texto', 42, {}]) expect(normalizarTitulares(v)).toEqual([])
  })
})

describe('lacunasDaLeitura', () => {
  const advogado: TitularLido = {
    papel: 'ADVOGADO',
    nome: 'Dra. Beltrana',
    documento: '',
    oab: 'GO 12345',
    tipoPessoa: 'PF',
    evidencia: '',
  }

  // A LACUNA PRECISA APARECER: sem o aviso, a leitura que custou tempo e tokens
  // devolve campo vazio e parece não ter feito nada.
  it('titular não encontrado é dito', () => {
    const avisos = lacunasDaLeitura(alvosDaCessao('ambos'), [advogado])
    expect(avisos.join(' ')).toMatch(/titular do cedente/)
  })

  it('nome sem documento avisa do homônimo', () => {
    const avisos = lacunasDaLeitura(alvosDaCessao('principal'), [
      { ...advogado, papel: 'CEDENTE', nome: 'Fulano', oab: '' },
    ])
    expect(avisos.join(' ')).toMatch(/homônimo/)
  })

  // A OAB BASTA PARA O ADVOGADO: é dela que o Escavador devolve o CPF dele.
  it('advogado com OAB e sem CPF não é lacuna', () => {
    expect(lacunasDaLeitura(alvosDaCessao('contratuais'), [advogado])).toEqual([])
  })

  it('advogado sem OAB e sem CPF é lacuna, e diz por quê', () => {
    const avisos = lacunasDaLeitura(alvosDaCessao('contratuais'), [{ ...advogado, oab: '' }])
    expect(avisos.join(' ')).toMatch(/Sem CPF nem OAB/)
  })

  it('tudo encontrado, nenhum aviso', () => {
    const avisos = lacunasDaLeitura(alvosDaCessao('ambos'), [
      advogado,
      { papel: 'CEDENTE', nome: 'Fulano', documento: '12345678900', oab: '', tipoPessoa: 'PF', evidencia: '' },
    ])
    expect(avisos).toEqual([])
  })
})

describe('verbasQueSobram', () => {
  /**
   * A RECUSA É DO TITULAR, NÃO DO CARD.
   *
   * O card cede até duas coisas com donos diferentes: o principal, do exequente,
   * e os honorários, do advogado. São créditos distintos — o honorário destacado
   * (art. 22, §4º da Lei 8.906/94) não responde pelas dívidas do exequente, e a
   * penhora contra ele não o alcança. Reprovar o card inteiro quando só um
   * titular tem dívida joga fora um negócio bom por causa de outro ruim que só
   * divide o número do processo com ele.
   */
  it('sem recusa, sobra tudo', () => {
    const r = verbasQueSobram('ambos', [])
    expect(r).toMatchObject({ parcela: 'ambos', tudoRecusado: false, recusada: '' })
  })

  it('recusado o cedente, sobram os honorários', () => {
    const r = verbasQueSobram('ambos', ['CEDENTE'])
    expect(r.parcela).toBe('honorarios')
    expect(r.tudoRecusado).toBe(false)
    expect(r.tituloDaRecusa).toBe('Crédito Principal Recusado')
  })

  it('recusado o advogado, sobra o principal', () => {
    const r = verbasQueSobram('ambos', ['ADVOGADO'])
    expect(r.parcela).toBe('principal')
    expect(r.tudoRecusado).toBe(false)
    expect(r.tituloDaRecusa).toBe('Créditos de Honorários Recusados')
  })

  it('recusados os dois, não sobra nada', () => {
    const r = verbasQueSobram('ambos', ['CEDENTE', 'ADVOGADO'])
    expect(r.parcela).toBeNull()
    expect(r.tudoRecusado).toBe(true)
  })

  // CESSÃO DE UMA VERBA SÓ: recusar o titular dela é recusar a cessão. Não há
  // segundo crédito escondido — o outro titular nem entrou no negócio.
  it('cessão só do principal: recusar o cedente recusa tudo', () => {
    const r = verbasQueSobram('principal', ['CEDENTE'])
    expect(r.tudoRecusado).toBe(true)
    expect(r.tituloDaRecusa).toBe('Crédito Principal Recusado')
  })

  it('cessão só de honorários: recusar o advogado recusa tudo', () => {
    for (const p of ['honorarios', 'contratuais', 'sucumbenciais'] as const) {
      expect(verbasQueSobram(p, ['ADVOGADO']).tudoRecusado, p).toBe(true)
    }
  })

  // NA DÚVIDA NÃO SOBRA NADA. Card cuja parcela o título não declara tem os dois
  // titulares apurados; recusado um deles, não dá para afirmar que o outro tem
  // crédito próprio ali — deixar seguir seria analisar verba que talvez não exista.
  it('parcela não declarada: recusar um titular para a cessão', () => {
    for (const p of ['auto', 'indefinido'] as const) {
      expect(verbasQueSobram(p, ['CEDENTE']).tudoRecusado, p).toBe(true)
    }
  })

  it('toda recusa nomeia a verba que caiu e o título da anotação', () => {
    for (const papeis of [['CEDENTE'], ['ADVOGADO'], ['CEDENTE', 'ADVOGADO']] as const) {
      const r = verbasQueSobram('ambos', [...papeis])
      expect(r.recusada.length, papeis.join('+')).toBeGreaterThan(5)
      expect(r.tituloDaRecusa.length, papeis.join('+')).toBeGreaterThan(5)
    }
  })
})

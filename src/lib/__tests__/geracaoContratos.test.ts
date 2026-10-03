import { describe, it, expect } from 'vitest'
import { faltaParaGerar, nomeDaPeca, nomeDaVariavel, PECAS_DO_CONTRATO } from '../geracaoContratos'

/**
 * A Geração de contratos na tela (onda 2): o resumo do que falta e os nomes em
 * português. A tradução é só de tela — a função continua recebendo as chaves.
 */

describe('faltaParaGerar — o mesmo critério do botão', () => {
  const pronto = {
    investidor: 'Maria da Silva',
    originador: 'Credijuris',
    numeroProcesso: '0000001-00.2024.5.05.0001',
    automatico: true,
    pecas: new Set<string>(),
  }

  it('tudo preenchido no automático: nada falta', () => {
    expect(faltaParaGerar(pronto)).toEqual([])
  })

  it('formulário vazio: investidor, originador e processo, nessa ordem', () => {
    expect(faltaParaGerar({ ...pronto, investidor: '', originador: '', numeroProcesso: '' })).toEqual([
      'investidor',
      'originador',
      'número do processo',
    ])
  })

  it('número só com espaço conta como vazio', () => {
    expect(faltaParaGerar({ ...pronto, numeroProcesso: '   ' })).toEqual(['número do processo'])
  })

  it('escolha à mão sem peça: falta ao menos uma peça', () => {
    // A função lê lista vazia como "automático": deixar ir geraria o contrário do pedido.
    expect(faltaParaGerar({ ...pronto, automatico: false })).toEqual(['ao menos uma peça'])
  })

  it('escolha à mão com peça marcada: nada falta', () => {
    expect(faltaParaGerar({ ...pronto, automatico: false, pecas: new Set(['procuracao']) })).toEqual([])
  })
})

describe('nomeDaPeca', () => {
  it('as cinco peças em português', () => {
    expect(PECAS_DO_CONTRATO.map(nomeDaPeca)).toEqual([
      'Cessão de crédito',
      'Cessão de honorários contratuais',
      'Cessão de honorários sucumbenciais',
      'Intermediação',
      'Procuração',
    ])
  })
  it('chave desconhecida sai como veio', () => {
    expect(nomeDaPeca('peca_nova')).toBe('peca_nova')
  })
})

describe('nomeDaVariavel', () => {
  it('as variáveis fixas da função', () => {
    expect(nomeDaVariavel('VALOR_CESSAO')).toBe('valor da cessão')
    expect(nomeDaVariavel('INVESTIDOR_CPF')).toBe('CPF/CNPJ do investidor')
    expect(nomeDaVariavel('I_QL')).toBe('qualificação do investidor')
  })

  it('variável de modelo pelo prefixo: de quem é, e as palavras da chave', () => {
    expect(nomeDaVariavel('CEDENTE_NACIONALIDADE')).toBe('nacionalidade do cedente')
    expect(nomeDaVariavel('CEDENTE_ESTADO_CIVIL')).toBe('estado civil do cedente')
    expect(nomeDaVariavel('CEDENTE_ENDERECO')).toBe('endereço do cedente')
    expect(nomeDaVariavel('INVESTIDOR_PIX')).toBe('Pix do investidor')
  })

  it('o sócio não vira "do escritório"', () => {
    expect(nomeDaVariavel('ESCRITORIO_SOCIO_CPF')).toBe('CPF do sócio responsável')
    expect(nomeDaVariavel('ESCRITORIO_SOCIO_ESTADO_CIVIL')).toBe('estado civil do sócio responsável')
    expect(nomeDaVariavel('ESCRITORIO_ENDERECO')).toBe('endereço do escritório')
  })

  it('o que não se deixa ler sai como veio (não se inventa nome)', () => {
    expect(nomeDaVariavel('C_XYZ')).toBe('C_XYZ')
    expect(nomeDaVariavel('CEDENTE_')).toBe('CEDENTE_')
  })
})

/**
 * O BLOCO "HISTÓRICO DO CEDENTE", escrito direto do checklist de certidões.
 *
 * As perguntas abaixo são as do modelo de precatórios (aba Análise Jurídica,
 * linhas 28 a 81), copiadas do arquivo. Os testes guardam: cada certidão cai na
 * linha dela; a residência atual e as anteriores não se misturam; resultado só
 * aparece quando foi registrado; e linha cuja pergunta mudou não é escrita.
 */
import { describe, it, expect } from 'vitest'
import { lerQuestionario, type AbaDaPlanilha } from '../../../supabase/functions/_shared/questionarioJuridico.ts'
import {
  certidoesParaPlanilha,
  descreverItem,
  escreverCertidoes,
  type ItemDaPlanilha,
  type SujeitoDaPlanilha,
} from '../../../supabase/functions/_shared/certidoesNaPlanilha.ts'

const HOJE = '2026-09-28'

const PERGUNTAS: Record<number, string> = {
  28: 'Certidão de Regularidade Fiscal (CND Federal)',
  29: 'Certidão Negativa de Débitos Trabalhistas (CNDT) (https://cndt-certidao.tst.jus.br/inicio.faces)',
  30: 'Certidão Unificada da Justiça Federal (https://certidao-unificada.cjf.jus.br/#/solicitacao-certidao)',
  31: 'Certidão Unificada do TRF-1 (https://sistemas.trf1.jus.br/certidao/#/solicitacao)',
  32: 'Certidão Unificada do TRF-2',
  33: 'Certidão Unificada do TRF-3',
  34: 'Certidão Unificada do TRF-4',
  35: 'Certidão Unificada do TRF-5',
  36: 'Certidão Unificada do TRF-6',
  37: 'Pesquisa de Protestos (CENPROT)',
  40: 'Maior de Idade?',
  41: 'Possui curatela ou tutela?',
  43: 'Qual o atual Estado de residência? (comprovante de endereço nos autos)',
  44: 'Certidão de Débitos Tributários do Estado?',
  45: 'Qual o atual Município de residência? (comprovante de endereço nos autos)',
  46: 'Certidão de Débitos Tributários do Município?',
  47: 'Certidões Cíveis e Criminais do Tribunal de Justiça do Estado?',
  48: 'Já residiu em outro Município/Estado? (enriquecer CPF na DateSolutions)',
  49: 'Certidão de Débitos Tributários do(s) Estado(s)? (descrever todas)',
  50: 'Certidão de Débitos Tributários do(s) Município(s)? (descrever todas)',
  51: 'Certidões Cíveis e Criminais do(s) Tribunal(is) de Justiça do(s) Estado(s)? (descrever todas)',
  52: 'Cônjuge (se houver)',
  53: 'O credor é casado?',
  54: 'Certidão de Regularidade Fiscal (CND Federal)',
  58: 'Certidão do FGTS? (https://consulta-crf.caixa.gov.br/consultacrf/pages/consultaEmpregador.jsf)',
}

function abaDoModelo(trocar: Record<number, string> = {}) {
  const valores: Record<string, unknown> = {}
  for (const [n, p] of Object.entries({ ...PERGUNTAS, ...trocar })) valores[`A${n}`] = p
  valores.C28 = 'Se positiva, pesquisar se há execuções fiscais. Se houver, indicar o n° do processo e valor.'
  const ws: AbaDaPlanilha & { valores: Record<string, unknown> } = {
    valores,
    model: { merges: ['A52:D52'] },
    getRow: (n: number) => ({
      getCell: (c: string) => ({
        get value() {
          return valores[`${c}${n}`] ?? null
        },
        set value(v: unknown) {
          valores[`${c}${n}`] = v
        },
      }),
    }),
  }
  return ws
}

const cedente: SujeitoDaPlanilha = {
  id: 'c',
  papel: 'CEDENTE',
  tipo_pessoa: 'PF',
  nome: 'Iana Kelle Pontes',
  documento: '52998224725',
  data_nascimento: '1985-04-12',
  uf_atual: 'BA',
  municipio_atual: 'Salvador',
  ufs_anteriores: ['SE'],
  municipios_anteriores: ['Aracaju'],
  residencia_levantada: false,
}

const obtida = (codigo: string, resultado: string | null, parametros: Record<string, unknown> = {}): ItemDaPlanilha => ({
  sujeito_id: 'c',
  certidao_codigo: codigo,
  status: 'OBTIDA',
  parametros,
  emitida_em: '2026-09-28',
  validade_ate: '2027-03-27',
  resultado,
  drive_link: 'https://drive.google.com/x',
})

const ITENS: ItemDaPlanilha[] = [
  obtida('FED.CND_RFB_PGFN', 'negativa'),
  obtida('TRAB.CNDT', 'positiva'),
  { sujeito_id: 'c', certidao_codigo: 'FED.TRF1', status: 'EM_EMISSAO', parametros: {} },
  obtida('EST.CDT', 'negativa', { uf: 'BA' }),
  obtida('EST.CDT', 'nada_consta', { uf: 'SE' }),
  obtida('MUN.CND', 'negativa', { municipio: 'Salvador' }),
  obtida('MUN.CND', null, { municipio: 'Aracaju' }),
  obtida('EST.TJ_CIVEL_CRIMINAL', 'positiva', { uf: 'BA' }),
]

describe('descreverItem', () => {
  it('resultado registrado vira a resposta, com a data', () => {
    expect(descreverItem(obtida('X', 'negativa'), HOJE).resposta).toBe('Negativa (emitida em 28/09/2026)')
  })

  it('positiva pede a pesquisa no complemento, com o PDF', () => {
    const d = descreverItem(obtida('X', 'positiva'), HOJE)
    expect(d.resposta).toMatch(/^POSITIVA/)
    expect(d.complemento).toContain('https://drive.google.com/x')
  })

  // SEM RESULTADO NO BANCO, NÃO SE SUPÕE NEGATIVA.
  it('obtida à mão, sem resultado, diz que não foi registrado', () => {
    expect(descreverItem(obtida('X', null), HOJE).resposta).toContain('resultado não registrado')
  })

  it('vencida não passa por válida', () => {
    expect(descreverItem({ ...obtida('X', 'negativa'), validade_ate: '2026-09-01' }, HOJE).resposta).toMatch(/^Vencida/)
  })
})

describe('certidoesParaPlanilha + escreverCertidoes', () => {
  const escrever = (sujeitos = [cedente], itens = ITENS, trocar = {}) => {
    const ws = abaDoModelo(trocar)
    const { linhas, comFormula } = lerQuestionario(ws)
    void comFormula
    const r = escreverCertidoes(ws, linhas, certidoesParaPlanilha(sujeitos, itens, HOJE))
    return { ws, ...r }
  }

  it('cada certidão cai na linha dela', () => {
    const { ws } = escrever()
    expect(ws.valores.B28).toBe('Negativa (emitida em 28/09/2026)')
    expect(ws.valores.B29).toMatch(/^POSITIVA/)
    expect(ws.valores.D29).toContain('A pesquisar')
    expect(ws.valores.B31).toBe('Em emissão')
    expect(ws.valores.B32).toBe('Não consta no checklist')
  })

  // A RESIDÊNCIA ATUAL E AS ANTERIORES EM LINHAS DIFERENTES — é o que a planilha pede.
  it('separa a residência atual das anteriores', () => {
    const { ws } = escrever()
    expect(ws.valores.B43).toBe('BA')
    expect(ws.valores.B45).toBe('Salvador')
    expect(ws.valores.B44).toBe('Negativa (emitida em 28/09/2026)')
    expect(ws.valores.B49).toBe('Nada consta (emitida em 28/09/2026)')
    expect(ws.valores.B46).toBe('Negativa (emitida em 28/09/2026)')
    expect(ws.valores.B50).toContain('resultado não registrado')
    expect(ws.valores.B47).toMatch(/^POSITIVA/)
    expect(ws.valores.B48).toBe('Sim')
    expect(ws.valores.D48).toBe('Estados: SE; Municípios: Aracaju')
  })

  it('maior de idade sai da data de nascimento', () => {
    expect(escrever().ws.valores.B40).toMatch(/^Sim \(41 anos/)
  })

  // A LINHA 41 (curatela) E O CASAMENTO SEM CÔNJUGE ficam para a conversa.
  it('não responde o que o checklist não sabe', () => {
    const { ws } = escrever()
    expect(ws.valores.B41).toBeUndefined()
    expect(ws.valores.B53).toBeUndefined()
    expect(ws.valores.B54).toBeUndefined()
  })

  it('com cônjuge cadastrado, responde o casamento e o bloco dele', () => {
    const conjuge: SujeitoDaPlanilha = {
      ...cedente,
      id: 'j',
      papel: 'CONJUGE',
      nome: 'João Pontes',
      documento: '11144477735',
      ufs_anteriores: [],
      municipios_anteriores: [],
    }
    const { ws } = escrever([cedente, conjuge], [...ITENS, { ...obtida('FED.CND_RFB_PGFN', 'negativa'), sujeito_id: 'j' }])
    expect(ws.valores.B53).toBe('Sim')
    expect(ws.valores.D53).toBe('João Pontes — CPF 11144477735')
    expect(ws.valores.B54).toBe('Negativa (emitida em 28/09/2026)')
    expect(ws.valores.B58).toBe('Não consta no checklist')
  })

  // O MODELO MUDOU: a linha 44 agora é outra pergunta, e não se escreve nela.
  it('linha cuja pergunta não é a esperada não é escrita', () => {
    const { ws, desalinhadas } = escrever(undefined, undefined, { 44: 'Possui imóveis em nome próprio?' })
    expect(ws.valores.B44).toBeUndefined()
    expect(desalinhadas).toContain(44)
  })

  it('sem residência anterior levantada, diz isso nas linhas das anteriores', () => {
    const sem = { ...cedente, ufs_anteriores: [], municipios_anteriores: [] }
    const { ws } = escrever([sem], ITENS.filter((i) => (i.parametros as { uf?: string }).uf !== 'SE'))
    expect(ws.valores.B48).toBe('Histórico de residência não levantado')
  })
})

/**
 * A PLANILHA DA ANÁLISE JURÍDICA QUE NASCE DA CONVERSA.
 *
 * Até 28/09/2026 a planilha só saía do motor antigo, que lia os autos de novo,
 * com outro modelo, longe da conversa da qualificação — e a equipe apontou que
 * assim ela "perde o contexto". Agora o conector entrega o questionário à
 * conversa, o Claude devolve um bloco JSON, quem opera cola, e a plataforma grava
 * pelo MESMO código do motor antigo. Estes testes guardam as três pontas: achar o
 * bloco no que foi colado, ler o questionário do modelo, e gravar sem estragar
 * a planilha.
 */
import { describe, it, expect } from 'vitest'
import {
  aplicarRespostas,
  extrairSaidaColada,
  lerQuestionario,
  secaoDaPlanilhaParaAConversa,
  type AbaDaPlanilha,
  type SaidaDaPlanilha,
} from '../../../supabase/functions/_shared/questionarioJuridico.ts'
import { montarEntrega, type AutosGuardados } from '../../../supabase/functions/_shared/entregaDosAutos.ts'

/** Uma aba de mentira: só o que o questionário usa — células por linha e merges. */
function abaDeMentira(celulas: Record<string, unknown>, merges: string[] = []): AbaDaPlanilha & {
  celulas: Record<string, unknown>
} {
  const valores: Record<string, unknown> = { ...celulas }
  return {
    celulas: valores,
    model: { merges },
    getRow: (n: number) => ({
      getCell: (c: string) => {
        const chave = `${c}${n}`
        return {
          get value() {
            return valores[chave] ?? null
          },
          set value(v: unknown) {
            valores[chave] = v
          },
        }
      },
    }),
  }
}

// O desenho real da aba: Dados Básicos respondem em C; os outros blocos em B,
// com complemento em C e a resposta do complemento em D.
const aba = () =>
  abaDeMentira(
    {
      A4: 'Número do processo',
      A5: 'Tribunal',
      A28: 'Cedente (se houver)', // título de sub-bloco, mesclado A:D
      A29: 'Certidão estadual cível',
      A91: 'Receita Corrente Líquida',
      C91: 'Link da fonte utilizada',
      A93: 'Mora/RCL',
      B93: { formula: 'B92/B91' }, // fórmula da planilha: ninguém escreve
      A105: 'Há cessão homologada?',
      C105: 'Data da homologação',
    },
    ['A28:D28'],
  )

describe('extrairSaidaColada', () => {
  const bloco = { respostas: [{ linha: 4, resposta: '8018315-51.2025.8.05.0000' }], avisos: [], resumo: 'x', ficha: {} }

  // É ASSIM QUE CHEGA: o botão de copiar do bloco de código do Claude.
  it('acha o bloco com as cercas de código', () => {
    const r = extrairSaidaColada('```json\n' + JSON.stringify(bloco) + '\n```')
    expect(r.ok && r.saida.respostas?.[0].linha).toBe(4)
  })

  // QUEM COLA NÃO É UM PROGRAMA: pode vir a resposta inteira, com a
  // qualificação antes e um comentário depois.
  it('acha o bloco no meio da resposta inteira', () => {
    const texto = '# Qualificação\n\nO crédito é...\n\n```json\n' + JSON.stringify(bloco) + '\n```\n\nFico à disposição.'
    expect(extrairSaidaColada(texto).ok).toBe(true)
  })

  it('aceita o JSON sem as cercas', () => {
    expect(extrairSaidaColada('aqui vai: ' + JSON.stringify(bloco)).ok).toBe(true)
  })

  it('diz claramente quando não há bloco', () => {
    const r = extrairSaidaColada('a análise está acima')
    expect(r.ok).toBe(false)
    expect(!r.ok && r.erro).toContain('Não achei o bloco')
  })

  it('distingue JSON sem "respostas" de texto sem JSON', () => {
    const r = extrairSaidaColada('```json\n{"outra": 1}\n```')
    expect(!r.ok && r.erro).toContain('sem a lista "respostas"')
  })

  it('JSON quebrado não passa', () => {
    expect(extrairSaidaColada('```json\n{"respostas": [ {"linha": 4,\n```').ok).toBe(false)
    expect(extrairSaidaColada('').ok).toBe(false)
  })
})

describe('lerQuestionario', () => {
  it('lê as perguntas, com a coluna de resposta de cada bloco', () => {
    const { linhas } = lerQuestionario(aba())
    const l4 = linhas.find((l) => l.linha === 4)
    expect(l4?.col).toBe('C') // Dados Básicos respondem em C
    expect(linhas.find((l) => l.linha === 105)?.col).toBe('B')
  })

  // TÍTULO DE SUB-BLOCO NÃO É PERGUNTA, e FÓRMULA NÃO É CAMPO.
  it('pula o título mesclado e a linha com fórmula', () => {
    const { linhas, comFormula } = lerQuestionario(aba())
    expect(linhas.some((l) => l.linha === 28)).toBe(false)
    expect(linhas.some((l) => l.linha === 93)).toBe(false)
    expect(comFormula).toContain(93)
  })

  it('traz a instrução do complemento quando ela existe', () => {
    const { linhas } = lerQuestionario(aba())
    expect(linhas.find((l) => l.linha === 105)?.complemento).toBe('Data da homologação')
    expect(linhas.find((l) => l.linha === 29)?.complemento).toBeNull()
  })
})

describe('aplicarRespostas', () => {
  const ctx = { temChecklist: true, tipo_aquisicao: 'principal', numero_processo: '8018315-51.2025.8.05.0000' }

  it('grava na coluna certa, com o complemento em D', () => {
    const ws = aba()
    const { linhas, comFormula } = lerQuestionario(ws)
    const saida: SaidaDaPlanilha = {
      respostas: [
        { linha: 4, resposta: '8018315-51.2025.8.05.0000' },
        { linha: 105, resposta: 'Sim', complemento: '14/03/2024' },
      ],
    }
    const r = aplicarRespostas(ws, linhas, comFormula, saida, ctx)
    expect(r.escritas).toBe(2)
    expect(ws.celulas.C4).toBe('8018315-51.2025.8.05.0000')
    expect(ws.celulas.B105).toBe('Sim')
    expect(ws.celulas.D105).toBe('14/03/2024')
  })

  // NÚMERO DE ORÇAMENTO PÚBLICO SEM LINK NÃO ENTRA — e diz por quê.
  it('descarta resposta de busca web sem link, com aviso', () => {
    const ws = aba()
    const { linhas, comFormula } = lerQuestionario(ws)
    const r = aplicarRespostas(ws, linhas, comFormula, { respostas: [{ linha: 91, resposta: 'R$ 1 bi' }] }, ctx)
    expect(r.escritas).toBe(0)
    expect(ws.celulas.B91).toBeUndefined()
    expect(r.avisos.join(' ')).toContain('DESCARTADAS por vir sem link')
  })

  it('com link, entra — e o link vai para D', () => {
    const ws = aba()
    const { linhas, comFormula } = lerQuestionario(ws)
    aplicarRespostas(ws, linhas, comFormula, {
      respostas: [{ linha: 91, resposta: 'R$ 1.000.000.000,00', fonte_url: 'https://loa.ba.gov.br' }],
    }, ctx)
    expect(ws.celulas.B91).toBe('R$ 1.000.000.000,00')
    expect(String(ws.celulas.D91)).toContain('https://loa.ba.gov.br')
  })

  // A FÓRMULA NUNCA É APAGADA, nem se a resposta vier para a linha dela.
  it('não escreve em célula com fórmula nem em linha fora do questionário', () => {
    const ws = aba()
    const { linhas, comFormula } = lerQuestionario(ws)
    const r = aplicarRespostas(ws, linhas, comFormula, {
      respostas: [{ linha: 93, resposta: '12%' }, { linha: 999, resposta: 'x' }],
    }, ctx)
    expect(ws.celulas.B93).toEqual({ formula: 'B92/B91' })
    expect(r.escritas).toBe(0)
    expect(r.avisos.join(' ')).toContain('não existem no questionário')
  })

  it('sem checklist, avisa que o histórico do cedente ficou em branco', () => {
    const ws = aba()
    const { linhas, comFormula } = lerQuestionario(ws)
    const r = aplicarRespostas(ws, linhas, comFormula, { respostas: [] }, { ...ctx, temChecklist: false })
    expect(r.avisos.join(' ')).toContain('Histórico do Cedente')
  })

  it('a ficha do card sai com o processo e a parcela cedida', () => {
    const ws = aba()
    const { linhas, comFormula } = lerQuestionario(ws)
    const r = aplicarRespostas(ws, linhas, comFormula, {
      respostas: [],
      ficha: { tribunal: 'TJBA', entidade_devedora: 'Estado da Bahia', cedente_nome: 'Iana', bruto_total: 100000 },
    }, ctx)
    expect(r.ficha.processo).toBe('8018315-51.2025.8.05.0000')
    expect(r.ficha.tribunal).toBe('TJBA')
    expect(r.ficha.valor_cedido).toBeGreaterThan(0)
  })
})

/**
 * O QUE A CONVERSA RECEBE — e onde. O questionário vai ANTES dos autos, para
 * ser lido como instrução, e não se perder depois de 250 mil caracteres.
 */
describe('a planilha na entrega da conversa', () => {
  const { linhas } = lerQuestionario(aba())
  const secao = secaoDaPlanilhaParaAConversa(linhas, 'CEDENTE (PF): Iana, doc 123.')

  it('leva o questionário, o checklist, as regras e o formato do bloco', () => {
    expect(secao).toContain('L105: Há cessão homologada?')
    expect(secao).toContain('CEDENTE (PF): Iana')
    expect(secao).toContain('NÃO INVENTE')
    expect(secao).toContain('ENTREGUE UM BLOCO SÓ, NO FIM')
    expect(secao).toContain('"respostas"')
  })

  it('entra antes dos dados do card e dos autos', () => {
    const g: AutosGuardados = {
      lead_id: 1,
      titulo: 't',
      criado_em: '2026-09-28T00:00:00.000Z',
      arquivos: [{ nome: 'p.pdf', paginas: 1, paginasTexto: ['TEXTO DOS AUTOS'] }],
    }
    const t = montarEntrega(g, 'roteiro', undefined, secao)
    const iSecao = t.indexOf('PLANILHA DA ANÁLISE JURÍDICA')
    expect(iSecao).toBeGreaterThan(0)
    expect(iSecao).toBeLessThan(t.indexOf('## DADOS DO CARD'))
    expect(iSecao).toBeLessThan(t.indexOf('TEXTO DOS AUTOS'))
  })

  it('sem seção, a entrega é a de sempre', () => {
    const g: AutosGuardados = { lead_id: 1, titulo: 't', criado_em: '', arquivos: [] }
    expect(montarEntrega(g, 'roteiro', undefined, '')).toBe(montarEntrega(g, 'roteiro'))
  })
})

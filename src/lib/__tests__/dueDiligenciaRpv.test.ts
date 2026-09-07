import { describe, it, expect } from 'vitest'
import {
  aplicarDiligenciaNoM2,
  historicoDoCredito,
  textoDaDiligencia,
  type ApuracaoDD,
  type ProcessoDD,
} from '../../../supabase/functions/_shared/dueDiligencia.ts'

/**
 * As linhas 10 e 11 da aba jurídica de RPV — "Histórico do cedente / do
 * advogado: tem dívida?".
 *
 * Eram respondidas pela IA lendo o processo DA CESSÃO, que não fala das dívidas
 * de ninguém: o "Não" impresso queria dizer "não achei nos autos" e era lido na
 * planilha como diligência feita. Estes testes fixam as três coisas que a
 * correção não pode errar: sem apuração NADA MUDA, apuração e autos se SOMAM em
 * vez de se apagarem, e o que não foi apurado nunca vira "Não".
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
  m2[linha] as { resposta?: string; complemento?: string } | undefined

describe('sem due diligence, a análise sai como sempre saiu', () => {
  it('nenhuma apuração: o m2 volta idêntico', () => {
    const m2 = { '10': { resposta: 'Não', complemento: '' }, '19': { resposta: 'Procedência' } }
    const r = aplicarDiligenciaNoM2(m2, historicoDoCredito([], []))
    expect(r.m2).toEqual(m2)
    expect(r.escritas).toEqual([])
    expect(r.notas).toEqual([])
  })

  it('apuração aberta (PENDENTE) não escreve — pedir não é apurar', () => {
    const hs = historicoDoCredito([apuracao({ id: 'a', papel: 'CEDENTE', status: 'PENDENTE' })], [])
    expect(hs[0].apurada).toBe(false)
    const r = aplicarDiligenciaNoM2({ '10': { resposta: 'Não' } }, hs)
    expect(so(r.m2, '10')?.resposta).toBe('Não')
    expect(r.escritas).toEqual([])
  })

  it('apuração que FALHOU não escreve e avisa: o "Não" ali é da IA, não da diligência', () => {
    const hs = historicoDoCredito([apuracao({ id: 'a', papel: 'CEDENTE', status: 'FALHA' })], [])
    const r = aplicarDiligenciaNoM2({ '10': { resposta: 'Não' } }, hs)
    expect(r.escritas).toEqual([])
    expect(r.notas.join(' ')).toMatch(/FALHOU/)
  })
})

describe('apuração concluída manda na célula', () => {
  it('nada consta: "Não" com complemento vazio', () => {
    const hs = historicoDoCredito([apuracao({ id: 'a', papel: 'CEDENTE' })], [])
    const r = aplicarDiligenciaNoM2({}, hs)
    expect(so(r.m2, '10')).toEqual({ resposta: 'Não', complemento: '' })
    expect(r.escritas).toEqual(['10'])
  })

  it('achou dívida: "Sim" e os números na coluna D', () => {
    const hs = historicoDoCredito(
      [apuracao({ id: 'a', papel: 'CEDENTE', nome: 'Maria' })],
      [
        proc({
          historico_id: 'a',
          numero_processo: '0001234-56.2020.8.09.0051',
          objeto: 'execução fiscal',
          valor_cobrado: 12345.67,
          estagio: 'penhora',
        }),
      ],
    )
    const r = aplicarDiligenciaNoM2({ '10': { resposta: 'Não' } }, hs)
    const c = so(r.m2, '10')
    expect(c?.resposta).toBe('Sim')
    expect(c?.complemento).toContain('0001234-56.2020.8.09.0051')
    expect(c?.complemento).toContain('execução fiscal')
    expect(c?.complemento).toContain('12.345,67')
    expect(c?.complemento).toContain('penhora')
  })

  it('o advogado vai para a 11, e não encosta na 10', () => {
    const hs = historicoDoCredito(
      [apuracao({ id: 'b', papel: 'ADVOGADO', nome: 'Dr. Sicrano', oab: 'GO 12345' })],
      [proc({ historico_id: 'b', numero_processo: '0009876-54.2019.8.09.0051' })],
    )
    const r = aplicarDiligenciaNoM2({ '10': { resposta: 'Não' } }, hs)
    expect(so(r.m2, '11')?.resposta).toBe('Sim')
    expect(so(r.m2, '10')?.resposta).toBe('Não')
    expect(r.escritas).toEqual(['11'])
  })

  it('cônjuge e PJ não têm linha em RPV e são ignorados', () => {
    const hs = historicoDoCredito(
      [apuracao({ id: 'c', papel: 'CONJUGE' }), apuracao({ id: 'd', papel: 'PJ' })],
      [proc({ historico_id: 'c', numero_processo: '0001111-11.2020.8.09.0051' })],
    )
    expect(hs).toEqual([])
  })

  it('dois advogados, um ainda pendente: a célula fala dos dois, então não é apurada', () => {
    const hs = historicoDoCredito(
      [
        apuracao({ id: 'x', papel: 'ADVOGADO', nome: 'Dr. A' }),
        apuracao({ id: 'y', papel: 'ADVOGADO', nome: 'Dr. B', status: 'PENDENTE' }),
      ],
      [],
    )
    expect(hs[0].apurada).toBe(false)
    expect(hs[0].quem).toContain('Dr. A')
    expect(hs[0].quem).toContain('Dr. B')
  })
})

describe('o que conta como dívida', () => {
  const comProcesso = (p: Partial<ProcessoDD>) =>
    historicoDoCredito(
      [apuracao({ id: 'a', papel: 'CEDENTE' })],
      [proc({ historico_id: 'a', numero_processo: '0001234-56.2020.8.09.0051', ...p })],
    )[0]

  it('cobrança declarada é dívida', () => {
    expect(comProcesso({ ha_cobranca: true, polo: 'ATIVO' }).temDivida).toBe(true)
  })

  it('cobrança negada não é dívida, mesmo no polo passivo', () => {
    const h = comProcesso({ ha_cobranca: false, polo: 'PASSIVO' })
    expect(h.temDivida).toBe(false)
    expect(h.indeterminados).toBe(0)
  })

  it('valor não apurado no polo PASSIVO conta como dívida — é o lado conservador', () => {
    const h = comProcesso({ ha_cobranca: null, polo: 'PASSIVO' })
    expect(h.temDivida).toBe(true)
  })

  it('valor não apurado fora do polo passivo fica indeterminado: autor não deve pela própria ação', () => {
    const h = comProcesso({ ha_cobranca: null, polo: 'ATIVO' })
    expect(h.temDivida).toBe(false)
    expect(h.indeterminados).toBe(1)
    const r = aplicarDiligenciaNoM2({}, [h])
    expect(so(r.m2, '10')?.resposta).toBe('Não')
    // O "Não" é honesto, mas a lacuna tem de aparecer em algum lugar.
    expect(r.notas.join(' ')).toMatch(/sem dizer se há valor sendo cobrado/)
  })
})

describe('apuração e autos se somam, nunca se apagam', () => {
  it('a IA achou dívida nos autos e a diligência não: fica "Sim", com o que ela leu', () => {
    const hs = historicoDoCredito([apuracao({ id: 'a', papel: 'CEDENTE' })], [])
    const r = aplicarDiligenciaNoM2(
      { '10': { resposta: 'Sim', complemento: 'penhora no rosto dos autos — 0007777-77.2021.8.09.0051' } },
      hs,
    )
    const c = so(r.m2, '10')
    expect(c?.resposta).toBe('Sim')
    expect(c?.complemento).toContain('0007777-77.2021.8.09.0051')
    expect(r.notas.join(' ')).toMatch(/confira qual das duas está desatualizada/)
  })

  it('processo que já está na diligência não é repetido pela leitura dos autos', () => {
    const hs = historicoDoCredito(
      [apuracao({ id: 'a', papel: 'CEDENTE' })],
      [proc({ historico_id: 'a', numero_processo: '0001234-56.2020.8.09.0051', objeto: 'execução fiscal' })],
    )
    // A IA escreveu o MESMO processo, sem máscara.
    const r = aplicarDiligenciaNoM2({ '10': { resposta: 'Sim', complemento: '00012345620208090051' } }, hs)
    const c = so(r.m2, '10') as { complemento: string }
    expect(c.complemento).toContain('0001234-56.2020.8.09.0051')
    expect(c.complemento).not.toContain('nos autos:')
  })

  it('processo que só a IA viu entra ao lado do que a diligência achou', () => {
    const hs = historicoDoCredito(
      [apuracao({ id: 'a', papel: 'CEDENTE' })],
      [proc({ historico_id: 'a', numero_processo: '0001234-56.2020.8.09.0051' })],
    )
    const r = aplicarDiligenciaNoM2({ '10': { resposta: 'Sim', complemento: '0007777-77.2021.8.09.0051' } }, hs)
    const c = so(r.m2, '10') as { complemento: string }
    expect(c.complemento).toContain('0001234-56.2020.8.09.0051')
    expect(c.complemento).toContain('nos autos: 0007777-77.2021.8.09.0051')
  })

  it('resposta "Não" limpa o complemento — a regra do modelo', () => {
    const hs = historicoDoCredito([apuracao({ id: 'a', papel: 'CEDENTE' })], [])
    const r = aplicarDiligenciaNoM2({ '10': { resposta: 'Não', complemento: 'nada a declarar' } }, hs)
    expect(so(r.m2, '10')?.complemento).toBe('')
  })
})

describe('a célula continua legível', () => {
  it('acima de oito processos, o excedente é contado em vez de listado', () => {
    const processos = Array.from({ length: 12 }, (_, i) =>
      proc({ historico_id: 'a', numero_processo: `000${1000 + i}-56.2020.8.09.0051` }),
    )
    const hs = historicoDoCredito([apuracao({ id: 'a', papel: 'CEDENTE' })], processos)
    const c = hs[0].complemento
    expect(c.match(/2020\.8\.09\.0051/g)).toHaveLength(8)
    expect(c).toContain('e mais 4 processo(s)')
  })
})

describe('o bloco que a IA lê', () => {
  it('diz o que foi apurado, marca o risco alto e não pede que ela responda a linha', () => {
    const hs = historicoDoCredito(
      [apuracao({ id: 'a', papel: 'CEDENTE', nome: 'Maria' })],
      [
        proc({
          historico_id: 'a',
          numero_processo: '0001234-56.2020.8.09.0051',
          objeto: 'execução fiscal',
          risco: 'ALTO',
          risco_motivo: 'penhora pode alcançar o crédito',
        }),
      ],
    )
    const t = textoDaDiligencia(hs)
    expect(t).toContain('CEDENTE (Maria): apurado')
    expect(t).toContain('RISCO ALTO')
    expect(t).toContain('penhora pode alcançar o crédito')
  })

  it('apuração não concluída aparece como tal, e manda seguir pelos autos', () => {
    const hs = historicoDoCredito([apuracao({ id: 'a', papel: 'CEDENTE', status: 'PENDENTE' })], [])
    expect(textoDaDiligencia(hs)).toMatch(/AINDA NÃO CONCLUÍDA/)
  })

  it('sem apuração nenhuma não há bloco para mandar', () => {
    expect(textoDaDiligencia([])).toBe('')
  })
})

describe('a coluna D sempre diz o que a diligência achou', () => {
  const comDivida = () =>
    historicoDoCredito(
      [apuracao({ id: 'a', papel: 'CEDENTE', nome: 'Maria' })],
      [proc({ historico_id: 'a', numero_processo: '0001234-56.2020.8.09.0051', objeto: 'execução fiscal' })],
    )

  it('a origem do dado é nomeada, não é só uma lista de números soltos', () => {
    const c = so(aplicarDiligenciaNoM2({}, comDivida()).m2, '10')
    expect(c?.complemento).toMatch(/^Due diligence:/)
  })

  it('linha travada pelo chat: a resposta é de quem revisou, e D denuncia a dívida', () => {
    // O operador está com o processo aberto e mandou "Não" — homônimo, dívida
    // quitada, processo do sócio. A resposta é dele; o achado não some.
    const r = aplicarDiligenciaNoM2({ '10': { resposta: 'Não', complemento: '' } }, comDivida(), ['10'])
    const c = so(r.m2, '10')
    expect(c?.resposta).toBe('Não')
    expect(c?.complemento).toContain('A DUE DILIGENCE ENCONTROU DÍVIDA')
    expect(c?.complemento).toContain('mantida a pedido de quem revisou')
    expect(c?.complemento).toContain('0001234-56.2020.8.09.0051')
  })

  it('o conflito também sobe como aviso da análise', () => {
    const r = aplicarDiligenciaNoM2({ '10': { resposta: 'Não' } }, comDivida(), ['10'])
    expect(r.notas.join(' ')).toMatch(/LINHA 10 EM CONFLITO/)
  })

  it('sem trava, a diligência manda na resposta — é o comportamento de sempre', () => {
    const r = aplicarDiligenciaNoM2({ '10': { resposta: 'Não' } }, comDivida())
    expect(so(r.m2, '10')?.resposta).toBe('Sim')
    expect(r.notas.join(' ')).not.toMatch(/EM CONFLITO/)
  })

  it('trava numa linha não afeta a outra', () => {
    const hs = historicoDoCredito(
      [apuracao({ id: 'a', papel: 'CEDENTE' }), apuracao({ id: 'b', papel: 'ADVOGADO' })],
      [
        proc({ historico_id: 'a', numero_processo: '0001111-11.2020.8.09.0051' }),
        proc({ historico_id: 'b', numero_processo: '0002222-22.2020.8.09.0051' }),
      ],
    )
    const r = aplicarDiligenciaNoM2({ '10': { resposta: 'Não' }, '11': { resposta: 'Não' } }, hs, ['10'])
    expect(so(r.m2, '10')?.resposta).toBe('Não')
    expect(so(r.m2, '11')?.resposta).toBe('Sim')
  })

  it('travada e sem dívida apurada: nada de alarme, e a célula fica limpa', () => {
    const hs = historicoDoCredito([apuracao({ id: 'a', papel: 'CEDENTE' })], [])
    const r = aplicarDiligenciaNoM2({ '10': { resposta: 'Não' } }, hs, ['10'])
    expect(so(r.m2, '10')).toEqual({ resposta: 'Não', complemento: '' })
    expect(r.notas.join(' ')).not.toMatch(/CONFLITO/)
  })

  it('travada em "Sim" com dívida apurada: concordam, e D lista o que se achou', () => {
    const r = aplicarDiligenciaNoM2({ '10': { resposta: 'Sim', complemento: '' } }, comDivida(), ['10'])
    expect(so(r.m2, '10')?.resposta).toBe('Sim')
    expect(so(r.m2, '10')?.complemento).toMatch(/^Due diligence:/)
    expect(r.notas.join(' ')).not.toMatch(/CONFLITO/)
  })
})

describe('risco alto vira aviso da análise', () => {
  it('a nota cita o motivo e manda avaliar fraude à execução', () => {
    const hs = historicoDoCredito(
      [apuracao({ id: 'a', papel: 'CEDENTE', nome: 'Maria' })],
      [
        proc({
          historico_id: 'a',
          numero_processo: '0001234-56.2020.8.09.0051',
          risco: 'ALTO',
          risco_motivo: 'execução fiscal em fase de penhora',
        }),
      ],
    )
    const r = aplicarDiligenciaNoM2({}, hs)
    const nota = r.notas.join(' ')
    expect(nota).toMatch(/⚠️/)
    expect(nota).toContain('execução fiscal em fase de penhora')
    expect(nota).toMatch(/fraude à execução/)
  })

  it('dívida sem risco apontado avisa sem alarme', () => {
    const hs = historicoDoCredito(
      [apuracao({ id: 'a', papel: 'CEDENTE', nome: 'Maria' })],
      [proc({ historico_id: 'a', numero_processo: '0001234-56.2020.8.09.0051', risco: 'NENHUM' })],
    )
    const nota = aplicarDiligenciaNoM2({}, hs).notas.join(' ')
    expect(nota).toContain('Sem risco alto apontado')
    expect(nota).not.toMatch(/⚠️/)
  })
})

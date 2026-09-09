import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  apurarProcessos,
  avaliarRisco,
  ErroEscavador,
  identidadeDoAdvogado,
  lerOab,
  poloDoAlvo,
  processosDoEnvolvido,
  traduzirProcesso,
  type EnvolvidoEscavador,
  type ProcessoEscavador,
} from '../../../supabase/functions/_shared/escavador.ts'

/**
 * O ESCAVADOR, e a pergunta que a due diligence faz a ele.
 *
 * A apuração de processos judiciais é a segunda frente da diligência — a que a
 * migration 0056 preparou no banco e a aba "Processos judiciais" mostrava como
 * "Ainda não implementado". O que estes testes fixam é a TRADUÇÃO: o que a API
 * devolve não é uma dívida, é uma lista de processos, e transformar uma coisa
 * na outra é onde se erra caro. Marcar como risco o crédito que estamos
 * comprando, ou a ação que o próprio cedente propôs, treina quem lê a planilha
 * a ignorar o alerta.
 */
const CPF_CEDENTE = '12345678900'
const CPF_OUTRO = '98765432100'
const CREDITO = '5000256-12.2024.8.13.0313'

const parte = (o: Partial<EnvolvidoEscavador>): EnvolvidoEscavador => ({
  nome: 'Fulano de Tal',
  polo: 'PASSIVO',
  ...o,
})

function processo(o: {
  numero?: string
  classe?: string
  assunto?: string
  situacao?: string
  arquivado?: boolean | null
  statusPredito?: string
  arquivadasTodas?: boolean
  valor?: string
  envolvidos?: EnvolvidoEscavador[]
} = {}): ProcessoEscavador {
  return {
    numero_cnj: o.numero ?? '0801234-56.2021.8.09.0051',
    fontes_tribunais_estao_arquivadas: o.arquivadasTodas,
    fontes: [
      {
        grau: 1,
        url: 'https://projudi.tjgo.jus.br/processo',
        arquivado: o.arquivado ?? null,
        status_predito: o.statusPredito ?? 'ATIVO',
        tribunal: { sigla: 'TJGO' },
        capa: {
          classe: o.classe ?? 'PROCEDIMENTO COMUM CIVEL',
          assunto: o.assunto,
          situacao: o.situacao,
          valor_causa: o.valor ? { valor: o.valor } : undefined,
        },
        envolvidos: o.envolvidos ?? [parte({ cpf: CPF_CEDENTE })],
      },
    ],
  }
}

describe('lerOab', () => {
  // O campo `oab` de dd_historico é texto livre de quem cadastra, e a API exige
  // estado e número separados. Sem esta leitura a linha 11 falharia por vírgula.
  it('lê as formas em que as pessoas escrevem uma OAB', () => {
    for (const escrito of ['GO 12345', 'OAB/GO 12.345', 'OAB GO 12345', 'go-12345']) {
      expect(lerOab(escrito)).toEqual({ uf: 'GO', numero: '12345' })
    }
    expect(lerOab('12345/GO')).toEqual({ uf: 'GO', numero: '12345' })
  })

  it('sem OAB reconhecível, nulo', () => {
    for (const v of ['', null, undefined, 'Dr. Fulano', 12345]) expect(lerOab(v)).toBeNull()
  })
})

describe('o polo do alvo', () => {
  it('acha pelo CPF e diz que foi pelo documento', () => {
    const r = poloDoAlvo(processo(), { documento: CPF_CEDENTE })
    expect(r).toEqual({ polo: 'PASSIVO', porDocumento: true })
  })

  // HOMÔNIMO NÃO É O CEDENTE. Com CPF em mãos, um nome igual que não bate no
  // documento é outra pessoa — e contá-lo como dívida reprovaria um crédito bom.
  it('mesmo nome, CPF diferente: não é ele', () => {
    const p = processo({ envolvidos: [parte({ nome: 'Fulano de Tal', cpf: CPF_OUTRO })] })
    expect(poloDoAlvo(p, { documento: CPF_CEDENTE, nome: 'Fulano de Tal' }).polo).toBe(
      'DESCONHECIDO',
    )
  })

  // Sem documento a busca é por nome, e o resultado carrega a ressalva — nunca
  // some, mas nunca se apresenta como certeza.
  it('sem documento, o nome vale e a origem fica registrada', () => {
    const p = processo({ envolvidos: [parte({ nome: 'Fulano de Tal' })] })
    expect(poloDoAlvo(p, { nome: 'fulano  de tal' })).toEqual({
      polo: 'PASSIVO',
      porDocumento: false,
    })
  })

  // O PIOR POLO VENCE: autor de uma ação e réu na reconvenção continua sendo
  // cobrado, e arredondar para "autor" apagaria a dívida.
  it('em dois polos, o passivo manda', () => {
    const p = processo({
      envolvidos: [
        parte({ cpf: CPF_CEDENTE, polo: 'ATIVO' }),
        parte({ cpf: CPF_CEDENTE, polo: 'PASSIVO' }),
      ],
    })
    expect(poloDoAlvo(p, { documento: CPF_CEDENTE }).polo).toBe('PASSIVO')
  })

  // O ADVOGADO NÃO É PARTE. Ele aparece dentro de `advogados` da parte que
  // patrocina, e responder "tem dívida?" por esses processos daria "Não" em
  // todos por construção — ver identidadeDoAdvogado.
  it('achado pela OAB, é terceiro e não parte', () => {
    const p = processo({
      envolvidos: [
        parte({
          cpf: CPF_OUTRO,
          polo: 'ATIVO',
          advogados: [
            { nome: 'Dra. Beltrana', polo: 'ADVOGADO', oabs: [{ uf: 'GO', numero: 12345 }] },
          ],
        }),
      ],
    })
    expect(poloDoAlvo(p, { oab: 'GO 12345' })).toEqual({ polo: 'TERCEIRO', porDocumento: true })
  })
})

describe('o risco para ESTA cessão', () => {
  const risco = (p: ProcessoEscavador, polo: Parameters<typeof avaliarRisco>[1] = 'PASSIVO') =>
    avaliarRisco(p, polo, true)

  it('execução em curso contra ele é o risco que a diligência procura', () => {
    const r = risco(processo({ classe: 'EXECUCAO FISCAL' }))
    expect(r.risco).toBe('ALTO')
    expect(r.motivo).toMatch(/fraude à execução/)
  })

  it('penhora decretada alcança o crédito hoje', () => {
    expect(risco(processo({ assunto: 'PENHORA / DEPOSITO' })).risco).toBe('ALTO')
  })

  // Baixado não alcança nada hoje, mas volta se desarquivarem: é atenção, não
  // impedimento.
  it('execução já baixada cai para atenção', () => {
    const r = risco(processo({ classe: 'EXECUCAO DE TITULO EXTRAJUDICIAL', situacao: 'Baixado' }))
    expect(r.risco).toBe('ATENCAO')
    expect(r.motivo).toMatch(/baixado/i)
  })

  // FALÊNCIA VALE EM QUALQUER POLO: o crédito vai para a massa seja ele quem
  // for na ação.
  it('falência do cedente é alto risco mesmo no polo ativo', () => {
    expect(risco(processo({ classe: 'RECUPERACAO JUDICIAL' }), 'ATIVO').risco).toBe('ALTO')
  })

  // O CASO QUE NÃO PODE VIRAR ALERTA: outro crédito do cedente, uma ação que
  // ele mesmo propôs. Não ameaça o recebimento — é histórico, não risco.
  it('ação proposta por ele não é risco nenhum', () => {
    expect(risco(processo({ classe: 'EXECUCAO DE TITULO EXTRAJUDICIAL' }), 'ATIVO')).toEqual({
      risco: 'NENHUM',
      motivo: null,
    })
  })

  it('ação de conhecimento em curso contra ele é atenção', () => {
    const r = risco(processo({ classe: 'PROCEDIMENTO COMUM CIVEL' }))
    expect(r.risco).toBe('ATENCAO')
    expect(r.motivo).toMatch(/condenação/)
  })

  it('processo arquivado sem cobrança não é risco', () => {
    expect(risco(processo({ arquivadasTodas: true })).risco).toBe('NENHUM')
  })

  // A ressalva do homônimo viaja junto do motivo: quem lê a planilha precisa
  // saber que o vínculo veio do nome.
  it('vínculo achado pelo nome carrega a ressalva no motivo', () => {
    const r = avaliarRisco(processo({ classe: 'EXECUCAO FISCAL' }), 'PASSIVO', false)
    expect(r.motivo).toMatch(/pelo NOME, não pelo CPF/)
  })
})

describe('traduzirProcesso', () => {
  it('devolve uma linha de dd_processo', () => {
    const linha = traduzirProcesso(
      processo({ classe: 'EXECUCAO FISCAL', valor: '31045.6100' }),
      { documento: CPF_CEDENTE },
    )
    expect(linha).toMatchObject({
      numero_processo: '0801234-56.2021.8.09.0051',
      tribunal: 'TJGO',
      objeto: 'EXECUCAO FISCAL',
      polo: 'PASSIVO',
      valor_cobrado: 31045.61,
      estagio: 'Em andamento',
      risco: 'ALTO',
      fonte: 'escavador',
      url_fonte: 'https://projudi.tjgo.jus.br/processo',
    })
  })

  // O ENDPOINT DE BUSCA NÃO DIZ O VALOR DEVIDO, só o valor da causa. No polo
  // passivo `ha_cobranca` fica NULL de propósito: o motor lê NULL no passivo
  // como dívida (o lado conservador) sem que este módulo finja ter apurado um
  // número que não apurou.
  it('no polo passivo a cobrança fica indeterminada, não inventada', () => {
    expect(traduzirProcesso(processo(), { documento: CPF_CEDENTE })?.ha_cobranca).toBeNull()
  })

  // Autor não é cobrado. Isso é um `false` honesto, e poupa a planilha de
  // contar como indeterminado o que não tem indeterminação nenhuma.
  it('no polo ativo não há cobrança contra ele, e nem valor', () => {
    const p = processo({
      valor: '99000.00',
      envolvidos: [parte({ cpf: CPF_CEDENTE, polo: 'ATIVO' })],
    })
    const linha = traduzirProcesso(p, { documento: CPF_CEDENTE })
    expect(linha?.ha_cobranca).toBe(false)
    expect(linha?.valor_cobrado).toBeNull()
  })

  // O CRÉDITO QUE ESTAMOS COMPRANDO VOLTA NA BUSCA. Sem tirá-lo, a linha 10 da
  // planilha diria "Sim, o cedente tem dívida" apontando o próprio processo da
  // cessão — o crédito virando prova contra si mesmo.
  it('o crédito em análise não entra na lista de dívidas', () => {
    const alvo = { documento: CPF_CEDENTE, cnjDoCredito: CREDITO }
    expect(traduzirProcesso(processo({ numero: CREDITO }), alvo)).toBeNull()
    // E por dígito: máscara diferente é o mesmo processo.
    expect(traduzirProcesso(processo({ numero: '50002561220248130313' }), alvo)).toBeNull()
  })

  it('item sem número de processo é descartado', () => {
    expect(traduzirProcesso({ numero_cnj: '' }, {})).toBeNull()
    expect(traduzirProcesso({}, {})).toBeNull()
  })
})

describe('apurarProcessos', () => {
  it('não repete o mesmo processo escrito de dois jeitos', () => {
    const lista = apurarProcessos(
      [
        processo({ numero: '0801234-56.2021.8.09.0051' }),
        processo({ numero: '08012345620218090051' }),
        processo({ numero: '0809999-11.2022.8.09.0051' }),
      ],
      { documento: CPF_CEDENTE },
    )
    expect(lista.map((l) => l.numero_processo)).toEqual([
      '0801234-56.2021.8.09.0051',
      '0809999-11.2022.8.09.0051',
    ])
  })

  it('lista vazia não quebra', () => {
    expect(apurarProcessos([], {})).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// A conversa com a API, com o fetch trocado
// ---------------------------------------------------------------------------

type Resposta = { status?: number; corpo: unknown; creditos?: string }

function fingirApi(respostas: Resposta[]) {
  const chamadas: string[] = []
  let i = 0
  vi.stubGlobal('fetch', (url: string) => {
    chamadas.push(String(url))
    const r = respostas[Math.min(i++, respostas.length - 1)]
    return Promise.resolve(
      new Response(JSON.stringify(r.corpo), {
        status: r.status ?? 200,
        headers: r.creditos ? { 'Creditos-Utilizados': r.creditos } : {},
      }),
    )
  })
  return chamadas
}

afterEach(() => vi.unstubAllGlobals())

describe('processosDoEnvolvido', () => {
  it('busca pelo CPF em dígitos e manda o token no header', async () => {
    const chamadas = fingirApi([{ corpo: { items: [processo()] }, creditos: '35' }])
    const r = await processosDoEnvolvido('tok-123', { documento: '123.456.789-00' })
    expect(chamadas[0]).toContain('cpf_cnpj=12345678900')
    expect(chamadas[0]).toContain('limit=100')
    expect(r.items).toHaveLength(1)
    expect(r.centavos).toBe(35)
    expect(r.truncado).toBe(false)
  })

  // O CURSOR É OPACO E ASSINADO: seguir o `links.next` da própria API é o único
  // jeito correto de paginar, e os créditos de cada página somam.
  it('segue links.next e soma os créditos das páginas', async () => {
    const chamadas = fingirApi([
      {
        corpo: {
          envolvido_encontrado: { nome: 'Fulano', quantidade_processos: 2 },
          items: [processo({ numero: '0800001-11.2020.8.09.0051' })],
          links: { next: 'https://api.escavador.com/api/v2/envolvido/processos?cursor=abc' },
        },
        creditos: '20',
      },
      { corpo: { items: [processo({ numero: '0800002-22.2021.8.09.0051' })] }, creditos: '20' },
    ])
    const r = await processosDoEnvolvido('tok', { documento: CPF_CEDENTE })
    expect(chamadas).toHaveLength(2)
    expect(chamadas[1]).toContain('cursor=abc')
    expect(r.items).toHaveLength(2)
    expect(r.centavos).toBe(40)
    expect(r.encontrado).toMatchObject({ nome: 'Fulano' })
  })

  // O TETO EXISTE PORQUE A API É PAGA. Estourá-lo não é "achei tudo isto": a
  // apuração volta marcada, e quem decide se vale pagar mais é quem opera.
  it('para no teto de páginas e diz que truncou', async () => {
    const chamadas = fingirApi([
      { corpo: { items: [processo()], links: { next: 'https://api.escavador.com/proxima' } } },
    ])
    const r = await processosDoEnvolvido('tok', { documento: CPF_CEDENTE })
    expect(chamadas).toHaveLength(5)
    expect(r.truncado).toBe(true)
  })

  it('sem CPF nem nome, nem chega a chamar a API', async () => {
    const chamadas = fingirApi([{ corpo: {} }])
    await expect(processosDoEnvolvido('tok', {})).rejects.toBeInstanceOf(ErroEscavador)
    expect(chamadas).toHaveLength(0)
  })

  // As falhas do Escavador chegam como uma linha em inglês. Sem traduzir,
  // apareceriam na tela como erro genérico e mandariam procurar defeito no
  // lugar errado.
  it('401 fala do token, 402 fala do saldo', async () => {
    fingirApi([{ status: 401, corpo: { error: 'Unauthenticated' } }])
    await expect(processosDoEnvolvido('ruim', { documento: CPF_CEDENTE })).rejects.toThrow(
      /recusou o token/,
    )
    vi.unstubAllGlobals()
    fingirApi([{ status: 402, corpo: { error: 'Você não possui saldo em crédito da API.' } }])
    await expect(processosDoEnvolvido('tok', { documento: CPF_CEDENTE })).rejects.toThrow(
      /Sem saldo/,
    )
  })
})

describe('identidadeDoAdvogado', () => {
  // A LIGAÇÃO QUE FALTAVA: nos autos o advogado só tem OAB, e dívida se procura
  // por CPF. É esta chamada que dá a linha 11 uma fonte.
  it('a OAB entra, o CPF sai', async () => {
    const chamadas = fingirApi([
      {
        corpo: {
          nome: 'Fulano da Silva',
          cpf: '123.456.789-00',
          quantidade_processos: 153,
          sociedades: [{ nome: 'SILVA E SOUZA ADVOGADOS', uf: 'BA' }],
        },
      },
    ])
    const r = await identidadeDoAdvogado('tok', { uf: 'go', numero: '12.345' })
    expect(chamadas[0]).toContain('oab_estado=GO')
    expect(chamadas[0]).toContain('oab_numero=12345')
    expect(r).toMatchObject({ nome: 'Fulano da Silva', cpf: CPF_CEDENTE, quantidadeProcessos: 153 })
  })

  it('CPF ausente ou truncado vira nulo, não string quebrada', async () => {
    fingirApi([{ corpo: { nome: 'Fulano', cpf: '123' } }])
    expect((await identidadeDoAdvogado('tok', { uf: 'GO', numero: '1' })).cpf).toBeNull()
  })
})

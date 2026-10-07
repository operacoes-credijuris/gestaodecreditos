/**
 * OS AUTOS JUNTADOS (pedido do dono, 07/10/2026): um PDF por processo, em
 * partes só quando o tamanho obriga — e a análise preferindo as partes aos
 * documentos soltos dos cards antigos.
 *
 * Os tamanhos vêm dos dados reais medidos no mesmo dia: 14 processos, de 21 a
 * 421 documentos, até 187 MB.
 */
import { describe, it, expect } from 'vitest'
import {
  ALVO_PARTE_BYTES,
  alvoEfetivo,
  antesDaParte,
  arquivosParaAnalise,
  depoisDaParte,
  ehParteJuntada,
  ehSoltoDoRotulo,
  faltaMedir,
  type Juntada,
  juntadaInicial,
  lerJuntada,
  MIN_ALVO_BYTES,
  nomeDaParte,
  notaDaJuntadaQueFalhou,
  notaDosAutosJuntos,
  planoDasPartes,
  proximoPasso,
  registrarParte,
  type DocDaJuntada,
  type ProcessoParaAnalise,
} from '../../../supabase/functions/_shared/autosJuntos.ts'
import { ehAnexoDosAutos, impressaoDoCard } from '../../../supabase/functions/_shared/processosDoCredito.ts'

const MB = 1024 * 1024
const CNJ = '8015250-24.2020.8.05.0000'

/** n documentos de tamanho igual somando `total` bytes, um por dia a partir de 2020-01-01. */
function processo(n: number, total: number): DocDaJuntada[] {
  return Array.from({ length: n }, (_, i) => ({
    ordem: i + 1,
    chave: `k${i + 1}`,
    nome: `Documento ${i + 1}`,
    data: new Date(Date.UTC(2020, 0, 1 + i)).toISOString().slice(0, 19),
    paginas: 3,
    bytes: Math.floor(total / n),
  }))
}

/**
 * A rotina inteira, sem rede: cada "invocação" lê o estado do JSON (como do
 * banco), faz UMA parte e grava o JSON de volta. É a retomada de verdade — nada
 * passa de uma invocação para a outra senão o que está serializado.
 */
function simular(docs: DocDaJuntada[], estado: Juntada = juntadaInicial('novo')) {
  let banco = JSON.stringify(estado)
  let invocacoes = 0
  for (;;) {
    const j = lerJuntada(JSON.parse(banco))!
    const passo = proximoPasso(docs, j)
    if (passo.passo !== 'parte') break
    invocacoes++
    expect(antesDaParte(j)).toBe('seguir')
    banco = JSON.stringify(j) // a tentativa conta ANTES de montar
    const daParte = docs.filter((d) => passo.parte.ordens.includes(d.ordem))
    registrarParte(j, {
      n: passo.n,
      de: passo.parte.ordens[0],
      ate: passo.parte.ordens.at(-1)!,
      nome: nomeDaParte('Conhecimento', CNJ, passo.n, passo.total),
      uuid: `u${passo.n}`,
      versao: `v${passo.n}`,
      bytes: passo.parte.bytes,
      paginas: daParte.reduce((t, d) => t + d.paginas, 0),
      documentos: daParte.length,
      primeiro: daParte[0].data,
      ultimo: daParte.at(-1)!.data,
      ligada: true,
      nota: 'pendente',
    })
    depoisDaParte(j, 'ok')
    banco = JSON.stringify(j)
    if (invocacoes > 100) throw new Error('não terminou')
  }
  return { j: lerJuntada(JSON.parse(banco))!, invocacoes }
}

describe('o plano das partes', () => {
  it('processo pequeno (21 documentos, 6 MB): um PDF só, "autos completos"', () => {
    const docs = processo(21, 6 * MB)
    const { j, invocacoes } = simular(docs)
    expect(invocacoes).toBe(1)
    expect(j.partes).toHaveLength(1)
    expect(j.partes[0].nome).toBe(`Conhecimento - autos completos - ${CNJ}.pdf`)
    expect(j.partes[0].documentos).toBe(21)
  })

  it('o maior processo (421 documentos, 187 MB): 4 partes, uma por invocação, nomes que batem', () => {
    const docs = processo(421, 187 * MB)
    const { j, invocacoes } = simular(docs)
    expect(invocacoes).toBe(4)
    expect(j.partes.map((p) => p.nome)).toEqual([1, 2, 3, 4].map((n) => `Conhecimento - autos (parte ${n} de 4) - ${CNJ}.pdf`))
    // Todos os documentos, cada um uma vez, na ordem do processo.
    expect(j.partes.reduce((t, p) => t + p.documentos, 0)).toBe(421)
    for (let i = 1; i < j.partes.length; i++) expect(j.partes[i].de).toBe(j.partes[i - 1].ate + 1)
    expect(j.partes[0].de).toBe(1)
    expect(j.partes.at(-1)!.ate).toBe(421)
    for (const p of j.partes) expect(p.bytes).toBeLessThanOrEqual(ALVO_PARTE_BYTES)
  })

  it('não reordena: a parte 1 é o começo do processo, mesmo que outra ordem "encaixasse melhor"', () => {
    const docs = [
      { ordem: 1, bytes: 30 },
      { ordem: 2, bytes: 30 },
      { ordem: 3, bytes: 10 },
    ]
    expect(planoDasPartes(docs, 40).map((p) => p.ordens)).toEqual([[1], [2, 3]])
  })

  it('documento maior que o alvo vai sozinho numa parte', () => {
    const docs = [
      { ordem: 1, bytes: 5 },
      { ordem: 2, bytes: 100 },
      { ordem: 3, bytes: 5 },
    ]
    expect(planoDasPartes(docs, 40).map((p) => p.ordens)).toEqual([[1], [2], [3]])
  })

  it('pula o que já foi juntado e o que ficou de fora', () => {
    const docs = processo(6, 6)
    expect(planoDasPartes(docs, 100, { desde: 2, fora: [4] }).map((p) => p.ordens)).toEqual([[3, 5, 6]])
  })

  it('sem tamanho medido não há plano: primeiro mede', () => {
    const docs = processo(3, 3 * MB)
    docs[1].bytes = null
    const j = juntadaInicial('novo')
    expect(faltaMedir(docs, j).map((d) => d.ordem)).toEqual([2])
    expect(proximoPasso(docs, j).passo).toBe('medir')
    // O que ficou de fora não precisa de tamanho.
    j.naoJuntados.push({ ordem: 2, nome: 'x', data: null, motivo: 'HTTP 404' })
    expect(proximoPasso(docs, j)).toMatchObject({ passo: 'parte', n: 1, total: 1 })
  })

  it('respeita o teto de arquivo do Kommo, com folga', () => {
    const j = juntadaInicial('novo')
    expect(alvoEfetivo(j)).toBe(ALVO_PARTE_BYTES)
    j.maxKommo = 20 * MB
    expect(alvoEfetivo(j)).toBe(Math.floor(20 * MB * 0.95))
  })

  it('tudo junto: o passo seguinte é fechar', () => {
    const docs = processo(5, 5 * MB)
    const { j } = simular(docs)
    expect(proximoPasso(docs, j).passo).toBe('fechar')
  })
})

describe('a retomada quando a volta cai no meio da parte', () => {
  it('duas quedas na mesma parte encolhem o alvo pela metade; passageira não conta', () => {
    const j = juntadaInicial('novo')
    expect(antesDaParte(j)).toBe('seguir') // 1ª tentativa — a volta morre (memória)
    const salvo = lerJuntada(JSON.parse(JSON.stringify(j)))!
    expect(salvo.falhas).toBe(1)
    expect(antesDaParte(salvo)).toBe('seguir') // 2ª — morre de novo
    expect(antesDaParte(salvo)).toBe('seguir') // 3ª: encolheu antes de tentar
    expect(salvo.alvo).toBe(ALVO_PARTE_BYTES / 2)
    // Rede caída devolve a tentativa: a parte não teve culpa.
    depoisDaParte(salvo, 'passageira')
    expect(salvo.falhas).toBe(0)
    depoisDaParte(salvo, 'ok')
    expect(salvo.passageiras).toBe(0)
  })

  it('nem o menor alvo passa: desiste', () => {
    const j = juntadaInicial('novo')
    j.alvo = MIN_ALVO_BYTES
    j.falhas = 2
    expect(antesDaParte(j)).toBe('desistir')
  })

  it('depois de encolher, o plano continua de onde parou, sem refazer as partes prontas', () => {
    const docs = processo(100, 100 * MB)
    const j = juntadaInicial('novo')
    const p1 = proximoPasso(docs, j)
    if (p1.passo !== 'parte') throw new Error()
    registrarParte(j, {
      n: 1, de: 1, ate: p1.parte.ordens.at(-1)!, nome: 'p1', uuid: 'u1', versao: null, bytes: p1.parte.bytes,
      paginas: 0, documentos: p1.parte.ordens.length, primeiro: null, ultimo: null, ligada: true, nota: 'feita',
    })
    j.alvo = ALVO_PARTE_BYTES / 2
    const p2 = proximoPasso(docs, j)
    if (p2.passo !== 'parte') throw new Error()
    expect(p2.n).toBe(2)
    expect(p2.parte.ordens[0]).toBe(p1.parte.ordens.at(-1)! + 1)
  })

  it('o estado é JSON puro e sobrevive a lixo', () => {
    expect(lerJuntada(null)).toBeNull()
    expect(lerJuntada({ v: 2 })).toBeNull()
    const j = lerJuntada({ v: 1, alvo: 'x', partes: [{ n: 1 }, { n: 2, uuid: 'u', nota: 'outra' }], naoJuntados: 'x' })!
    expect(j.alvo).toBe(ALVO_PARTE_BYTES)
    expect(j.partes).toHaveLength(1)
    expect(j.partes[0].nota).toBe('pendente')
    expect(j.naoJuntados).toEqual([])
    expect(lerJuntada(JSON.parse(JSON.stringify(juntadaInicial('rejuntar'))))).toEqual(juntadaInicial('rejuntar'))
  })
})

describe('os nomes', () => {
  it('rótulo na frente e CNJ no fim', () => {
    expect(nomeDaParte('Conhecimento', CNJ, 1, 1)).toBe(`Conhecimento - autos completos - ${CNJ}.pdf`)
    expect(nomeDaParte('Precatório', CNJ, 2, 3)).toBe(`Precatório - autos (parte 2 de 3) - ${CNJ}.pdf`)
    expect(nomeDaParte('Conhecimento e cumprimento', CNJ, 1, 2)).toBe(
      `Conhecimento e cumprimento - autos (parte 1 de 2) - ${CNJ}.pdf`,
    )
    expect(nomeDaParte('Autos', CNJ, 1, 1)).toBe(`Autos completos - ${CNJ}.pdf`)
  })

  it('a parte é reconhecida como anexo da rotina — senão cada nota de anexo pediria leitura paga pela IA', () => {
    const parte = nomeDaParte('Cumprimento', CNJ, 1, 2)
    expect(ehParteJuntada(parte)).toBe(true)
    expect(ehAnexoDosAutos(parte)).toBe(true)
    expect(ehAnexoDosAutos(`📎 ${parte}`)).toBe(true)
    expect(ehAnexoDosAutos('📎 Conhecimento 001 - 09-06-2020 - Petição Inicial.pdf')).toBe(true)
    expect(ehAnexoDosAutos('Ofício requisitório.pdf')).toBe(false)
    expect(ehParteJuntada('Petição - autos do cliente.pdf')).toBe(false)
  })

  it('a nota de anexo de uma parte não muda a impressão do card', () => {
    const antes = impressaoDoCard('X - Fulano - 123', [{ texto: 'dados do crédito', automatica: false }] as any)
    const depois = impressaoDoCard('X - Fulano - 123', [
      { texto: 'dados do crédito', automatica: false },
      { texto: `📎 ${nomeDaParte('Precatório', CNJ, 1, 1)}`, automatica: true, arquivo_uuid: 'u1' },
    ] as any)
    expect(depois).toBe(antes)
  })
})

describe('partes > soltos, no "Executar análise"', () => {
  const parte1 = { uuid: 'p1', nome: nomeDaParte('Conhecimento', CNJ, 1, 2) }
  const parte2 = { uuid: 'p2', nome: nomeDaParte('Conhecimento', CNJ, 2, 2) }
  const solto1 = { uuid: 's1', nome: 'Conhecimento 001 - 09-06-2020 - Petição Inicial.pdf' }
  const solto2 = { uuid: 's2', nome: 'Conhecimento 002 - 10-06-2020 - Despacho.pdf' }
  const repetido = { uuid: 's9', nome: 'Conhecimento 001 - 09-06-2020 - Petição Inicial.pdf' }
  const doComercial = { uuid: 'c1', nome: 'Ofício requisitório.pdf' }
  const conhecimento: ProcessoParaAnalise = {
    cnj: CNJ, rotulo: 'Conhecimento', juntado: true, partes: ['p1', 'p2'],
    soltos: [{ uuid: 's1', ordem: 1 }, { uuid: 's2', ordem: 2 }],
  }

  it('lê as partes e o que é do comercial; deixa os soltos do processo juntado', () => {
    const r = arquivosParaAnalise([solto1, parte1, solto2, parte2, repetido, doComercial], [conhecimento])
    expect(r.ler.map((a) => a.uuid)).toEqual(['p1', 'p2', 'c1'])
    expect(r.ignorados.map((a) => a.uuid)).toEqual(['s1', 's2', 's9'])
  })

  it('pelo uuid, mesmo sem nome (antes de pedir os metadados ao drive)', () => {
    const r = arquivosParaAnalise([{ uuid: 's1' }, { uuid: 'p1' }, { uuid: 'p2' }, { uuid: 'x' }], [conhecimento])
    expect(r.ignorados.map((a) => a.uuid)).toEqual(['s1'])
  })

  it('parte apagada do card: os soltos voltam a valer — nada fica sem ler', () => {
    const r = arquivosParaAnalise([solto1, parte1, solto2], [conhecimento])
    expect(r.ignorados).toEqual([])
  })

  it('junção que não terminou não substitui nada', () => {
    const r = arquivosParaAnalise([solto1, parte1, parte2], [{ ...conhecimento, juntado: false }])
    expect(r.ignorados).toEqual([])
  })

  it('dois processos com o mesmo rótulo, um juntado e outro não: pelo nome não se decide', () => {
    const outro: ProcessoParaAnalise = { cnj: '0000001-00.2019.8.05.0001', rotulo: 'Conhecimento', juntado: false, partes: [], soltos: [] }
    const r = arquivosParaAnalise([solto1, parte1, parte2, repetido], [conhecimento, outro])
    // s1 sai pelo uuid (é do juntado); o repetido, sem uuid conhecido, fica.
    expect(r.ignorados.map((a) => a.uuid)).toEqual(['s1'])
  })

  it('soltos de OUTRO processo do card ficam', () => {
    const precatorio = { uuid: 'q1', nome: 'Precatório 001 - 01-01-2024 - Ofício.pdf' }
    const prc: ProcessoParaAnalise = { cnj: '1', rotulo: 'Precatório', juntado: false, partes: [], soltos: [{ uuid: 'q1', ordem: 1 }] }
    const r = arquivosParaAnalise([precatorio, parte1, parte2], [conhecimento, prc])
    expect(r.ler.map((a) => a.uuid)).toContain('q1')
  })

  it('o solto de um documento que ficou FORA da junção continua sendo lido (pelo uuid e pelo nome)', () => {
    const r = arquivosParaAnalise([solto1, solto2, parte1, parte2, repetido], [{ ...conhecimento, naoJuntados: [1] }])
    // s1 e o repetido são o documento 001, que não entrou nas partes: ficam. s2 sai.
    expect(r.ler.map((a) => a.uuid)).toEqual(['s1', 'p1', 'p2', 's9'])
    expect(r.ignorados.map((a) => a.uuid)).toEqual(['s2'])
  })

  it('card sem processo da rotina: tudo é lido', () => {
    const r = arquivosParaAnalise([solto1, doComercial], [])
    expect(r.ignorados).toEqual([])
  })

  it('o solto se reconhece com e sem acento, e não confunde rótulos', () => {
    expect(ehSoltoDoRotulo('Precatorio 012 - Oficio.pdf', 'Precatório')).toBe(true)
    expect(ehSoltoDoRotulo('Conhecimento e cumprimento 003 - x.pdf', 'Conhecimento')).toBe(false)
    expect(ehSoltoDoRotulo('Conhecimento 1 - x.pdf', 'Conhecimento')).toBe(false)
  })
})

describe('a nota dos autos juntados', () => {
  const partes = [
    { nome: nomeDaParte('Conhecimento', CNJ, 1, 2), documentos: 200, paginas: 1500, primeiro: '2020-06-09T15:54:00', ultimo: '2023-01-10T00:00:00', nota: 'feita' as const },
    { nome: nomeDaParte('Conhecimento', CNJ, 2, 2), documentos: 219, paginas: 1171, primeiro: '2023-01-11T00:00:00', ultimo: '2025-09-08T14:35:23', nota: 'feita' as const },
  ]

  it('diz o processo, o papel, quantos documentos em quantos PDFs, as páginas, o período e ONDE estão', () => {
    const t = notaDosAutosJuntos({
      cnj: CNJ,
      rotulo: 'Conhecimento',
      modo: 'novo',
      partes,
      totalDocumentos: 421,
      naoJuntados: [{ ordem: 37, nome: 'Certidão', data: '2021-02-10T00:00:00', motivo: 'PDF protegido por senha (cifrado)' }],
    })
    expect(t).toContain(`Autos do processo ${CNJ} (conhecimento)`)
    expect(t).toContain('419 documento(s) reunidos em 2 PDFs')
    expect(t).toContain('2.671 páginas')
    expect(t).toContain('de 09/06/2020 a 08/09/2025')
    expect(t).toContain('Os PDFs estão logo acima, neste chat, e na área Arquivos do card')
    expect(t).toContain(`• ${partes[0].nome}`)
    expect(t).toContain('1 documento(s) não puderam ser juntados: 037 - 10/02/2021 - Certidão (PDF protegido por senha (cifrado))')
    expect(t).not.toContain('soltos')
  })

  it('um PDF só; e o rejuntado avisa que os soltos continuam no card', () => {
    const t = notaDosAutosJuntos({
      cnj: CNJ, rotulo: 'Precatório', modo: 'rejuntar', partes: [{ ...partes[0], nome: nomeDaParte('Precatório', CNJ, 1, 1) }],
      totalDocumentos: 200, naoJuntados: [],
    })
    expect(t).toContain('reunidos em um PDF só')
    expect(t).toContain('O PDF está logo acima, neste chat')
    expect(t).toContain('continuam na área Arquivos')
    expect(t).not.toContain('⚠️')
  })

  it('nota de anexo recusada: não promete o chat', () => {
    const t = notaDosAutosJuntos({
      cnj: CNJ, rotulo: 'Conhecimento', modo: 'novo', partes: [partes[0], { ...partes[1], nota: 'recusada' }],
      totalDocumentos: 419, naoJuntados: [],
    })
    expect(t).not.toContain('logo acima')
    expect(t).toContain('na área Arquivos do card')
  })

  it('a junção que falhou diz o que subiu e o que falta', () => {
    const t = notaDaJuntadaQueFalhou({ cnj: CNJ, rotulo: 'Cumprimento', partes: [partes[0]], motivo: 'o Kommo recusou' })
    expect(t).toContain(`processo ${CNJ} (cumprimento)`)
    expect(t).toContain('Subiram 1 parte(s)')
    expect(t).toContain('O resto do processo não está no card')
  })
})

describe('na plataforma: o histórico do card mostra as partes junto da nota dos autos', () => {
  it('as notas de anexo e a nota de texto, escritas em sequência, viram um bloco só', async () => {
    const { agruparNotas, nomeDoAnexo } = await import('@/lib/historicoDeNotas')
    const t = Date.parse('2026-10-07T15:00:00Z')
    const em = (s: number) => new Date(t + s * 1000).toISOString()
    // Como o kommo-sync espelha: o anexo vira "📎 nome", com o uuid; autor é o usuário do token.
    const notas = [
      { id: 1, texto: `📎 ${nomeDaParte('Conhecimento', CNJ, 1, 2)}`, criado_em: em(0), autor: 'Integração', tipo: 'attachment', arquivo_uuid: 'p1' },
      { id: 2, texto: `📎 ${nomeDaParte('Conhecimento', CNJ, 2, 2)}`, criado_em: em(1), autor: 'Integração', tipo: 'attachment', arquivo_uuid: 'p2' },
      { id: 3, texto: '📂 Autos do processo …', criado_em: em(2), autor: 'Integração', tipo: 'common' },
    ]
    const blocos = agruparNotas(notas)
    expect(blocos).toHaveLength(1)
    expect(blocos[0].nota.id).toBe(3)
    expect(blocos[0].anexos.map((a) => nomeDoAnexo(a))).toEqual([
      nomeDaParte('Conhecimento', CNJ, 1, 2),
      nomeDaParte('Conhecimento', CNJ, 2, 2),
    ])
  })
})

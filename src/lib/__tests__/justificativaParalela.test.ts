/**
 * A JUSTIFICATIVA TÉCNICA EM FRENTES PARALELAS E RESUMÍVEIS (05/10/2026): as
 * regras puras que a Edge Function `justificativa-tecnica` e a janela dividem.
 *
 * Nada aqui chama a Anthropic, o Kommo ou o banco. O banco da gravação
 * condicional é uma loja falsa em memória, com atrasos sorteados para as frentes
 * se atropelarem de verdade.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  aposInterrupcao,
  aposResposta,
  type BlocoDaConversa,
  cabeMaisUmaGeracao,
  comPlano,
  consumoTotal,
  conversaParaEncerrar,
  decidirFrente,
  dossieDaConversa,
  dossiesDaLinha,
  ehEstadoV2,
  type EstadoDaPesquisa,
  estadoInicial,
  fecharFrente,
  FOLGA_PARA_NOVA_CHAMADA_MS,
  type FrenteDoPlano,
  frenteNova,
  frentesOrfas,
  FRENTE_SEM_SINAL_MS,
  gravarComVersao,
  juntarDossies,
  MAX_BUSCAS_POR_FRENTE,
  MAX_FRENTES,
  MAX_INVOCACOES_DA_FRENTE,
  MAX_PAGINAS_POR_FRENTE,
  type MensagemDaConversa,
  PEDIDO_DE_CONTINUAR,
  PEDIDO_DE_ENCERRAR,
  pedidoDaFrente,
  pendentesNoFim,
  planoDaSaida,
  pontoSeguro,
  salvarCheckpoint,
  TETO_DA_FRENTE_MIN,
  TITULO_FRENTE_UNICA,
  tomarFrente,
  usoDosBlocos,
  usosRestantes,
  VAGAS_DE_PESQUISA,
  vagasOcupadas,
} from '../../../supabase/functions/_shared/justificativaParalela.ts'
import {
  blocoDoCard,
  CONSUMO_ZERO,
  geracaoParada,
  juntarNotas,
  MARCA_NOTAS,
  montarPrompt,
  NOTA_AUTOMATICA_MAX_CARACTERES,
  NOTA_IA_MAX_CARACTERES,
  notasDoCardParaIA,
  separarNotas,
  textoComFontes,
  TRAVA_GERACAO_MIN,
  valoresDoCard,
} from '../../../supabase/functions/_shared/justificativaTecnica.ts'

const AGORA = new Date('2026-10-05T15:00:00.000Z')
const minutosDepois = (m: number) => new Date(AGORA.getTime() + m * 60_000)

// ---------------------------------------------------------------- 1. o plano

/** O plano que o prompt do dono pede: as quatro frentes do relato. */
const PLANO_DO_DONO = {
  frentes: [
    { titulo: 'Posição e andamento da fila', perguntas: ['Qual o ano de orçamento mais antigo pendente do Estado de Goiás no TJGO?', 'Editais de acordo direto de 2024, 2025 e 2026'], trazer: 'ano mais antigo pendente por data', contexto: 'Ente: GOINFRA (fila do Estado de Goiás); LOA 2027' },
    { titulo: 'Ritmo, repasses, EC 136, RPV e comitê', perguntas: ['Repasse anual do Estado ao TJGO', 'Efeito da EC 136/2025'], trazer: 'valores anuais com fonte', contexto: 'Estado de Goiás, regime especial' },
    { titulo: 'Situação fiscal (RGF) e acordo direto', perguntas: ['RGF Anexo 2: precatórios vencidos'], trazer: 'evolução do saldo', contexto: '' },
    { titulo: 'Peculiaridades e LOA', perguntas: ['Exigências formais de cessão no TJGO'], trazer: 'normas', contexto: 'natureza alimentar' },
  ],
}

describe('planejamento — as frentes', () => {
  it('lê o plano do prompt do dono: quatro frentes, com perguntas e contexto', () => {
    const p = planoDaSaida(PLANO_DO_DONO)!
    expect(p.map((f) => f.titulo)).toEqual([
      'Posição e andamento da fila',
      'Ritmo, repasses, EC 136, RPV e comitê',
      'Situação fiscal (RGF) e acordo direto',
      'Peculiaridades e LOA',
    ])
    expect(p[0].perguntas).toHaveLength(2)
    expect(p[0].contexto).toContain('LOA 2027')
  })

  it(`mais de ${MAX_FRENTES}: as perguntas das que sobram vão para a última (nada se perde)`, () => {
    const seis = { frentes: [...PLANO_DO_DONO.frentes, { titulo: 'Extra A', perguntas: ['pa'], trazer: 'ta', contexto: '' }, { titulo: 'Extra B', perguntas: ['pb'], trazer: '', contexto: '' }] }
    const p = planoDaSaida(seis)!
    expect(p).toHaveLength(MAX_FRENTES)
    expect(p[3].perguntas).toEqual(['Exigências formais de cessão no TJGO', '(Extra A) pa', '(Extra B) pb'])
  })

  it('menos de duas frentes legíveis, ou saída torta: null (cai na frente única)', () => {
    expect(planoDaSaida({ frentes: [PLANO_DO_DONO.frentes[0]] })).toBeNull()
    expect(planoDaSaida({ frentes: [{ titulo: '', perguntas: ['x'] }, { titulo: 'Y', perguntas: [] }] })).toBeNull()
    expect(planoDaSaida(null)).toBeNull()
    expect(planoDaSaida('texto')).toBeNull()
  })

  it('o plano falhou: uma frente única, resumível, com a tarefa inteira e tetos maiores', () => {
    const e = comPlano(estadoInicial('PROMPT', AGORA), null, 'saída do planejamento invalida', null, AGORA)
    expect(e.plano).toEqual({ origem: 'reserva', motivo: 'saída do planejamento invalida' })
    expect(e.frentes).toHaveLength(1)
    expect(e.frentes[0]).toMatchObject({ id: 'f1', titulo: TITULO_FRENTE_UNICA, unica: true, status: 'pesquisando' })
    expect(e.fase).toBe('pesquisando')
    expect(usosRestantes(e.frentes[0]).buscas).toBeGreaterThan(MAX_BUSCAS_POR_FRENTE)
  })

  it('com plano: uma frente por item, ids f1…f4, todas pesquisando', () => {
    const e = comPlano(estadoInicial('PROMPT', AGORA), planoDaSaida(PLANO_DO_DONO), null, null, AGORA)
    expect(e.frentes.map((f) => f.id)).toEqual(['f1', 'f2', 'f3', 'f4'])
    expect(e.frentes.every((f) => f.status === 'pesquisando' && !f.unica)).toBe(true)
    expect(e.plano?.origem).toBe('planejado')
  })

  it('a frente recebe só o que precisa: a frente, o contexto e o mínimo do crédito — sem cedente, fundo nem comissão', () => {
    const f = planoDaSaida(PLANO_DO_DONO)![0]
    const t = pedidoDaFrente(f, {
      cedente: 'MARIA DA SILVA', fundo_escolhido: 'BTG', comissao: 'R$ 40.000,00 (limitada)',
      ente_devedor: 'GOINFRA', tribunal: 'TJGO', data_hoje: '05/10/2026', notas: 'nota longa do comercial',
    }, 'Você é analista… (o prompt da casa)')
    expect(t).toContain('SUA FRENTE: Posição e andamento da fila')
    expect(t).toContain('1. Qual o ano de orçamento mais antigo pendente')
    expect(t).toContain('- Ente devedor: GOINFRA')
    expect(t).toContain('- Data de hoje: 05/10/2026')
    expect(t).toContain('LOA 2027')
    expect(t).toContain('o prompt da casa')
    for (const fora of ['MARIA DA SILVA', 'BTG', 'R$ 40.000,00', 'nota longa do comercial']) expect(t).not.toContain(fora)
  })
})

// ---------------------------------------------------------------- 2. o checkpoint e a retomada

const busca = (id: string, extra: Record<string, unknown> = {}): BlocoDaConversa[] => [
  { type: 'server_tool_use', id, name: 'web_search', input: { query: `q ${id}` } },
  { type: 'web_search_tool_result', tool_use_id: id, content: [{ type: 'web_search_result', url: `https://x.gov.br/${id}`, title: id, encrypted_content: `ENC-${id}` }], ...extra },
]
const pensar: BlocoDaConversa = { type: 'thinking', thinking: '', signature: 'SIG-1' }
const inicio: MensagemDaConversa[] = [{ role: 'user', content: 'SUA FRENTE: fila' }]

describe('checkpoint — o ponto seguro da conversa', () => {
  it('só corta onde toda chamada de ferramenta tem resultado, terminando num resultado ou texto', () => {
    const blocos = [pensar, ...busca('s1'), pensar, { type: 'server_tool_use', id: 's2', name: 'web_fetch', input: {} }]
    expect(pontoSeguro(blocos)).toBe(3) // pensar + s1 + resultado; a chamada s2 sem resultado fica de fora
    expect(pontoSeguro([pensar])).toBe(0)
    expect(pontoSeguro([pensar, { type: 'text', text: 'parcial' }])).toBe(2)
  })

  it('o filtro dinâmico (execução de código com buscas dentro): só fecha quando o código fecha', () => {
    const blocos: BlocoDaConversa[] = [
      { type: 'server_tool_use', id: 'c1', name: 'code_execution', input: {} },
      ...busca('s1', { caller: { type: 'code_execution_20260120', tool_id: 'c1' } }),
      { type: 'code_execution_tool_result', tool_use_id: 'c1', content: { stdout: 'ok' } },
    ]
    expect(pontoSeguro(blocos.slice(0, 3))).toBe(0) // a busca terminou, o código não
    expect(pontoSeguro(blocos)).toBe(4)
  })

  it('um pause_turn que terminou com chamada pendente: o pendente é resolvido pela continuação', () => {
    const conversa: MensagemDaConversa[] = [...inicio, { role: 'assistant', content: [pensar, { type: 'server_tool_use', id: 's9', name: 'web_search', input: {} }] }]
    expect([...pendentesNoFim(conversa)]).toEqual(['s9'])
    // A continuação começa pelo resultado do pendente.
    const parcial: BlocoDaConversa[] = [{ type: 'web_search_tool_result', tool_use_id: 's9', content: [] }, pensar]
    expect(pontoSeguro(parcial, pendentesNoFim(conversa))).toBe(1)
    expect(pontoSeguro([pensar], pendentesNoFim(conversa))).toBe(0)
  })

  it('cortada pelo relógio: salva até o ponto seguro e fecha o turno com o pedido de continuar', () => {
    const blocos = [pensar, ...busca('s1'), pensar, { type: 'server_tool_use', id: 's2', name: 'web_search', input: {} }]
    const r = aposInterrupcao(inicio, blocos)
    expect(r.avancou).toBe(true)
    expect(r.conversa).toHaveLength(3)
    expect(r.conversa[1]).toEqual({ role: 'assistant', content: blocos.slice(0, 3) })
    expect(r.conversa[2]).toEqual({ role: 'user', content: [{ type: 'text', text: PEDIDO_DE_CONTINUAR }] })
    // Sem nada salvável: a conversa fica como estava, e não avançou.
    expect(aposInterrupcao(inicio, [pensar])).toEqual({ conversa: inicio, avancou: false })
  })

  it('o estado é serializável: o JSON de ida e volta devolve os blocos INTACTOS (assinatura, encrypted_content)', () => {
    const r = aposInterrupcao(inicio, [pensar, ...busca('s1')])
    const e0 = comPlano(estadoInicial('P', AGORA), planoDaSaida(PLANO_DO_DONO), null, null, AGORA)
    const tomado = tomarFrente(e0, 'f1', 'inv-1', null, AGORA)!
    const salvo = salvarCheckpoint(tomado, 'f1', 'inv-1', {
      conversa: r.conversa, container: { id: 'cont_1', expires_at: null }, retomadas: 1,
      interrupcoes_sem_avanco: 0, consumo: { ...CONSUMO_ZERO, buscas: 1 }, segundos: 330,
    }, AGORA)!
    const relido = JSON.parse(JSON.stringify(salvo)) as EstadoDaPesquisa
    expect(relido).toEqual(salvo)
    const blocos = relido.frentes[0].conversa![1].content as BlocoDaConversa[]
    expect(blocos[0]).toEqual({ type: 'thinking', thinking: '', signature: 'SIG-1' })
    expect((blocos[2].content as { encrypted_content: string }[])[0].encrypted_content).toBe('ENC-s1')
    expect(ehEstadoV2(relido)).toBe(true)
  })

  it('pause_turn: a resposta entra como veio e a próxima chamada continua (sem mensagem nova)', () => {
    const r = aposResposta(inicio, [pensar, ...busca('s1')], 'pause_turn')
    expect(r.desfecho).toBe('continuar')
    expect(r.conversa[r.conversa.length - 1].role).toBe('assistant')
    expect(aposResposta(inicio, [{ type: 'text', text: 'DOSSIÊ' }], 'end_turn').desfecho).toBe('terminou')
    expect(aposResposta(inicio, [], 'refusal').desfecho).toBe('recusa')
  })

  it('encerrar no teto: tira a chamada pendente do fim e pede o dossiê com o que tem', () => {
    const conversa: MensagemDaConversa[] = [
      ...inicio,
      { role: 'assistant', content: [pensar, ...busca('s1'), { type: 'server_tool_use', id: 's2', name: 'web_search', input: {} }] },
    ]
    const r = conversaParaEncerrar(conversa)
    expect(r[1]).toEqual({ role: 'assistant', content: [pensar, ...busca('s1')] })
    expect(r[2]).toEqual({ role: 'user', content: [{ type: 'text', text: PEDIDO_DE_ENCERRAR }] })
    expect(pendentesNoFim(r).size).toBe(0)
    // Já terminando num pedido do usuário (o de continuar): o de encerrar entra junto.
    const comContinuar = aposInterrupcao(inicio, busca('s1')).conversa
    const r2 = conversaParaEncerrar(comContinuar)
    expect(r2).toHaveLength(3)
    expect(r2[2].content).toEqual([{ type: 'text', text: PEDIDO_DE_CONTINUAR }, { type: 'text', text: PEDIDO_DE_ENCERRAR }])
  })

  it('o dossiê sai da conversa inteira (todas as voltas do assistente)', () => {
    const conversa: MensagemDaConversa[] = [
      ...inicio,
      { role: 'assistant', content: busca('s1') },
      { role: 'user', content: [{ type: 'text', text: PEDIDO_DE_CONTINUAR }] },
      { role: 'assistant', content: [{ type: 'text', text: 'Fila parada desde 2019.', citations: [{ type: 'web_search_result_location', url: 'https://x.gov.br/s1', title: 'TJGO' }] }] },
    ]
    expect(dossieDaConversa(conversa)).toEqual({ texto: 'Fila parada desde 2019. [1]', fontes: [{ url: 'https://x.gov.br/s1', titulo: 'TJGO' }] })
  })

  it('o uso de uma chamada cortada conta os resultados inteiros (erro não é cobrado)', () => {
    expect(usoDosBlocos([
      ...busca('s1'),
      { type: 'web_search_tool_result', tool_use_id: 's2', content: { type: 'web_search_tool_result_error', error_code: 'unavailable' } },
      { type: 'web_fetch_tool_result', tool_use_id: 'f1', content: { type: 'web_fetch_result', url: 'u' } },
    ])).toEqual({ buscas: 1, fetches: 1 })
  })
})

describe('o relógio e os tetos da frente', () => {
  const f = (o: Partial<Parameters<typeof decidirFrente>[0]> = {}) => ({
    segundos: 0, invocacoes: 1, interrupcoes_sem_avanco: 0, consumo: { ...CONSUMO_ZERO }, unica: false, ...o,
  })
  it('com relógio: chama; sem relógio para uma chamada: cede para uma invocação nova', () => {
    expect(decidirFrente(f(), 300_000)).toBe('chamar')
    expect(decidirFrente(f(), FOLGA_PARA_NOVA_CHAMADA_MS - 1)).toBe('ceder')
  })
  it(`no teto (${TETO_DA_FRENTE_MIN} min, invocações, buscas e páginas, interrupções sem avanço): encerra com o que tem`, () => {
    expect(decidirFrente(f({ segundos: TETO_DA_FRENTE_MIN * 60 }), 300_000)).toBe('encerrar')
    expect(decidirFrente(f({ invocacoes: MAX_INVOCACOES_DA_FRENTE + 1 }), 300_000)).toBe('encerrar')
    expect(decidirFrente(f({ interrupcoes_sem_avanco: 2 }), 300_000)).toBe('encerrar')
    expect(decidirFrente(f({ consumo: { ...CONSUMO_ZERO, buscas: MAX_BUSCAS_POR_FRENTE, fetches: MAX_PAGINAS_POR_FRENTE } }), 300_000)).toBe('encerrar')
    // No teto mas sem relógio: cede, e a próxima invocação encerra.
    expect(decidirFrente(f({ segundos: TETO_DA_FRENTE_MIN * 60 }), 10_000)).toBe('ceder')
  })
  // O TEMPO DE TRABALHO, NÃO O DE RELÓGIO (08/10/2026): a frente órfã relançada
  // horas depois não chega estourada; a invocação em curso conta.
  it('o teto de tempo conta o trabalho das invocações, não o tempo parada', () => {
    expect(decidirFrente(f({ segundos: 0, invocacoes: 2 }), 300_000)).toBe('chamar')
    expect(decidirFrente(f({ segundos: TETO_DA_FRENTE_MIN * 60 - 60 }), 30_000)).toBe('encerrar')
  })
  it('a rede da rede: invocações demais, desiste sem chamar nada', () => {
    expect(decidirFrente(f({ invocacoes: MAX_INVOCACOES_DA_FRENTE + 3 }), 300_000)).toBe('desistir')
  })
  it('o max_uses de cada chamada é o que sobra do teto da frente (nunca menos de 1)', () => {
    expect(usosRestantes({ unica: false, consumo: { ...CONSUMO_ZERO, buscas: 4, fetches: 1 } })).toEqual({ buscas: 2, paginas: 3 })
    expect(usosRestantes({ unica: false, consumo: { ...CONSUMO_ZERO, buscas: 9, fetches: 9 } })).toEqual({ buscas: 1, paginas: 1 })
  })
})

// ---------------------------------------------------------------- 3. a concorrência na linha e a trava da redação

/** A linha falsa: a gravação só vale com o `rev` lido (o `pesquisa->>rev` do PostgREST). */
function lojaFalsa(inicial: EstadoDaPesquisa) {
  let pesquisa = JSON.parse(JSON.stringify(inicial)) as EstadoDaPesquisa
  let status = 'gerando'
  let gravacoes = 0
  let recusadas = 0
  const atraso = () => new Promise<void>((r) => setTimeout(r, Math.floor(Math.random() * 4)))
  return {
    ler: async () => {
      await atraso()
      return status === 'gerando' ? (JSON.parse(JSON.stringify(pesquisa)) as EstadoDaPesquisa) : null
    },
    gravar: async (novo: EstadoDaPesquisa, rev: number, colunas: Record<string, unknown>) => {
      await atraso()
      if (pesquisa.rev !== rev || status !== 'gerando') {
        recusadas++
        return false
      }
      pesquisa = JSON.parse(JSON.stringify(novo))
      if (typeof colunas.status === 'string') status = colunas.status
      gravacoes++
      return true
    },
    get estado() { return pesquisa },
    get gravacoes() { return gravacoes },
    get recusadas() { return recusadas },
    encerrar() { status = 'pronta' },
  }
}

const rapido = { esperar: () => new Promise<void>((r) => setTimeout(r, 1)) }

describe('a concorrência entre as frentes na mesma linha', () => {
  const comQuatro = () => {
    let e = comPlano(estadoInicial('P', AGORA), planoDaSaida(PLANO_DO_DONO), null, null, AGORA)
    for (const id of ['f1', 'f2', 'f3', 'f4']) e = tomarFrente(e, id, `inv-${id}`, null, AGORA)!
    return e
  }
  const fim = (texto: string) => ({
    status: 'pronta' as const, dossie: { texto, fontes: [] }, parcial: false, erro: null,
    consumo: { ...CONSUMO_ZERO, buscas: 3 }, segundos: 100, retomadas: 0,
  })

  it('quatro frentes fechando juntas: nenhuma gravação se perde, e a redação dispara UMA vez', async () => {
    for (let rodada = 0; rodada < 12; rodada++) {
      const loja = lojaFalsa(comQuatro())
      const disparos: string[] = []
      await Promise.all(['f1', 'f2', 'f3', 'f4'].map(async (id) => {
        let dispara = false
        const r = await gravarComVersao(loja.ler, loja.gravar, (e) => {
          const m = fecharFrente(e, id, `inv-${id}`, fim(`dossiê ${id}`), AGORA)
          if (!m) return null
          dispara = m.disparaRedacao
          return { estado: m.estado }
        }, rapido)
        expect(r.ok).toBe(true)
        if (r.ok && dispara) disparos.push(id)
      }))
      expect(loja.estado.frentes.map((f) => f.status)).toEqual(['pronta', 'pronta', 'pronta', 'pronta'])
      expect(loja.estado.frentes.map((f) => f.dossie?.texto)).toEqual(['dossiê f1', 'dossiê f2', 'dossiê f3', 'dossiê f4'])
      expect(disparos).toHaveLength(1)
      expect(loja.estado.redacao.disparada_por).toBe(`inv-${disparos[0]}`)
      expect(loja.estado.fase).toBe('redigindo')
      expect(loja.estado.rev).toBe(comQuatro().rev + 4)
    }
  })

  it('checkpoints de uma frente e fechamento de outra se cruzam sem perda', async () => {
    const loja = lojaFalsa(comQuatro())
    const conversa = aposInterrupcao(inicio, busca('s1')).conversa
    await Promise.all([
      gravarComVersao(loja.ler, loja.gravar, (e) => {
        const n = salvarCheckpoint(e, 'f1', 'inv-f1', { conversa, container: null, retomadas: 1, interrupcoes_sem_avanco: 0, consumo: { ...CONSUMO_ZERO, buscas: 1 }, segundos: 330 }, AGORA)
        return n ? { estado: n } : null
      }, rapido),
      gravarComVersao(loja.ler, loja.gravar, (e) => {
        const m = fecharFrente(e, 'f2', 'inv-f2', fim('d2'), AGORA)
        return m ? { estado: m.estado } : null
      }, rapido),
    ])
    expect(loja.estado.frentes[0].conversa).toEqual(conversa)
    expect(loja.estado.frentes[0].retomadas).toBe(1)
    expect(loja.estado.frentes[1].status).toBe('pronta')
    expect(loja.estado.redacao.disparada_em).toBeNull()
  })

  it('a invocação que não é mais a dona da frente não grava (disparo em dobro, frente já fechada)', async () => {
    const e = comQuatro()
    expect(fecharFrente(e, 'f1', 'outra-invocacao', fim('x'), AGORA)).toBeNull()
    const fechado = fecharFrente(e, 'f1', 'inv-f1', fim('x'), AGORA)!.estado
    expect(fecharFrente(fechado, 'f1', 'inv-f1', fim('de novo'), AGORA)).toBeNull()
    expect(salvarCheckpoint(fechado, 'f1', 'inv-f1', { conversa: [], container: null, retomadas: 0, interrupcoes_sem_avanco: 0, consumo: CONSUMO_ZERO, segundos: 0 }, AGORA)).toBeNull()
    // Tomar: a continuação legítima (anterior = a dona) toma; um disparo repetido, com a dona viva, não.
    expect(tomarFrente(e, 'f2', 'inv-nova', 'inv-f2', AGORA)?.frentes[1].invocacao_id).toBe('inv-nova')
    expect(tomarFrente(e, 'f2', 'inv-intrusa', null, AGORA)).toBeNull()
    // A dona sumiu (sem pulso além da trava): pode ser tomada.
    expect(tomarFrente(e, 'f2', 'inv-nova', null, minutosDepois(TRAVA_GERACAO_MIN + 1))).not.toBeNull()
    // A gravação reconhece que nada há a fazer, sem tentar.
    const loja = lojaFalsa(fechado)
    const r = await gravarComVersao(loja.ler, loja.gravar, (x) => {
      const m = fecharFrente(x, 'f1', 'inv-f1', fim('y'), AGORA)
      return m ? { estado: m.estado } : null
    }, rapido)
    expect(r).toEqual({ ok: false, motivo: 'nada-a-fazer' })
    expect(loja.gravacoes).toBe(0)
  })

  it('a geração refeita por cima (a linha não é mais desta): ninguém grava', async () => {
    const loja = lojaFalsa(comQuatro())
    loja.encerrar()
    const r = await gravarComVersao(loja.ler, loja.gravar, (e) => ({ estado: e }), rapido)
    expect(r).toEqual({ ok: false, motivo: 'nao-e-mais-desta-geracao' })
  })

  it('conflito sem fim: desiste depois das tentativas, sem gravar por cima', async () => {
    const e = comQuatro()
    let tentativas = 0
    const r = await gravarComVersao(async () => e, async () => { tentativas++; return false }, (x) => ({ estado: x }), { ...rapido, tentativas: 3 })
    expect(r).toEqual({ ok: false, motivo: 'conflito' })
    expect(tentativas).toBe(3)
  })

  it('cada gravação sobe o rev e refaz o andamento que a janela lê', async () => {
    const loja = lojaFalsa(comQuatro())
    const r = await gravarComVersao(loja.ler, loja.gravar, (e) => {
      const m = fecharFrente(e, 'f3', 'inv-f3', { ...fim('d3'), parcial: true }, AGORA)
      return m ? { estado: m.estado } : null
    }, rapido)
    expect(r.ok && r.estado.andamento.frentes[2]).toEqual({ id: 'f3', titulo: 'Situação fiscal (RGF) e acordo direto', status: 'pronta', parcial: true, retomadas: 0 })
    expect(r.ok && r.estado.andamento.fase).toBe('pesquisando')
  })
})

// ---------------------------------------------------------------- 4. a junção dos dossiês

describe('juntarDossies — fontes globais, sem repetição', () => {
  const tj = { url: 'https://www.tjgo.jus.br/precatorios', titulo: 'TJGO — Precatórios' }
  const rgf = { url: 'https://www.tesourotransparente.gov.br/rgf', titulo: 'RGF' }
  const ec = { url: 'https://www.planalto.gov.br/ec136', titulo: 'EC 136' }

  it('renumera cada dossiê na lista única; a mesma página de duas frentes é uma fonte só', () => {
    const r = juntarDossies([
      { titulo: 'Fila', status: 'pronta', parcial: false, erro: null, dossie: { texto: 'Pendente desde 2019 [1]. Edital 2025 [2].', fontes: [tj, ec] } },
      { titulo: 'Fiscal', status: 'pronta', parcial: true, erro: null, dossie: { texto: 'Saldo subiu [1]; segundo o TJGO [2] (ver [2025]).', fontes: [rgf, { ...tj, url: 'https://www.tjgo.jus.br/precatorios/' }] } },
      { titulo: 'LOA', status: 'falha', parcial: true, erro: 'limite de uso', dossie: null },
    ])
    expect(r.fontes).toEqual([tj, ec, rgf])
    expect(r.texto).toContain('=== FRENTE 1: Fila ===\nPendente desde 2019 [1]. Edital 2025 [2].')
    // [1] local → 3 (RGF); [2] local → 1 (a mesma página do TJGO); o ano entre colchetes fica.
    expect(r.texto).toContain('Saldo subiu [3]; segundo o TJGO [1] (ver [2025]).')
    expect(r.texto).toContain('Pesquisa interrompida pelo tempo')
    expect(r.texto).toContain('=== FRENTE 3: LOA ===\n(Esta frente não trouxe resultado: limite de uso.')
  })

  it('a regra de citação de sempre fecha a conta: só as citadas, na ordem de leitura', () => {
    const j = juntarDossies([
      { titulo: 'A', status: 'pronta', parcial: false, erro: null, dossie: { texto: 'x [1] y [2]', fontes: [tj, ec] } },
      { titulo: 'B', status: 'pronta', parcial: false, erro: null, dossie: { texto: 'z [1]', fontes: [rgf] } },
    ])
    const final = textoComFontes('A fila está parada [3], segundo o tribunal [1].', j.fontes)
    expect(final.texto).toBe('A fila está parada [1], segundo o tribunal [2].\n\nFONTES\n[1] RGF — https://www.tesourotransparente.gov.br/rgf\n[2] TJGO — Precatórios — https://www.tjgo.jus.br/precatorios')
  })

  it('a linha de antes da mudança ({ texto, fontes }) ainda chega à redação', () => {
    expect(dossiesDaLinha({ texto: 'antigo [1]', fontes: [tj] })).toEqual({ texto: 'antigo [1]', fontes: [tj] })
    expect(dossiesDaLinha(null)).toEqual({ texto: '', fontes: [] })
  })
})

// ---------------------------------------------------------------- 5. ###NOTAS###

describe('###NOTAS### — as notas internas, com as fontes antes delas', () => {
  const fontes = [
    { url: 'https://a.gov.br', titulo: 'A' },
    { url: 'https://b.jus.br', titulo: 'B' },
  ]
  it('a lista de fontes entra logo depois do parágrafo, ANTES da linha ###NOTAS###', () => {
    const r = textoComFontes('Justificativa técnica: fila parada [2] e repasse menor [1].\n###NOTAS###\nRGF 2025 não confirmado; edital diverge da ata [2].', fontes)
    expect(r.texto).toBe(
      'Justificativa técnica: fila parada [1] e repasse menor [2].\n\nFONTES\n[1] B — https://b.jus.br\n[2] A — https://a.gov.br' +
      `\n\n${MARCA_NOTAS}\nRGF 2025 não confirmado; edital diverge da ata [1].`,
    )
  })
  it('notas sem fonte citada no texto: a marca e as notas continuam no fim', () => {
    expect(textoComFontes('Texto.\n  ### NOTAS ###  \nNada a notar.', fontes).texto).toBe(`Texto.\n\n${MARCA_NOTAS}\nNada a notar.`)
  })
  it('sem a linha ###NOTAS###, nada muda', () => {
    const r = textoComFontes('Fato [1].', fontes)
    expect(r.texto).toBe('Fato [1].\n\nFONTES\n[1] A — https://a.gov.br')
    expect(separarNotas(r.texto)).toEqual({ corpo: r.texto, notas: null })
  })
  it('separar e juntar: o texto único volta igual; notas apagadas levam a marca junto', () => {
    const t = `Corpo.\n\nFONTES\n[1] A — https://a.gov.br\n\n${MARCA_NOTAS}\nDivergência X.`
    const p = separarNotas(t)
    expect(p).toEqual({ corpo: 'Corpo.\n\nFONTES\n[1] A — https://a.gov.br', notas: 'Divergência X.' })
    expect(juntarNotas(p.corpo, p.notas)).toBe(t)
    expect(juntarNotas('Corpo.', '   ')).toBe('Corpo.')
    expect(juntarNotas('Corpo.', null)).toBe('Corpo.')
  })
})

// ---------------------------------------------------------------- 6. o card inteiro para a IA

describe('o card inteiro — título e notas no bloco de dados', () => {
  const nota = (texto: string, criado_em: string, automatica = false) => ({ texto, criado_em, automatica })

  it('das mais antigas para as mais novas, com data; a ficha automática gigante sai', () => {
    const t = notasDoCardParaIA([
      nota('Cliente aceitou 30%.', '2026-09-20T13:00:00Z'),
      nota('VALOR ATUALIZADO: R$ 1.250.000,00\nLOA 2027', '2026-09-01T13:00:00Z'),
      nota('FICHA '.repeat(NOTA_AUTOMATICA_MAX_CARACTERES), '2026-09-10T13:00:00Z', true),
      nota('Ficha curta da análise: TRIBUNAL: TJGO', '2026-09-11T13:00:00Z', true),
      nota('   ', '2026-09-12T13:00:00Z'),
    ])
    const linhas = t.split('\n')
    expect(linhas[0]).toBe('  • [01/09/2026] VALOR ATUALIZADO: R$ 1.250.000,00')
    expect(linhas[1]).toBe('    LOA 2027')
    expect(t.indexOf('Ficha curta')).toBeLessThan(t.indexOf('Cliente aceitou'))
    expect(t).toContain('[11/09/2026, automática] Ficha curta')
    expect(t).not.toContain('FICHA FICHA')
    expect(t).toMatch(/1 ficha\(s\) automática\(s\) longa\(s\) omitida\(s\)/)
  })

  it('passando do teto, saem as MAIS ANTIGAS primeiro; cada nota tem teto próprio', () => {
    const longas = Array.from({ length: 6 }, (_, i) => nota(`nota ${i} ` + 'x'.repeat(900), `2026-09-0${i + 1}T10:00:00Z`))
    const t = notasDoCardParaIA(longas, 2_000)
    expect(t).toMatch(/^ {2}\(4 nota\(s\) mais antiga\(s\) omitida\(s\) por tamanho\)/)
    expect(t).toContain('nota 5 ')
    expect(t).toContain('nota 4 ')
    expect(t).not.toContain('nota 3 ')
    const gigante = notasDoCardParaIA([nota('y'.repeat(NOTA_IA_MAX_CARACTERES + 500), '2026-09-01T10:00:00Z')])
    expect(gigante).toContain('[…nota cortada]')
    expect(gigante.length).toBeLessThan(NOTA_IA_MAX_CARACTERES + 100)
  })

  it('o bloco de dados leva o título e as notas; o prompt montado também', () => {
    const v = valoresDoCard({
      pipeline_id: 13901939,
      nome: 'Credijuris - JOÃO PEREIRA - 5001234-12.2022.8.09.0051 - principal',
      notas: [nota('Expedido em 10/03/2025; apresentado em 20/03/2025.', '2026-09-01T10:00:00Z')],
    }, { agora: AGORA })
    expect(v.titulo).toBe('Credijuris - JOÃO PEREIRA - 5001234-12.2022.8.09.0051 - principal')
    expect(v.notas).toContain('[01/09/2026] Expedido em 10/03/2025')
    const b = blocoDoCard(v)
    expect(b.split('\n')[0]).toBe('- Título do card: Credijuris - JOÃO PEREIRA - 5001234-12.2022.8.09.0051 - principal')
    expect(b).toContain('- Notas do card (das mais antigas para as mais novas):\n  • [01/09/2026] Expedido em 10/03/2025')
    expect(montarPrompt('Escreva.', v).texto).toContain('apresentado em 20/03/2025')
  })

  it('card sem nota: o bloco diz "(não informado)", sem inventar', () => {
    expect(notasDoCardParaIA([])).toBe('')
    expect(blocoDoCard({})).toContain('- Notas do card (das mais antigas para as mais novas):\n(não informado)')
  })
})

// ---------------------------------------------------------------- 7. vagas, consumo, tempo e morte

describe('as vagas de pesquisa (o limite da casa, contado em frentes)', () => {
  const andamento = (fase: 'planejando' | 'pesquisando' | 'redigindo', pesquisando = 0, prontas = 0) => ({
    fase, plano: 'planejado' as const,
    frentes: [
      ...Array.from({ length: pesquisando }, (_, i) => ({ id: `p${i}`, titulo: '', status: 'pesquisando' as const, parcial: false, retomadas: 0 })),
      ...Array.from({ length: prontas }, (_, i) => ({ id: `q${i}`, titulo: '', status: 'pronta' as const, parcial: false, retomadas: 0 })),
    ],
  })
  it('planejando reserva o plano inteiro; pesquisando conta as frentes vivas; redigindo, uma; a linha antiga, uma', () => {
    expect(vagasOcupadas([andamento('planejando')])).toBe(MAX_FRENTES)
    expect(vagasOcupadas([andamento('pesquisando', 2, 2)])).toBe(2)
    expect(vagasOcupadas([andamento('redigindo', 0, 4)])).toBe(1)
    expect(vagasOcupadas([null])).toBe(1)
  })
  it(`com ${VAGAS_DE_PESQUISA} vagas: duas gerações inteiras pesquisando cabem; a terceira espera alguma frente terminar`, () => {
    expect(cabeMaisUmaGeracao([andamento('pesquisando', 4)])).toBe(true)
    expect(cabeMaisUmaGeracao([andamento('pesquisando', 4), andamento('pesquisando', 4)])).toBe(false)
    expect(cabeMaisUmaGeracao([andamento('pesquisando', 4), andamento('pesquisando', 1, 3)])).toBe(true)
  })
})

describe('consumo e tempo da geração inteira', () => {
  it('soma planejamento, todas as frentes e a redação; o tempo é o de relógio, com cada etapa', () => {
    let e = comPlano(estadoInicial('P', AGORA), planoDaSaida(PLANO_DO_DONO), null, { ...CONSUMO_ZERO, chamadas: 1, input_tokens: 5000, output_tokens: 800 }, minutosDepois(0.5))
    e = { ...e, frentes: e.frentes.map((f, i) => ({ ...f, consumo: { ...CONSUMO_ZERO, chamadas: 2, input_tokens: 100_000, output_tokens: 6000, buscas: 5 + (i % 2), fetches: 3, interrompidas: i === 0 ? 1 : 0 }, segundos: 200 + i, retomadas: i })) }
    e = { ...e, tempos: { ...e.tempos, pesquisa_fim: minutosDepois(6.5).toISOString(), redacao_s: 90 } }
    const c = consumoTotal(e, { ...CONSUMO_ZERO, chamadas: 1, input_tokens: 30_000, output_tokens: 4000 }, minutosDepois(8), 'claude-opus-5-5')
    expect(c).toMatchObject({
      modelo: 'claude-opus-5-5', chamadas: 1 + 8 + 1, input_tokens: 5000 + 400_000 + 30_000, output_tokens: 800 + 24_000 + 4000,
      buscas: 22, fetches: 12, interrompidas: 1, segundos: 480,
      etapas: { planejamento_s: 30, pesquisa_s: 360, redacao_s: 90 },
    })
    expect(c.frentes?.map((f) => f.segundos)).toEqual([200, 201, 202, 203])
  })
})

describe('a morte da geração é falta de progresso (pulso), não tempo total', () => {
  it(`viva enquanto pulsa — mesmo depois de 15 minutos; morta com ${TRAVA_GERACAO_MIN} min sem pulso`, () => {
    const agora = minutosDepois(15).getTime()
    expect(geracaoParada({ status: 'gerando', atualizado_em: minutosDepois(14.5).toISOString() }, agora)).toBe(false)
    expect(geracaoParada({ status: 'gerando', atualizado_em: minutosDepois(15 - TRAVA_GERACAO_MIN - 0.1).toISOString() }, agora)).toBe(true)
  })
})

describe('o estado nasce no formato 2, e o de antes é reconhecido', () => {
  it('estado inicial: planejando, sem frentes, rev 0, com o andamento pronto para a janela', () => {
    const e = estadoInicial('PROMPT DA CASA', AGORA)
    expect(e).toMatchObject({ versao: 2, rev: 0, fase: 'planejando', instrucao: 'PROMPT DA CASA', frentes: [] })
    expect(e.andamento).toEqual({ fase: 'planejando', plano: null, frentes: [] })
    expect(ehEstadoV2(e)).toBe(true)
    expect(ehEstadoV2({ texto: 'antigo', fontes: [] })).toBe(false)
    expect(frenteNova('f9', PLANO_DO_DONO.frentes[0] as FrenteDoPlano).conversa).toBeNull()
  })
})

/**
 * A FRENTE ÓRFÃ (08/10/2026): na geração do Renan de Santana, a frente da EC
 * 136 foi tomada e a invocação morreu no primeiro segundo; as irmãs terminaram
 * e a redação esperou por ela para sempre. O vigia a acha e a relança.
 */
describe('frentesOrfas — o vigia das frentes', () => {
  const comQuatro = () => {
    let e = comPlano(estadoInicial('P', AGORA), planoDaSaida(PLANO_DO_DONO), null, null, AGORA)
    for (const id of ['f1', 'f2', 'f3', 'f4']) e = tomarFrente(e, id, `inv-${id}`, null, AGORA)!
    return e
  }
  const fim = {
    status: 'pronta' as const, dossie: { texto: 'achado', fontes: [] }, parcial: false, erro: null,
    consumo: { ...CONSUMO_ZERO, buscas: 3 }, segundos: 100, retomadas: 0,
  }

  it('o caso do Renan: três prontas, a da EC 136 sem sinal desde a tomada — órfã depois de 3 min', () => {
    let e = comQuatro()
    for (const id of ['f1', 'f2', 'f4']) e = fecharFrente(e, id, `inv-${id}`, fim, minutosDepois(2))!.estado
    expect(frentesOrfas(e, minutosDepois(2.5))).toEqual([])
    expect(frentesOrfas(e, new Date(AGORA.getTime() + FRENTE_SEM_SINAL_MS + 1000))).toEqual([{ id: 'f3', anterior: 'inv-f3' }])
  })

  it('o relançamento toma a frente (com a invocação anterior) e só uma vez', () => {
    const e = comQuatro()
    const depois = minutosDepois(4)
    const [o] = frentesOrfas(e, depois).filter((x) => x.id === 'f3')
    const tomada = tomarFrente(e, 'f3', 'inv-nova', o.anterior, depois)!
    expect(tomada.frentes.find((f) => f.id === 'f3')?.invocacoes).toBe(2)
    // O SEGUNDO VIGIA, com a mesma invocação anterior: a frente já é de outra, com pulso fresco.
    expect(tomarFrente(tomada, 'f3', 'inv-outra', o.anterior, depois)).toBeNull()
    expect(frentesOrfas(tomada, depois).map((x) => x.id)).not.toContain('f3')
  })

  it('a frente viva (checkpoint recente) não é órfã; fora da pesquisa, nada é órfão', () => {
    const e = comQuatro()
    expect(frentesOrfas(e, minutosDepois(2))).toEqual([])
    expect(frentesOrfas({ ...e, fase: 'redigindo' }, minutosDepois(30))).toEqual([])
  })

  it('a frente que nunca foi tomada (o disparo se perdeu) conta do fim do plano', () => {
    const e = comPlano(estadoInicial('P', AGORA), planoDaSaida(PLANO_DO_DONO), null, null, AGORA)
    expect(frentesOrfas(e, minutosDepois(1))).toEqual([])
    expect(frentesOrfas(e, minutosDepois(4)).map((x) => x.anterior)).toEqual(e.frentes.map(() => null))
  })

  it('a função relança quando uma irmã fecha, e a janela vigia a cada minuto', () => {
    const f = readFileSync(join(__dirname, '..', '..', '..', 'supabase/functions/justificativa-tecnica/index.ts'), 'utf8')
    expect(f).toContain("else if (feito.ok) await vigiarFrentes(svc, leadId, tentativa).catch(() => 0)")
    expect(f).toContain("if (acao === 'vigiar') return await vigiar(req, svc, body)")
    const j = readFileSync(join(__dirname, '..', '..', 'components/JustificativaTecnica.tsx'), 'utf8')
    expect(j).toContain("invokeFunction<{ relancadas?: number }>(FUNCAO, { acao: 'vigiar', kommo_lead_id: leadId })")
    expect(j).toContain('setInterval(vigiar, 60_000)')
  })
})

// _shared/dueDiligencia.ts
// A due diligence de PROCESSOS JUDICIAIS dos sujeitos do crédito, traduzida para
// as duas perguntas que a análise de RPV faz:
//
//   linha 10  "Histórico do cedente: tem dívida?"   -> Sim/Não + números
//   linha 11  "Histórico do advogado: tem dívida?"  -> Sim/Não + números
//
// POR QUE ISTO NÃO É TRABALHO DA IA. As duas linhas sempre estiveram no
// questionário e sempre foram respondidas pela IA lendo o PROCESSO DA CESSÃO —
// que não diz nada sobre as outras dívidas do cedente nem do advogado. O "Não"
// que saía impresso significava "não achei nos autos", e era lido na planilha
// como "diligência feita, nada consta". Dívida de terceiro só se descobre
// procurando por CPF/CNPJ/OAB, e é isso que a due diligence faz. Aqui a
// resposta passa a vir de quem a apurou.
//
// SEM APURAÇÃO, NADA MUDA. Crédito sem linha em dd_historico (ou com a migration
// 0056 ainda não rodada) mantém exatamente o comportamento antigo: a IA responde
// e ninguém sobrescreve. Trocar o "Não" da IA por célula vazia seria mexer em
// todo card de hoje sem que ninguém tenha pedido — e é assunto separado, que
// está anotado no fim deste arquivo.
//
// SEM `npm:`, DE PROPÓSITO: assim o vitest de src/lib/__tests__ importa este
// módulo direto. O acesso ao banco fica em quem chama; aqui só entram as linhas
// já lidas.

export type PapelDD = 'CEDENTE' | 'CONJUGE' | 'PJ' | 'ADVOGADO'

/** Os dois papéis que têm linha própria no questionário de RPV. */
export const LINHA_DO_PAPEL: Record<string, '10' | '11'> = {
  CEDENTE: '10',
  ADVOGADO: '11',
}

/** Uma apuração (dd_historico): de quem, por quem, e se de fato aconteceu. */
export interface ApuracaoDD {
  id: string
  papel: PapelDD | string
  nome?: string | null
  documento?: string | null
  oab?: string | null
  status?: string | null // PENDENTE | APURADO | FALHA
  fonte?: string | null
  apurado_em?: string | null
  observacao?: string | null
}

/** Um processo achado pela apuração (dd_processo). */
export interface ProcessoDD {
  historico_id: string
  numero_processo: string
  tribunal?: string | null
  objeto?: string | null
  polo?: string | null // ATIVO | PASSIVO | TERCEIRO | DESCONHECIDO
  ha_cobranca?: boolean | null
  valor_cobrado?: number | string | null
  estagio?: string | null
  risco?: string | null // NAO_AVALIADO | NENHUM | ATENCAO | ALTO
  risco_motivo?: string | null
}

export interface HistoricoDePapel {
  papel: 'CEDENTE' | 'ADVOGADO'
  linha: '10' | '11'
  /** Alguém de fato procurou. Só `status = 'APURADO'` conta. */
  apurada: boolean
  /** Houve tentativa e ela falhou — diferente de nunca ter sido pedida. */
  falhou: boolean
  quem: string
  temDivida: boolean
  /** Achados que não dá para classificar como dívida nem como não-dívida. */
  indeterminados: number
  /** Achados com risco ALTO para ESTA cessão (penhora, fraude à execução). */
  altoRisco: ProcessoDD[]
  processos: ProcessoDD[]
  /** O que vai na coluna D quando a resposta é "Sim". */
  complemento: string
}

/**
 * Quantos processos cabem na célula.
 *
 * A coluna D é uma célula de planilha, não um relatório: com trinta números ela
 * vira uma tarja ilegível e some a informação que importa. O excedente é
 * contado, e o detalhe fica na tela da due diligence.
 */
export const MAX_PROCESSOS_NA_CELULA = 8

const soDigitos = (s: unknown): string => String(s ?? '').replace(/\D/g, '')

/**
 * Escrito com ESCAPES UNICODE, e não com as marcas combinantes literais: o
 * mesmo cuidado de `normalizar` em _shared/credijuris.ts. Um deploy que corrompa
 * o encoding do arquivo invalidaria os literais em silêncio, e "Sim" com acento
 * deixaria de casar.
 */
const semAcento = (s: string): string =>
  s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

/**
 * CNJs escritos num texto livre, mascarados ou não.
 *
 * Serve para não repetir na célula um processo que a IA já tinha citado lendo
 * os autos: os dois lados são comparados por dígito, porque o mesmo processo
 * aparece "0001234-56.2020.8.09.0051" de um lado e "00012345620208090051" do
 * outro.
 */
export function cnjsDoTexto(texto: unknown): string[] {
  const s = String(texto ?? '')
  const achados: string[] = []
  for (const m of s.matchAll(/\d[\d.\-/]{18,}\d|\d{20}/g)) {
    const d = soDigitos(m[0])
    if (d.length === 20) achados.push(d)
  }
  return achados
}

const brlCurto = (v: number): string =>
  'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const numero = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v.replace(/\./g, '').replace(',', '.'))
    return Number.isFinite(n) ? n : null
  }
  return null
}

/**
 * Este processo é dívida do sujeito?
 *
 * `ha_cobranca` responde direto quando alguém a preencheu. Quando é null, o
 * POLO decide, e decide para o lado conservador: quem está no polo passivo está
 * sendo processado, e um valor ainda não apurado não é um valor inexistente.
 * Nos outros polos — o cedente autor de uma ação não deve nada por ela — null
 * fica indeterminado, aparece no texto da IA e não vira "Sim" sozinho.
 */
function ehDivida(p: ProcessoDD): boolean | null {
  if (p.ha_cobranca === true) return true
  if (p.ha_cobranca === false) return false
  return String(p.polo ?? '').toUpperCase() === 'PASSIVO' ? true : null
}

function descreverProcesso(p: ProcessoDD): string {
  const v = numero(p.valor_cobrado)
  const partes = [p.objeto, v != null && v > 0 ? brlCurto(v) : null, p.estagio]
    .map((x) => String(x ?? '').trim())
    .filter(Boolean)
  return p.numero_processo + (partes.length ? ` (${partes.join(' — ')})` : '')
}

/**
 * Junta apurações e processos nos dois papéis que a planilha pergunta.
 *
 * CONJUGE e PJ ficam de fora porque o questionário de RPV não tem linha para
 * eles — o modelo de precatórios tem, e é lá que essa apuração aparece. Trazê-la
 * para a linha 10 misturaria a dívida do cônjuge com a do cedente numa célula
 * que diz "cedente".
 */
export function historicoDoCredito(
  apuracoes: ApuracaoDD[],
  processos: ProcessoDD[],
): HistoricoDePapel[] {
  const saida: HistoricoDePapel[] = []
  for (const papel of ['CEDENTE', 'ADVOGADO'] as const) {
    const minhas = apuracoes.filter((a) => String(a.papel ?? '').toUpperCase() === papel)
    if (minhas.length === 0) continue

    const ids = new Set(minhas.map((a) => a.id))
    const meus = processos.filter((p) => ids.has(p.historico_id))
    const status = minhas.map((a) => String(a.status ?? '').toUpperCase())

    saida.push({
      papel,
      linha: LINHA_DO_PAPEL[papel],
      // Vários advogados: só vale como apurado quando TODOS foram. Um apurado e
      // outro pendente escreveria "Não" numa célula que fala dos dois.
      apurada: status.length > 0 && status.every((s) => s === 'APURADO'),
      falhou: status.some((s) => s === 'FALHA'),
      quem: minhas
        .map((a) => [a.nome, a.oab ? `OAB ${a.oab}` : null].filter(Boolean).join(', '))
        .filter(Boolean)
        .join(' | '),
      temDivida: meus.some((p) => ehDivida(p) === true),
      indeterminados: meus.filter((p) => ehDivida(p) === null).length,
      altoRisco: meus.filter((p) => String(p.risco ?? '').toUpperCase() === 'ALTO'),
      processos: meus,
      complemento: montarComplemento(meus),
    })
  }
  return saida
}

function montarComplemento(processos: ProcessoDD[]): string {
  const devedores = processos.filter((p) => ehDivida(p) === true)
  if (devedores.length === 0) return ''
  const mostrados = devedores.slice(0, MAX_PROCESSOS_NA_CELULA).map(descreverProcesso)
  const resto = devedores.length - mostrados.length
  return mostrados.join('; ') + (resto > 0 ? `; e mais ${resto} processo(s) — ver a due diligence` : '')
}

/**
 * O bloco que vai junto do processo, para a IA LER — não para ela decidir.
 *
 * As células 10 e 11 são escritas pelo código (ver aplicarDiligenciaNoM2); este
 * texto existe para que o resto da análise fique coerente com elas: a IA
 * levanta o risco de fraude à execução em "riscos" e comenta a penhora em
 * "comentarios_analise" sabendo o que a diligência achou. Sem ele, a planilha
 * diria "Sim, tem dívida" na linha 10 e o parecer ao lado ignoraria o assunto.
 */
export function textoDaDiligencia(hs: HistoricoDePapel[]): string {
  if (hs.length === 0) return ''
  const linhas: string[] = []
  for (const h of hs) {
    const rotulo = h.papel === 'CEDENTE' ? 'CEDENTE' : 'ADVOGADO'
    if (!h.apurada) {
      linhas.push(
        `— ${rotulo} (${h.quem || 'sem nome'}): apuração ${h.falhou ? 'TENTADA E FALHOU' : 'AINDA NÃO CONCLUÍDA'}. ` +
          'Nada a considerar: responda a linha pelo que estiver nos autos, como sempre.',
      )
      continue
    }
    if (h.processos.length === 0) {
      linhas.push(`— ${rotulo} (${h.quem}): apurado, NENHUM processo em nome dele.`)
      continue
    }
    linhas.push(`— ${rotulo} (${h.quem}): apurado, ${h.processos.length} processo(s):`)
    for (const p of h.processos) {
      const d = ehDivida(p)
      const marca = d === true ? 'DÍVIDA' : d === false ? 'sem cobrança contra ele' : 'cobrança indeterminada'
      const risco = String(p.risco ?? '').toUpperCase()
      const alerta =
        risco === 'ALTO' || risco === 'ATENCAO'
          ? ` [RISCO ${risco}${p.risco_motivo ? ': ' + p.risco_motivo : ''}]`
          : ''
      linhas.push(`    ${descreverProcesso(p)} — polo ${p.polo ?? 'DESCONHECIDO'}, ${marca}${alerta}`)
    }
  }
  return linhas.join('\n')
}

export interface ResultadoDiligenciaM2 {
  m2: Record<string, unknown>
  /** Para os avisos da análise. Vazio quando não há o que dizer. */
  notas: string[]
  /** Quais linhas o código escreveu, para o log e para os testes. */
  escritas: string[]
}

/**
 * Escreve as linhas 10 e 11 a partir da apuração, preservando o que a IA achou.
 *
 * NÃO É SUBSTITUIÇÃO CEGA, é união. A diligência procura por CPF/OAB e enxerga o
 * que os autos não mostram; a IA lê os autos e às vezes enxerga o que a
 * diligência não pegou — um ofício de penhora no rosto dos autos, uma execução
 * noticiada nos próprios autos. Apagar um com o outro perderia informação nos
 * dois sentidos, então: "Sim" se QUALQUER um dos dois achou dívida, e a célula
 * lista os dois conjuntos, sem repetir o processo que já está em ambos.
 *
 * Papel sem apuração concluída não é tocado.
 */
export function aplicarDiligenciaNoM2(
  m2: Record<string, unknown> | null | undefined,
  hs: HistoricoDePapel[],
  /**
   * As linhas que o CHAT escreveu — uma ordem explícita de quem confere.
   *
   * Nelas a resposta da coluna B é de quem revisou, e não da diligência: a
   * pessoa está com o processo aberto e pode saber de algo que a apuração não
   * pegou (dívida já quitada, homônimo, processo do sócio e não dele). O que
   * NÃO acontece é a dívida sumir: a coluna D diz que a diligência achou, com o
   * marcador de conflito. Ver a montagem do complemento abaixo.
   */
  travadas: string[] = [],
): ResultadoDiligenciaM2 {
  const saida: Record<string, unknown> = { ...(m2 ?? {}) }
  const notas: string[] = []
  const escritas: string[] = []
  const travas = new Set(travadas.map(String))

  for (const h of hs) {
    const qual = h.papel === 'CEDENTE' ? 'do cedente' : 'do advogado'

    if (h.falhou) {
      notas.push(
        `⚠️ DUE DILIGENCE ${qual.toUpperCase()} FALHOU: a busca por processos em nome ${
          h.quem ? 'de ' + h.quem : qual
        } não foi concluída. A linha ${h.linha} ficou com o que a IA leu nos autos, que não cobre dívidas de fora deste processo.`,
      )
    }
    if (!h.apurada) continue

    const atual = (saida[h.linha] ?? {}) as { resposta?: unknown; complemento?: unknown }
    const iaDisseSim = semAcento(String(atual.resposta ?? '').trim()).startsWith('sim')
    const travada = travas.has(h.linha)
    // Linha travada pelo chat: a coluna B é de quem revisou. Sem trava, é a
    // união — "Sim" se a diligência OU os autos acharam.
    const resposta = travada
      ? (iaDisseSim ? 'Sim' : 'Não')
      : (h.temDivida || iaDisseSim ? 'Sim' : 'Não')
    const contradiz = travada && !iaDisseSim && h.temDivida

    // O que a IA escreveu na célula, menos os processos que a diligência já
    // lista. Comparado por dígito: máscara diferente é o mesmo processo.
    const jaListados = new Set(cnjsDoTexto(h.complemento))
    const doTextoDaIA = cnjsDoTexto(atual.complemento)
    const novosDaIA = doTextoDaIA.filter((d) => !jaListados.has(d))
    const complementoIA =
      novosDaIA.length > 0
        ? `nos autos: ${String(atual.complemento ?? '').trim()}`
        : iaDisseSim && !h.temDivida && String(atual.complemento ?? '').trim()
          ? `nos autos: ${String(atual.complemento).trim()}`
          : ''

    // A COLUNA D SEMPRE DIZ O QUE A DILIGÊNCIA ACHOU, e diz de onde veio.
    //
    // Inclusive — e principalmente — quando a coluna B ficou "Não" por ordem de
    // quem revisou: a célula de resposta sozinha esconderia a apuração, e quem
    // abre a planilha depois leria "não tem dívida" sem saber que existe uma
    // busca dizendo o contrário. O marcador de conflito deixa a divergência no
    // documento, em vez de resolvê-la em silêncio para um dos lados.
    const daDiligencia = h.complemento
      ? (contradiz
          ? `⚠️ A DUE DILIGENCE ENCONTROU DÍVIDA (resposta "Não" mantida a pedido de quem revisou) — ${h.complemento}`
          : `Due diligence: ${h.complemento}`)
      : ''

    const complemento = daDiligencia
      ? [daDiligencia, complementoIA].filter(Boolean).join('; ')
      : resposta === 'Não' ? '' : complementoIA

    saida[h.linha] = { ...atual, resposta, complemento }
    escritas.push(h.linha)

    if (contradiz) {
      notas.push(
        `⚠️ LINHA ${h.linha} EM CONFLITO: a due diligence achou dívida ${qual} e a resposta foi mantida em "Não" ` +
        'por pedido no chat. A coluna D da planilha registra os processos encontrados — confira antes de assinar.',
      )
    }

    if (h.temDivida) {
      const alto = h.altoRisco.length
      notas.push(
        `${alto ? '⚠️ ' : ''}DUE DILIGENCE ${qual.toUpperCase()}: ${
          h.processos.filter((p) => ehDivida(p) === true).length
        } processo(s) com cobrança contra ${h.quem || qual}` +
          (alto
            ? `, ${alto} com RISCO ALTO para esta cessão (${h.altoRisco
                .map((p) => p.risco_motivo || p.numero_processo)
                .slice(0, 2)
                .join('; ')}). Avalie fraude à execução antes de fechar.`
            : '. Sem risco alto apontado para esta cessão.'),
      )
    }
    if (h.indeterminados > 0) {
      notas.push(
        `DUE DILIGENCE ${qual.toUpperCase()}: ${h.indeterminados} processo(s) achado(s) sem dizer se há valor sendo cobrado. ` +
          `A linha ${h.linha} não os conta como dívida — confirme na aba Processos judiciais.`,
      )
    }
    if (iaDisseSim && !h.temDivida) {
      notas.push(
        `A leitura dos autos apontou dívida ${qual} e a due diligence não achou nenhuma. ` +
          `A linha ${h.linha} ficou "Sim", com o que a IA leu — confira qual das duas está desatualizada.`,
      )
    }
  }

  return { m2: saida, notas, escritas }
}

// ---------------------------------------------------------------------------
// O QUE AINDA FICA EM ABERTO, e de propósito:
//
// Crédito SEM apuração continua imprimindo o "Não" da IA nas linhas 10 e 11 —
// que quer dizer "não achei nos autos", e não "nada consta". A correção honesta
// seria deixar a célula vazia, mas isso muda TODO card de hoje (nenhum tem due
// diligence de processos ainda) e não foi pedido. Quando a aba Processos
// judiciais entrar no ar e virar rotina, é a mudança seguinte: trocar o
// silêncio por célula vazia + aviso de "diligência não feita".
// ---------------------------------------------------------------------------

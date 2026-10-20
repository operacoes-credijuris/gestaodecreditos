// UMA NOTA SÓ POR CARD, EDITADA NO LUGAR — os autos do Escavador no chat do Kommo.
//
// O PEDIDO DO DONO (20/10/2026). A rotina dos autos escrevia uma nota a cada
// passo: os processos identificados, a primeira falha do robô, a desistência,
// a conclusão de cada processo, uma nota de anexo por parte de PDF, as notas
// das ações `rejuntar`/`repetir_falhas`… Num card com três processos eram dez,
// quinze mensagens no fim do histórico, e a conversa da equipe sumia no meio
// delas. Agora é UMA nota de texto por card: criada quando a rotina identifica
// os processos e EDITADA (PATCH no Kommo) a cada mudança. Os PDFs ficam só na
// aba Arquivos do card.
//
// O TEXTO É CALCULADO DO BANCO, nunca acumulado: cada volta da rotina monta a
// nota inteira a partir de `escavador_autos_processo` e compara com o último
// texto que subiu (`escavador_autos_card.nota_texto`). Igual, nada se chama;
// diferente, edita-se. Uma edição que falhou de passagem não perde nada — a
// próxima volta calcula o mesmo texto e tenta de novo.
//
// QUANDO NÃO HÁ NOTA (cards lidos antes desta mudança, `nota_em` nulo): nada se
// escreve. O card já tinha as notas antigas, e uma nota nova no fim do
// histórico é justamente o que o dono não quer.
//
// SEM `Deno.` E SEM `npm:`: o vitest alcança este módulo direto.

import { lerJuntada, type Juntada } from './autosJuntos.ts'
import { INTERVALO_REPETIR_MIN, tetoDoRobo } from './falhasDosAutos.ts'
import { INTERROMPIDO } from './interrupcaoDosAutos.ts'

/** Um processo do card, como a nota o descreve (de `escavador_autos_processo`). */
export interface ProcessoDaNota {
  cnj: string
  rotulo: string
  estado: string
  detalhe?: string | null
  /** O código da falha passageira do robô na rodada em curso (INTERNAL_ERROR…). */
  falhaDoRobo?: string | null
  /** Pedidos pagos nesta rodada. */
  tentativas?: number
  /** O teto configurado no processo (null = o padrão). */
  teto?: number | null
  /** A rotina desistiu depois do teto de tentativas do robô. */
  desistiu?: boolean
  /** Formato antigo (um arquivo por documento): quantos subiram, de quantos. */
  anexados?: number
  totalDocumentos?: number
  /** O estado da junção (coluna `juntada`), cru: é lido aqui. */
  juntada?: unknown
}

/** A linha do banco no formato da nota. Colunas que não existem (antes da 0077) ficam vazias. */
export function processoDaNota(l: Record<string, unknown>): ProcessoDaNota {
  return {
    cnj: String(l.numero_cnj ?? ''),
    rotulo: String(l.rotulo ?? '') || 'Processo',
    estado: String(l.estado ?? ''),
    detalhe: l.detalhe == null ? null : String(l.detalhe),
    falhaDoRobo: l.falha_do_robo == null ? null : String(l.falha_do_robo),
    tentativas: Number(l.tentativas_do_pedido) || 0,
    teto: l.teto_de_tentativas == null ? null : Number(l.teto_de_tentativas),
    desistiu: l.desistiu_em != null,
    anexados: Number(l.anexados) || 0,
    totalDocumentos: Number(l.total_documentos) || 0,
    juntada: l.juntada ?? null,
  }
}

const dataBR = (iso: string | null | undefined) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''))
  return m ? `${m[3]}/${m[2]}/${m[1]}` : ''
}
const milhar = (n: number) => n.toLocaleString('pt-BR')
const periodo = (a: string | null, b: string | null) =>
  a && b ? (dataBR(a) === dataBR(b) ? `de ${dataBR(a)}` : `de ${dataBR(a)} a ${dataBR(b)}`) : ''

/** Quantos nomes de PDF a nota lista por processo, no máximo (a nota do Kommo tem tamanho). */
const MAX_PDFS_NA_NOTA = 6
/** Quantos documentos não juntados a nota cita, no máximo. */
const MAX_NAO_JUNTADOS_NA_NOTA = 3

/** A ordem dos processos na nota: a do processo no tribunal — conhecimento, cumprimento, requisitório. */
function ordemDoRotulo(rotulo: string): number {
  const r = rotulo.toLowerCase()
  if (r === 'conhecimento') return 0
  if (r === 'conhecimento e cumprimento') return 1
  if (r === 'cumprimento') return 2
  if (r === 'precatório' || r === 'rpv') return 3
  return 4
}

/** "Conhecimento", "Precatório"… — e "Processo" quando o papel não foi dito. */
function nomeDoPapel(rotulo: string): string {
  return !rotulo || /^(autos|processo)$/i.test(rotulo) ? 'Processo' : rotulo
}

/** O motivo gravado, sem o ponto final e sem a maiúscula do começo (ele entra no meio da frase). */
function motivo(detalhe: string | null | undefined): string {
  const t = String(detalhe ?? '').trim().replace(/[.\s]+$/, '')
  if (!t) return 'o Escavador não entregou os autos'
  return /^(O|A|Os|As) /.test(t) ? t[0].toLowerCase() + t.slice(1) : t
}

function listaDePdfs(nomes: string[]): string[] {
  const linhas = nomes.slice(0, MAX_PDFS_NA_NOTA).map((n) => `   📄 ${n}`)
  if (nomes.length > MAX_PDFS_NA_NOTA) linhas.push(`   … e mais ${nomes.length - MAX_PDFS_NA_NOTA} PDF(s)`)
  return linhas
}

/** As linhas do andamento de UM processo. Só o que muda de verdade entra: um texto instável seria uma edição por volta. */
export function andamentoDoProcesso(p: ProcessoDaNota): string[] {
  const j: Juntada | null = lerJuntada(p.juntada)
  const todas = j?.partes ?? []
  // NA ABA ARQUIVOS SÓ ESTÁ O QUE FOI LIGADO AO CARD: a parte que subiu ao drive
  // e não ligou não é prometida ali.
  const partes = todas.filter((x) => x.ligada)
  const soltas = todas.filter((x) => !x.ligada)
  const teto = tetoDoRobo(p.teto)
  switch (p.estado) {
    case 'NOVO':
      return ['🕓 Na fila para pedir os autos ao Escavador.']
    case 'FILA':
      return /^Cota/i.test(String(p.detalhe ?? ''))
        ? ['🕓 Na fila: a cota diária de pedidos ao Escavador acabou; o pedido sai no próximo dia.']
        : ['🕓 Na fila para pedir os autos ao Escavador.']
    case 'SEM_SALDO':
      return ['🕓 Parado: o Escavador está sem crédito. O pedido sai assim que a conta for recarregada.']
    case 'PEDINDO':
      return ['📨 Pedindo os autos ao Escavador.']
    case 'AGUARDANDO':
      return p.falhaDoRobo
        ? [
          `⏳ Pedido de novo ao Escavador (tentativa ${Math.max(1, p.tentativas ?? 0)} de ${teto}, depois de uma falha do robô ` +
          `dele: ${p.falhaDoRobo}). Aguardando o robô trazer os autos do tribunal.`,
        ]
        : ['⏳ Pedido feito ao Escavador. Aguardando o robô dele trazer os autos do tribunal (costuma levar algumas horas).']
    case 'REPETIR':
      return (p.tentativas ?? 0) > 0
        ? [
          `🔁 O robô do Escavador não conseguiu entrar no tribunal (${p.falhaDoRobo ?? 'erro do robô'}) — falha do ` +
          `Escavador, não da Credijuris. Tentativa ${p.tentativas} de ${teto}; peço de novo a cada ${INTERVALO_REPETIR_MIN} minutos.`,
        ]
        : [
          `🔁 Nova rodada de pedidos ao Escavador, que falhou antes (${p.falhaDoRobo ?? 'erro do robô'}, falha do robô dele). ` +
          `Peço a cada ${INTERVALO_REPETIR_MIN} minutos, até ${teto} vezes.`,
        ]
    case 'ANEXANDO': {
      if (j?.modo === 'rejuntar') {
        return ['📥 Juntando os autos em poucos PDFs. Os documentos soltos de antes continuam na aba Arquivos do card.']
      }
      if (partes.length) {
        return ['📥 Autos prontos no Escavador; os PDFs estão subindo para a aba Arquivos do card. Já estão lá:', ...listaDePdfs(partes.map((x) => x.nome))]
      }
      if (!j && (p.anexados ?? 0) > 0) {
        return [`📥 Autos prontos; subindo para a aba Arquivos do card (${milhar(p.anexados ?? 0)} de ${milhar(p.totalDocumentos ?? 0)} documentos).`]
      }
      return ['📥 Autos prontos no Escavador; os PDFs estão subindo para a aba Arquivos do card.']
    }
    case 'CONCLUIDO': {
      if (j?.concluida && todas.length) {
        const docs = partes.reduce((t, x) => t + x.documentos, 0)
        const paginas = partes.reduce((t, x) => t + x.paginas, 0)
        const datas = partes.flatMap((x) => [x.primeiro, x.ultimo]).filter((d): d is string => !!d).sort()
        const quando = periodo(datas[0] ?? null, datas.at(-1) ?? null)
        const linhas = partes.length
          ? [
            `✅ Autos anexados na aba Arquivos do card — ${milhar(docs)} documento(s)` +
            (paginas ? `, ${milhar(paginas)} páginas` : '') +
            (quando ? `, ${quando}` : '') +
            `, ${partes.length === 1 ? 'num PDF só' : `em ${partes.length} PDFs`}:`,
            ...listaDePdfs(partes.map((x) => x.nome)),
          ]
          : ['❌ Os autos foram juntados, mas nenhum PDF ficou ligado ao card.']
        if (j.modo === 'rejuntar') {
          linhas.push('   Os documentos soltos de antes continuam na aba Arquivos; o "Executar análise" lê só os PDFs juntados.')
        }
        if (soltas.length) {
          linhas.push(
            `⚠️ ${soltas.length} PDF(s) subiram ao Kommo mas não ficaram ligados ao card: ${soltas.map((x) => x.nome).join('; ')}. ` +
              'Anexe à mão o que faltar.',
          )
        }
        if (j.naoJuntados.length) {
          const fora = [...j.naoJuntados].sort((a, b) => a.ordem - b.ordem)
          const exemplos = fora.slice(0, MAX_NAO_JUNTADOS_NA_NOTA).map((d) => `${d.nome} (${d.motivo})`).join('; ')
          linhas.push(
            `⚠️ ${fora.length} documento(s) ficaram de fora: ${exemplos}${fora.length > MAX_NAO_JUNTADOS_NA_NOTA ? '…' : ''}. ` +
              'Se forem importantes, baixe-os no Escavador ou no tribunal.',
          )
        }
        return linhas
      }
      // O FORMATO ANTIGO (um arquivo por documento), ou o rejuntar que falhou.
      const linhas = [
        `✅ Autos anexados na aba Arquivos do card, um arquivo por documento ("${nomeDoPapel(p.rotulo)} 001, 002…")` +
          ((p.totalDocumentos ?? 0) > 0 ? `: ${milhar(p.anexados ?? 0)} de ${milhar(p.totalDocumentos ?? 0)} documento(s).` : '.'),
      ]
      if (/^Rejuntar falhou/i.test(String(p.detalhe ?? ''))) {
        linhas.push('⚠️ Não consegui juntá-los em poucos PDFs; os documentos soltos continuam valendo para a análise.')
      }
      return linhas
    }
    case 'FALHOU': {
      const linhas = p.desistiu && p.falhaDoRobo
        ? [
          `❌ O robô do Escavador seguiu falhando no tribunal (${p.falhaDoRobo}) depois de ${Math.max(1, p.tentativas ?? 0)} ` +
          'tentativa(s); parei de tentar. Para tentar de novo, tire o card da coluna de análise e devolva-o a ela — ou anexe os autos à mão.',
        ]
        : [`❌ Não consegui baixar os autos: ${motivo(p.detalhe)}. Anexe os autos à mão.`]
      if (partes.length) {
        linhas.push('   Subiram à aba Arquivos do card só estes PDFs (o resto do processo não está no card):', ...listaDePdfs(partes.map((x) => x.nome)))
      }
      return linhas
    }
    case INTERROMPIDO:
      return [
        '⏸️ Interrompido — o card saiu da coluna de análise antes do pedido ao Escavador. ' +
          'Nenhum pedido é feito enquanto ele estiver fora; se voltar à coluna, o pedido volta para a fila.',
      ]
    default:
      return [`ℹ️ ${p.estado || 'Sem andamento'}.`]
  }
}

/**
 * A NOTA ÚNICA do card: os processos identificados, o papel de cada um e o
 * andamento de cada pedido. SEM A ASSINATURA — quem a envia assina
 * (`assinarNota`), como em toda nota da plataforma.
 *
 * DETERMINÍSTICA de propósito: os mesmos processos no mesmo estado dão o mesmo
 * texto, letra por letra. É isso que deixa a rotina não editar a nota quando
 * nada mudou (sem hora, sem contagem que anda sozinha).
 */
export function notaUnicaDosAutos(processos: ProcessoDaNota[]): string {
  const lista = [...processos].sort(
    (a, b) => ordemDoRotulo(a.rotulo) - ordemDoRotulo(b.rotulo) || (a.cnj < b.cnj ? -1 : a.cnj > b.cnj ? 1 : 0),
  )
  const blocos = lista.map((p) => [`• ${nomeDoPapel(p.rotulo)} — ${p.cnj}`, ...andamentoDoProcesso(p)].join('\n'))
  return [
    `📂 Autos deste crédito pelo Escavador — ${lista.length === 1 ? '1 processo identificado' : `${lista.length} processos identificados`}:`,
    ...blocos,
    'Esta nota é atualizada sozinha a cada passo, aqui mesmo; os PDFs ficam na aba Arquivos do card. ' +
      'Se algum número de processo estiver errado, corrija o título ou as anotações do card.',
  ].join('\n\n')
}

// ------------------------------------------------------------------ A NOTA NO KOMMO

/** O que o banco guarda da nota do card (`escavador_autos_card`, migração 0078). */
export interface NotaDoCard {
  kommo_lead_id: number
  /** O id da nota no Kommo. Null = ainda não criada (ou apagada no Kommo e por recriar). */
  nota_id: number | null
  /** O último texto que subiu, assinado. */
  nota_texto: string | null
  /**
   * Quando o card entrou no regime da nota única (a primeira leitura depois
   * desta mudança) — e, depois, quando a criação da nota foi tomada por uma
   * volta. NULO = card lido antes desta mudança: nenhuma nota.
   */
  nota_em: string | null
}

/** O que a sincronização da nota pede ao Kommo e ao banco. */
export interface PortaDaNota {
  /** POST da nota `common`. */
  criar(leadId: number, texto: string): Promise<{ id: number } | { erro: string }>
  /** PATCH do texto da nota. 'apagada' = o Kommo não a tem mais (404). */
  editar(leadId: number, notaId: number, texto: string): Promise<'ok' | 'apagada' | { erro: string }>
  /**
   * A POSSE DA CRIAÇÃO, por update condicional: grava `nota_id = null` e
   * `nota_em = agora` só se a linha ainda tem o `nota_id` e o `nota_em` lidos.
   * true = esta volta ganhou e cria; false = outra volta chegou antes.
   */
  tomarCriacao(leadId: number, lido: { notaId: number | null; notaEm: string | null }): Promise<boolean>
  /** Grava o id da nota criada e o texto. */
  gravarCriada(leadId: number, notaId: number, texto: string): Promise<void>
  /** Grava o texto editado — só se `nota_texto` ainda é o lido (outra volta pode ter editado depois). */
  gravarTexto(leadId: number, texto: string, textoLido: string | null): Promise<void>
}

/**
 * Quanto a criação de uma nota fica reservada para a volta que a tomou. Passado
 * isso sem `nota_id`, a criação falhou (ou a volta morreu) e outra tenta.
 */
export const POSSE_DA_CRIACAO_MS = 3 * 60_000

export type ResultadoDaNota = 'sem_nota' | 'igual' | 'editada' | 'criada' | 'esperando' | 'falhou'

/**
 * Leva a nota do card ao texto de agora. NUNCA ESCREVE NOTA NOVA ao lado de
 * uma que existe: com `nota_id`, só se edita; a criação só acontece quando o
 * card não tem nota (a primeira falhou) ou o Kommo disse que ela foi apagada —
 * e sempre por uma volta só (`tomarCriacao`).
 */
export async function sincronizarNotaDoCard(
  card: NotaDoCard,
  texto: string,
  porta: PortaDaNota,
  agoraMs: number,
): Promise<ResultadoDaNota> {
  const leadId = Number(card.kommo_lead_id)
  // Card de antes da mudança: as notas antigas ficam, e nada novo se escreve.
  if (!card.nota_em) return 'sem_nota'
  // 0 = a nota foi criada, mas o Kommo não devolveu o id: não há o que editar, e criar outra duplicaria.
  if (card.nota_id === 0) return 'sem_nota'

  if (card.nota_id) {
    if (card.nota_texto === texto) return 'igual'
    const r = await porta.editar(leadId, card.nota_id, texto)
    if (r === 'ok') {
      await porta.gravarTexto(leadId, texto, card.nota_texto)
      return 'editada'
    }
    if (r !== 'apagada') return 'falhou'
    // APAGADA NO KOMMO: uma nota nova, e uma só — a volta que tirar o id velho.
    if (!(await porta.tomarCriacao(leadId, { notaId: card.nota_id, notaEm: card.nota_em }))) return 'esperando'
    return await criar(leadId, texto, porta)
  }

  // SEM NOTA AINDA (a criação da primeira leitura falhou, ou a volta morreu no
  // meio): espera a posse de quem tentou vencer, e então toma.
  const desde = Date.parse(card.nota_em)
  if (Number.isFinite(desde) && agoraMs - desde < POSSE_DA_CRIACAO_MS) return 'esperando'
  if (!(await porta.tomarCriacao(leadId, { notaId: null, notaEm: card.nota_em }))) return 'esperando'
  return await criar(leadId, texto, porta)
}

async function criar(leadId: number, texto: string, porta: PortaDaNota): Promise<ResultadoDaNota> {
  const r = await porta.criar(leadId, texto)
  if ('erro' in r) return 'falhou'
  await porta.gravarCriada(leadId, r.id, texto)
  return 'criada'
}

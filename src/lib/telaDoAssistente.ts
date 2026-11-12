// A LÓGICA DA TELA DO ASSISTENTE, fora do componente (revisão do assistente,
// 12/11/2026): o histórico que vai ao modelo, o pedido em curso por conversa, a
// contagem de Skills e os tipos de anexo. Funções puras, testadas em
// src/lib/__tests__/assistenteTela.test.ts — no componente, o mesmo desenho
// vivia espalhado em `useState` e era testado só lendo o fonte.

import type { ArquivoGerado } from './arquivosDoAssistente'

export interface AcaoProposta {
  tipo: 'gerar_peticao'
  processo_id: string
  numero_cnj: string | null
  cessionario: string | null
  instrucao: string
}

export interface ContatoSugerido {
  nome_contato: string | null
  whatsapp: string
  mensagem: string
}

export interface Mensagem {
  role: 'user' | 'assistant'
  /** O texto que a pessoa escreveu, ou o que o assistente respondeu — e só ele. */
  content: string
  /** A ação que a resposta propôs (gerar petição). */
  acaoProposta?: AcaoProposta
  /**
   * O QUE A PESSOA FEZ COM A PROPOSTA, gravado na conversa (12/11/2026). Antes o
   * Cancelar/Confirmar só tirava o cartão da tela: reaberta a conversa, ele
   * voltava, pronto para gerar a mesma petição de novo.
   */
  acaoResolvida?: 'confirmada' | 'cancelada'
  /** Arquivos que uma Skill gerou nesta resposta (ver Configurações → Skills). */
  arquivos?: ArquivoGerado[]
  /** Contato + mensagem prontos pra abrir o WhatsApp e copiar de um clique. */
  contatoSugerido?: ContatoSugerido
  /**
   * A RESPOSTA PAROU NO LIMITE DE TAMANHO (12/11/2026). Era um parágrafo colado
   * no fim do `content`: ia junto no "Copiar resposta" e voltava ao modelo no
   * histórico, como se o próprio assistente o tivesse escrito.
   */
  truncada?: boolean
  /** Os nomes dos arquivos que a pessoa anexou a esta pergunta. */
  anexos?: string[]
}

// ----------------------------------------------------------- aviso de corte

/** O aviso que até 11/11/2026 era gravado DENTRO do texto da resposta. */
const AVISO_DE_CORTE_ANTIGO =
  /\n*---\n+\*\*Resposta interrompida\*\* por tamanho\.[^\n]*\s*$/

/**
 * Tira do texto o aviso de corte das conversas gravadas antes de 12/11/2026 e
 * devolve-o como marca. Sem isto, as conversas antigas continuariam mandando o
 * aviso ao modelo e ao "Copiar".
 */
export function normalizarMensagem(m: Mensagem): Mensagem {
  if (m.role !== 'assistant' || typeof m.content !== 'string') return m
  if (!AVISO_DE_CORTE_ANTIGO.test(m.content)) return m
  return { ...m, content: m.content.replace(AVISO_DE_CORTE_ANTIGO, '').trimEnd(), truncada: true }
}

// --------------------------------------------------- o histórico ao modelo

/**
 * As notas do que a mensagem levava além do texto. O MODELO SÓ VÊ O TEXTO: sem
 * elas, "manda de novo aquela mensagem para o cartório" não tinha a que se
 * referir — o cartão de contato, a petição proposta e os arquivos gerados
 * ficavam só na tela. As notas vão ao modelo, nunca à bolha.
 */
export function notasDaMensagem(m: Mensagem): string[] {
  const notas: string[] = []
  if (m.role === 'user') {
    if (m.anexos?.length) notas.push(`[Anexos: ${m.anexos.join(', ')}]`)
    return notas
  }
  if (m.contatoSugerido) {
    const c = m.contatoSugerido
    notas.push(
      `[Cartão de contato: ${c.nome_contato?.trim() || 'sem nome'}, ${c.whatsapp}, mensagem: "${c.mensagem}"]`,
    )
  }
  if (m.acaoProposta) {
    const a = m.acaoProposta
    const desfecho =
      m.acaoResolvida === 'confirmada'
        ? ' (a pessoa confirmou e abriu a revisão)'
        : m.acaoResolvida === 'cancelada'
          ? ' (a pessoa cancelou)'
          : ''
    notas.push(
      `[Ação proposta: gerar petição no processo ${a.numero_cnj ?? '(a confirmar)'} — ${a.instrucao}${desfecho}]`,
    )
  }
  if (m.arquivos?.length) notas.push(`[Arquivos gerados: ${m.arquivos.map((f) => f.nome).join(', ')}]`)
  if (m.truncada) notas.push('[Esta resposta foi interrompida por tamanho.]')
  return notas
}

/**
 * O histórico que vai ao servidor: só papel e texto, o texto com as notas.
 *
 * A PERGUNTA SEM RESPOSTA SAI (a que falhou e ficou na conversa): duas falas
 * seguidas da pessoa, uma delas nunca respondida, confundiam o modelo — e a
 * nova pergunta já vem separada, no campo `pergunta`.
 */
export function historicoParaOModelo(
  mensagens: readonly Mensagem[],
): { role: 'user' | 'assistant'; content: string }[] {
  const saida: { role: 'user' | 'assistant'; content: string }[] = []
  mensagens.forEach((bruta, i) => {
    const m = normalizarMensagem(bruta)
    if (m.role === 'user' && mensagens[i + 1]?.role !== 'assistant') return
    const partes = [m.content.trim(), ...notasDaMensagem(m)].filter(Boolean)
    if (partes.length === 0) return
    saida.push({ role: m.role, content: partes.join('\n\n') })
  })
  return saida
}

// ------------------------------------------- a conversa, pergunta e resposta

/** A pergunta é a última fala e ainda não tem resposta? */
function ultimaEhAPergunta(msgs: readonly Mensagem[], pergunta: string): boolean {
  const ultima = msgs[msgs.length - 1]
  return ultima?.role === 'user' && ultima.content === pergunta
}

/**
 * A conversa com a pergunta nova no fim. `substituir` é a pergunta que falhou:
 * se ela é a última fala (sem resposta), a nova toma o lugar dela — a pessoa
 * reescreveu a pergunta em vez de tocar "Tentar de novo", e a velha não fica
 * pendurada sem resposta.
 */
export function comPergunta(
  msgs: readonly Mensagem[],
  pergunta: Mensagem,
  substituir: string | null = null,
): Mensagem[] {
  const base = substituir !== null && ultimaEhAPergunta(msgs, substituir) ? msgs.slice(0, -1) : msgs
  return [...base, pergunta]
}

/**
 * A conversa com a resposta no fim. SE A PERGUNTA NÃO ESTÁ LÁ (a gravação dela
 * falhou, ou a conversa foi relida do banco antes de ela chegar), entra antes —
 * resposta sem pergunta não se lê.
 */
export function comResposta(
  msgs: readonly Mensagem[],
  pergunta: Mensagem,
  resposta: Mensagem,
): Mensagem[] {
  return ultimaEhAPergunta(msgs, pergunta.content)
    ? [...msgs, resposta]
    : [...msgs, pergunta, resposta]
}

/**
 * Marca a proposta de petição como confirmada ou cancelada. Procura pela
 * posição e confere o texto; não batendo (a conversa do banco tem outra ordem),
 * vale a primeira resposta com o mesmo texto e a proposta em aberto.
 */
export function comAcaoResolvida(
  msgs: readonly Mensagem[],
  indice: number,
  conteudo: string,
  estado: 'confirmada' | 'cancelada',
): Mensagem[] {
  const casa = (m: Mensagem | undefined) =>
    !!m && m.role === 'assistant' && !!m.acaoProposta && !m.acaoResolvida && m.content === conteudo
  const alvo = casa(msgs[indice]) ? indice : msgs.findIndex(casa)
  if (alvo < 0) return [...msgs]
  return msgs.map((m, i) => (i === alvo ? { ...m, acaoResolvida: estado } : m))
}

/** O título da conversa: o começo da primeira pergunta. */
export function tituloDaConversa(msgs: readonly Mensagem[]): string {
  const primeira = msgs.find((m) => m.role === 'user')?.content.trim() || 'Conversa'
  return primeira.length > 60 ? `${primeira.slice(0, 60)}…` : primeira
}

// --------------------------------------------- o pedido em curso, por conversa

/**
 * O PEDIDO EM CURSO É DE UMA CONVERSA, não da tela (12/11/2026). Com um só
 * `carregando` para o painel, perguntar em A e abrir B mostrava "Consultando os
 * dados…" em B e travava o Enviar dela; e o erro de A, chegando com B aberta,
 * sumia sem ninguém ver.
 */
export type Pendencia<P> =
  | { estado: 'enviando'; pedido: P }
  | { estado: 'erro'; pedido: P; erro: string }

export type Pendencias<P> = Readonly<Record<string, Pendencia<P>>>

export type AcaoDePendencia<P> =
  | { tipo: 'enviou'; conversa: string; pedido: P }
  | { tipo: 'respondeu'; conversa: string }
  | { tipo: 'falhou'; conversa: string; erro: string }
  | { tipo: 'descartou'; conversa: string }

export function pendenciasReducer<P>(
  estado: Pendencias<P>,
  acao: AcaoDePendencia<P>,
): Pendencias<P> {
  const atual = estado[acao.conversa]
  switch (acao.tipo) {
    case 'enviou':
      return { ...estado, [acao.conversa]: { estado: 'enviando', pedido: acao.pedido } }
    case 'falhou':
      // SÓ QUEM ESTAVA ENVIANDO FALHA: a conversa excluída no meio do pedido já
      // saiu daqui, e não volta como erro.
      if (atual?.estado !== 'enviando') return estado
      return { ...estado, [acao.conversa]: { estado: 'erro', pedido: atual.pedido, erro: acao.erro } }
    case 'respondeu':
    case 'descartou': {
      if (!atual) return estado
      const resto = { ...estado }
      delete resto[acao.conversa]
      return resto
    }
  }
}

// ------------------------------------------------------------------ Skills

/** As Skills marcadas que ainda existem na lista carregada. */
export function skillsValidas(
  selecionadas: ReadonlySet<string>,
  lista: readonly { skill_id: string }[],
): string[] {
  return lista.map((s) => s.skill_id).filter((id) => selecionadas.has(id))
}

/**
 * O número do botão "Skills (N)": SÓ AS QUE EXISTEM. A Skill removida em
 * Configurações continuava no conjunto das marcadas e contava — o botão dizia
 * 3 com duas na lista.
 */
export function contarSkills(
  selecionadas: ReadonlySet<string>,
  lista: readonly { skill_id: string }[],
  comBaseDoKommo: boolean,
): number {
  return skillsValidas(selecionadas, lista).length + (comBaseDoKommo ? 1 : 0)
}

/**
 * As Skills do pedido. ANTES DE A LISTA CHEGAR, `undefined` — o campo não vai,
 * e o servidor usa todas as ativas. Antes ia `[]`, e a primeira pergunta feita
 * logo ao abrir saía sem Skill nenhuma.
 */
export function skillsDoPedido(
  carregou: boolean,
  selecionadas: ReadonlySet<string>,
  lista: readonly { skill_id: string }[] | undefined,
): string[] | undefined {
  return carregou ? skillsValidas(selecionadas, lista ?? []) : undefined
}

// ------------------------------------------------------------------ anexos

/**
 * O anexo só se lê com uma Skill (no container de código)? A mesma regra do
 * servidor (`tipoDeBloco` em supabase/functions/assistente): imagem, PDF e
 * texto vão direto; o resto — planilha, Word, zip — precisa de Skill.
 */
export function anexoPrecisaDeSkill(tipo: string): boolean {
  const mime = (tipo || 'application/octet-stream').toLowerCase()
  if (['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(mime)) return false
  if (mime === 'application/pdf' || mime.startsWith('text/')) return false
  return true
}

// ------------------------------------------------------------------ teclado

/**
 * O Enter envia? NO CELULAR, NÃO: lá não há Shift para quebrar a linha, e o
 * Enter era o único jeito de pular linha — enviava a pergunta pela metade. Lá
 * quem envia é o botão. E NUNCA NO MEIO DE UMA COMPOSIÇÃO (acento por tecla
 * morta, teclado japonês): o Enter que confirma a letra enviava junto.
 */
export function enterEnvia(e: {
  key: string
  shiftKey: boolean
  isComposing: boolean
  keyCode?: number
  toque: boolean
}): boolean {
  if (e.key !== 'Enter' || e.shiftKey) return false
  if (e.isComposing || e.keyCode === 229) return false
  return !e.toque
}

/** A próxima opção de uma lista pelo teclado (setas, Home, End), em volta. */
export function proximaOpcao(atual: number, total: number, tecla: string): number | null {
  if (total === 0) return null
  if (tecla === 'ArrowDown') return atual < 0 ? 0 : (atual + 1) % total
  if (tecla === 'ArrowUp') return atual < 0 ? total - 1 : (atual - 1 + total) % total
  if (tecla === 'Home') return 0
  if (tecla === 'End') return total - 1
  return null
}

/** Um id de conversa novo, já no navegador: a conversa tem nome antes de ir ao banco. */
export function novoIdDeConversa(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  // SEM `randomUUID` (navegador antigo, página fora de https): o mesmo formato.
  const b = new Uint8Array(16)
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(b)
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256)
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

// O QUE O ESCAVADOR MANDA, E O QUE FAZEMOS COM ISSO — as partes puras.
//
// POR QUE ESTE ARQUIVO EXISTE SEPARADO DA FUNÇÃO. O callback é um endpoint
// público que não dá para exercitar em teste de integração sem expor a conta: o
// que se pode testar é a LEITURA do que chega e a MONTAGEM do que se grava. É o
// que mora aqui, sem `Deno.` e sem `npm:`, para rodar no vitest.
//
// E porque o formato do evento NÃO ESTÁ DOCUMENTADO. A documentação do Escavador
// descreve o mecanismo — URL cadastrada no painel, token no header Authorization,
// retentativas — e mostra o corpo de um callback de MONITORAMENTO, não o de uma
// atualização de processo. Escrever um parser confiante em cima disso seria
// construir sobre suposição: a função não confia no corpo, ela extrai o que
// consegue e PERGUNTA À API qual é o estado de verdade.

/** O número CNJ tem forma inconfundível, e é isso que permite achá-lo em qualquer corpo. */
const CNJ = /\b(\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4})\b/

/**
 * O processo de que este evento fala — venha ele em que campo vier.
 *
 * VARRE O JSON INTEIRO, de propósito. O campo pode se chamar `numero_cnj`,
 * `numero`, `processo.numero_cnj` ou vir aninhado num `event_data`; a forma do
 * número, essa, não muda. Procurar pelo formato é o que sobrevive a um evento
 * cuja estrutura ninguém nos documentou.
 */
export function cnjDoEvento(payload: unknown): string | null {
  if (payload == null) return null
  const texto = typeof payload === 'string' ? payload : JSON.stringify(payload)
  return texto.match(CNJ)?.[1] ?? null
}

/** Os estados que o Escavador usa para uma solicitação de atualização. */
export const ESTADOS_DO_PEDIDO = ['PENDENTE', 'SUCESSO', 'NAO_ENCONTRADO', 'ERRO'] as const
export type EstadoDoPedido = (typeof ESTADOS_DO_PEDIDO)[number]

/** O pedido terminou — de qualquer maneira? Só `PENDENTE` é espera. */
export function pedidoEncerrado(status: unknown): boolean {
  const s = String(status ?? '').trim().toUpperCase()
  return s !== '' && s !== 'PENDENTE'
}

/** O pedido terminou BEM, que é a única situação em que há documento para buscar. */
export function pedidoBemSucedido(status: unknown): boolean {
  return String(status ?? '').trim().toUpperCase() === 'SUCESSO'
}

/**
 * O identificador do evento, para não tratá-lo duas vezes.
 *
 * O Escavador reenvia o que não recebeu confirmação — o próprio endpoint de
 * listagem mostra `attempts` e `next_run_at`. Sem uma chave, cada reenvio
 * baixaria os mesmos PDFs de novo, e cada download pode custar.
 *
 * SEM UUID NO CORPO, INVENTA-SE UM ESTÁVEL a partir do que veio: dois eventos
 * iguais têm de gerar a mesma chave, senão a idempotência não existe. É hash do
 * conteúdo, não do relógio.
 */
export function chaveDoEvento(payload: unknown): string {
  const p = (payload ?? {}) as Record<string, unknown>
  const dele = p.uuid ?? p.id ?? (p.callback as Record<string, unknown> | undefined)?.uuid
  if (typeof dele === 'string' && dele.trim()) return dele.trim()
  if (typeof dele === 'number') return String(dele)

  // FNV-1a sobre o corpo inteiro — mesmo corpo, mesma chave.
  const texto = JSON.stringify(payload ?? null)
  let h = 0x811c9dc5
  for (const c of texto) {
    h ^= c.codePointAt(0) ?? 0
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return `sem-uuid-${h.toString(16).padStart(8, '0')}`
}

/** O nome do evento, quando ele se apresenta. Serve ao registro, não à decisão. */
export function nomeDoEvento(payload: unknown): string | null {
  const p = (payload ?? {}) as Record<string, unknown>
  const e = p.event ?? p.evento ?? (p.resultado as Record<string, unknown> | undefined)?.event
  return typeof e === 'string' && e.trim() ? e.trim() : null
}

/** Um documento como o Escavador o lista em `/autos` e `/documentos-publicos`. */
export interface DocumentoDoEscavador {
  chave: string
  nome: string
  tipo: string | null
}

/**
 * Os documentos de uma resposta de listagem, no formato que gravamos.
 *
 * TOLERANTE COM O NOME E INTOLERANTE COM A CHAVE: sem `key` não há como baixar o
 * PDF, então o item é descartado; sem nome, guarda-se a chave como nome, porque
 * um documento sem rótulo ainda é um documento.
 */
export function documentosDaLista(corpo: unknown): DocumentoDoEscavador[] {
  const itens = (corpo as { items?: unknown[] } | null)?.items
  if (!Array.isArray(itens)) return []
  const vistos = new Set<string>()
  const saida: DocumentoDoEscavador[] = []
  for (const bruto of itens) {
    const i = (bruto ?? {}) as Record<string, unknown>
    const chave = String(i.key ?? '').trim()
    if (!chave || vistos.has(chave)) continue
    vistos.add(chave)
    const nome = String(i.nome ?? i.titulo ?? i.tipo ?? '').trim()
    saida.push({
      chave,
      nome: nome || chave,
      tipo: typeof i.tipo === 'string' && i.tipo.trim() ? i.tipo.trim() : null,
    })
  }
  return saida
}

/**
 * Onde o PDF fica no balde.
 *
 * PELO CNJ E PELA CHAVE, e não pelo nome do documento: nome se repete ("Petição"
 * aparece oito vezes num processo) e vem com barra, acento e espaço. A chave é
 * única e já é um identificador — e é ela que liga o arquivo à linha do banco.
 */
export function caminhoDoDocumento(numeroCnj: string, chave: string): string {
  const cnj = String(numeroCnj ?? '').replace(/[^\d.-]/g, '')
  const limpa = String(chave ?? '')
    // A BARRA SAI PRIMEIRO — ela criaria pasta dentro do processo — e a
    // sequência de pontos junto com ela: `..` num nome de objeto é caminho para
    // fora, e a chave vem de fora. Ninguém precisa que ela contenha ponto duplo.
    .replace(/[^\w.-]+/g, '_')
    .replace(/\.{2,}/g, '.')
    .replace(/^\.+/, '')
    .slice(0, 120)
  return `${cnj}/${limpa || 'documento'}.pdf`
}

// _shared/edicaoDeNota.ts
// EDITAR UMA NOTA DO CARD PELA PLATAFORMA (20/10/2026, pedido do dono).
//
// O histórico do card mostra as notas, e às vezes quem escreveu quer corrigir o
// texto. A API do Kommo edita o texto de uma nota `common` no lugar (PATCH em
// /leads/notes/{id}), sem criar outra — a nota fica onde estava na linha do
// tempo. O Kommo NÃO guarda a versão anterior: o rastro é o rodapé, que passa a
// dizer quem editou e quando.
//
// SÓ NOTA DE GENTE: as notas de texto escritas por pessoas (pela plataforma, com
// "registrado por … pela plataforma Credijuris", ou direto no Kommo). Movimento,
// anexo e nota automática da análise não se editam — a automática é registro
// do sistema, e editá-la apagaria a marca que a separa do que o comercial diz.
//
// Sem `npm:` e sem `Deno.`: a tela e a função usam as mesmas regras.

/** A linha de rodapé da plataforma: "— registrado por …" ou "— editado por …", sempre com "pela plataforma Credijuris". */
const RODAPE = /^\s*—\s*(registrado|editado)\b.*pela plataforma Credijuris.*$/im

/** A nota pode ser editada pela plataforma? */
export function notaEditavel(n: {
  id?: unknown
  tipo?: string | null
  automatica?: boolean | null
  arquivo_uuid?: string | null
}): boolean {
  return Number(n.id) > 0 && (n.tipo ?? 'common') === 'common' && !n.automatica && !n.arquivo_uuid
}

/** O texto que vai para o campo de edição: a nota sem o rodapé da plataforma. */
export function corpoEditavel(texto: string): string {
  return String(texto ?? '')
    .split(/\r?\n/)
    .filter((l) => !RODAPE.test(l))
    .join('\n')
    .trim()
}

/** "20/10/2026 15:40", no horário de Brasília. */
export function quandoEmBrasilia(d: Date): string {
  return d.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).replace(',', '')
}

/**
 * O texto novo da nota: o corpo editado e o rodapé com o rastro. Mantém QUEM
 * REGISTROU (a linha "registrado por …", sem a edição anterior) e acrescenta
 * quem editou agora — uma linha só, por mais que a nota seja editada.
 */
export function textoEditado(original: string, novoCorpo: string, editor: string, quando: Date): string {
  const corpo = String(novoCorpo ?? '').trim()
  const registrado = String(original ?? '')
    .split(/\r?\n/)
    .find((l) => /^\s*—\s*registrado\b.*pela plataforma Credijuris/i.test(l))
    ?.replace(/\s*·\s*editado por .*$/i, '')
    .trim()
  const edicao = `editado por ${String(editor ?? '').trim() || 'alguém'} em ${quandoEmBrasilia(quando)}`
  const rodape = registrado ? `${registrado} · ${edicao}` : `— ${edicao} pela plataforma Credijuris`
  return `${corpo}\n\n${rodape}`
}

/**
 * A NOTA DE ARQUIVO COM TEXTO DE GENTE (27/10/2026, pedido do dono): o "Anotar"
 * com anexo grava o texto dentro da nota do arquivo (ver notaComArquivo.ts), e
 * ela também se edita. Devolve o texto dela — ou null quando o texto é só o
 * nome do arquivo, que o próprio Kommo põe em toda nota de arquivo.
 */
export function textoProprioDaNotaDeArquivo(params: Record<string, unknown> | null | undefined): string | null {
  const p = params ?? {}
  const limpo = (v: unknown) => String(v ?? '').trim()
  const texto = limpo(p.text)
  if (!texto) return null
  const nomes = [limpo(p.file_name), limpo(p.original_file_name)].filter(Boolean)
  return nomes.includes(texto) ? null : texto
}

/**
 * Os parâmetros do PATCH da nota de arquivo: os do arquivo, como o Kommo os
 * tem, e o texto novo. Só os campos que a documentação da nota de arquivo
 * lista — mandar de volta tudo o que a leitura trouxe arriscaria um 400.
 */
export function paramsDaNotaDeArquivo(params: Record<string, unknown> | null | undefined, texto: string) {
  const p = params ?? {}
  return {
    ...(p.file_uuid ? { file_uuid: String(p.file_uuid) } : {}),
    ...(p.version_uuid ? { version_uuid: String(p.version_uuid) } : {}),
    ...(p.file_name ? { file_name: String(p.file_name) } : {}),
    text: texto,
  }
}

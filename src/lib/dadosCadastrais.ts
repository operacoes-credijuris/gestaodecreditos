// Regras de TELA de Dados cadastrais (onda 2 do redesenho): a busca da lista e
// as iniciais do avatar. O que o Salvar grava NÃO mora aqui — está em
// fichaPessoa.ts, com o teste que o prende.
//
// Sem import nenhum: roda no teste sem rede e sem o cliente do Supabase.

/** Minúsculo e sem acento — a busca não pode depender de "José" × "Jose". */
export function semAcento(s: string | null | undefined): string {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

/**
 * A linha casa com a busca?
 *
 * DUAS FORMAS DE CASAR, como na amostra (base.js › casaBusca):
 *   • TEXTO, sem acento e sem caixa, em qualquer campo — nome, documento,
 *     representante;
 *   • DÍGITOS, para o documento colado cru ou com outra máscara: "11222333"
 *     acha "11.222.333/0001-81". SÓ A PARTIR DE 4 DÍGITOS: com um ou dois, todo
 *     CPF da lista casaria, e a busca deixaria de filtrar.
 *
 * Busca em branco casa com tudo.
 */
export function casaBuscaDaFicha(
  campos: Array<string | null | undefined>,
  busca: string,
  minDigitos = 4,
): boolean {
  const q = semAcento(busca).trim()
  if (!q) return true
  if (campos.some((c) => semAcento(c).includes(q))) return true
  const dq = q.replace(/\D/g, '')
  return (
    dq.length >= minDigitos &&
    campos.some((c) => String(c ?? '').replace(/\D/g, '').includes(dq))
  )
}

const CONECTIVOS = new Set(['de', 'da', 'do', 'das', 'dos', 'e'])

/**
 * As iniciais do avatar da linha: as duas primeiras palavras com mais de duas
 * letras, SEM OS CONECTIVOS ("Francisco das Chagas Lima" → "FC"; a amostra dava
 * "FD", e "das" não é nome de ninguém). Nome só de palavras curtas cai na
 * primeira letra, para o avatar nunca sair vazio.
 */
export function iniciaisDoNome(nome: string): string {
  const palavras = nome.trim().split(/\s+/).filter(Boolean)
  const longas = palavras
    .filter((p) => p.length > 2 && !CONECTIVOS.has(p.toLowerCase()))
    .slice(0, 2)
  const base = longas.length ? longas : palavras.slice(0, 1)
  return base
    .map((p) => p[0] ?? '')
    .join('')
    .toUpperCase()
}

/** O que a ficha tem para copiar — os campos como a tela os mostra. */
export interface FichaParaCopiar {
  nome: string
  cpf?: string | null
  rg?: string | null
  representante?: string | null
  banco?: string | null
  agencia?: string | null
  conta?: string | null
  pix?: string | null
  /** O endereço já em texto corrido (o da prévia da ficha). */
  endereco?: string | null
}

/**
 * Os dados da ficha em texto, um por linha, para colar numa mensagem ou numa
 * transferência ("Copiar dados" da ficha — revisão de qualidade de vida).
 *
 * POR QUE: o comercial copia CPF, banco, agência, conta e Pix o tempo todo, e na
 * tabela não dá para selecionar — o clique na linha abre a ficha. Aqui sai tudo
 * de uma vez, rotulado, para quem recebe não confundir agência com conta.
 *
 * Campo vazio NÃO vira linha (um "Pix: " em branco parece dado faltando de quem
 * mandou). Os RÓTULOS SEGUEM O DOCUMENTO, como na tela: 12 dígitos ou mais é
 * CNPJ, o representante aparece e o RG passa a ser o dele. Sem nenhum dado além
 * do nome, devolve '' — não há o que copiar.
 */
export function textoDaFicha(f: FichaParaCopiar): string {
  const pj = String(f.cpf ?? '').replace(/\D/g, '').length > 11
  const linhas: Array<[string, string | null | undefined]> = [
    [pj ? 'CNPJ' : 'CPF', f.cpf],
    ['Representante legal', pj ? f.representante : null],
    [pj ? 'RG do representante' : 'RG', f.rg],
    ['Banco', f.banco],
    ['Agência', f.agencia],
    ['Conta', f.conta],
    ['Pix', f.pix],
    ['Endereço', f.endereco],
  ]
  const preenchidas = linhas
    .map(([rotulo, valor]) => [rotulo, String(valor ?? '').trim()] as const)
    .filter(([, valor]) => valor)
  if (preenchidas.length === 0) return ''
  return [`Nome: ${f.nome.trim()}`, ...preenchidas.map(([r, v]) => `${r}: ${v}`)].join('\n')
}

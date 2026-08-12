// Helpers de formatação e normalização de strings (pt-BR).

/** Converte string vazia/só espaços em null (mantém o banco sem ""). */
export const vazioNull = (s?: string | null): string | null =>
  s?.trim() ? s.trim() : null

/** Reduz um número de processo/telefone à forma só-dígitos. */
export function onlyDigits(v?: string | null): string {
  return (v ?? '').replace(/\D/g, '')
}

export function formatBRL(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return value.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  })
}

/**
 * Campo de dinheiro: os dígitos entram pela direita como centavos, então
 * digitar "1234" vira 12,34 e não há como montar um valor inválido. Devolve
 * null quando não sobrou dígito nenhum (campo em branco = não informado).
 */
export function parseBRLInput(v: string): number | null {
  const d = onlyDigits(v)
  return d ? Number(d) / 100 : null
}

/** Valor para dentro do campo de dinheiro: 1234.5 -> "1.234,50" (sem "R$"). */
export function formatBRLInput(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return ''
  return value.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

/**
 * Campo de percentual com DUAS CASAS OBRIGATÓRIAS. Mesma mecânica do campo de
 * dinheiro, e de propósito a mesma implementação: os dígitos entram pela
 * direita, então digitar "1550" vira 15,50 e não existe momento em que o campo
 * fique sem as duas casas nem como montar um valor inválido. Duas cópias da
 * mesma regra divergiriam com o tempo.
 */
export const parsePercentInput = parseBRLInput
export const formatPercentInput = formatBRLInput

/**
 * Percentual com DUAS casas sempre: "10,00%" e não "10%". Casas fixas alinham a
 * coluna e evitam que 81,4 e 81,40 pareçam números de precisão diferente.
 */
export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return `${value.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}%`
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const d = new Date(value.length <= 10 ? `${value}T00:00:00` : value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('pt-BR')
}

/**
 * O documento é de PESSOA JURÍDICA? Passar de 11 dígitos é o que decide.
 *
 * MESMA RÉGUA da máscara abaixo, de propósito: é o 12º dígito que troca o
 * formato na tela, e seria incoerente ele mudar a máscara para CNPJ e a
 * plataforma continuar chamando o campo de CPF. Daí este ser o único lugar que
 * responde "é PJ?" — o rótulo do campo, o rótulo na tabela e o campo de
 * representante legal todos consultam esta função.
 */
export function ehCnpj(v: string | null | undefined): boolean {
  return onlyDigits(v).length > 11
}

/** "CNPJ" ou "CPF", conforme o que já foi digitado. Ver ehCnpj. */
export const rotuloDocumento = (v: string | null | undefined): string =>
  ehCnpj(v) ? 'CNPJ' : 'CPF'

/**
 * Máscara de CPF/CNPJ que TROCA DE FORMATO sozinha no 12º dígito.
 *
 *   até 11 dígitos  000.000.000-00        (CPF)
 *   12 ou mais      00.000.000/0000-00    (CNPJ)
 *
 * O 12º dígito digitado é o que vira CPF em CNPJ, e o teto é 14. Como só entram
 * dígitos, não existe estado com formato inválido.
 */
export function formatCpfCnpjInput(v: string | null | undefined): string {
  const d = onlyDigits(v).slice(0, 14)
  if (d.length <= 11) {
    let s = d.slice(0, 3)
    if (d.length > 3) s += '.' + d.slice(3, 6)
    if (d.length > 6) s += '.' + d.slice(6, 9)
    if (d.length > 9) s += '-' + d.slice(9, 11)
    return s
  }
  let s = d.slice(0, 2) + '.' + d.slice(2, 5) + '.' + d.slice(5, 8) + '/' + d.slice(8, 12)
  if (d.length > 12) s += '-' + d.slice(12, 14)
  return s
}

/**
 * Agência e conta aceitam só dígitos e os separadores que aparecem de verdade
 * nesses números (ponto, hífen, barra). Letra é descartada na digitação: agência
 * e conta não têm letra, e uma que escape vira erro de transferência.
 */
export function limparNumeroConta(v: string | null | undefined): string {
  return (v ?? '').replace(/[^\d.\-/]/g, '')
}

/** Máscara de CEP: 00000-000. Só dígitos entram, teto de 8. */
export function formatCepInput(v: string | null | undefined): string {
  const d = onlyDigits(v).slice(0, 8)
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d
}

export interface PartesEndereco {
  logradouro?: string | null
  numero?: string | null
  complemento?: string | null
  bairro?: string | null
  cidade?: string | null
  uf?: string | null
  cep?: string | null
}

/**
 * Endereço em texto corrido, a partir das partes. É o que a tabela mostra e o
 * que se cola num contrato:
 *
 *   Rua Campos Sales, nº 223, apto 204, bairro Santa Tereza I,
 *   Barbacena/MG, CEP 36201-082
 *
 * Parte vazia é OMITIDA junto com a pontuação dela — sem isso um investidor sem
 * complemento sairia com ", ," no meio do endereço. Devolve string vazia quando
 * não há nada, e aí quem exibe decide o que mostrar.
 */
export function compilarEndereco(p: PartesEndereco): string {
  const t = (v: string | null | undefined) => (v ?? '').trim()
  const partes: string[] = []
  if (t(p.logradouro)) partes.push(t(p.logradouro))
  if (t(p.numero)) partes.push(`nº ${t(p.numero)}`)
  if (t(p.complemento)) partes.push(t(p.complemento))
  if (t(p.bairro)) partes.push(`bairro ${t(p.bairro)}`)
  // Cidade e UF andam juntas: "Barbacena/MG". Só a UF, sem cidade, não informa.
  const cidadeUf = t(p.cidade)
    ? t(p.uf)
      ? `${t(p.cidade)}/${t(p.uf)}`
      : t(p.cidade)
    : ''
  if (cidadeUf) partes.push(cidadeUf)
  if (t(p.cep)) partes.push(`CEP ${formatCepInput(p.cep)}`)
  return partes.join(', ')
}

/** Dígitos verificadores de CPF. Pega erro de digitação e de transcrição. */
export function cpfValido(v: string | null | undefined): boolean {
  const d = onlyDigits(v)
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false
  const dv = (ate: number) => {
    let soma = 0
    for (let i = 0; i < ate; i++) soma += Number(d[i]) * (ate + 1 - i)
    const r = (soma * 10) % 11
    return r === 10 ? 0 : r
  }
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10])
}

/** Dígitos verificadores de CNPJ. */
export function cnpjValido(v: string | null | undefined): boolean {
  const d = onlyDigits(v)
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false
  const dv = (ate: number) => {
    let peso = ate - 7
    let soma = 0
    for (let i = 0; i < ate; i++) {
      soma += Number(d[i]) * peso
      peso = peso === 2 ? 9 : peso - 1
    }
    const r = soma % 11
    return r < 2 ? 0 : 11 - r
  }
  return dv(12) === Number(d[12]) && dv(13) === Number(d[13])
}

/** true quando é CPF válido ou CNPJ válido; vazio conta como válido. */
export function cpfCnpjValido(v: string | null | undefined): boolean {
  const d = onlyDigits(v)
  if (!d) return true
  return d.length <= 11 ? cpfValido(d) : cnpjValido(d)
}

/**
 * Texto pronto para comparação de BUSCA: sem acento, minúsculo, sem espaço
 * sobrando. Quem digita numa caixa de busca não digita acento — procura "goiania"
 * e espera achar "Goiânia". Sem isto, a busca só encontra o que já foi digitado
 * com o acento certo, e a lista volta vazia com o item bem ali na tela.
 *
 * Separada de normalizarNome de propósito: aquela é CHAVE PRIMÁRIA no banco e
 * não pode mudar de comportamento; esta é só de leitura e pode evoluir.
 */
export function normalizarBusca(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/**
 * Nome normalizado: sem acento, sem espaço duplicado, minúsculo. Serve para
 * agrupar o mesmo investidor escrito de formas diferentes ("José da Silva" e
 * "jose da  silva" caem no mesmo lugar).
 *
 * ⚠️ É CHAVE PRIMÁRIA de public.investidor_dados. Mudar esta função órfã as
 * linhas já gravadas, porque a chave deixaria de casar. Se algum dia precisar
 * mudar, migre os dados junto.
 *
 * A faixa ̀-ͯ é a dos diacríticos combinantes, que é o que sobra
 * depois do normalize('NFD') separar letra e acento.
 */
export function normalizarNome(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/** Palavras que ligam um nome mas não distinguem duas pessoas. */
const CONECTIVOS = new Set(['de', 'da', 'do', 'das', 'dos', 'e'])

/**
 * Palavras significativas de um nome, sem acento e sem conectivo.
 *
 * A pontuação vira separador, e não parte da palavra: "Silva, José" tem de casar
 * com "José Silva", e "Credijuris Ltda." com "Credijuris Ltda". Depois de
 * normalizarBusca só sobra ASCII (o cedilha também sai no NFD), então a classe
 * [^a-z0-9] pega tudo o que não é letra nem dígito.
 */
function palavrasNome(s: string): string[] {
  return normalizarBusca(s)
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((p) => p && !CONECTIVOS.has(p))
}

/** Distância de edição, abandonada assim que passa de `max`. */
function distanciaEdicao(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  let anterior = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const atual = [i]
    for (let j = 1; j <= b.length; j++) {
      atual[j] = Math.min(
        anterior[j] + 1,
        atual[j - 1] + 1,
        anterior[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    }
    if (Math.min(...atual) > max) return max + 1
    anterior = atual
  }
  return anterior[b.length]
}

/**
 * Os nomes da lista parecidos com `consulta`, do mais parecido ao menos.
 *
 * Serve para OFERECER, nunca para corrigir sozinho: quem digita é que sabe se são
 * a mesma pessoa. Quem usa isto é o campo de texto livre (ComboboxTexto), que
 * mostra os parecidos quando a busca ao pé da letra não achou nada — assim o nome
 * certo aparece debaixo do cursor de quem digitou "Silvaa".
 *
 * Existe porque investidor e originador são identificados pelo nome
 * normalizado (ver normalizarNome). Uma letra trocada ou um sobrenome a menos
 * produz OUTRA chave, e o efeito não é cosmético: a pessoa aparece duas vezes na
 * aba de dados pessoais, cada metade com uma ficha bancária, e ninguém percebe
 * porque as duas linhas parecem certas.
 *
 * Diferença de acento, de caixa ou de espaço NÃO chega aqui: normalizarNome já
 * as trata como o mesmo nome. O que sobra são três casos:
 *
 *   1. mesmas palavras em outra ordem — "Silva, José" / "José Silva"
 *   2. uma palavra a mais ou a menos — "José Silva" / "José Antônio Silva"
 *   3. uma palavra quase igual — "José Silvaa" / "José Silva"
 *
 * Duas palavras erradas ao mesmo tempo ficam de fora de propósito: a partir daí
 * a semelhança é fraca e o aviso passaria a apontar gente que não tem relação.
 */
export function nomesParecidos(
  consulta: string,
  nomes: readonly string[],
  limite = 8,
): string[] {
  const q = palavrasNome(consulta)
  if (q.length === 0) return []
  const setQ = new Set(q)
  const notados: { nome: string; nota: number }[] = []
  for (const nome of nomes) {
    const setP = new Set(palavrasNome(nome))
    if (setP.size === 0) continue
    const comuns = [...setQ].filter((w) => setP.has(w)).length
    let nota: number | null = null
    if (comuns === setQ.size && comuns === setP.size) {
      nota = 0 // caso 1
    } else if (comuns > 0 && comuns === Math.min(setQ.size, setP.size)) {
      nota = 1 // caso 2
    } else {
      const soQ = [...setQ].filter((w) => !setP.has(w))
      const soP = [...setP].filter((w) => !setQ.has(w))
      if (soQ.length === 1 && soP.length === 1) {
        // Palavra curta admite só um erro: em "luz"/"cruz" a distância 2 já é
        // outra palavra, não um deslize de digitação.
        const limiar = Math.min(soQ[0].length, soP[0].length) <= 4 ? 1 : 2
        const d = distanciaEdicao(soQ[0], soP[0], limiar)
        if (d <= limiar) nota = 2 + d // caso 3
      }
    }
    if (nota !== null) notados.push({ nome, nota })
  }
  return notados
    .sort((a, b) => a.nota - b.nota)
    .slice(0, limite)
    .map((x) => x.nome)
}

/** O mais parecido de todos, ou null. Ver nomesParecidos. */
export function nomeParecido(
  consulta: string,
  nomes: readonly string[],
): string | null {
  return nomesParecidos(consulta, nomes, 1)[0] ?? null
}

/** Data e hora local: "10/08/2026 às 16:21". Para carimbo de geração. */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return `${d.toLocaleDateString('pt-BR')} às ${d.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  })}`
}

/**
 * Hoje em ISO local (YYYY-MM-DD). O locale sv-SE já entrega nesse formato, e
 * usar a data LOCAL (não UTC) importa: perto da meia-noite o toISOString()
 * viraria o dia antes da hora e acenderia semáforo errado.
 */
export function hojeISO(): string {
  return new Date().toLocaleDateString('sv-SE')
}

/**
 * Dias corridos de `inicio` até `fim`, ambos ISO (YYYY-MM-DD). null quando a
 * data inicial não existe ou está malformada.
 *
 * A conta é feita em UTC de propósito: subtrair Dates locais erra em um dia
 * sempre que houver mudança de fuso no intervalo, e a diferença apareceria como
 * "364 dias" num crédito comprado há exatamente um ano.
 */
export function diasEntre(
  inicio: string | null | undefined,
  fim: string,
): number | null {
  const a = (inicio ?? '').slice(0, 10)
  const b = (fim ?? '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(b)) return null
  const [y1, m1, d1] = a.split('-').map(Number)
  const [y2, m2, d2] = b.split('-').map(Number)
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000)
}

/**
 * Meses de `inicio` até `fim`, ambos ISO (YYYY-MM-DD), com fração no mês
 * incompleto. null quando alguma data falta ou está malformada.
 *
 * Meses de CALENDÁRIO, não dias/30: de 01/01 a 01/07 tem de dar exatamente 6, e
 * é assim que alguém confere a conta na mão. A sobra de dias entra como fração
 * do mês corrente (01/01 a 15/07 -> 6 + 14/31).
 *
 * Pode devolver negativo quando `fim` é anterior a `inicio`; quem usa decide o
 * que fazer com isso.
 */
export function mesesEntre(
  inicio: string | null | undefined,
  fim: string | null | undefined,
): number | null {
  const a = (inicio ?? '').slice(0, 10)
  const b = (fim ?? '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(b)) return null
  const [y1, m1, d1] = a.split('-').map(Number)
  const [y2, m2, d2] = b.split('-').map(Number)
  const inteiros = (y2 - y1) * 12 + (m2 - m1)
  if (d2 === d1) return inteiros
  // Fração do mês em curso, medida no mês onde a sobra cai.
  const anterior = d2 < d1 ? inteiros - 1 : inteiros
  const refMes = m2 - 1 + (d2 < d1 ? -1 : 0)
  const diasNoMes = new Date(y2, refMes + 1, 0).getDate()
  const sobra = d2 < d1 ? diasNoMes - d1 + d2 : d2 - d1
  return anterior + sobra / diasNoMes
}

/**
 * Data de "daqui a N meses" a partir de um ISO local (YYYY-MM-DD). Meses de
 * CALENDÁRIO, com o dia preso ao último do mês quando ele não existe
 * (31/01 -> 28/02) — somar 30 dias por mês erraria em boa parte do ano.
 */
export function mesesDepois(iso: string, meses: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const seq = m + meses
  const ano = y + Math.floor((seq - 1) / 12)
  const mes = ((seq - 1) % 12) + 1
  // Dia 0 do mês seguinte = último dia deste mês.
  const ultimoDia = new Date(ano, mes, 0).getDate()
  const dia = Math.min(d, ultimoDia)
  return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
}

/** Formata número de processo no padrão CNJ NNNNNNN-DD.AAAA.J.TR.OOOO. */
export function formatCNJ(value: string | null | undefined): string {
  if (!value) return '—'
  const digits = onlyDigits(value)
  if (digits.length !== 20) return value
  return `${digits.slice(0, 7)}-${digits.slice(7, 9)}.${digits.slice(
    9,
    13,
  )}.${digits.slice(13, 14)}.${digits.slice(14, 16)}.${digits.slice(16, 20)}`
}

// Partículas que permanecem em minúsculo no meio do nome.
const PARTICULAS_NOME = new Set([
  'de', 'da', 'do', 'das', 'dos', 'e', 'di', 'du', 'del', 'la', 'van', 'von',
])

/**
 * Converte um nome em CAIXA ALTA (vindo do ADVBOX) para "Primeira Letra
 * Maiúscula", mantendo partículas em minúsculo (ex.: "ERCÍLIO DA COSTA" ->
 * "Ercílio da Costa").
 */
export function formatNome(value: string | null | undefined): string {
  if (!value) return ''
  return value
    .toLocaleLowerCase('pt-BR')
    .split(/\s+/)
    .filter(Boolean)
    .map((w, i) =>
      i > 0 && PARTICULAS_NOME.has(w)
        ? w
        : w.charAt(0).toLocaleUpperCase('pt-BR') + w.slice(1),
    )
    .join(' ')
}

/**
 * "Sentence case": tudo minúsculo, só a primeira letra maiúscula
 * (ex.: "ENTRAR EM CONTATO" -> "Entrar em contato").
 */
export function sentenceCase(value: string | null | undefined): string {
  if (!value) return ''
  const s = value.toLocaleLowerCase('pt-BR')
  return s.charAt(0).toLocaleUpperCase('pt-BR') + s.slice(1)
}

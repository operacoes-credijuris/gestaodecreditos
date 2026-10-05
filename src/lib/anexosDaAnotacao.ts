// OS ARQUIVOS DO "ANOTAR" (05/10/2026, pedido do dono): além do texto, a
// anotação do card pode levar anexos — escolhidos no computador, arrastados para
// a caixa ou colados com Ctrl+V. Aqui moram as REGRAS (a lista, o limite, a
// ordem das chamadas e o que se diz quando parte falha), testáveis sem Kommo
// nem navegador. A tela (`CaixaDeAnotacao`) dá as chamadas de verdade.
//
// A SEQUÊNCIA, a mesma do envio aos fundos (`enviarAoFundo`):
//   1. o TEXTO, se houver, pela kommo-anotar — uma nota só, com o nome de quem
//      escreveu no rodapé;
//   2. cada ARQUIVO pela kommo-anexo-enviar, um de cada vez, com o cabeçalho
//      `x-texto` VAZIO: a função só grava a nota de texto quando há texto (ver
//      o passo 4 dela), e assim o texto não se repete a cada arquivo. Nada muda
//      na função.
//
// O TEXTO NÃO VAI NO CABEÇALHO DO ARQUIVO: um texto de alguns parágrafos,
// codificado, pode passar do tamanho que o caminho até a função aceita num
// cabeçalho — e aí a requisição inteira é recusada (o mesmo motivo da Remessa).
//
// FALHANDO O TEXTO, NADA MAIS SAI: os arquivos esperam, e a mensagem diz que
// nada entrou. FALHANDO UM ARQUIVO, os outros seguem; no fim, a tela diz o que
// entrou e o que não, e só o que não entrou fica na lista — enviar de novo não
// repete nem o texto nem os arquivos que já estão no card.
//
// NADA AQUI MOVE CARD.
import type { ProgressoDoEnvio } from './enviarArquivo'

/** O teto da kommo-anexo-enviar (`MAX_BYTES` lá): 100 MB por arquivo. */
export const LIMITE_DO_ANEXO = 100 * 1024 * 1024

const MB = 1024 * 1024

/** "48 KB", "1,4 MB", "37 MB" — o tamanho como a lista o mostra. */
export function tamanhoLegivel(bytes: number): string {
  if (bytes < MB) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  const mb = bytes / MB
  return mb < 10 ? `${mb.toFixed(1).replace('.', ',')} MB` : `${Math.round(mb)} MB`
}

/** O mesmo arquivo escolhido duas vezes não entra duas vezes. */
export const chaveDoArquivo = (a: Pick<File, 'name' | 'size' | 'lastModified'>): string =>
  `${a.name}:${a.size}:${a.lastModified}`

export type EstadoDoAnexo =
  | { fase: 'esperando' }
  | { fase: 'enviando'; pct: number }
  /** O arquivo já saiu do computador; a função está terminando com ele no Kommo. */
  | { fase: 'gravando' }
  | { fase: 'falhou'; erro: string }

export interface AnexoDaAnotacao {
  chave: string
  arquivo: File
  estado: EstadoDoAnexo
}

const doisDigitos = (n: number) => String(n).padStart(2, '0')

/**
 * O PRINT COLADO chega como "image.png" (todos com o mesmo nome): ganha um nome
 * que diga o que é e quando, para o card não ficar com cinco "image.png".
 */
export function nomearColado(arquivo: File, agora: Date, ordem: number): File {
  if (arquivo.name && arquivo.name !== 'image.png') return arquivo
  const quando =
    `${agora.getFullYear()}-${doisDigitos(agora.getMonth() + 1)}-${doisDigitos(agora.getDate())}` +
    `-${doisDigitos(agora.getHours())}${doisDigitos(agora.getMinutes())}${doisDigitos(agora.getSeconds())}`
  const tipo = arquivo.type || 'image/png'
  const ext = (tipo.split('/')[1] || 'png').replace('jpeg', 'jpg').replace(/[^a-z0-9]/gi, '')
  return new File([arquivo], `imagem-colada-${quando}-${ordem}.${ext}`, {
    type: tipo,
    lastModified: agora.getTime() + ordem,
  })
}

/**
 * Acrescenta os arquivos à lista. O GRANDE DEMAIS E O VAZIO NÃO ENTRAM, e a
 * mensagem diz por quê — antes de enviar, e não depois de um minuto de envio
 * recusado. O repetido também não entra (ficaria duas vezes no card).
 */
export function acrescentarAnexos(
  lista: readonly AnexoDaAnotacao[],
  novos: readonly File[],
): { lista: AnexoDaAnotacao[]; recusados: string[] } {
  const saida = [...lista]
  const recusados: string[] = []
  for (const arquivo of novos) {
    const chave = chaveDoArquivo(arquivo)
    if (arquivo.size > LIMITE_DO_ANEXO) {
      recusados.push(`${arquivo.name} (${tamanhoLegivel(arquivo.size)}) passa do limite de 100 MB por arquivo.`)
    } else if (arquivo.size === 0) {
      recusados.push(`${arquivo.name} está vazio (0 KB).`)
    } else if (saida.some((a) => a.chave === chave)) {
      recusados.push(`${arquivo.name} já está na lista.`)
    } else {
      saida.push({ chave, arquivo, estado: { fase: 'esperando' } })
    }
  }
  return { lista: saida, recusados }
}

/** As chamadas que a tela faz, na ordem em que `enviarAnotacao` as pede. */
export interface PassosDaAnotacao {
  /** A nota de texto (kommo-anotar). LANÇA com o motivo. */
  anotar: (texto: string) => Promise<void>
  /**
   * Um arquivo (kommo-anexo-enviar, com `x-texto` vazio). LANÇA com o motivo.
   * O `aviso` é o da função: o arquivo entrou no card, mas a nota dele não.
   */
  anexar: (arquivo: File, onProgresso: (p: ProgressoDoEnvio) => void) => Promise<{ aviso?: string | null } | void>
}

export interface ResultadoDaAnotacao {
  /** O texto subiu NESTA tentativa. */
  textoEnviado: boolean
  /** O texto falhou — e então nenhum arquivo foi tentado. */
  erroDoTexto: string | null
  /** Os arquivos que entraram no card, na ordem. */
  enviados: string[]
  /** Os que não entraram, com o motivo. Ficam na lista para tentar de novo. */
  falhas: { chave: string; nome: string; erro: string }[]
  /** Arquivo no card, mas com algo a dizer (a nota do arquivo não subiu). */
  avisos: string[]
}

const mensagem = (e: unknown) => (e as Error)?.message ?? String(e)

/**
 * ENVIA a anotação: o texto (se houver) e depois cada arquivo da lista, um de
 * cada vez. `onEstado` acompanha cada arquivo (a barra da lista). Nunca lança:
 * o que deu errado vem no resultado.
 */
export async function enviarAnotacao(
  texto: string,
  anexos: readonly AnexoDaAnotacao[],
  passos: PassosDaAnotacao,
  onEstado: (chave: string, estado: EstadoDoAnexo) => void,
  /** O texto desta anotação JÁ ENTROU no card numa tentativa anterior: sem a linha de "anexado". */
  opcoes: { textoJaNoCard?: boolean } = {},
): Promise<ResultadoDaAnotacao> {
  const r: ResultadoDaAnotacao = { textoEnviado: false, erroDoTexto: null, enviados: [], falhas: [], avisos: [] }
  const t = texto.trim()
  if (t) {
    try {
      await passos.anotar(t)
      r.textoEnviado = true
    } catch (e) {
      r.erroDoTexto = mensagem(e)
      return r
    }
  }
  for (const a of anexos) {
    // A PORTA DE NOVO, aqui: a lista é da tela, e um arquivo que passasse do
    // limite seria recusado pela função só depois de subir inteiro.
    if (a.arquivo.size > LIMITE_DO_ANEXO) {
      const erro = `passa do limite de 100 MB (${tamanhoLegivel(a.arquivo.size)})`
      r.falhas.push({ chave: a.chave, nome: a.arquivo.name, erro })
      onEstado(a.chave, { fase: 'falhou', erro })
      continue
    }
    onEstado(a.chave, { fase: 'enviando', pct: 0 })
    try {
      const resp = await passos.anexar(a.arquivo, (p) =>
        onEstado(a.chave, p.fase === 'enviando' ? { fase: 'enviando', pct: p.pct } : { fase: 'gravando' }),
      )
      r.enviados.push(a.arquivo.name)
      if (resp && resp.aviso) r.avisos.push(`${a.arquivo.name}: ${resp.aviso}`)
    } catch (e) {
      const erro = mensagem(e)
      r.falhas.push({ chave: a.chave, nome: a.arquivo.name, erro })
      onEstado(a.chave, { fase: 'falhou', erro })
    }
  }
  // SÓ ARQUIVO, SEM TEXTO: a nota de arquivo do Kommo não diz quem anexou. Uma
  // linha de texto com os nomes, DEPOIS dos arquivos e só dos que entraram, leva
  // o rodapé de quem enviou como toda anotação. Falhar aqui não desfaz nada: os
  // arquivos já estão no card, e vira aviso.
  if (!t && !opcoes.textoJaNoCard && r.enviados.length > 0) {
    const nomes = juntar(r.enviados)
    try {
      await passos.anotar(r.enviados.length === 1 ? `Arquivo anexado: ${nomes}.` : `Arquivos anexados: ${nomes}.`)
    } catch (e) {
      r.avisos.push(`A linha dizendo quem anexou não subiu (${mensagem(e)}); os arquivos estão no card.`)
    }
  }
  return r
}

const juntar = (nomes: readonly string[]) =>
  nomes.length <= 1 ? (nomes[0] ?? '') : `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}`

const arquivos = (n: number) => (n === 1 ? '1 arquivo' : `${n} arquivos`)

/**
 * O QUE A TELA DIZ DEPOIS DO ENVIO. `completo` = nada ficou para trás (a caixa
 * fecha e o aviso é o de sucesso); senão, a caixa fica aberta com a mensagem,
 * que diz o que entrou e o que não entrou.
 */
export function resumoDaAnotacao(
  r: ResultadoDaAnotacao,
): { completo: boolean; tom: 'sucesso' | 'aviso' | 'perigo'; texto: string } {
  if (r.erroDoTexto) {
    return {
      completo: false,
      tom: 'perigo',
      texto: `A anotação não subiu para o Kommo (${r.erroDoTexto}). Nada foi enviado — o texto e os arquivos continuam aqui.`,
    }
  }
  const entrou = [...(r.textoEnviado ? ['a anotação'] : []), ...r.enviados]
  if (r.falhas.length) {
    const naoEntrou = r.falhas.map((f) => `${f.nome} (${f.erro})`).join('; ')
    const tentar =
      r.falhas.length === 1
        ? 'Ele continua na lista: Enviar tenta só ele.'
        : 'Eles continuam na lista: Enviar tenta só eles.'
    return {
      completo: false,
      tom: entrou.length ? 'aviso' : 'perigo',
      texto: entrou.length
        ? `Entrou no card: ${juntar(entrou)}. Não entrou: ${naoEntrou}. ${tentar}`
        : `Nenhum arquivo entrou no card. Não entrou: ${naoEntrou}. ${tentar}`,
    }
  }
  // O TEXTO TEM O AVISO DELE (o da página, ao gravar a nota): aqui só os
  // arquivos, para não dizer "anotação enviada" duas vezes.
  const n = r.enviados.length
  const base = n ? `${n === 1 ? 'Arquivo anexado' : `${arquivos(n)} anexados`} ao card no Kommo.` : 'Anotação enviada ao card no Kommo.'
  return {
    completo: true,
    tom: r.avisos.length ? 'aviso' : 'sucesso',
    texto: r.avisos.length ? `${base} ${r.avisos.join(' ')}` : base,
  }
}

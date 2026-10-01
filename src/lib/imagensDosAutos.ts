// As páginas digitalizadas dos autos, subidas para o Claude poder VÊ-LAS.
//
// O DEFEITO QUE ISTO CORRIGE. O depósito dos autos guardava texto, e só. Anexo
// escaneado — acórdão antigo, ofício do juízo, RG — não tem texto para o pdf.js
// extrair: ele era descartado antes de chegar ao balcão, e a análise saía
// completa na aparência, declarando ausências sem ter aberto os documentos que
// poderiam desmenti-las. Num card de dezenove anexos, dois sumiam assim.
//
// A SAÍDA É IMAGEM, NÃO OCR, e a razão é a mesma da análise de RPV (ver
// paginasDigitalizadas.ts): o modelo lê uma página escaneada muito melhor que
// qualquer OCR local, e aqui quem vai ler é justamente um modelo.
//
// REAPROVEITA A ESTEIRA QUE JÁ EXISTE: a escolha das páginas é de
// paginasDigitalizadas.ts, a rasterização é de renderizarPaginas.ts, e o balde é
// o mesmo `analises-input` da migração 0055. O que este arquivo acrescenta é o
// caminho — que precisa ser estável, porque quem vai baixar por ele é a Edge
// Function do conector, com service_role, horas depois.

import { supabase } from '@/lib/supabase'
import type { SelecaoImagem } from '@/lib/paginasDigitalizadas'
import { ARESTA_MAIOR_ALVO, QUALIDADE_JPEG, renderizarPaginas } from '@/lib/renderizarPaginas'

/** O balde das páginas digitalizadas, criado pela migração 0055. */
export const BALDE_AUTOS = 'analises-input'

/** Quantas subidas correm ao mesmo tempo. Acima disso o Storage responde 429. */
const CONCORRENCIA = 6

/**
 * O nome-base de um arquivo dentro do balde.
 *
 * O ÍNDICE VAI NA FRENTE, e não é enfeite: o nome é saneado e cortado em 40
 * caracteres, e dois volumes do mesmo processo — "…Autos completos - Volume 1" e
 * "… Volume 2", que é como o cartório digitaliza — colidem nos 40 primeiros
 * caracteres. Sem o índice, a página N do volume 2 gravaria por cima da do
 * volume 1, e o modelo leria uma rotulada como a outra.
 */
export function baseDoArquivo(indice: number, nome: string): string {
  const limpo = nome
    .replace(/\.pdf$/i, '')
    .replace(/[^\w.-]+/g, '_')
    .slice(0, 40)
  return String(indice).padStart(2, '0') + '-' + (limpo || 'arquivo')
}

/**
 * Onde uma página mora no balde.
 *
 * SOB O ID DE QUEM SUBIU, porque é isso que as policies da 0055 exigem — e é o
 * que a função `autos-imagens` reconfere antes de gravar o caminho na linha do
 * balcão: o endpoint do conector é público, e ele baixa o que a linha mandar.
 */
export function caminhoDaPagina(userId: string, codigo: string, base: string, pagina: number): string {
  return `${userId}/${codigo}/autos/${base}-p${String(pagina).padStart(4, '0')}.jpg`
}

export interface ImagemSubida {
  arquivo: string
  pagina: number
  caminho: string
}

export interface EnvioDasImagens {
  prontas: ImagemSubida[]
  falhas: string[]
}

/**
 * Rasteriza e sobe as páginas escolhidas, uma esteira só.
 *
 * CADA PÁGINA SAI DA RENDERIZAÇÃO DIRETO PARA A FILA DE UPLOAD, em vez de
 * renderizar todas e só então subir todas. São duas etapas em série no segundo
 * caso, e num processo com dezenas de páginas digitalizadas isso mediu 2m04s
 * contra 7s de um processo nato-digital. Aqui o tempo importa mais que lá: a
 * conversa no Claude já está aberta, esperando.
 */
export async function subirImagensDosAutos(
  selecao: SelecaoImagem[],
  codigo: string,
  userId: string,
  andamento?: (feitas: number, total: number) => void,
): Promise<EnvioDasImagens> {
  const total = selecao.reduce((n, s) => n + s.numeros.length, 0)
  const prontas: ImagemSubida[] = []
  const falhas: string[] = []
  if (total === 0) return { prontas, falhas }

  const emVoo = new Set<Promise<void>>()
  for (const [i, sel] of selecao.entries()) {
    const base = baseDoArquivo(i, sel.arquivo)
    const { falhas: naoRenderizadas } = await renderizarPaginas(
      sel.bytes,
      sel.numeros,
      undefined,
      async (img) => {
        const caminho = caminhoDaPagina(userId, codigo, base, img.numero)
        // A TAREFA NUNCA REJEITA: ela entra num Promise.race e num Promise.all,
        // e uma rejeição ali sobe pela esteira e derruba o envio inteiro por
        // causa de uma página. Falha de página é aviso, não desastre.
        const tarefa = (async () => {
          try {
            // UMA RETENTATIVA, COM ESPERA: o Storage responde 429 sob carga, e
            // uma oscilação de rede tirava a página da leitura para sempre.
            let { error } = await supabase.storage
              .from(BALDE_AUTOS)
              .upload(caminho, img.blob, { contentType: 'image/jpeg', upsert: true })
            if (error) {
              await new Promise((r) => setTimeout(r, 1200))
              ;({ error } = await supabase.storage
                .from(BALDE_AUTOS)
                .upload(caminho, img.blob, { contentType: 'image/jpeg', upsert: true }))
            }
            if (error) falhas.push(`"${sel.arquivo}" p. ${img.numero}: ${error.message}`)
            else {
              prontas.push({ arquivo: sel.arquivo, pagina: img.numero, caminho })
              andamento?.(prontas.length, total)
            }
          } catch (e) {
            falhas.push(`"${sel.arquivo}" p. ${img.numero}: ${(e as Error)?.message ?? String(e)}`)
          }
        })().finally(() => emVoo.delete(tarefa))
        emVoo.add(tarefa)
        // Cheia a fila, espera a PRIMEIRA que terminar — esperar todas
        // esvaziaria a rede a cada rodada de seis.
        if (emVoo.size >= CONCORRENCIA) await Promise.race(emVoo)
      },
    )
    if (naoRenderizadas.length > 0) {
      falhas.push(`"${sel.arquivo}" p. ${naoRenderizadas.join(', ')}: não renderizou`)
    }
  }
  // O que ainda estava em voo quando a última página saiu do forno.
  await Promise.all(emVoo)
  return { prontas, falhas }
}

/** Um anexo do card que é imagem (foto, print), e não PDF — já baixado. */
export interface AnexoDeImagem {
  nome: string
  blob: Blob
}

/**
 * A POSIÇÃO DOS ANEXOS EM IMAGEM no nome do balde, longe das dos PDFs: o índice
 * de `baseDoArquivo` é a ordem da seleção, e um anexo com o mesmo índice
 * gravaria por cima da página 1 de um PDF.
 */
const POSICAO_DOS_ANEXOS = 100

/** A imagem no tamanho que o modelo olha (ver renderizarPaginas.ts), em JPEG. */
async function imagemParaJpeg(original: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(original)
  try {
    const escala = Math.min(1, ARESTA_MAIOR_ALVO / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * escala))
    canvas.height = Math.max(1, Math.round(bitmap.height * escala))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('o navegador não deu um canvas para converter a imagem')
    // FUNDO BRANCO: PNG com transparência viraria preto no JPEG.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    return await new Promise<Blob>((ok, falha) =>
      canvas.toBlob((b) => (b ? ok(b) : falha(new Error('não consegui converter a imagem'))), 'image/jpeg', QUALIDADE_JPEG),
    )
  } finally {
    bitmap.close()
  }
}

/**
 * Sobe os anexos em imagem do card, cada um como a página 1 de si mesmo.
 *
 * O DEFEITO QUE ISTO CORRIGE (01/10/2026). Anexo que não era PDF ia ao conector
 * só como o nome e o aviso "não é PDF": o print do extrato do PRC, a foto do RG,
 * ficavam fora da análise, e era preciso anexá-los de novo na conversa. Agora o
 * Claude os vê pelo `ver_paginas`, como vê uma página escaneada.
 */
export async function subirAnexosDeImagem(
  anexos: AnexoDeImagem[],
  codigo: string,
  userId: string,
): Promise<EnvioDasImagens> {
  const prontas: ImagemSubida[] = []
  const falhas: string[] = []
  for (const [k, a] of anexos.entries()) {
    try {
      const jpeg = await imagemParaJpeg(a.blob)
      const caminho = caminhoDaPagina(userId, codigo, baseDoArquivo(POSICAO_DOS_ANEXOS + k, a.nome), 1)
      let { error } = await supabase.storage
        .from(BALDE_AUTOS)
        .upload(caminho, jpeg, { contentType: 'image/jpeg', upsert: true })
      if (error) {
        await new Promise((r) => setTimeout(r, 1200))
        ;({ error } = await supabase.storage
          .from(BALDE_AUTOS)
          .upload(caminho, jpeg, { contentType: 'image/jpeg', upsert: true }))
      }
      if (error) falhas.push(`"${a.nome}": ${error.message}`)
      else prontas.push({ arquivo: a.nome, pagina: 1, caminho })
    } catch (e) {
      falhas.push(`"${a.nome}": ${(e as Error)?.message ?? String(e)}`)
    }
  }
  return { prontas, falhas }
}

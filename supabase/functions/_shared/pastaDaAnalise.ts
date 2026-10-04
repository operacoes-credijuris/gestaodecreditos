// A PASTA DA ANÁLISE NO DRIVE — qual é, e quando se pode gravá-la no card.
//
// O DEFEITO QUE ISTO CORRIGE (03/10/2026, pedido do dono: "quando a gente salve
// esse arquivo, ele já jogue no drive na pasta respectiva da análise"). As
// certidões da BullAI recalculavam o caminho da pasta a cada vez, sempre em
// "Precatórios" e pelo nome do cedente escrito no título — e depois GRAVAVAM
// essa pasta em `kommo_leads.drive_pasta_id`. Num card de RPV (cuja análise vive
// em "Requisições de Pequeno Valor") os PDFs iam para a pasta errada E o atalho
// do card para a análise passava a apontar para ela. No precatório, bastava o
// nome no título mudar (ou o cedente passar a vir do ofício) para os PDFs
// caírem numa pasta nova, longe da planilha.
//
// A REGRA, em três frases:
//   1. A pasta é a do CARD (`drive_pasta_id`), se houver e ela ainda existir.
//   2. Só na falta dela se calcula o caminho — A. Análises de crédito /
//      {categoria do FUNIL} / {originador} / {cedente} —, com o nome da pasta
//      do cedente escrito como a análise daquela categoria o escreve.
//   3. O card só recebe a pasta quando não tinha nenhuma. NUNCA se troca uma
//      pasta gravada por outra: quem a gravou foi a análise, e é ela que manda.
//
// MÓDULO PURO — sem `Deno.` e sem `npm:` —, testado pelo vitest
// (src/lib/__tests__/pastaDaAnalise.test.ts). A metade que toca o Drive mora em
// `pastaDoCard.ts`.

import { FUNIL_RPV } from './autosParaOKommo.ts'

export const CATEGORIA_PRECATORIOS = 'Precatórios'
export const CATEGORIA_RPV = 'Requisições de Pequeno Valor'
/** A subpasta das certidões, dentro da pasta da análise. */
export const SUBPASTA_CERTIDOES = 'Certidões'

/**
 * A categoria (o nome da pasta) de um card, pelo FUNIL em que ele está.
 *
 * O FUNIL, e não o texto da anotação — a mesma escolha da tela da análise
 * (`AnaliseCredito`, "A CATEGORIA VEM DO FUNIL"). RPV só no funil de RPV; os
 * de precatório (Interno, Externo e o antigo), e o que não se reconhece, em
 * Precatórios: certidão é trabalho da trilha do precatório, e era essa a
 * categoria de antes para todo card.
 */
export function categoriaDoFunil(pipelineId: number | null | undefined): string {
  return Number(pipelineId) === FUNIL_RPV ? CATEGORIA_RPV : CATEGORIA_PRECATORIOS
}

const CONECTORES = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'di', 'du', 'del', 'la', 'le', 'van', 'von'])

/**
 * Title Case para nomes: primeira letra de cada palavra maiúscula, o resto
 * minúsculo, e os conectores do português em minúsculas ("Vanderlan Gomes de
 * Morais"). É assim que a análise de RPV nomeia a pasta do cedente — e mora
 * aqui para a gerar-analise-rpv e as certidões escreverem o MESMO nome.
 */
export function tituloNome(s: string): string {
  return String(s || '')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((w, i) => (i > 0 && CONECTORES.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ')
}

/**
 * O nome da pasta do cedente, como a análise de cada categoria o escreve.
 *
 * RPV: Title Case, até 80 letras, "Cedente" na falta (gerar-analise-rpv).
 * Precatórios: como veio, aparado, "Sem cedente" na falta (planilha jurídica).
 * Escrever diferente abriria uma segunda pasta para o mesmo cedente.
 */
export function nomeDaPastaDoCedente(categoria: string, cedente: string | null | undefined): string {
  const nome = String(cedente ?? '').trim()
  if (categoria === CATEGORIA_RPV) return tituloNome(nome).slice(0, 80) || 'Cedente'
  return nome || 'Sem cedente'
}

/** O nome da pasta do originador: aparado, "Sem originador" na falta. */
export function nomeDaPastaDoOriginador(originador: string | null | undefined): string {
  return String(originador ?? '').trim() || 'Sem originador'
}

/** O id gravado no card, ou null: texto vazio conta como "sem pasta". */
export function pastaGravada(id: string | null | undefined): string | null {
  const t = String(id ?? '').trim()
  return t ? t : null
}

/**
 * Usar a pasta do card, ou calcular o caminho — e se a calculada pode ir para o card.
 *
 * `pastaDoCardExiste`:
 *   - true: a pasta está no Drive (e não na lixeira) — usa-se ela;
 *   - false: o Drive disse que ela não existe mais — calcula-se, MAS O CARD NÃO
 *     É REESCRITO: o id gravado é da análise, e trocá-lo é decisão dela;
 *   - null: não deu para conferir (rede, permissão). Usa-se a do card: se ela
 *     de fato sumiu, o envio falha e diz — melhor que espalhar arquivos numa
 *     pasta calculada por causa de um tropeço na consulta.
 */
export type EscolhaDaPasta =
  | { usar: 'card'; pastaId: string; gravarNoCard: false }
  | { usar: 'calcular'; motivo: 'sem_pasta' | 'pasta_sumiu'; gravarNoCard: boolean }

export function escolherPastaDaAnalise(o: {
  pastaDoCard: string | null | undefined
  pastaDoCardExiste: boolean | null
}): EscolhaDaPasta {
  const id = pastaGravada(o.pastaDoCard)
  if (!id) return { usar: 'calcular', motivo: 'sem_pasta', gravarNoCard: true }
  if (o.pastaDoCardExiste === false) return { usar: 'calcular', motivo: 'pasta_sumiu', gravarNoCard: false }
  return { usar: 'card', pastaId: id, gravarNoCard: false }
}

/** O endereço de uma pasta do Drive. */
export function urlDaPasta(id: string): string {
  return `https://drive.google.com/drive/folders/${id}`
}

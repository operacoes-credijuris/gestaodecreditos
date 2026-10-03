// "GERAR CONTRATO" A PARTIR DO CARD (onda 4 do redesenho, etapa 11): o que a
// Geração de contratos preenche sozinha quando chega com `?card=<id>`.
//
// FUNÇÕES PURAS, com teste (contratoDoCard.test.ts). O cuidado que elas existem
// para guardar é um só: o ORIGINADOR. Um nome que não está na lista do Drive faz
// o `gerar-contrato` CRIAR uma pasta de originador nova — e o preenchimento
// automático nunca pode fazer isso. Por isso o originador:
//   - só é escolhido DA LISTA que o Drive devolveu (`listar_originadores`);
//   - pela regra do servidor (`chaveDoOriginador`, _shared/pastaDoOriginador.ts):
//     sem contar acento, maiúsculas, espaços, pontuação e o prefixo
//     "Intermediador - " / "Originador - ";
//   - sem item igual, fica EM BRANCO, e a tela pede a escolha.

import { chaveDoOriginador } from '../../supabase/functions/_shared/pastaDoOriginador.ts'
import { lerCadastroDoCard, FUNIL_RPV } from './kommo'

/** A categoria do RPV, como a Geração de contratos e o Drive a escrevem. */
export const CATEGORIA_RPV = 'Requisições de Pequeno Valor'

/**
 * O id do card no endereço, ou null. SÓ O ID — nunca nomes no endereço —, e só
 * se for um número inteiro positivo: qualquer outra coisa é ignorada.
 */
export function cardDoEndereco(valor: string | null | undefined): number | null {
  const v = String(valor ?? '').trim()
  if (!/^\d{1,15}$/.test(v)) return null
  const n = Number(v)
  return n > 0 ? n : null
}

/**
 * O item DA LISTA igual ao intermediador do card, ou null.
 *
 * Devolve o item COMO ESTÁ NA LISTA ("Intermediador - Lima & Barros Advocacia"),
 * e não o nome do card: é o nome da pasta que já existe, e é ele que o
 * `gerar-contrato` acha sem criar nada. Duas pastas iguais depois da normalização
 * são a mesma pessoa escrita de dois jeitos: fica a primeira, como no servidor.
 */
export function originadorDoCard(lista: readonly string[], intermediador: string | null | undefined): string | null {
  const alvo = chaveDoOriginador(intermediador)
  if (!alvo) return null
  return lista.find((o) => chaveDoOriginador(o) === alvo) ?? null
}

/** O card do espelho, no que o preenchimento precisa dele. */
export interface CardParaContrato {
  kommo_lead_id: number
  pipeline_id: number
  nome?: string | null
  processo_cnj?: string | null
  notas?: { texto: string; automatica?: boolean }[] | null
  nota_texto?: string | null
}

/** O que a tela preenche a partir do card. */
export interface PreenchimentoDoCard {
  id: number
  /** O card é do funil de RPV — o único que tem o botão, e o único que se preenche. */
  ehRpv: boolean
  cedente: string
  /** O intermediador do título do card — o nome com que a análise criou a pasta. */
  intermediador: string
  /** O número do processo, ou '' quando o card não tem. */
  numero: string
}

/**
 * O que o card diz, pela MESMA leitura do cadastro que a análise usa
 * (`lerCadastroDoCard`): o número do título primeiro, o intermediador do título —
 * é o nome com que a análise criou a pasta em "A. Análises de crédito".
 */
export function preenchimentoDoCard(card: CardParaContrato): PreenchimentoDoCard {
  const c = lerCadastroDoCard(card)
  return {
    id: card.kommo_lead_id,
    ehRpv: Number(card.pipeline_id) === FUNIL_RPV,
    cedente: c.cedente.trim(),
    intermediador: c.intermediador.trim(),
    numero: c.numero.trim(),
  }
}

/**
 * O ORIGINADOR A APLICAR AGORA, ou `undefined` para não mexer no campo.
 *
 * SÓ NO RETORNO DA LISTA, e só UMA VEZ:
 *   - a lista tem de ser a da categoria do RPV e já ter chegado (não em voo, nem
 *     com erro): antes disso não há de onde escolher;
 *   - `jaAplicado` (uma referência da tela) impede reaplicar — se a pessoa
 *     escolheu outro à mão, ou trocou a categoria e voltou, a escolha dela fica.
 * Aplicar é escolher da lista ou deixar em branco ('' — e a tela avisa).
 */
export function originadorAAplicar(e: {
  card: PreenchimentoDoCard | null
  jaAplicado: boolean
  /** A categoria a que a lista carregada pertence, ou null se nenhuma chegou. */
  categoriaDaLista: string | null
  carregando: boolean
  lista: readonly string[]
}): string | undefined {
  if (!e.card || !e.card.ehRpv || e.jaAplicado) return undefined
  if (e.carregando || e.categoriaDaLista !== CATEGORIA_RPV) return undefined
  return originadorDoCard(e.lista, e.card.intermediador) ?? ''
}

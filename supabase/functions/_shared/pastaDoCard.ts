// A PASTA DA ANÁLISE DO CARD, no Drive de verdade — a metade com efeito da
// regra pura de `pastaDaAnalise.ts` (leia lá o PORQUÊ).
//
// QUEM USA: as certidões da BullAI (os PDFs vão para {pasta da análise} /
// Certidões) e a gravação da planilha jurídica do precatório (que leva o
// checklist das certidões dentro). Todas pela mesma função, para o arquivo cair
// sempre onde o atalho do card aponta.
//
// O QUE ELA NÃO FAZ: trocar a pasta gravada no card. Quem define a pasta da
// análise é a própria análise (`gerar-analise-rpv`, `pasta-do-cedente`); aqui
// só se grava quando o card ainda não tinha nenhuma.

import type { serviceClient } from './auth.ts'
import {
  driveEncontrarAnalisesRoot,
  driveExistePasta,
  driveFindChildByTolerantName,
  driveFindOrCreateFolder,
  refreshGoogleAccessToken,
} from './credijuris.ts'
import { segredoGoogle } from './segredos.ts'
import { type CardDoCadastro, lerCadastroDoCard } from './cadastroDoCard.ts'
import {
  categoriaDoFunil,
  escolherPastaDaAnalise,
  nomeDaPastaDoCedente,
  nomeDaPastaDoOriginador,
  pastaGravada,
  SUBPASTA_CERTIDOES,
} from './pastaDaAnalise.ts'

type Servico = ReturnType<typeof serviceClient>

/** O token do Google, ou o erro que diz o que falta. */
export async function tokenDoGoogle(): Promise<string> {
  const google = await segredoGoogle()
  if (!google) {
    throw new Error('Credenciais do Google não configuradas — sem elas não dá para salvar no Drive.')
  }
  return await refreshGoogleAccessToken(google.client_id, google.client_secret, google.refresh_token)
}

/**
 * A. Análises de crédito / {categoria} / {originador} / {cedente}, achada ou
 * criada. A categoria é achada pelo nome tolerante (como em toda a casa); o
 * originador e o cedente, pelo nome exato.
 */
export async function caminhoDaAnalise(
  token: string,
  dados: { categoria: string; originador?: string | null; cedente?: string | null },
): Promise<string> {
  const raiz = await driveEncontrarAnalisesRoot(token)
  const cat = await driveFindChildByTolerantName(token, raiz, dados.categoria)
  const catId = cat?.id ?? (await driveFindOrCreateFolder(token, dados.categoria, raiz))
  const origId = await driveFindOrCreateFolder(token, nomeDaPastaDoOriginador(dados.originador), catId)
  return await driveFindOrCreateFolder(token, nomeDaPastaDoCedente(dados.categoria, dados.cedente), origId)
}

export interface PastaDaAnalise {
  token: string
  pastaId: string
  /** 'card': a pasta gravada no card; 'calculada': o caminho, na falta dela. */
  origem: 'card' | 'calculada'
  /** A calculada foi gravada no card (que estava sem pasta). */
  gravadaNoCard: boolean
}

/**
 * A pasta da análise do card: a gravada, se ainda existir; senão, o caminho
 * pela categoria do funil — gravado no card só se ele estava sem pasta.
 *
 * `nomes`: o originador e o cedente a usar no caminho calculado. Sem eles, os
 * do cadastro do card (título e anotações, como a tela os lê).
 */
export async function pastaDaAnaliseDoCard(
  svc: Servico,
  leadId: number,
  nomes?: { originador?: string | null; cedente?: string | null },
): Promise<PastaDaAnalise> {
  const { data: card } = await svc
    .from('kommo_leads')
    .select('nome, processo_cnj, notas, nota_texto, pipeline_id, drive_pasta_id')
    .eq('kommo_lead_id', leadId)
    .maybeSingle()
  const linha = (card ?? {}) as Record<string, unknown>
  const token = await tokenDoGoogle()
  const doCard = pastaGravada(linha.drive_pasta_id as string | null)
  const escolha = escolherPastaDaAnalise({
    pastaDoCard: doCard,
    pastaDoCardExiste: doCard ? await driveExistePasta(token, doCard) : null,
  })
  if (escolha.usar === 'card') {
    return { token, pastaId: escolha.pastaId, origem: 'card', gravadaNoCard: false }
  }

  const cadastro = lerCadastroDoCard(linha as unknown as CardDoCadastro)
  const pastaId = await caminhoDaAnalise(token, {
    categoria: categoriaDoFunil(linha.pipeline_id as number | null),
    originador: nomes?.originador ?? cadastro.intermediador,
    cedente: nomes?.cedente ?? cadastro.cedente,
  })
  let gravadaNoCard = false
  if (escolha.gravarNoCard) {
    // CONDICIONAL AO CARD AINDA ESTAR SEM PASTA: entre a leitura acima e esta
    // gravação a análise pode ter gravado a dela, e é a dela que fica.
    // FALHA EM SILÊNCIO DE PROPÓSITO (como `ligarPastaAoCard`): o arquivo vai
    // para a pasta de qualquer jeito; perder o atalho não derruba o envio.
    const { data } = await svc
      .from('kommo_leads')
      .update({ drive_pasta_id: pastaId })
      .eq('kommo_lead_id', leadId)
      .or('drive_pasta_id.is.null,drive_pasta_id.eq.')
      .select('kommo_lead_id')
    gravadaNoCard = (data ?? []).length > 0
  }
  return { token, pastaId, origem: 'calculada', gravadaNoCard }
}

/** A subpasta "Certidões" dentro da pasta da análise do card, achada ou criada. */
export async function pastaDasCertidoesDoCard(
  svc: Servico,
  leadId: number,
): Promise<PastaDaAnalise & { pastaDaAnaliseId: string }> {
  const analise = await pastaDaAnaliseDoCard(svc, leadId)
  const id = await driveFindOrCreateFolder(analise.token, SUBPASTA_CERTIDOES, analise.pastaId)
  return { ...analise, pastaId: id, pastaDaAnaliseId: analise.pastaId }
}

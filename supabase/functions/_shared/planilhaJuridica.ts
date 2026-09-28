// A PLANILHA DA ANÁLISE JURÍDICA — o arquivo: abrir o modelo, ler o checklist,
// salvar no Drive.
//
// A METADE QUE TOCA O MUNDO do que mora em `questionarioJuridico.ts` (que é
// puro). Saiu da `analise-precatorio` em 28/09/2026 pelo mesmo motivo daquele:
// agora são três que precisam dela — o motor antigo, a `planilha-juridica`, que
// grava as respostas vindas da conversa do Claude, e o conector, que entrega o
// questionário à conversa. Cada uma com a sua cópia, o nome do modelo, a pasta
// do Drive e a leitura do checklist divergiriam na primeira mudança.

import ExcelJS from 'npm:exceljs@4.4.0'
import type { serviceClient } from './auth.ts'
import {
  driveEncontrarAnalisesRoot,
  driveFindChildByTolerantName,
  driveFindOrCreateFolder,
  driveUploadBytes,
  refreshGoogleAccessToken,
  storageGetBytes,
} from './credijuris.ts'
import { segredoGoogle } from './segredos.ts'
import {
  ABA_JURIDICA,
  type AbaDaPlanilha,
  type LinhaQuestionario,
  lerQuestionario,
} from './questionarioJuridico.ts'

type Servico = ReturnType<typeof serviceClient>

export const BUCKET_TEMPLATES = 'contratos-templates'
export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const CATEGORIA = 'Precatórios'

/**
 * Acha o modelo no bucket sem depender do nome exato.
 *
 * O arquivo foi subido à mão, e nome subido à mão varia: acento que o Storage
 * recusa, extensão dobrada (".xlsx.xlsx" acontece quando se renomeia no
 * Windows com as extensões ocultas). Amarrar num literal fazia a função morrer
 * com "objeto não encontrado" sem dizer o que ELA achou — daí listar e escolher.
 */
export async function acharModelo(svc: Servico): Promise<{ path: string; bytes: Uint8Array }> {
  const { data, error } = await svc.storage.from(BUCKET_TEMPLATES).list('', { limit: 200 })
  if (error) throw new Error(`Não consegui listar o bucket ${BUCKET_TEMPLATES}: ${error.message}`)
  const nomes = (data ?? []).map((o) => o.name)
  const alvo = nomes.find((n) => /precat/i.test(n) && /\.xlsx(\.xlsx)?$/i.test(n))
  if (!alvo) {
    throw new Error(
      `Não achei o modelo de precatórios no bucket ${BUCKET_TEMPLATES}. ` +
        `Encontrei: ${nomes.length ? nomes.join(', ') : '(bucket vazio)'}. ` +
        `Suba o arquivo com "precatorios" no nome e extensão .xlsx.`,
    )
  }
  return { path: alvo, bytes: await storageGetBytes(svc, BUCKET_TEMPLATES, alvo) }
}

/** O modelo aberto, com a aba jurídica e o questionário já lido dela. */
export interface ModeloAberto {
  wb: ExcelJS.Workbook
  ws: AbaDaPlanilha
  path: string
  linhas: LinhaQuestionario[]
  comFormula: number[]
}

export async function abrirModelo(svc: Servico): Promise<ModeloAberto> {
  const { path, bytes } = await acharModelo(svc)
  const wb = new ExcelJS.Workbook()
  // O tipo do ExcelJS pede Buffer do Node; no Deno o que existe é Uint8Array,
  // e a biblioteca lê os dois igual. Mesmo elenco da gerar-analise-rpv.
  await wb.xlsx.load(bytes as unknown as Parameters<typeof wb.xlsx.load>[0])
  // TOLERANTE A CAIXA E ACENTO de propósito: o template de RPV chama a aba de
  // "Análise jurídica" e o de precatórios de "Análise Jurídica". Amarrar no
  // literal quebraria a função por uma letra maiúscula.
  const chaveAba = (n: string) =>
    n.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
  const ws = wb.worksheets.find((w: { name: string }) => chaveAba(w.name) === chaveAba(ABA_JURIDICA))
  if (!ws) {
    throw new Error(
      `O modelo ${path} não tem a aba "${ABA_JURIDICA}". Abas encontradas: ` +
        wb.worksheets.map((w: { name: string }) => w.name).join(', '),
    )
  }
  const aba = ws as unknown as AbaDaPlanilha
  const { linhas, comFormula } = lerQuestionario(aba)
  if (linhas.length === 0) {
    throw new Error(`Não achei pergunta nenhuma na aba "${ABA_JURIDICA}" de ${path}.`)
  }
  return { wb, ws: aba, path, linhas, comFormula }
}

interface Sujeito {
  id: string
  papel: string
  tipo_pessoa: string
  nome: string
  documento: string
  uf_atual: string | null
  municipio_atual: string | null
  ufs_anteriores: string[]
  municipios_anteriores: string[]
  residencia_levantada: boolean
}

/**
 * O bloco "Histórico do Cedente" em texto, a partir do banco.
 *
 * A PLATAFORMA NÃO GUARDA SE A CERTIDÃO VEIO POSITIVA OU NEGATIVA. `dd_certidao`
 * registra se ela foi OBTIDA (status), não o resultado dela — `regra_positiva`
 * fica no catálogo e diz o que fazer quando é positiva, sem que ninguém anote
 * que foi. Então o texto abaixo diz o estado do checklist, e as regras proíbem
 * concluir positivo/negativo a partir dele. Confundir "obtida" com "negativa"
 * reprovaria ou aprovaria crédito por dado que não existe.
 */
export async function checklistEmTexto(
  svc: Servico,
  leadId: number,
): Promise<{ texto: string; temChecklist: boolean }> {
  const { data: sujeitos } = await svc
    .from('dd_sujeito')
    .select(
      'id, papel, tipo_pessoa, nome, documento, uf_atual, municipio_atual, ufs_anteriores, municipios_anteriores, residencia_levantada',
    )
    .eq('kommo_lead_id', leadId)
  const suj = (sujeitos ?? []) as Sujeito[]
  if (suj.length === 0) {
    return {
      texto:
        'NENHUM SUJEITO CADASTRADO. A due diligence de certidões deste crédito ainda ' +
        'não foi iniciada na plataforma (aba Certidões da janela de Due diligence).',
      temChecklist: false,
    }
  }

  const { data: itens } = await svc
    .from('dd_certidao')
    .select(
      'sujeito_id, certidao_codigo, status, obrigatoria, parametros, emitida_em, validade_ate, dispensa_motivo',
    )
    .eq('kommo_lead_id', leadId)
  const { data: catalogo } = await svc.from('certidao_catalogo').select('codigo, nome_curto')
  const nomeDaCertidao = new Map(
    ((catalogo ?? []) as { codigo: string; nome_curto: string }[]).map((c) => [c.codigo, c.nome_curto]),
  )

  const partes: string[] = []
  for (const s of suj) {
    const meus = ((itens ?? []) as Record<string, unknown>[]).filter((i) => i.sujeito_id === s.id)
    const enderecos = [
      s.uf_atual || s.municipio_atual
        ? `residência atual: ${[s.municipio_atual, s.uf_atual].filter(Boolean).join('/')}`
        : 'residência atual não informada',
      s.ufs_anteriores.length || s.municipios_anteriores.length
        ? `anteriores: ${[...s.municipios_anteriores, ...s.ufs_anteriores].join(', ')}`
        : s.residencia_levantada
          ? 'histórico de residência levantado, sem endereços anteriores'
          : 'HISTÓRICO DE RESIDÊNCIA NÃO LEVANTADO',
    ].join('; ')

    partes.push(`— ${s.papel} (${s.tipo_pessoa}): ${s.nome}, doc ${s.documento}. ${enderecos}.`)
    if (meus.length === 0) {
      partes.push('    checklist não montado para este sujeito.')
      continue
    }
    for (const i of meus) {
      const nome = nomeDaCertidao.get(String(i.certidao_codigo)) ?? String(i.certidao_codigo)
      const p = i.parametros as Record<string, unknown> | null
      const escopo = p && Object.keys(p).length ? ` [${Object.values(p).join('/')}]` : ''
      const extra = [
        i.emitida_em ? `emitida ${i.emitida_em}` : null,
        i.validade_ate ? `vale até ${i.validade_ate}` : null,
        i.dispensa_motivo ? `DISPENSADA: ${i.dispensa_motivo}` : null,
      ]
        .filter(Boolean)
        .join(', ')
      partes.push(
        `    ${nome}${escopo}: ${i.status}${i.obrigatoria ? '' : ' (não obrigatória)'}` +
          (extra ? ` — ${extra}` : ''),
      )
    }
  }
  return { texto: partes.join('\n'), temChecklist: true }
}

const limparNomeArquivo = (s: string) =>
  s.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 180)

/**
 * Salva a planilha preenchida em A. Análises de crédito / Precatórios /
 * {originador} / {cedente}.
 *
 * AS VERBAS NO NOME DO ARQUIVO, como na análise de RPV. Duas análises do mesmo
 * precatório com cenários diferentes ficavam indistinguíveis na pasta — e, pior,
 * a segunda SOBRESCREVIA a primeira, porque o upload substitui por nome. Com as
 * verbas no nome, cenário diferente é arquivo diferente, e refazer o MESMO
 * cenário continua substituindo, que é o que se quer.
 */
/**
 * A pasta do cedente no Drive — achada ou criada —, e o token para usá-la.
 *
 * UM CAMINHO SÓ para os dois momentos que a tocam: o CLIQUE em "Executar
 * análise", que cria a pasta antes de a análise acabar (para o título do card
 * já levar a ela), e a GRAVAÇÃO da planilha, que salva o arquivo dentro dela.
 * Com dois cálculos do caminho, um nome escrito diferente abriria duas pastas
 * para o mesmo cedente — e a planilha cairia na que o link não aponta.
 */
export async function garantirPastaDoCedente(dados: {
  originador?: string
  cedente?: string
}): Promise<{ token: string; pastaId: string; cedente: string }> {
  const google = await segredoGoogle()
  if (!google) {
    throw new Error('Credenciais do Google não configuradas — sem elas não dá para salvar no Drive.')
  }
  const token = await refreshGoogleAccessToken(google.client_id, google.client_secret, google.refresh_token)
  const raiz = await driveEncontrarAnalisesRoot(token)
  const catFolder = await driveFindChildByTolerantName(token, raiz, CATEGORIA)
  const catId = catFolder?.id ?? (await driveFindOrCreateFolder(token, CATEGORIA, raiz))
  const originador = (dados.originador || 'Sem originador').trim()
  const cedente = (dados.cedente || 'Sem cedente').trim()
  const origId = await driveFindOrCreateFolder(token, originador, catId)
  const pastaId = await driveFindOrCreateFolder(token, cedente, origId)
  return { token, pastaId, cedente }
}

/**
 * O card passa a apontar para a pasta: é o que faz o título virar link.
 *
 * FALHA EM SILÊNCIO DE PROPÓSITO. A pasta e o arquivo já existem no Drive; o
 * link no card é atalho, e perder o atalho não pode derrubar o que já foi
 * salvo.
 */
export async function ligarPastaAoCard(svc: Servico, leadId: number, pastaId: string): Promise<void> {
  if (!leadId || !pastaId) return
  await svc.from('kommo_leads').update({ drive_pasta_id: pastaId }).eq('kommo_lead_id', leadId)
}

export async function salvarPlanilhaNoDrive(
  wb: ExcelJS.Workbook,
  dados: { originador?: string; cedente?: string; numero_processo?: string; verbasNome: string },
): Promise<{ drive_file_url: string | null; drive_folder_url: string; pasta_id: string }> {
  const { token, pastaId: cedId, cedente } = await garantirPastaDoCedente(dados)

  const bytes = new Uint8Array(await wb.xlsx.writeBuffer())
  // Fica logo depois de "Análise Jurídica", e não no fim: nome de arquivo é
  // truncado pela direita em toda lista.
  const nomeArquivo =
    limparNomeArquivo(
      `Análise Jurídica${dados.verbasNome ? ` [${dados.verbasNome}]` : ''} - ${cedente}` +
        `${dados.numero_processo ? ` - ${dados.numero_processo}` : ''}`,
    ) + '.xlsx'
  const up = await driveUploadBytes(token, nomeArquivo, cedId, bytes, XLSX_MIME, true)
  return {
    drive_file_url: up.webViewLink ?? null,
    drive_folder_url: `https://drive.google.com/drive/folders/${cedId}`,
    pasta_id: cedId,
  }
}

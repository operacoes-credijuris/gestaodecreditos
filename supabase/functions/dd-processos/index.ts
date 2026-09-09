// ============================================================================
// dd-processos — a APURAÇÃO de processos judiciais dos sujeitos do crédito.
//
// É a segunda frente da due diligence, a que a migration 0056 preparou no banco
// e a aba "Processos judiciais" mostrava como "Ainda não implementado". As duas
// perguntas que ela responde são as linhas 10 e 11 do questionário de RPV:
//
//   linha 10  "Histórico do cedente: tem dívida?"
//   linha 11  "Histórico do advogado: tem dívida?"
//
// Até aqui quem as respondia era a IA lendo O PROCESSO DA CESSÃO, que não fala
// das dívidas de ninguém — o "Não" impresso queria dizer "não achei nos autos"
// e era lido na planilha como "diligência feita, nada consta". Esta função
// preenche dd_historico e dd_processo; o motor (_shared/dueDiligencia.ts) já
// sabe lê-las e passa a escrever as duas linhas a partir da apuração.
//
// O CAMINHO DO ADVOGADO É O MOTIVO DE ISTO EXISTIR AGORA. Dívida se procura por
// CPF, e nos autos o advogado só tem OAB — a 0056 registrou a lacuna. O
// Escavador liga uma coisa à outra: /advogado/resumo devolve o CPF a partir da
// OAB, e daí a busca é a mesma dos demais sujeitos.
//
// NÃO CONFUNDIR COM dd-credor. Aquela pega os processos do credor e manda CADA
// UM para a IA ler pelo Manual — é o aprofundamento, caro, para quando algo
// aparece. Esta é a primeira passada: barata, determinística, sobre a lista
// inteira, e é ela que alimenta a planilha.
//
// USO (POST, com sessão):
//   { lead_id, numero_processo?, alvos?: [{ papel, nome, documento?, oab? }] }
// Sem `alvos`, os sujeitos vêm de dd_sujeito. Em RPV não se monta checklist de
// certidões, então normalmente não há dd_sujeito e quem manda os alvos é a tela.
// ============================================================================

import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { ERRO_ACESSO, getCallerAtivo, serviceClient } from '../_shared/auth.ts'
import { chaveEscavador } from '../_shared/segredos.ts'
import { cnjDoCard } from '../_shared/nucleo/cnj.ts'
import {
  apurarProcessos,
  ErroEscavador,
  identidadeDoAdvogado,
  lerOab,
  processosDoEnvolvido,
  type ProcessoApurado,
} from '../_shared/escavador.ts'

type Papel = 'CEDENTE' | 'CONJUGE' | 'PJ' | 'ADVOGADO'
const PAPEIS: Papel[] = ['CEDENTE', 'CONJUGE', 'PJ', 'ADVOGADO']

interface Alvo {
  papel: Papel
  nome: string
  documento?: string | null
  oab?: string | null
  sujeito_id?: string | null
}

const soDigitos = (v: unknown) => String(v ?? '').replace(/\D/g, '')

/** O resultado de um alvo, como a tela e o log o veem. */
interface Apuracao {
  papel: Papel
  nome: string
  documento: string | null
  oab: string | null
  status: 'APURADO' | 'FALHA'
  processos: ProcessoApurado[]
  observacao: string | null
  centavos: number
  requisicoes: number
}

/**
 * Um alvo, do documento à lista de processos.
 *
 * O ADVOGADO ENTRA POR OUTRA PORTA: sem CPF, a OAB vai primeiro a
 * /advogado/resumo, que devolve o CPF, e só então a busca de dívidas acontece
 * como a de qualquer um. Listar os processos que ele PATROCINA seria a resposta
 * errada — neles ele é procurador, nunca parte, e a linha 11 sairia "Não" em
 * todos por construção.
 */
async function apurarAlvo(chave: string, alvo: Alvo, cnjDoCredito: string): Promise<Apuracao> {
  const base = {
    papel: alvo.papel,
    nome: alvo.nome,
    documento: soDigitos(alvo.documento) || null,
    oab: alvo.oab ? String(alvo.oab).trim() : null,
  }
  const notas: string[] = []
  let centavos = 0
  let requisicoes = 0
  let documento = base.documento
  let nome = base.nome

  try {
    if (!documento && base.oab) {
      const oab = lerOab(base.oab)
      if (!oab) {
        throw new ErroEscavador(400, `OAB "${base.oab}" não foi entendida (use, por exemplo, "GO 12345").`)
      }
      const quem = await identidadeDoAdvogado(chave, oab)
      requisicoes += 1
      if (!quem.cpf) {
        throw new ErroEscavador(
          404,
          `O Escavador não achou o CPF do advogado de OAB ${oab.uf} ${oab.numero}. ` +
            'Sem CPF não há como procurar dívida em nome dele — informe o CPF à mão.',
        )
      }
      documento = quem.cpf
      if (quem.nome) nome = quem.nome
      notas.push(`CPF ${quem.cpf} obtido pela OAB ${oab.uf} ${oab.numero}`)
      if (quem.sociedades.length > 0) {
        notas.push('Sociedades: ' + quem.sociedades.map((s) => s.nome).filter(Boolean).join('; '))
      }
    }

    if (!documento && !nome) throw new ErroEscavador(400, 'Alvo sem documento e sem nome.')

    const busca = await processosDoEnvolvido(chave, { documento, nome })
    centavos += busca.centavos
    requisicoes += busca.paginas

    const processos = apurarProcessos(busca.items, {
      documento,
      nome,
      oab: base.oab,
      cnjDoCredito,
    })

    if (!documento) {
      notas.push('Busca feita PELO NOME (sem CPF): confirme que os processos são da mesma pessoa')
    }
    if (busca.truncado) {
      notas.push(
        `Há mais processos do que as ${busca.paginas} páginas consultadas — ` +
          'a lista abaixo não é exaustiva',
      )
    }
    const doCredito = busca.items.length - processos.length
    if (cnjDoCredito && doCredito > 0) {
      notas.push('O processo do próprio crédito foi excluído da lista')
    }

    return {
      ...base,
      documento,
      nome,
      status: 'APURADO',
      processos,
      observacao: notas.join('. ') || null,
      centavos,
      requisicoes,
    }
  } catch (e) {
    const erro = e as ErroEscavador
    return {
      ...base,
      status: 'FALHA',
      processos: [],
      observacao: String(erro?.message ?? erro).slice(0, 500),
      centavos,
      requisicoes,
    }
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    // PORTÃO DE ACESSO. Esta função gasta crédito da API a cada chamada, e o
    // verify_jwt padrão aceitaria o JWT de quem o administrador desativou —
    // desativar não invalida token já emitido.
    const svc = serviceClient()
    const usuario = await getCallerAtivo(req, svc)
    if (!usuario) return jsonResponse({ erro: ERRO_ACESSO }, 401)

    const chave = await chaveEscavador()
    if (!chave) {
      return jsonResponse(
        { erro: 'Token do Escavador não configurado. Configurações → Escavador.' },
        400,
      )
    }

    const body = await req.json().catch(() => ({}))
    const leadId = Number(body.lead_id)
    if (!Number.isFinite(leadId) || leadId <= 0) {
      return jsonResponse({ erro: 'Informe o lead_id do card.' }, 400)
    }

    // O NÚMERO DO CRÉDITO SAI DO TÍTULO DO CARD, como em todo o resto do
    // sistema: o espelho `processo_cnj` já apontou o processo citado numa
    // ANOTAÇÃO, e aqui um número errado significa deixar de excluir da lista o
    // processo da própria cessão — que apareceria como dívida do cedente.
    const { data: lead } = await svc
      .from('kommo_leads')
      .select('nome, processo_cnj')
      .eq('kommo_lead_id', leadId)
      .maybeSingle()
    const cnjDoCredito =
      String(body.numero_processo ?? '').trim() ||
      cnjDoCard(lead?.nome, lead?.processo_cnj) ||
      ''

    // Os alvos: os que a tela mandou, ou os sujeitos já cadastrados. Em RPV não
    // se monta checklist de certidões, então dd_sujeito costuma estar vazio e
    // quem manda é a tela.
    let alvos: Alvo[] = Array.isArray(body.alvos)
      ? body.alvos
          .map((a: Record<string, unknown>) => ({
            papel: String(a.papel ?? '').toUpperCase() as Papel,
            nome: String(a.nome ?? '').trim(),
            documento: a.documento ? soDigitos(a.documento) : null,
            oab: a.oab ? String(a.oab).trim() : null,
            sujeito_id: (a.sujeito_id as string) ?? null,
          }))
          .filter((a: Alvo) => PAPEIS.includes(a.papel) && (a.nome || a.documento || a.oab))
      : []

    if (alvos.length === 0) {
      const { data: sujeitos } = await svc
        .from('dd_sujeito')
        .select('id, papel, nome, documento')
        .eq('kommo_lead_id', leadId)
      alvos = (sujeitos ?? []).map((s) => ({
        papel: s.papel as Papel,
        nome: s.nome,
        documento: s.documento,
        oab: null,
        sujeito_id: s.id,
      }))
    }

    if (alvos.length === 0) {
      return jsonResponse(
        {
          erro:
            'Nenhum sujeito para apurar. Informe ao menos o cedente (nome e CPF) ou ' +
            'o advogado (OAB).',
        },
        400,
      )
    }

    // Em paralelo: são chamadas de rede independentes, e a Edge Function tem
    // 150 s de teto de relógio.
    const apuracoes = await Promise.all(alvos.map((a) => apurarAlvo(chave, a, cnjDoCredito)))

    // ---------------------------------------------------------------------
    // Gravação: uma apuração por alvo, e a foto dos processos daquele alvo.
    // ---------------------------------------------------------------------
    //
    // REAPURAR SUBSTITUI A FOTO. Os processos que vieram do Escavador na
    // passada anterior saem e entram os de agora — é o que "apuração refeita"
    // significa. As linhas de outra fonte (lançadas à mão) ficam.
    const gravadas: Record<string, unknown>[] = []
    for (const a of apuracoes) {
      const alvo = alvos.find((x) => x.papel === a.papel && x.nome === a.nome) ?? alvos[0]
      const identidade = a.documento ?? a.oab ?? a.nome

      const { data: existente } = await svc
        .from('dd_historico')
        .select('id')
        .eq('kommo_lead_id', leadId)
        .eq('papel', a.papel)
        .or(
          [
            a.documento ? `documento.eq.${a.documento}` : null,
            a.oab ? `oab.eq.${a.oab}` : null,
            `nome.eq.${a.nome}`,
          ]
            .filter(Boolean)
            .join(','),
        )
        .maybeSingle()

      const linha = {
        kommo_lead_id: leadId,
        papel: a.papel,
        sujeito_id: alvo?.sujeito_id ?? null,
        nome: a.nome || identidade,
        documento: a.documento,
        oab: a.oab,
        status: a.status,
        fonte: 'escavador',
        // O check dd_historico_apurado_exige_data recusa APURADO sem data: uma
        // apuração sem data é uma foto sem dia, e diligência tem validade.
        apurado_em: a.status === 'APURADO' ? new Date().toISOString() : null,
        observacao: a.observacao,
        criado_por: usuario.id,
        atualizado_em: new Date().toISOString(),
      }

      let historicoId = existente?.id as string | undefined
      if (historicoId) {
        const { error } = await svc.from('dd_historico').update(linha).eq('id', historicoId)
        if (error) return jsonResponse({ erro: `dd_historico: ${error.message}` }, 400)
      } else {
        const { data, error } = await svc.from('dd_historico').insert(linha).select('id').single()
        if (error) return jsonResponse({ erro: `dd_historico: ${error.message}` }, 400)
        historicoId = data.id as string
      }

      await svc.from('dd_processo').delete().eq('historico_id', historicoId).eq('fonte', 'escavador')
      if (a.processos.length > 0) {
        const { error } = await svc.from('dd_processo').insert(
          a.processos.map((p) => ({ ...p, historico_id: historicoId, kommo_lead_id: leadId })),
        )
        if (error) return jsonResponse({ erro: `dd_processo: ${error.message}` }, 400)
      }

      // O QUE CUSTOU. O preço vem no header de cada resposta, em centavos; sem
      // registrar, o gasto só aparece na fatura, agregado, sem dizer qual card
      // o consumiu. Ver a migração 0061.
      await svc.from('escavador_consumo').insert({
        kommo_lead_id: leadId,
        historico_id: historicoId,
        operacao: a.papel === 'ADVOGADO' ? 'advogado' : 'envolvido',
        alvo: identidade,
        centavos: a.centavos,
        requisicoes: a.requisicoes,
        processos: a.processos.length,
        erro: a.status === 'FALHA' ? a.observacao : null,
        criado_por: usuario.id,
      })

      gravadas.push({
        historico_id: historicoId,
        papel: a.papel,
        nome: a.nome,
        documento: a.documento,
        status: a.status,
        observacao: a.observacao,
        total: a.processos.length,
        com_risco: a.processos.filter((p) => p.risco !== 'NENHUM').length,
        alto_risco: a.processos.filter((p) => p.risco === 'ALTO').length,
        processos: a.processos,
      })
    }

    const centavos = apuracoes.reduce((s, a) => s + a.centavos, 0)
    return jsonResponse({
      ok: true,
      lead_id: leadId,
      credito: cnjDoCredito || null,
      custo_centavos: centavos,
      custo: `R$ ${(centavos / 100).toFixed(2).replace('.', ',')}`,
      apuracoes: gravadas,
    })
  } catch (err) {
    return jsonResponse({ erro: (err as Error).message }, 500)
  }
})

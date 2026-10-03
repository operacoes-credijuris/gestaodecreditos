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
// COMO A APURAÇÃO PAGA ENTRA NO BANCO (revisão de 03/10/2026) — ver o módulo.
import {
  destinoDaApuracao,
  ehConflitoDeUnicidade,
  faltaColunaDaLiberacao,
  historicoDoAlvo,
  type LinhaDoHistorico,
  observacaoDaFalhaMantida,
  observacaoDaGravacaoFalha,
} from '../_shared/gravacaoDaApuracao.ts'

type Servico = ReturnType<typeof serviceClient>

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
 * UMA BUSCA POR DOCUMENTO, por mais papéis que aquele documento tenha.
 *
 * Numa cessão de honorários o cedente É o advogado: o mesmo CPF chega aqui duas
 * vezes, como CEDENTE e como ADVOGADO. Sem esta memória, a mesma pessoa era
 * procurada duas vezes e cobrada duas vezes — e a tela abria duas abas com a
 * mesma lista.
 *
 * PROMESSA, e não resultado: os alvos correm em paralelo, e guardar o valor
 * pronto só evitaria a segunda busca se a primeira já tivesse voltado. Guardando
 * a promessa, o segundo papel espera a busca do primeiro em vez de abrir outra.
 *
 * As duas apurações continuam existindo no banco, e isso é de propósito: as
 * linhas 10 e 11 do questionário perguntam por pessoas diferentes, e quando são
 * a mesma pessoa as duas respondem — com o mesmo achado, não com silêncio numa
 * delas.
 */
type MemoriaDeBusca = Map<string, ReturnType<typeof processosDoEnvolvido>>

/**
 * Um alvo, do documento à lista de processos.
 *
 * O ADVOGADO ENTRA POR OUTRA PORTA: sem CPF, a OAB vai primeiro a
 * /advogado/resumo, que devolve o CPF, e só então a busca de dívidas acontece
 * como a de qualquer um. Listar os processos que ele PATROCINA seria a resposta
 * errada — neles ele é procurador, nunca parte, e a linha 11 sairia "Não" em
 * todos por construção.
 */
async function apurarAlvo(
  chave: string,
  alvo: Alvo,
  cnjDoCredito: string,
  memoria: MemoriaDeBusca,
): Promise<Apuracao> {
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

    // SÓ QUEM ESTÁ NO POLO PASSIVO. A pergunta é "que dívida esta pessoa tem", e
    // dívida se cobra de réu; o filtro vai à API para que as causas que ela
    // patrocina e as que ela move não cheguem a ser trazidas — página não
    // trazida é página não cobrada.
    const chaveDaBusca = documento || 'nome:' + nome.toLowerCase()
    const jaPedida = memoria.get(chaveDaBusca)
    const reusada = Boolean(jaPedida)
    const promessa = jaPedida ?? processosDoEnvolvido(chave, { documento, nome, polo: 'PASSIVO' })
    memoria.set(chaveDaBusca, promessa)
    const busca = await promessa
    if (reusada) {
      notas.push('Mesma pessoa de outro papel neste crédito: a busca foi feita uma vez só')
    } else {
      centavos += busca.centavos
      requisicoes += busca.paginas
    }

    const processos = apurarProcessos(
      busca.items,
      { documento, nome, oab: base.oab, cnjDoCredito },
      { buscaSoDeReu: true },
    )

    if (!documento) {
      notas.push('Busca feita PELO NOME (sem CPF): confirme que os processos são da mesma pessoa')
    }
    if (busca.truncado) {
      notas.push(
        `Há mais processos do que as ${busca.paginas} páginas consultadas — ` +
          'a lista abaixo não é exaustiva',
      )
    }
    // POR DÍGITO, e não pela diferença de tamanho das listas: desde que o
    // filtro de polo entrou, a lista encolhe em quase toda busca (as causas
    // patrocinadas saem), e comparar os tamanhos avisaria que o crédito foi
    // excluído em cards onde ele nem apareceu.
    const digitos = (v: string) => v.replace(/[^0-9]/g, '')
    if (
      cnjDoCredito &&
      busca.items.some((i) => digitos(String(i.numero_cnj ?? '')) === digitos(cnjDoCredito))
    ) {
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

/**
 * Grava UMA apuração: a linha de dd_historico e a foto dos processos dela.
 *
 * LANÇA no erro de banco — e quem chama registra o consumo assim mesmo (a busca
 * já foi paga) e conta a falha na tela. As regras de quê gravar estão em
 * `_shared/gravacaoDaApuracao.ts`.
 */
async function gravarApuracao(
  svc: Servico,
  leadId: number,
  usuarioId: string,
  alvo: Alvo | undefined,
  a: Apuracao,
): Promise<{ historicoId: string; mantida: LinhaDoHistorico | null; avisoDeMigracao: string | null }> {
  const identidade = a.documento ?? a.oab ?? a.nome
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
    criado_por: usuarioId,
    atualizado_em: new Date().toISOString(),
  }
  const quem = { documento: linha.documento, oab: linha.oab, nome: linha.nome }

  // TODAS AS LINHAS DO PAPEL, e a escolha em código (`historicoDoAlvo`): o
  // filtro `.or(nome.eq.…)` levava o nome cru para a sintaxe do PostgREST e
  // tinha o erro ignorado. São poucas linhas por crédito e papel.
  const lerLinhas = async (): Promise<LinhaDoHistorico[]> => {
    const { data, error } = await svc
      .from('dd_historico')
      .select('id, documento, oab, nome, status, apurado_em')
      .eq('kommo_lead_id', leadId)
      .eq('papel', a.papel)
    if (error) throw new Error(`dd_historico (leitura): ${error.message}`)
    return (data ?? []) as LinhaDoHistorico[]
  }

  // A LIBERAÇÃO SAI em toda regravação (ver `destinoDaApuracao`). Sem a coluna
  // da 0062 no banco não há liberação a tirar, e a gravação segue sem ela.
  const atualizar = async (id: string) => {
    let { error } = await svc
      .from('dd_historico')
      .update({ ...linha, liberado_em: null, liberado_por: null })
      .eq('id', id)
    if (error && faltaColunaDaLiberacao(error)) {
      ;({ error } = await svc.from('dd_historico').update(linha).eq('id', id))
    }
    if (error) throw new Error(`dd_historico: ${error.message}`)
  }

  let anterior = historicoDoAlvo(await lerLinhas(), quem)
  if (destinoDaApuracao(anterior, a.status).tipo === 'MANTER_ANTERIOR') {
    return { historicoId: anterior!.id, mantida: anterior, avisoDeMigracao: null }
  }

  let historicoId: string
  if (anterior) {
    await atualizar(anterior.id)
    historicoId = anterior.id
  } else {
    const { data, error } = await svc.from('dd_historico').insert(linha).select('id').single()
    if (error && ehConflitoDeUnicidade(error)) {
      // A CORRIDA: outra aba gravou o mesmo alvo entre a leitura e o insert.
      // A linha dela é a desta apuração; relê e decide de novo sobre ela.
      anterior = historicoDoAlvo(await lerLinhas(), quem)
      if (!anterior) throw new Error(`dd_historico: ${error.message}`)
      if (destinoDaApuracao(anterior, a.status).tipo === 'MANTER_ANTERIOR') {
        return { historicoId: anterior.id, mantida: anterior, avisoDeMigracao: null }
      }
      await atualizar(anterior.id)
      historicoId = anterior.id
    } else if (error) {
      throw new Error(`dd_historico: ${error.message}`)
    } else {
      historicoId = data.id as string
    }
  }

  // REAPURAR SUBSTITUI A FOTO: saem os processos do Escavador da passada
  // anterior, entram os de agora. As linhas de outra fonte (à mão) ficam.
  const { error: eLimpeza } = await svc
    .from('dd_processo')
    .delete()
    .eq('historico_id', historicoId)
    .eq('fonte', 'escavador')
  if (eLimpeza) throw new Error(`dd_processo (limpeza): ${eLimpeza.message}`)

  let avisoDeMigracao: string | null = null
  if (a.processos.length > 0) {
    const linhas = a.processos.map((p) => ({
      ...p,
      historico_id: historicoId,
      kommo_lead_id: leadId,
    }))
    let { error } = await svc.from('dd_processo').insert(linhas)

    // COLUNA QUE FALTA NÃO PODE CUSTAR A APURAÇÃO INTEIRA.
    //
    // A busca no Escavador é COBRADA POR REQUISIÇÃO, e quando ela volta o
    // dinheiro já foi gasto. Recusar a gravação porque uma coluna nova ainda
    // não existe no banco joga fora o que se pagou, e o próximo clique paga
    // de novo — foi o que aconteceu no dia em que `data_ultima_movimentacao`
    // entrou no código antes de a migração 0067 rodar.
    //
    // Aqui a apuração entra sem a coluna, e o aviso volta para a tela dizendo
    // o que falta. A leitura já degrada do mesmo jeito (ver o `select('*')`
    // do painel): o que não existe não vem, e a célula fica com um traço.
    if (error && /data_ultima_movimentacao/i.test(error.message)) {
      const semAColuna = linhas.map(({ data_ultima_movimentacao: _d, ...resto }) => resto)
      ;({ error } = await svc.from('dd_processo').insert(semAColuna))
      if (!error) {
        avisoDeMigracao =
          'A migração 0067 ainda não rodou: a apuração foi salva, mas sem a data da ' +
          'última movimentação dos processos. Rode-a no SQL Editor do Supabase.'
      }
    }
    if (error) {
      // APURADO SEM OS PROCESSOS É "NADA CONSTA" — o pior erro possível aqui: a
      // linha já diz APURADO com a data de hoje, e a foto antiga já saiu. A
      // linha volta a FALHA para a lacuna aparecer na análise. Se nem isso
      // gravar (a linha tem recusa, que exige APURADO), fica o erro na tela.
      await svc
        .from('dd_historico')
        .update({
          status: 'FALHA',
          apurado_em: null,
          observacao:
            `A busca achou ${a.processos.length} processo(s), mas a gravação deles falhou ` +
            `(${error.message.slice(0, 200)}). Refaça a apuração.`,
          atualizado_em: new Date().toISOString(),
        })
        .eq('id', historicoId)
      throw new Error(`dd_processo: ${error.message}`)
    }
  }
  return { historicoId, mantida: null, avisoDeMigracao }
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
    const memoria: MemoriaDeBusca = new Map()
    const apuracoes = await Promise.all(
      alvos.map((a) => apurarAlvo(chave, a, cnjDoCredito, memoria)),
    )

    // ---------------------------------------------------------------------
    // Gravação: uma apuração por alvo, e a foto dos processos daquele alvo.
    // ---------------------------------------------------------------------
    //
    // REAPURAR SUBSTITUI A FOTO. Os processos que vieram do Escavador na
    // passada anterior saem e entram os de agora — é o que "apuração refeita"
    // significa. As linhas de outra fonte (lançadas à mão) ficam.
    const gravadas: Record<string, unknown>[] = []
    /**
     * O que falta no banco, dito a quem acabou de pagar pela busca.
     *
     * Migração pendente não pode virar erro de gravação aqui: o Escavador cobra
     * por requisição, e recusar a linha inteira joga fora o que já foi gasto.
     * Grava-se o que dá, e o aviso sobe para a tela.
     */
    let avisoDeMigracao: string | null = null
    /**
     * O que foi PAGO e não se conseguiu salvar. Nunca mais um 400 no meio do
     * laço: ele jogava fora o consumo deste alvo e a gravação dos seguintes, que
     * também já tinham sido pagos. Cada alvo grava o que dá, e a falha sobe para
     * a tela — no item dele e no aviso.
     */
    const naoSalvas: string[] = []
    for (let i = 0; i < apuracoes.length; i++) {
      const a = apuracoes[i]
      // PELA POSIÇÃO: Promise.all devolve na ordem dos alvos. Procurar pelo
      // papel e pelo nome errava quando o Escavador devolvia o nome do advogado
      // achado pela OAB (o nome mudava, e o sujeito_id vinha do primeiro alvo).
      const alvo = alvos[i]
      const identidade = a.documento ?? a.oab ?? a.nome

      let historicoId: string | null = null
      let mantida: LinhaDoHistorico | null = null
      let erroDeGravacao: string | null = null
      try {
        const r = await gravarApuracao(svc, leadId, usuario.id, alvo, a)
        historicoId = r.historicoId
        mantida = r.mantida
        if (r.avisoDeMigracao) avisoDeMigracao = r.avisoDeMigracao
      } catch (e) {
        erroDeGravacao = String((e as Error)?.message ?? e)
        console.error('[dd-processos] gravação', leadId, a.papel, erroDeGravacao)
      }

      // O QUE CUSTOU — SEMPRE, gravada a apuração ou não. O preço vem no header
      // de cada resposta, em centavos; sem registrar, o gasto só aparece na
      // fatura, agregado, sem dizer qual card o consumiu. Ver a migração 0061.
      // Uma segunda tentativa, porque é o único registro desse dinheiro.
      const consumo = {
        kommo_lead_id: leadId,
        historico_id: historicoId,
        operacao: a.papel === 'ADVOGADO' ? 'advogado' : 'envolvido',
        alvo: identidade,
        centavos: a.centavos,
        requisicoes: a.requisicoes,
        processos: a.processos.length,
        erro: a.status === 'FALHA'
          ? a.observacao
          : erroDeGravacao
            ? `apuração não salva: ${erroDeGravacao}`.slice(0, 500)
            : null,
        criado_por: usuario.id,
      }
      let { error: eConsumo } = await svc.from('escavador_consumo').insert(consumo)
      if (eConsumo) ({ error: eConsumo } = await svc.from('escavador_consumo').insert(consumo))
      if (eConsumo) {
        console.error('[dd-processos] consumo não registrado', leadId, consumo, eConsumo.message)
        naoSalvas.push(`o consumo de ${a.papel.toLowerCase()} não foi registrado (${eConsumo.message})`)
      }

      if (erroDeGravacao) {
        naoSalvas.push(`a apuração de ${a.papel.toLowerCase()} não foi salva (${erroDeGravacao})`)
        // FALHA PARA A TELA, com o motivo verdadeiro: o resultado não está no
        // banco, e a lista que a tela recarrega não o terá.
        gravadas.push({
          historico_id: historicoId,
          papel: a.papel,
          nome: a.nome,
          documento: a.documento,
          status: 'FALHA',
          gravada: false,
          observacao: observacaoDaGravacaoFalha(erroDeGravacao, a.centavos),
          total: 0,
          com_risco: 0,
          alto_risco: 0,
          processos: [],
        })
        continue
      }

      gravadas.push({
        historico_id: historicoId,
        papel: a.papel,
        nome: a.nome,
        documento: a.documento,
        status: a.status,
        observacao: mantida ? observacaoDaFalhaMantida(a.observacao, mantida.apurado_em) : a.observacao,
        ...(mantida ? { anterior_mantida: true } : {}),
        total: a.processos.length,
        com_risco: a.processos.filter((p) => p.risco !== 'NENHUM').length,
        alto_risco: a.processos.filter((p) => p.risco === 'ALTO').length,
        processos: a.processos,
      })
    }
    if (naoSalvas.length > 0) {
      const t = 'Atenção: ' + naoSalvas.join('; ') + '.'
      avisoDeMigracao = avisoDeMigracao ? `${avisoDeMigracao} ${t}` : t
    }

    const centavos = apuracoes.reduce((s, a) => s + a.centavos, 0)
    return jsonResponse({
      ok: true,
      aviso: avisoDeMigracao,
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

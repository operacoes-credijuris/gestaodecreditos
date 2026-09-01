// Classifica a fase processual estruturada de cada crédito (public.processos_fase),
// a partir do histórico de movimentações que o cache do ADVBOX já mantém.
//
// SEPARADA, DE PROPÓSITO, de carteira-resumo: aquela função escreve texto livre
// (estágio/providências) para o investidor; esta escreve um código de fase fixo
// (taxonomia do diagnóstico de fases processuais) para a aba "Fase Processual"
// da tela de Créditos. Nem a chamada ao modelo, nem a tabela, nem a UI se
// misturam entre as duas.
//
// Modos (corpo da requisição):
//   { processo_id }                       um crédito só (botão "gerar novamente"), sempre forçado
//   { forcar?: boolean }                  varredura diária (botão "Atualizar" e o cron)
//   { acao: 'override_manual', processo_id, fase_codigo }   reclassificação manual do usuário
//
// A VARREDURA DIÁRIA NÃO RELÊ A CARTEIRA INTEIRA. Ela busca só dois grupos:
// (1) créditos nunca classificados (primeira fase, precisa acontecer uma vez
// por crédito, independente de movimentação); (2) créditos — OU um de seus
// apensos — com andamento dentro de JANELA_RECENTE_DIAS. É a mesma resolução
// (crédito + apensos, casamento por dígito) que a tela "Movimentações
// recentes" usa para exibir, para as duas leituras nunca divergirem sobre
// "quem mudou". `forcar: true` ignora tudo isso e reclassifica o lote inteiro
// mesmo assim (uso: depois de um ajuste no prompt, quando se quer reprocessar
// todo mundo de propósito).
//
// Autorização: JWT do usuário (app) OU x-cron-secret (pg_cron) para os modos de
// classificação; override_manual exige sempre um usuário autenticado (é ação
// dele, fica no log com o usuario_id).
//
// SEM LOTE/ENCADEAMENTO: ao contrário do carteira-resumo (que pode custar até 3
// idas ao modelo por crédito, por causa do loop de correção de forma), aqui é
// uma chamada só por crédito, sem retentativa — o grupo do dia cabe numa
// invocação só, dentro do WORKER_RESOURCE_LIMIT (~150s).
import Anthropic from 'npm:@anthropic-ai/sdk@0.115.0'
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { ERRO_ACESSO, getCallerAtivo, serviceClient } from '../_shared/auth.ts'
import { chaveAnthropic } from '../_shared/segredos.ts'

// Haiku dá conta: a saída é um código fixo de uma lista curta, não prosa livre.
const MODELO = 'claude-haiku-4-5-20251001'

const CONCORRENCIA = 5

// Janela de "movimentação recente" que decide quem entra na varredura diária —
// crédito ou um de seus apensos precisa ter andamento dentro dela. Maior que 1
// dia de propósito: dá folga para o cron não perder ninguém se um dia passar
// sem rodar. Créditos nunca classificados entram sempre, independente desta
// janela (ver a varredura abaixo) — senão um crédito novo, sem "movimentação
// recente" nenhuma ainda, nunca ganharia a primeira fase.
const JANELA_RECENTE_DIAS = 3

// Teto de andamentos enviados ao modelo. A primeira classificação de um
// crédito precisa enxergar mais fundo no histórico (o marco mais avançado pode
// ser antigo); as rodadas seguintes só precisam do que mudou desde a última
// vez, e a fase atual entra no dossiê como contexto.
const MAX_ANDAMENTOS_INICIAL = 150
const MAX_ANDAMENTOS_INCREMENTAL = 40

// Regra padrão de prazo — só TJGO por ora (ver diagnóstico de fases
// processuais). Usada para calcular data_limite_pagamento a partir da
// intimação lida da expedição da RPV, e para decidir automaticamente
// ATV-02 -> ATV-03 quando o prazo vence sem nenhuma movimentação nova.
// TODO: parametrizar por tribunal quando tivermos as demais regras.
const PRAZO_TJGO_DIAS_INTIMACAO = 10
const PRAZO_TJGO_DIAS_PAGAMENTO = 60

// ATV-04 não existe mais como código à parte: por pedido explícito, o pedido
// de sequestro protocolado e o sequestro já deferido (aguardando cumprimento)
// viraram a MESMA fase (ATV-03) — ver SISTEMA_ATIVO.
const FASES_ATIVO = ['ATV-01', 'ATV-02', 'ATV-03', 'ATV-05', 'ATV-06', 'ATV-08'] as const
const FASES_COMPLEMENTAR = [
  'CMP-01',
  'CMP-02',
  'CMP-03',
  'CMP-04',
  'CMP-05',
  'CMP-06',
  'CMP-07',
  'CMP-08',
  'CMP-10',
] as const

const onlyDigits = (v: unknown): string => String(v ?? '').replace(/\D/g, '')

// O modelo, apesar da ferramenta forçada, às vezes devolve algo não vazio mas
// que não é uma data (ex.: "não encontrado" em vez de deixar o campo de fora).
// Sem esta validação, isso ia parar direto em contas de data e quebrava a
// classificação do crédito inteiro com "Invalid time value". Só aceita
// AAAA-MM-DD explícito; qualquer outra coisa vira "sem essa informação".
const DATA_ISO_RE = /^\d{4}-\d{2}-\d{2}$/
const dataValida = (v: string | null): string | null => (v && DATA_ISO_RE.test(v) ? v : null)

function hash(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i)
  return (h >>> 0).toString(36)
}

/** Soma dias corridos a uma data AAAA-MM-DD, em UTC (sem deriva de fuso). */
function somarDias(dataISO: string, dias: number): string {
  const d = new Date(`${dataISO}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

const SISTEMA_BASE = `Você é um classificador de fase processual da Credijuris, que adquire créditos judiciais contra a Fazenda Pública (RPV e precatório) de credores originais e os cede a investidores.

Sua única tarefa é ler os andamentos processuais fornecidos e devolver, pela ferramenta, a fase da esteira em que o crédito está — uma taxonomia fixa, não uma descrição livre.

REGRAS TRANSVERSAIS — aplique antes de decidir qualquer fase:
1. A fase é o MARCO MAIS AVANÇADO já atingido e não revertido, não a última movimentação. Uma juntada de documento posterior à expedição da RPV não devolve o processo à fase anterior.
2. Movimentação genérica — juntada de documento, decurso de prazo, ato ordinatório, expedição de certidão, intimação sem conteúdo decisório — NUNCA muda a fase. Se os andamentos novos forem só isso, mantenha a fase atual informada no dossiê.
3. Regressão SÓ ocorre por evento de reversão nomeado explicitamente na definição de cada fase. Fora disso, não há retrocesso.
4. Havendo sinais de duas fases na mesma janela, prevalece a de marco mais avançado, salvo evento de reversão expresso. Empate real (dois marcos do mesmo nível, mesma data) vai para Outros.
5. Outros é resposta legítima — nunca force o palpite mais próximo. Toda vez que classificar como Outros, preencha motivo_outros (o que impediu a classificação) e fase_anterior_valida com a última fase substantiva válida conhecida (a informada no dossiê como fase atual, se houver).
6. Registre sempre movimentacao_ancora_data e movimentacao_ancora_texto — a movimentação que fundamentou sua escolha. Sem isso não há como auditar depois.
7. data_entrada_fase é a data do MARCO de entrada, não a data de hoje nem a do processamento.
8. Eventos que ameaçam a titularidade ou a integridade do crédito SEMPRE caem em Outros, com motivo detalhado, mesmo que a fase substantiva pareça óbvia: penhora no rosto dos próprios autos; notícia ou juntada de cessão anterior a terceiro; impugnação da cessão pela Fazenda, pelo cedente ou pelo Ministério Público; devolução ou cancelamento de requisição por vício de beneficiário ou de valor; decisão que condiciona a cessão a instrumento público não cumprido; movimentação datada ANTES da data de aquisição do crédito (indício de falha de sincronização, não andamento real).
9. Ao expedir alvará ou ordem de transferência, confira sempre o BENEFICIÁRIO nomeado na movimentação. Beneficiário diferente da cessionária (comum: honorários ao advogado do cedente, ou requisição que reaproveita o cadastro do cedente) NÃO produz entrada na fase de alvará — registre isso no motivo e prefira Outros com alerta.
10. NUNCA invente o teor de uma decisão ou despacho — mas isso é sobre não PREENCHER lacuna, não sobre ignorar o que o texto realmente diz. Muitas movimentações são só um RÓTULO GENÉRICO do sistema de origem — "Decisão -> Outras Decisões", "Despacho", às vezes com um código CNJ/TPU — sem nenhum texto dizendo o que foi decidido; NESSAS, não é permitido supor que o resultado foi favorável (ou desfavorável) só porque a decisão veio logo depois de uma petição pedindo aquilo, mesmo que pareça óbvio. Mas se o próprio texto do andamento já traz o resultado — "habilitação admitida", "cessionário habilitado", "defiro a habilitação", "homologo a cessão", "indefiro o pedido" — isso é teor explícito, não invenção, e fundamenta a fase normalmente. A regra é: use o que está escrito, por mais direto que seja; não complete o que NÃO está escrito. Sem teor nenhum, mantenha a fase anterior informada no dossiê, ou vá para Outros com motivo "teor da decisão não consta no andamento" se não houver fase anterior confiável.`

const SISTEMA_ATIVO = `
TRILHA ATIVO — este crédito é ativo. Escolha uma destas fases:

ATV-01 Aguardando Homologação — petição de homologação da cessão (ou habilitação da cessionária) protocolada, juízo ainda não decidiu. Entra na juntada dessa petição. Sai na decisão que homologa a cessão ou defere a habilitação — NÃO é a expedição da requisição, que já ocorreu antes da aquisição, nem homologação de CÁLCULOS. Quando a saída ocorrer nesta janela, classifique como ATV-02 (ainda não decida ATV-03 por conta própria: o servidor recalcula o roteamento a partir da data da homologação e da intimação da expedição, quando disponíveis).

ATV-02 Homologado / Aguardando Período de Graça — cessão homologada, prazo de pagamento da requisição (já expedida antes da aquisição) ainda correndo. Entra na homologação. Sai pelo pagamento (fora desta lista, ver ATV-06) ou, sem nenhuma movimentação, quando o prazo vence (o servidor cuida dessa transição automática por calendário — você não precisa vigiar isso). Devolução ou cancelamento da requisição por vício reverte a atenção para Outros, com alerta.

ATV-03 Sequestro — cobre TUDO desde o cabimento do sequestro até a constrição efetivamente cumprida: prazo de pagamento vencido sem quitação e sequestro ainda nem requerido; petição de sequestro protocolada e não decidida; ordem de sequestro já deferida, pendente de cumprimento. É a MESMA fase do início ao fim desse trecho — pedido, deferimento e cumprimento pendente não mudam o código, só a movimentação-âncora. Entra pelo vencimento do prazo (quem estava em ATV-02) ou direto da homologação, se o prazo já tinha vencido antes dela. Sai SÓ no CUMPRIMENTO da ordem (constrição efetivamente realizada) — o deferimento da ordem, sozinho, não tira o crédito daqui. Ordem infrutífera ou não cumprida permanece aqui.

ATV-05 Penhora Efetivada — bloqueio ou transferência para conta judicial já concretizados, ainda indisponíveis à cessionária. Bloqueio infrutífero ou ordem ainda não cumprida ficam em ATV-03; bloqueio parcial entra aqui. Sai na expedição de alvará ou ordem de transferência.

ATV-06 Alvará Expedido / Aguardando Pagamento — alvará expedido, OU ordem/ofício de transferência, OU comunicação de pagamento/depósito pelo ente devedor (três portas — em convênio ou depósito direto o pagamento chega sem alvará nenhum). Confira sempre o beneficiário nomeado (regra 9 acima). Alvará devolvido ou cancelado por dado bancário incorreto reverte para ATV-05.

ATV-08 Outros — fallback (ver regra 5). Inclui suspensão/sobrestamento, extinção, recurso ou incidente que afete o crédito, habilitação de herdeiros/falecimento do cedente, movimentação sigilosa, e os eventos da regra 8.

Concluso (conclusao_pendente) NÃO é uma destas fases — é atributo à parte, que reflete a SITUAÇÃO ATUAL dos autos, não o fato histórico de terem sido conclusos algum dia. Marque conclusao_pendente=true SÓ SE a conclusão mais recente ainda não tiver sido seguida de nenhuma decisão, despacho ou sentença. Qualquer um desses três — mesmo indeferindo o pedido, determinando diligência, emenda ou vista — dá BAIXA na conclusão: marque conclusao_pendente=false, mantendo a fase substantiva normalmente (ex.: um processo em ATV-03 cujos autos foram conclusos e já voltou despacho continua ATV-03, com conclusao_pendente=false). Ao marcar true, conclusao_desde é a data dessa conclusão AINDA aberta, nunca de uma conclusão antiga já resolvida.

CAMPO ESPECIAL data_intimacao_lida_expedicao_rpv: preencha com a data em que a intimação da expedição da RPV foi LIDA/confirmada, se e só se encontrar isso explicitamente nos andamentos (geralmente ocorre ANTES da aquisição do crédito — isso é normal nesta trilha, não é o indício de erro da regra 8). Deixe vazio se não encontrar. Quando fase_codigo for ATV-02 ou ATV-03, movimentacao_ancora_data deve ser a data da DECISÃO que homologou a cessão (é a partir dela e da intimação acima que o servidor recalcula o roteamento correto).`

const SISTEMA_COMPLEMENTAR = `
TRILHA COMPLEMENTAR — este crédito é RPV complementar. Os autos são OS MESMOS do crédito principal e carregam todo o histórico dele (expedição da requisição original, período de graça, sequestro, alvará) — essa memória, lida sem filtro, produz fases falsas.

CORTE TEMPORAL OBRIGATÓRIO: a leitura da esteira complementar começa na data de protocolo da petição de complementação (marco de entrada de CMP-01). Qualquer andamento ANTERIOR a essa data é histórico do crédito principal — informa, não classifica. Depois do corte, exige-se pelo menos um sinal de que o andamento pertence ao ciclo de complementação: marcador léxico ("complementar", "complementação", "diferença", "resíduo", "saldo remanescente"), número de requisição diverso do original, ou valor de ordem de grandeza muito inferior ao do principal (valor parecido com o principal é sinal de erro de leitura). Sem nenhum desses sinais depois do corte, classifique Outros com motivo "movimentação não atribuível ao ciclo".

CMP-01 RPV Complementar Peticionado — petição de complementação protocolada (com memória de cálculo da diferença), juízo não decidiu. Esta data é o corte temporal acima. Sai na decisão que defere a complementação ou manda à contadoria.

CMP-02 Deferido — juízo admitiu a complementação (há diferença a apurar/pagar). CUIDADO: "defiro" aparece em dezenas de contextos nos autos (sequestro, alvará, habilitação, prazo, vista) — NENHUM desses é esta fase. E a decisão que HOMOLOGA A CONTA da contadoria também não é esta fase, é saída de CMP-03. Indeferimento do pedido de complementação encerra o ciclo: classifique Outros, motivo "complementação indeferida".

CMP-03 Aguardando Cálculos — do envio à contadoria até a homologação da conta. É fase de ciclo inteiro: remessa, elaboração, juntada da conta, manifestação das partes, impugnação, homologação — tudo isso é ainda CMP-03. Conta elaborada pela própria cessionária e juntada já na petição inicial não abre esta fase (pertence a CMP-01). Impugnação da conta NÃO regride a fase (mantém CMP-03, é só sinal a observar). Sai na homologação da conta pela contadoria/juízo.

CMP-04 Aguardando Expedição da RPV — cálculos homologados, requisição complementar ainda não expedida. Sai na expedição/transmissão da requisição complementar. Confira sempre o beneficiário (regra 9): é comum a serventia reaproveitar o cadastro do requisitório original e expedir em nome do CEDENTE — se divergir da cessionária, Outros com alerta.

CMP-05 Aguardando Período de Graça — requisição complementar expedida e recebida, prazo de pagamento correndo (conta da própria expedição complementar, não do principal). Sai pelo pagamento (CMP-08) ou pelo deferimento do sequestro (CMP-06). Não há fase própria para "prazo vencido sem sequestro" nesta trilha — se vencer sem evento novo, mantenha CMP-05.

CMP-06 Sequestro — ordem de sequestro deferida, pendente de cumprimento. Sai no cumprimento (CMP-07). Petição de sequestro protocolada e não decidida fica em CMP-05.

CMP-07 Penhora — bloqueio ou transferência para conta judicial já concretizados. Sai na expedição de alvará ou ordem de transferência.

CMP-08 Alvará Expedido / Aguardando Pagamento — mesmas três portas de ATV-06 (alvará, ordem de transferência, ou comunicação de depósito). Alvará relativo ao crédito PRINCIPAL, mesmo depois do corte temporal, não pertence a este ciclo — aplique o corte antes de classificar.

CMP-10 Outros — fallback (ver regra 5), incluindo trilha indeterminada (nenhum sinal de B.0 permite atribuir ao principal ou ao complementar) e indeferimento da complementação.

Concluso (conclusao_pendente) segue a mesma lógica de ATV: atributo à parte que reflete a situação ATUAL, não fase. Marque true só se a conclusão mais recente ainda não tiver sido seguida de decisão, despacho ou sentença; qualquer um desses dá baixa na conclusão (conclusao_pendente=false), mesmo mantendo a mesma fase substantiva.

CAMPO ciclo_complementacao: número da instância do ciclo (1 para o primeiro, 2 para uma segunda complementação, e assim por diante — cada ciclo é identificado pela data de protocolo da sua própria petição). Use 1 se não houver indício de ciclo anterior.`

interface FaseAtual {
  fase_codigo: string
  data_entrada_fase: string | null
  movimentacao_ancora_data: string | null
  movimentacao_ancora_texto: string | null
  data_intimacao_lida_expedicao_rpv: string | null
  fonte_hash: string | null
}

interface ProcessoRow {
  id: string
  numero_cnj: string | null
  tribunal: string | null
  comarca: string | null
  vara: string | null
  data_aquisicao: string | null
  status: string | null
}

interface MovRow {
  id: string
  numero_digits: string | null
  data: string | null
  data_ts: string | null
  conteudo: string | null
}

function montarDossie(p: ProcessoRow, movs: MovRow[], atual: FaseAtual | null): string {
  const linhas: string[] = []
  linhas.push('## Cadastro do crédito')
  linhas.push(
    `- Tribunal/vara: ${[p.tribunal, p.comarca, p.vara].filter(Boolean).join(' · ') || 'não informado'}`,
  )
  linhas.push(`- Data de aquisição do crédito: ${p.data_aquisicao || 'não informada'}`)
  linhas.push(`- Hoje: ${new Date().toISOString().slice(0, 10)}`)

  linhas.push('')
  if (atual) {
    linhas.push('## Fase atual (última classificação)')
    linhas.push(`- Fase: ${atual.fase_codigo}, desde ${atual.data_entrada_fase ?? 'não informado'}`)
    linhas.push(
      `- Movimentação-âncora anterior: ${atual.movimentacao_ancora_data ?? 'sem data'}: ${atual.movimentacao_ancora_texto ?? ''}`,
    )
    if (atual.data_intimacao_lida_expedicao_rpv) {
      linhas.push(
        `- Intimação da expedição da RPV já identificada anteriormente, lida em: ${atual.data_intimacao_lida_expedicao_rpv}`,
      )
    }
    linhas.push(
      '- Abaixo estão só os andamentos MAIS RECENTES (janela limitada). Se nenhum marco novo relevante aparecer, mantenha a mesma fase e repita os mesmos dados de entrada/âncora acima.',
    )
  } else {
    linhas.push(
      '## Sem classificação anterior — esta é a primeira. Leia o histórico abaixo por inteiro e determine o marco mais avançado já atingido.',
    )
  }

  const cronologico = [...movs].reverse()
  linhas.push('')
  linhas.push(`## Andamentos (${movs.length} enviados, do mais ANTIGO para o mais RECENTE)`)
  if (cronologico.length === 0) {
    linhas.push('Nenhum andamento novo.')
  } else {
    for (const m of cronologico) linhas.push(`- ${m.data ?? 'sem data'}: ${(m.conteudo ?? '').trim()}`)
  }
  return linhas.join('\n')
}

function ferramentaPara(trilha: 'ativo' | 'complementar') {
  const enumFases = trilha === 'ativo' ? FASES_ATIVO : FASES_COMPLEMENTAR
  const properties: Record<string, unknown> = {
    fase_codigo: { type: 'string', enum: enumFases, description: 'Código da fase escolhida.' },
    data_entrada_fase: { type: 'string', description: 'Data (AAAA-MM-DD) do marco de entrada nesta fase.' },
    movimentacao_ancora_data: { type: 'string', description: 'Data (AAAA-MM-DD) da movimentação que fundamenta a escolha.' },
    movimentacao_ancora_texto: { type: 'string', description: 'Trecho da movimentação-âncora (pode resumir se muito longa).' },
    conclusao_pendente: { type: 'boolean', description: 'true se os autos estão conclusos ao magistrado agora.' },
    conclusao_desde: { type: 'string', description: 'Data (AAAA-MM-DD) da conclusão, se conclusao_pendente=true. Deixe vazio se false.' },
    fase_anterior_valida: { type: 'string', description: 'Só quando fase_codigo é o Outros desta trilha: a última fase substantiva válida conhecida.' },
    motivo_outros: { type: 'string', description: 'Só quando fase_codigo é o Outros desta trilha: por que não foi possível classificar.' },
    data_intimacao_lida_expedicao_rpv: { type: 'string', description: 'Data (AAAA-MM-DD) da intimação lida da expedição da RPV, se encontrada. Deixe vazio se não encontrar.' },
  }
  if (trilha === 'complementar') {
    properties.ciclo_complementacao = {
      type: 'integer',
      description: 'Número do ciclo de complementação (1 se não houver indício de ciclo anterior).',
    }
  }
  return {
    name: 'registrar_fase',
    description: 'Registra a fase processual estruturada do crédito.',
    // strict: restringe a própria geração de tokens do modelo à gramática do
    // schema (grammar-constrained sampling) — o enum de fase_codigo deixa de
    // ser "instrução que o modelo deveria seguir" e vira algo que ele
    // fisicamente não consegue violar. Sem isto, visto na prática: um crédito
    // da trilha complementar recebendo um código da trilha ativo, mesmo com o
    // enum já restrito na ferramenta.
    strict: true,
    input_schema: {
      type: 'object' as const,
      properties,
      required: ['fase_codigo', 'data_entrada_fase', 'movimentacao_ancora_data', 'movimentacao_ancora_texto', 'conclusao_pendente'],
      additionalProperties: false,
    },
  }
}

interface ResultadoModelo {
  fase_codigo: string
  data_entrada_fase: string | null
  movimentacao_ancora_data: string | null
  movimentacao_ancora_texto: string | null
  conclusao_pendente: boolean
  conclusao_desde: string | null
  fase_anterior_valida: string | null
  motivo_outros: string | null
  data_intimacao_lida_expedicao_rpv: string | null
  ciclo_complementacao: number | null
}

async function classificar(
  anthropic: Anthropic,
  modelo: string,
  trilha: 'ativo' | 'complementar',
  dossie: string,
): Promise<ResultadoModelo> {
  const ferramenta = ferramentaPara(trilha)
  const r = await anthropic.messages.create({
    model: modelo,
    max_tokens: 800,
    system: [
      {
        type: 'text',
        text: SISTEMA_BASE + (trilha === 'ativo' ? SISTEMA_ATIVO : SISTEMA_COMPLEMENTAR),
        cache_control: { type: 'ephemeral' },
      },
    ],
    tools: [ferramenta],
    tool_choice: { type: 'tool', name: ferramenta.name },
    messages: [{ role: 'user', content: `Classifique o crédito abaixo.\n\n${dossie}` }],
  })
  for (const bloco of r.content) {
    if (bloco.type === 'tool_use') {
      const i = bloco.input as Record<string, unknown>
      return {
        fase_codigo: String(i.fase_codigo ?? ''),
        data_entrada_fase: dataValida(i.data_entrada_fase ? String(i.data_entrada_fase) : null),
        movimentacao_ancora_data: dataValida(i.movimentacao_ancora_data ? String(i.movimentacao_ancora_data) : null),
        movimentacao_ancora_texto: i.movimentacao_ancora_texto ? String(i.movimentacao_ancora_texto) : null,
        conclusao_pendente: i.conclusao_pendente === true,
        conclusao_desde: dataValida(i.conclusao_desde ? String(i.conclusao_desde) : null),
        fase_anterior_valida: i.fase_anterior_valida ? String(i.fase_anterior_valida) : null,
        motivo_outros: i.motivo_outros ? String(i.motivo_outros) : null,
        data_intimacao_lida_expedicao_rpv: dataValida(
          i.data_intimacao_lida_expedicao_rpv ? String(i.data_intimacao_lida_expedicao_rpv) : null,
        ),
        ciclo_complementacao:
          typeof i.ciclo_complementacao === 'number' ? i.ciclo_complementacao : trilha === 'complementar' ? 1 : null,
      }
    }
  }
  throw new Error('O modelo não retornou os campos esperados.')
}

/**
 * Roteamento determinístico ATV-01 -> ATV-02/ATV-03, e correção de ATV-02/03
 * quando o modelo já tinha os dois dados mas escolheu o código errado. Feito
 * em CÓDIGO, não pelo modelo: aritmética de data é o tipo de coisa que o
 * modelo erra silenciosamente, e aqui a decisão é puramente determinística
 * dados os dois marcos (mesmo princípio de propor_contato: o servidor compõe
 * o que é cálculo, o modelo só extrai o que é leitura).
 */
function aplicarRoteamentoAtivo(
  resultado: ResultadoModelo,
  intimacaoConhecida: string | null,
): { fase_codigo: string; data_limite_pagamento: string | null } {
  // dataValida cobre também o valor já gravado no banco (intimacaoConhecida),
  // que pode ter sido salvo antes desta validação existir.
  const intimacao = dataValida(resultado.data_intimacao_lida_expedicao_rpv ?? intimacaoConhecida)
  if (!intimacao || resultado.fase_codigo === 'ATV-01') {
    return { fase_codigo: resultado.fase_codigo, data_limite_pagamento: null }
  }
  const dataLimite = somarDias(intimacao, PRAZO_TJGO_DIAS_INTIMACAO + PRAZO_TJGO_DIAS_PAGAMENTO)
  if (resultado.fase_codigo !== 'ATV-02' && resultado.fase_codigo !== 'ATV-03') {
    return { fase_codigo: resultado.fase_codigo, data_limite_pagamento: dataLimite }
  }
  const dataHomologacao = resultado.movimentacao_ancora_data
  if (!dataHomologacao) return { fase_codigo: resultado.fase_codigo, data_limite_pagamento: dataLimite }
  const vencidoAntesDaHomologacao = dataLimite < dataHomologacao
  return {
    fase_codigo: vencidoAntesDaHomologacao ? 'ATV-03' : 'ATV-02',
    data_limite_pagamento: dataLimite,
  }
}

async function mapPool<T, R>(itens: T[], limite: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const saida = new Array<R>(itens.length)
  let proximo = 0
  const trabalhador = async (): Promise<void> => {
    while (true) {
      const i = proximo++
      if (i >= itens.length) return
      saida[i] = await fn(itens[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limite, itens.length) }, trabalhador))
  return saida
}

/**
 * Única transição por calendário da taxonomia: ATV-02 -> ATV-03 quando o
 * prazo vence sem nenhuma movimentação nova (por isso não dá para depender só
 * da varredura orientada por andamento). Roda de graça, sem chamar o modelo.
 */
async function varrerTransicaoPorCalendario(svc: ReturnType<typeof serviceClient>): Promise<number> {
  const hoje = new Date().toISOString().slice(0, 10)
  const { data: vencidos } = await svc
    .from('processos_fase')
    .select('processo_id')
    .eq('fase_codigo', 'ATV-02')
    .not('data_limite_pagamento', 'is', null)
    .lt('data_limite_pagamento', hoje)
  const linhas = (vencidos ?? []) as { processo_id: string }[]
  for (const linha of linhas) {
    await svc
      .from('processos_fase')
      .update({ fase_codigo: 'ATV-03', classificado_em: new Date().toISOString() })
      .eq('processo_id', linha.processo_id)
    await svc.from('processos_fase_mudancas').insert({
      processo_id: linha.processo_id,
      fase_anterior: 'ATV-02',
      fase_nova: 'ATV-03',
      origem: 'auto',
      movimentacao_ancora_texto:
        'Prazo de pagamento vencido (calculado a partir da intimação da expedição da RPV), sem quitação registrada.',
    })
  }
  return linhas.length
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const body = (await req.json().catch(() => ({}))) as {
      processo_id?: string
      forcar?: boolean
      modelo?: string
      acao?: string
      fase_codigo?: string
      tratado?: boolean
      movimentacao_data?: string
      situacao_id?: string | null
      situacao_data?: string | null
    }

    const svc = serviceClient()

    // ----- Marcar/desmarcar "tratado" na tela de Movimentações recentes -----
    if (body.acao === 'marcar_tratado') {
      const caller = await getCallerAtivo(req, svc)
      if (!caller) return jsonResponse({ error: ERRO_ACESSO }, 401)
      if (!body.processo_id) return jsonResponse({ error: 'Informe processo_id.' }, 400)
      await svc
        .from('processos_fase')
        .update({
          tratado: body.tratado === true,
          tratado_em: body.tratado === true ? new Date().toISOString() : null,
          tratado_movimentacao_data: body.tratado === true ? (body.movimentacao_data ?? null) : null,
        })
        .eq('processo_id', body.processo_id)
      return jsonResponse({ ok: true })
    }

    // ----- "Situação" e "Data da Situação" (anotação manual, por fase) -----
    if (body.acao === 'definir_situacao') {
      const caller = await getCallerAtivo(req, svc)
      if (!caller) return jsonResponse({ error: ERRO_ACESSO }, 401)
      if (!body.processo_id) return jsonResponse({ error: 'Informe processo_id.' }, 400)
      await svc
        .from('processos_fase')
        .update({
          situacao_id: body.situacao_id ?? null,
          situacao_data: body.situacao_data ?? null,
        })
        .eq('processo_id', body.processo_id)
      return jsonResponse({ ok: true })
    }

    // ----- Override manual: sempre exige usuário autenticado (é ação dele) -----
    if (body.acao === 'override_manual') {
      const caller = await getCallerAtivo(req, svc)
      if (!caller) return jsonResponse({ error: ERRO_ACESSO }, 401)
      if (!body.processo_id || !body.fase_codigo) {
        return jsonResponse({ error: 'Informe processo_id e fase_codigo.' }, 400)
      }
      const { data: atualRow } = await svc
        .from('processos_fase')
        .select('fase_codigo')
        .eq('processo_id', body.processo_id)
        .maybeSingle()
      const hoje = new Date().toISOString().slice(0, 10)
      await svc.from('processos_fase').upsert({
        processo_id: body.processo_id,
        fase_codigo: body.fase_codigo,
        data_entrada_fase: hoje,
        classificado_em: new Date().toISOString(),
      })
      await svc.from('processos_fase_mudancas').insert({
        processo_id: body.processo_id,
        fase_anterior: (atualRow as { fase_codigo: string } | null)?.fase_codigo ?? null,
        fase_nova: body.fase_codigo,
        origem: 'manual',
        usuario_id: caller.id,
      })
      return jsonResponse({ ok: true })
    }

    // ----- Modos de classificação -----
    const cronSecret = Deno.env.get('CRON_SECRET')
    const headerSecret = req.headers.get('x-cron-secret')
    const autorizadoPorCron = !!cronSecret && headerSecret === cronSecret
    if (!autorizadoPorCron) {
      const caller = await getCallerAtivo(req, svc)
      if (!caller) return jsonResponse({ error: ERRO_ACESSO }, 401)
    }

    const apiKey = await chaveAnthropic()
    if (!apiKey) {
      return jsonResponse(
        { error: 'Chave da Anthropic não configurada. Informe em Configurações → Integrações.' },
        400,
      )
    }

    const anthropic = new Anthropic({ apiKey })
    const modelo = body.modelo && body.modelo.trim() ? body.modelo.trim() : MODELO

    let lote: string[]
    let forcar = body.forcar === true

    if (body.processo_id) {
      lote = [body.processo_id]
      forcar = true
    } else {
      // AO CONTRÁRIO do carteira-resumo (que só serve quem já tem investidor
      // definido), a fase processual existe independente de o crédito já estar
      // alocado a um cessionário — é o processo judicial que anda, não a
      // carteira do investidor. Filtrar por `cessionario` aqui descartava quase
      // toda a base.
      const { data: candidatosData } = await svc
        .from('processos')
        .select('id, numero_cnj')
        .in('status', ['ativo', 'complementar'])
      const candidatos = (candidatosData ?? []) as { id: string; numero_cnj: string | null }[]

      if (forcar) {
        // Reprocessamento completo proposital (ex.: depois de ajustar o
        // prompt) — ignora a varredura por novidade, pega todo mundo.
        lote = candidatos.map((p) => p.id)
      } else {
        // Quem nunca foi classificado entra sempre — não dá pra depender de
        // "teve movimentação recente" pra dar a PRIMEIRA fase a um crédito novo.
        const { data: jaClassificadosData } = await svc.from('processos_fase').select('processo_id')
        const idsClassificados = new Set(
          ((jaClassificadosData ?? []) as { processo_id: string }[]).map((r) => r.processo_id),
        )
        const semClassificacao = candidatos.filter((p) => !idsClassificados.has(p.id)).map((p) => p.id)

        // Quem teve movimentação recente — crédito OU um de seus apensos,
        // mesma resolução usada na tela "Movimentações recentes": é a
        // varredura diária olhando o que realmente mudou, em vez de reler a
        // carteira inteira.
        const { data: apensosTodosData } = await svc.from('apensos').select('processo_id, numero')
        const processoPorDigitos = new Map<string, string>()
        for (const p of candidatos) {
          const d = onlyDigits(p.numero_cnj)
          if (d.length >= 6) processoPorDigitos.set(d, p.id)
        }
        for (const a of (apensosTodosData ?? []) as { processo_id: string | null; numero: string | null }[]) {
          if (!a.processo_id) continue
          const d = onlyDigits(a.numero)
          if (d.length >= 6 && !processoPorDigitos.has(d)) processoPorDigitos.set(d, a.processo_id)
        }
        const corteRecente = new Date(Date.now() - JANELA_RECENTE_DIAS * 86400000).toISOString().slice(0, 10)
        const { data: movRecentesData } = await svc
          .from('advbox_movimentacoes')
          .select('numero_digits')
          .gte('data', corteRecente)
        const movimentaramRecentemente = new Set<string>()
        for (const m of (movRecentesData ?? []) as { numero_digits: string | null }[]) {
          const credId = processoPorDigitos.get(m.numero_digits ?? '')
          if (credId) movimentaramRecentemente.add(credId)
        }

        lote = [...new Set([...semClassificacao, ...movimentaramRecentemente])]
      }
    }

    // Transição de calendário só na varredura da carteira inteira, não no
    // regenerar-um-crédito-só (não muda nada ali e seria trabalho à toa).
    let calendarioTransicionados = 0
    if (!body.processo_id) calendarioTransicionados = await varrerTransicaoPorCalendario(svc)

    if (lote.length === 0) {
      return jsonResponse({ ok: true, gerados: 0, pulados: 0, falhas: 0, calendarioTransicionados })
    }

    const { data: procData } = await svc
      .from('processos')
      .select('id, numero_cnj, tribunal, comarca, vara, data_aquisicao, status')
      .in('id', lote)
    const todos = (procData ?? []) as ProcessoRow[]

    // Encerrado sai do classificador: não há posição de fase a manter.
    const encerrados = todos.filter((p) => p.status === 'encerrado').map((p) => p.id)
    if (encerrados.length) {
      await svc.from('processos_fase').delete().in('processo_id', encerrados)
    }
    const processos = todos.filter((p) => p.status === 'ativo' || p.status === 'complementar')

    // Um crédito pode ter movimentação registrada no ADVBOX sob o número de um
    // APENSO, não só o seu próprio numero_cnj — é o mesmo motivo pelo qual a
    // aba Publicações e Movimentações resolve cada andamento por um Map de
    // números (crédito + apensos), não só pelo numero_cnj isolado. Sem isto,
    // andamentos reais do crédito ficavam invisíveis para o classificador.
    const digitsDe = new Map<string, string[]>()
    for (const p of processos) {
      const d = onlyDigits(p.numero_cnj)
      digitsDe.set(p.id, d.length >= 6 ? [d] : [])
    }
    const { data: apensosData } = processos.length
      ? await svc
          .from('apensos')
          .select('processo_id, numero')
          .in(
            'processo_id',
            processos.map((p) => p.id),
          )
      : { data: [] }
    for (const a of (apensosData ?? []) as { processo_id: string | null; numero: string | null }[]) {
      if (!a.processo_id) continue
      const d = onlyDigits(a.numero)
      if (d.length < 6) continue
      digitsDe.get(a.processo_id)?.push(d)
    }
    const todosDigits = [...new Set([...digitsDe.values()].flat())]

    const { data: movData } = todosDigits.length
      ? await svc
          .from('advbox_movimentacoes')
          .select('id, numero_digits, data, data_ts, conteudo')
          .in('numero_digits', todosDigits)
          .order('data', { ascending: false })
          .order('data_ts', { ascending: false, nullsFirst: false })
          .order('id', { ascending: false })
      : { data: [] }
    const movsPor = new Map<string, MovRow[]>()
    for (const m of (movData ?? []) as MovRow[]) {
      const k = m.numero_digits ?? ''
      const l = movsPor.get(k) ?? []
      l.push(m)
      movsPor.set(k, l)
    }
    /** Todas as movimentações de um crédito, unindo as dos seus apensos, na
     * mesma ordem (data desc, data_ts desc, id desc) da consulta original —
     * cada Map já vem ordenado, mas precisa reordenar depois de unir. */
    function movimentacoesDoCredito(processoId: string): MovRow[] {
      const digitos = digitsDe.get(processoId) ?? []
      const todas = digitos.flatMap((d) => movsPor.get(d) ?? [])
      todas.sort((a, b) => {
        if (a.data !== b.data) return (b.data ?? '').localeCompare(a.data ?? '')
        if (a.data_ts !== b.data_ts) return (b.data_ts ?? '').localeCompare(a.data_ts ?? '')
        return b.id.localeCompare(a.id)
      })
      return todas
    }

    const { data: jaTem } = await svc
      .from('processos_fase')
      .select(
        'processo_id, fase_codigo, data_entrada_fase, movimentacao_ancora_data, movimentacao_ancora_texto, data_intimacao_lida_expedicao_rpv, fonte_hash',
      )
      .in('processo_id', lote)
    const atualPor = new Map<string, FaseAtual>()
    for (const r of (jaTem ?? []) as (FaseAtual & { processo_id: string })[]) {
      atualPor.set(r.processo_id, r)
    }

    let gerados = 0
    let pulados = encerrados.length
    let falhas = 0

    await mapPool(processos, CONCORRENCIA, async (p) => {
      const trilha = p.status === 'complementar' ? 'complementar' : 'ativo'
      const atual = atualPor.get(p.id) ?? null
      const teto = atual ? MAX_ANDAMENTOS_INCREMENTAL : MAX_ANDAMENTOS_INICIAL
      const todasMovs = movimentacoesDoCredito(p.id)
      const movs = todasMovs.slice(0, teto)

      const fonte = hash([todasMovs.length, movs.map((m) => m.id).join(','), p.status ?? ''].join('|'))
      if (!forcar && atual?.fonte_hash === fonte) {
        pulados++
        return
      }

      if (movs.length === 0 && !atual) {
        await svc.from('processos_fase').upsert({
          processo_id: p.id,
          fase_codigo: trilha === 'ativo' ? 'ATV-08' : 'CMP-10',
          data_entrada_fase: new Date().toISOString().slice(0, 10),
          fonte_hash: fonte,
          erro: 'Sem andamentos no cache do ADVBOX para este crédito.',
          classificado_em: new Date().toISOString(),
        })
        falhas++
        return
      }

      try {
        const resultado = await classificar(anthropic, modelo, trilha, montarDossie(p, movs, atual))
        const roteamento =
          trilha === 'ativo'
            ? aplicarRoteamentoAtivo(resultado, atual?.data_intimacao_lida_expedicao_rpv ?? null)
            : { fase_codigo: resultado.fase_codigo, data_limite_pagamento: null }

        const faseAnterior = atual?.fase_codigo ?? null
        await svc.from('processos_fase').upsert({
          processo_id: p.id,
          fase_codigo: roteamento.fase_codigo,
          ciclo_complementacao: resultado.ciclo_complementacao,
          data_entrada_fase: resultado.data_entrada_fase ?? new Date().toISOString().slice(0, 10),
          movimentacao_ancora_data: resultado.movimentacao_ancora_data,
          movimentacao_ancora_texto: resultado.movimentacao_ancora_texto,
          fase_anterior_valida: resultado.fase_anterior_valida,
          conclusao_pendente: resultado.conclusao_pendente,
          conclusao_desde: resultado.conclusao_desde,
          data_intimacao_lida_expedicao_rpv:
            resultado.data_intimacao_lida_expedicao_rpv ?? atual?.data_intimacao_lida_expedicao_rpv ?? null,
          data_limite_pagamento: roteamento.data_limite_pagamento,
          fonte_hash: fonte,
          modelo,
          erro: null,
          classificado_em: new Date().toISOString(),
        })
        // Registra TODA vez que um crédito é reprocessado (não só quando a fase
        // muda) — é o que alimenta a seção "Movimentações recentes": mesmo permanecendo na
        // mesma fase, ela mostra a movimentação nova que justificou a
        // confirmação. Usa a movimentação MAIS RECENTE de fato (movs[0], já
        // ordenada desc), não a âncora escolhida pelo modelo — a âncora pode ser
        // mais antiga (o marco que define a fase), enquanto aqui o interesse é
        // "o que aconteceu de novo", ainda que não tenha mudado nada na fase.
        if (movs.length > 0) {
          await svc.from('processos_fase_mudancas').insert({
            processo_id: p.id,
            fase_anterior: faseAnterior,
            fase_nova: roteamento.fase_codigo,
            origem: 'auto',
            movimentacao_ancora_data: movs[0].data,
            movimentacao_ancora_texto: movs[0].conteudo,
          })
        }
        gerados++
      } catch (e) {
        await svc.from('processos_fase').upsert({
          processo_id: p.id,
          fase_codigo: atual?.fase_codigo ?? (trilha === 'ativo' ? 'ATV-08' : 'CMP-10'),
          data_entrada_fase: atual?.data_entrada_fase ?? new Date().toISOString().slice(0, 10),
          erro: String((e as Error).message ?? e).slice(0, 500),
          classificado_em: new Date().toISOString(),
        })
        falhas++
      }
    })

    return jsonResponse({
      ok: true,
      modelo,
      gerados,
      pulados,
      falhas,
      calendarioTransicionados,
    })
  } catch (e) {
    return jsonResponse({ error: String((e as Error).message ?? e) }, 500)
  }
})

// A carteira de UM investidor, calculada UMA vez, para três consumidores.
//
// POR QUE ESTE ARQUIVO EXISTE
//
// A tela (CarteirasInvestidores), o Excel (exportarCarteira) e o relatório em
// HTML (relatorioCarteira) mostram os mesmos números para o mesmo investidor.
// Até aqui, cada um repetia o bloco de contas por conta própria — o mesmo
// `carteira.map(valorProjetado)` seguido do mesmo `tirAgregada`, escrito três
// vezes. Enquanto as três cópias estiverem idênticas ninguém percebe; na
// primeira que alguém ajustar só num lugar, a plataforma passa a publicar dois
// números diferentes para a mesma carteira, e um deles vai para o investidor.
//
// Aqui a conta acontece uma vez. Quem exibe só formata.
//
// NADA É RECALCULADO DE FORMA DIFERENTE. Todas as funções chamadas abaixo são
// as do núcleo (lib/projecao, lib/labels), exatamente na ordem em que a tela já
// as chamava.
import type { Processo } from './types'
import type { CarteiraResumo } from './queries'
import {
  diasEmCarteira,
  estaPago,
  MESES_ALERTA_LIQUIDACAO,
  statusLiquidacao,
  statusTir,
  textoTipoCredito,
  textosResumo,
} from './labels'
import { mesesDepois, onlyDigits, sentenceCase } from './format'
import {
  aReceberEstimado,
  ganhoProjetado,
  ipcaMais2,
  retorno,
  retornoProjetadoCarteira,
  tir,
  tirAgregada,
  valorProjetado,
  type ParametrosAtualizacao,
  type Projecao,
  type Tir,
} from './projecao'

/**
 * Tudo o que a TELA já tem em mãos e que os geradores precisam.
 *
 * É o contrato de entrada: nenhum consumidor busca dado por conta própria. Isso
 * é o que garante que o arquivo baixado seja o retrato do que estava na tela no
 * instante do clique, e não uma segunda leitura do banco que pode ter mudado.
 */
export interface DadosCarteira {
  investidor: string
  mesRef: string
  carteira: Processo[]
  resumos: Map<string, CarteiraResumo> | undefined
  ultimaMov: Map<string, string> | undefined
  /** Totais dos cards que já têm valor; null = ainda não cadastrado. */
  capitalTotal: number | null
  jaRecebidoTotal: number | null
  /** SELIC/IPCA da projeção do valor. */
  parametros: ParametrosAtualizacao | undefined
  /**
   * O "hoje" QUE A TELA ESTÁ USANDO. Vem de fora de propósito: a tela congela a
   * data na montagem, e os geradores chamavam hojeISO() na hora do clique. Com a
   * aba aberta atravessando a meia-noite, o arquivo era calculado com uma data e
   * a tela com outra — dias em carteira e valor projetado saíam diferentes do que
   * está na frente de quem baixou, e o arquivo vai para o investidor.
   */
  hoje: string
}

/** Uma operação da carteira, com tudo o que se calcula sobre ela. */
export interface LinhaCarteira {
  p: Processo
  /** Rótulo do status de liquidação (Verde/Azul/Âmbar/Vermelho/—) e a dica. */
  status: ReturnType<typeof statusLiquidacao>
  /** Estágio e providências já resolvidos (encerrado usa a mensagem fixa). */
  textos: ReturnType<typeof textosResumo>
  proj: Projecao
  tir: Tir
  ganho: number | null
  /** Ganho sobre o capital, em %. */
  retorno: number | null
  /** Da cessão até hoje; liquidado, até o recebimento efetivo. */
  dias: number | null
  /** Data da última movimentação no ADVBOX, casada por dígitos do CNJ. */
  ultimaMovimentacao: string | null
  /** 'Efetivada' quando já pago, 'Estimada' quando ainda é projeção. */
  statusTir: 'Efetivada' | 'Estimada'
  pago: boolean
  /** Tipos do crédito em uma linha, em caixa de frase. */
  tipoCredito: string
}

export interface CarteiraCalculada extends DadosCarteira {
  /** Data a partir da qual a expectativa acende o âmbar. */
  limiteAlerta: string
  linhas: LinhaCarteira[]
  tirMedia: ReturnType<typeof tirAgregada>
  aReceber: ReturnType<typeof aReceberEstimado>
  retornoCarteira: ReturnType<typeof retornoProjetadoCarteira>
  /**
   * Soma dos ganhos projetados, sobre EXATAMENTE o mesmo conjunto que
   * `retornoCarteira` considera. Somar sobre um conjunto maior faria o card de
   * ganho e o de retorno discordarem: `ganhoTotal / capitalConsiderado` tem de
   * devolver `retornoCarteira.valor`, senão o relatório afirma um ganho em reais
   * que o percentual ao lado desmente.
   */
  ganhoTotal: number | null
  /** Capital do conjunto acima — o denominador do retorno. */
  capitalConsiderado: number | null
  /** IPCA + 2% a.a., já resolvido, para não repetir a soma em cada consumidor. */
  ipca2: number | null
  /** Operações liquidadas (com data de recebimento efetivo). */
  liquidadas: number
}

/**
 * Calcula a carteira inteira. Ordem das linhas = ordem de `d.carteira`, que a
 * tela já entrega por data de cessão, da mais antiga para a mais nova.
 */
export function montarCarteiraDoInvestidor(d: DadosCarteira): CarteiraCalculada {
  const hoje = d.hoje
  const limiteAlerta = mesesDepois(hoje, MESES_ALERTA_LIQUIDACAO)

  const linhas: LinhaCarteira[] = d.carteira.map((p) => {
    const proj = valorProjetado(p, d.parametros, hoje)
    const t = tir(p.capital_investido, p.data_aquisicao, proj)
    const ganho = ganhoProjetado(proj, p.capital_investido, p.valor_estimado_complementar)
    return {
      p,
      status: statusLiquidacao(p.data_liquidacao, p.expectativa_liquidacao, hoje, limiteAlerta),
      textos: textosResumo(p.status, d.resumos?.get(p.id)),
      proj,
      tir: t,
      ganho,
      retorno: retorno(ganho, p.capital_investido),
      dias: diasEmCarteira(p.data_aquisicao, p.data_liquidacao, hoje),
      ultimaMovimentacao: d.ultimaMov?.get(onlyDigits(p.numero_cnj)) ?? null,
      statusTir: statusTir(p.data_liquidacao),
      pago: estaPago(p.data_liquidacao),
      tipoCredito: sentenceCase(textoTipoCredito(p.tipo_credito)),
    }
  })

  const tirMedia = tirAgregada(
    linhas.map((l) => ({
      capital: l.p.capital_investido,
      valor: l.proj.valor,
      dias: l.tir.dias,
    })),
  )
  const aReceber = aReceberEstimado(
    linhas.map((l) => ({
      proj: l.proj,
      dataLiquidacao: l.p.data_liquidacao,
      valorComplementar: l.p.valor_estimado_complementar,
    })),
  )
  const retornoCarteira = retornoProjetadoCarteira(
    linhas.map((l) => ({ ganho: l.ganho, capital: l.p.capital_investido })),
  )

  // O MESMO filtro de retornoProjetadoCarteira, repetido de propósito: é o que
  // faz `ganhoTotal / capitalConsiderado` fechar com `retornoCarteira.valor`.
  let somaGanho = 0
  let somaCapital = 0
  let considerados = 0
  for (const l of linhas) {
    if (l.ganho === null) continue
    const cap = l.p.capital_investido
    if (typeof cap !== 'number' || cap <= 0) continue
    somaGanho += l.ganho
    somaCapital += cap
    considerados++
  }

  return {
    ...d,
    limiteAlerta,
    linhas,
    tirMedia,
    aReceber,
    retornoCarteira,
    ganhoTotal: considerados > 0 ? Math.round(somaGanho * 100) / 100 : null,
    capitalConsiderado: considerados > 0 ? Math.round(somaCapital * 100) / 100 : null,
    ipca2: ipcaMais2(d.parametros?.ipca_12m_aa),
    liquidadas: linhas.filter((l) => l.pago).length,
  }
}

/** A resposta da Edge Function `carteira-resumo`. */
export interface RespostaDosResumos {
  ok?: boolean
  erro?: string
  gerados: number
  pulados: number
  falhas: number
  restantes: number
}

/**
 * O QUE A TELA DIZ DEPOIS DE GERAR RESUMOS, e se acompanha a varredura.
 *
 * O `ok: false` VEM COM HTTP 200 (12/11/2026): a carteira-resumo responde 200
 * com `ok: false` e `erro` quando não leu os créditos ou não gravou o texto. A
 * tela só olhava `falhas` e anunciava "Resumo gerado." — ou "Nenhum crédito teve
 * novidade" — com a carteira intacta. E com todo crédito do último lote
 * falhando (`falhas` > 0, `gerados` 0), também dizia "nenhuma novidade".
 *
 * `individual`: o "Gerar novamente" de um crédito (vs. a varredura inteira).
 */
export function avisoDosResumos(
  r: RespostaDosResumos,
  individual: boolean,
): { avisos: { tipo: 'sucesso' | 'erro'; texto: string }[]; acompanhar: boolean } {
  const falhou = r.ok === false || !!r.erro
  if (individual) {
    if (falhou || r.falhas > 0) {
      return {
        avisos: [{
          tipo: 'erro',
          texto: r.erro
            ? `Não foi possível gerar o resumo deste crédito: ${r.erro}`
            : 'Não foi possível gerar o resumo deste crédito.',
        }],
        acompanhar: false,
      }
    }
    return { avisos: [{ tipo: 'sucesso', texto: 'Resumo gerado.' }], acompanhar: false }
  }
  const avisos: { tipo: 'sucesso' | 'erro'; texto: string }[] = []
  if (falhou) avisos.push({ tipo: 'erro', texto: `Parte dos resumos não foi gerada: ${r.erro ?? 'falha no servidor'}.` })
  // Varredura: a resposta volta antes do fim (o servidor segue em lotes, mesmo
  // quando um lote falhou), e a tela acompanha os textos chegando.
  if (r.restantes > 0) {
    if (!falhou) avisos.push({ tipo: 'sucesso', texto: 'Gerando os resumos — os textos vão aparecendo aqui.' })
    return { avisos, acompanhar: true }
  }
  if (falhou) return { avisos, acompanhar: false }
  const falhas = r.falhas > 0 ? ` ${r.falhas === 1 ? '1 crédito falhou' : `${r.falhas} créditos falharam`}.` : ''
  if (r.gerados === 0 && r.falhas > 0) {
    avisos.push({ tipo: 'erro', texto: `Nenhum resumo gerado.${falhas}` })
  } else {
    avisos.push({
      tipo: 'sucesso',
      texto:
        r.gerados > 0
          ? `${r.gerados === 1 ? '1 resumo gerado' : `${r.gerados} resumos gerados`}.${falhas}`
          : 'Nenhum crédito teve novidade desde a última geração.',
    })
  }
  return { avisos, acompanhar: false }
}

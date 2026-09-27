// EM QUE PÉ ESTÃO OS AUTOS DE UMA ANÁLISE — a pergunta que o conector faz antes
// de entregar qualquer coisa.
//
// POR QUE ISTO VIROU UMA DECISÃO EXPLÍCITA. A leitura dos PDFs acontece no
// navegador de quem clicou em "Executar análise", e a conversa do Claude abre na
// hora, sem esperá-la. Antes, o conector só sabia uma coisa: "achei os autos" ou
// "não achei". Não achar significava três situações diferentes — ainda lendo, a
// leitura morreu (a aba foi fechada), ou código errado — e as três recebiam a
// mesma frase ambígua. O modelo, sem saber qual era, às vezes desistia e seguia
// com o que tinha: uma análise feita sem os autos, com cara de análise completa.
//
// AGORA O NAVEGADOR RESERVA O BALCÃO no clique e vai anotando o progresso, e
// esta função transforma o que está anotado numa ordem clara para o modelo:
// espere, ou pare e peça para clicar de novo. Nunca "siga com o que tem".
//
// MÓDULO PURO — sem `Deno.` e sem `npm:` —, para o vitest.

/** Uma linha do balcão, com as colunas de progresso da migração 0069 (opcionais). */
export interface BalcaoDosAutos {
  arquivos?: unknown
  expira_em?: string | null
  /** 'fila' | 'lendo' | 'imagens' | 'pronto' | 'falhou'. Ausente antes da 0069. */
  estado?: string | null
  progresso?: {
    etapa?: string
    feitos?: number
    total?: number
    detalhe?: string
    motivo?: string
    na_frente?: number
  } | null
  atualizado_em?: string | null
}

/**
 * Quanto tempo sem sinal de vida até concluir que a leitura parou.
 *
 * TRÊS MINUTOS, e não um: o navegador anota o progresso a cada arquivo, e um
 * PDF escaneado de trezentas páginas pode levar mais de um minuto sozinho. Um
 * limite curto demais declararia morta uma leitura que só estava num arquivo
 * grande — e mandaria a pessoa clicar de novo à toa.
 */
export const SILENCIO_MAXIMO_MS = 3 * 60 * 1000

export type SituacaoDosAutos =
  | { tipo: 'pronto' }
  | { tipo: 'esperando'; mensagem: string }
  | { tipo: 'parou'; mensagem: string }
  | { tipo: 'falhou'; mensagem: string }
  | { tipo: 'vencido'; mensagem: string }

const temArquivos = (b: BalcaoDosAutos) => Array.isArray(b.arquivos) && b.arquivos.length > 0

/** O progresso em palavras, para a mensagem dizer QUANTO falta, e não só "espere". */
function andamento(b: BalcaoDosAutos): string {
  const p = b.progresso ?? {}
  if (b.estado === 'fila') {
    const n = Number(p.na_frente ?? 0)
    return n > 0
      ? `na fila da plataforma, com ${n} análise(s) à frente`
      : 'na fila da plataforma, prestes a começar'
  }
  const feitos = Number(p.feitos ?? 0)
  const total = Number(p.total ?? 0)
  const conta = total > 0 ? ` (${feitos} de ${total} arquivo(s))` : ''
  return `sendo lidos na plataforma${conta}`
}

/**
 * A situação dos autos de uma análise, e o que dizer ao modelo sobre ela.
 *
 * `pronto` é o único estado em que há o que entregar. Todos os outros levam uma
 * mensagem que PROÍBE começar — e é essa proibição, mais do que a espera, que
 * resolve o defeito: análise pela metade é pior do que análise nenhuma, porque
 * parece inteira.
 */
export function situacaoDosAutos(b: BalcaoDosAutos | null | undefined, agora = Date.now()): SituacaoDosAutos | null {
  // SEM LINHA NENHUMA quem decide é a espera de quem chama: pode ser só o
  // instante entre o clique e a reserva.
  if (!b) return null

  if (b.expira_em && new Date(b.expira_em).getTime() < agora) {
    return {
      tipo: 'vencido',
      mensagem:
        'Este código de análise expirou (os autos ficam disponíveis por 2 horas). ' +
        'Peça a quem está operando para clicar de novo em “Executar análise” na plataforma Credijuris.',
    }
  }

  // O TEXTO CHEGOU: entrega. As imagens das páginas digitalizadas podem ainda
  // estar subindo — `ver_paginas` espera por elas do seu lado, e o índice já
  // diz quais são. Segurar o texto por causa delas atrasaria a análise inteira.
  if (temArquivos(b)) return { tipo: 'pronto' }

  if (b.estado === 'falhou') {
    const motivo = String(b.progresso?.motivo ?? '').trim()
    return {
      tipo: 'falhou',
      mensagem:
        'A leitura dos autos FALHOU na plataforma' + (motivo ? `: ${motivo}` : '') + '. ' +
        'NÃO faça a análise sem os autos. Diga a quem está operando que a leitura falhou ' +
        'e peça para clicar de novo em “Executar análise”.',
    }
  }

  // SEM SINAL DE VIDA HÁ MUITO TEMPO: a aba que lia foi fechada, recarregada ou
  // dormiu. Esperar mais não traz nada — só a pessoa pode reabrir.
  const ultimoSinal = b.atualizado_em ? new Date(b.atualizado_em).getTime() : NaN
  if (Number.isFinite(ultimoSinal) && agora - ultimoSinal > SILENCIO_MAXIMO_MS) {
    const minutos = Math.round((agora - ultimoSinal) / 60000)
    return {
      tipo: 'parou',
      mensagem:
        `A leitura dos autos PAROU há ${minutos} minuto(s), antes de terminar — provavelmente a aba da ` +
        'plataforma Credijuris foi fechada ou recarregada. NÃO faça a análise sem os autos. ' +
        'Peça a quem está operando para clicar de novo em “Executar análise” neste card.',
    }
  }

  return {
    tipo: 'esperando',
    mensagem:
      `Os autos ainda estão ${andamento(b)}. NÃO COMECE A ANÁLISE: ela precisa dos autos inteiros, ` +
      'e o que você escrevesse agora seria feito sem eles. Chame `autos_do_credito` de novo, com o ' +
      'mesmo código, até eles chegarem — cada chamada já espera alguns segundos do lado de cá.',
  }
}

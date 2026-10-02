// O que o Salvar do crédito (Operacional → Créditos) confere e grava.
//
// MORAVA DENTRO DE pages/operacional/execucao/Processos.tsx, e saiu de lá para
// poder ser testada sem montar a tela: as regras de data e de liquidação decidem
// em que card da carteira o dinheiro do crédito aparece (ver errosDoCredito), e o
// payload decide o que um campo escondido deixa no banco. O redesenho vai refazer
// o formulário; estas funções são o que ele não pode mudar sem querer.
import { vazioNull } from './format'
import type { Processo, StatusProcesso } from './types'

/**
 * Data de liquidação, já recebido e valor estimado complementar só existem
 * depois que o crédito começou a ser pago — ou seja, fora do status Ativo.
 * Ficam ocultos no formulário e na ficha, e o salvamento os descarta em Ativo.
 * Ponto único da regra: mudou aqui, mudou nos quatro lugares que a usam.
 */
export const emLiquidacao = (status?: StatusProcesso): boolean =>
  status === 'complementar' || status === 'encerrado'

/** O formulário de crédito novo. */
export const CREDITO_VAZIO: Partial<Processo> = {
  numero_cnj: '',
  tribunal: '',
  comarca: '',
  vara: '',
  cedente: '',
  numero_processo_administrativo: '',
  cedente_advogado: '',
  cessionario: '',
  originador: '',
  entidade_devedora: '',
  data_aquisicao: '',
  expectativa_liquidacao: '',
  instrumento: null,
  numero_rtdpj: '',
  status: 'ativo',
  data_liquidacao: '',
  especie_requisitorio: null,
  tipo_credito: [],
  capital_investido: null,
  valor_face: null,
  data_referencia: '',
  indice_atualizacao: null,
  ja_recebido: null,
  valor_estimado_complementar: null,
}

/**
 * Erros de validação do formulário, por campo (vazio = pode salvar). A tela os
 * mostra inline, junto do campo, sem toast.
 */
export function errosDoCredito(editing: Partial<Processo>): Record<string, string> {
  const novosErros: Record<string, string> = {}
  if (!editing.numero_cnj?.trim()) {
    // Validação inline: erro aparece junto ao campo, sem toast.
    novosErros.numero_cnj = 'Informe o número do processo'
  }

  // COERÊNCIA DA LIQUIDAÇÃO — é aqui que o estado nasce, e é aqui que tem de
  // ser barrado. TODA a plataforma decide "este crédito foi pago?" pela
  // PRESENÇA de data_liquidacao (projecao.ts, statusLiquidacao, statusTir,
  // diasEmCarteira), nunca pelo status. Salvar "Encerrado" com valor recebido e
  // sem a data fazia o mesmo dinheiro entrar em DOIS cards da carteira: somava
  // em "Já recebido" e, por ser lido como não liquidado, somava o valor de face
  // atualizado em "A receber estimado" — R$ 310 mil e R$ 372 mil do mesmo
  // crédito, num caso medido. Corrigir na projeção não resolveria: a regra é
  // compartilhada por quatro funções e mexer nela quebra a TIR.
  if (emLiquidacao(editing.status)) {
    const temValorRecebido =
      editing.ja_recebido != null || editing.valor_estimado_complementar != null
    if (temValorRecebido && !vazioNull(editing.data_liquidacao ?? null)) {
      novosErros.data_liquidacao =
        'Informe a data de liquidação do valor já recebido'
    }
    if (editing.status === 'encerrado' && !vazioNull(editing.data_liquidacao ?? null)) {
      novosErros.data_liquidacao =
        'Crédito encerrado precisa da data efetiva de liquidação'
    }
  }

  // DATA FORA DE ORDEM: liquidar antes de comprar não existe, e o efeito era
  // "Dias em carteira" imprimindo número negativo com a TIR justificando
  // "Prazo nulo" — erro de digitação de ano que passava calado.
  const aq = vazioNull(editing.data_aquisicao ?? null)
  // SÓ A DATA QUE ESTÁ NA TELA. Fora da liquidação o campo fica escondido e o
  // salvar o apaga (payload.data_liquidacao = null, em payloadDoCredito);
  // conferido mesmo assim, um valor antigo fora de ordem travava o Salvar com o
  // erro num campo que ninguém via — o botão simplesmente não fazia nada.
  const liq = emLiquidacao(editing.status) ? vazioNull(editing.data_liquidacao ?? null) : null
  const exp = vazioNull(editing.expectativa_liquidacao ?? null)
  if (aq && liq && liq < aq)
    novosErros.data_liquidacao = 'A liquidação não pode ser anterior à cessão'
  if (aq && exp && exp < aq)
    novosErros.expectativa_liquidacao =
      'A expectativa não pode ser anterior à cessão'

  return novosErros
}

/**
 * O que o Salvar grava, e o `id` que decide entre atualizar (tem id) e criar.
 * Só chamar depois de errosDoCredito voltar vazio.
 */
export function payloadDoCredito(editing: Partial<Processo>) {
  // drive_pasta_id fica FORA do payload: é cache que a resolução da pasta grava
  // por conta própria, e o formulário reenviaria o valor que carregou ao abrir —
  // sobrescrevendo com um id velho um que acabou de ser resolvido.
  const {
    id,
    created_at,
    updated_at,
    advbox_lawsuit_id,
    drive_pasta_id: _cachePasta,
    ...payload
  } =
    editing as Processo
  // Em Ativo os três campos ficam ocultos, então são descartados.
  if (!emLiquidacao(payload.status)) {
    payload.data_liquidacao = null
    payload.ja_recebido = null
    payload.valor_estimado_complementar = null
  }
  // Nº RTDPJ só se aplica a registro público e é opcional (vazio = nulo).
  payload.numero_rtdpj =
    payload.instrumento === 'registro_publico'
      ? vazioNull(payload.numero_rtdpj)
      : null
  // Nº do processo administrativo em branco vira null. Note que ele NÃO é
  // zerado quando a espécie deixa de ser precatório, ao contrário do RTDPJ
  // acima: aqui o valor foi digitado à mão ou lido de um ofício, e apagá-lo por
  // efeito colateral de trocar a espécie seria perder dado sem avisar. Ele
  // continua visível na ficha e no formulário justamente para poder ser
  // corrigido — incoerência à vista é melhor que sumiço silencioso.
  payload.numero_processo_administrativo = vazioNull(
    payload.numero_processo_administrativo,
  )
  // Originador em branco vira null: é ele que monta a lista de nomes da
  // aba Dados pessoais e bancários, e string vazia entraria como se fosse
  // alguém. (O cessionário não passa por aqui — mudar isso agora afetaria
  // filtros e comparações que já existem, e a tela trata os dois casos.)
  payload.originador = vazioNull(payload.originador)
  // Datas em branco viram null.
  payload.data_aquisicao = vazioNull(payload.data_aquisicao)
  payload.expectativa_liquidacao = vazioNull(payload.expectativa_liquidacao)
  payload.data_liquidacao = vazioNull(payload.data_liquidacao)
  payload.data_referencia = vazioNull(payload.data_referencia)
  // Sem tipo marcado o banco espera lista vazia, não null (coluna NOT NULL).
  payload.tipo_credito = payload.tipo_credito ?? []
  return { id, payload }
}

/**
 * AS ETIQUETAS QUE A PLATAFORMA PODE PÔR E TIRAR DE UM CARD DO KOMMO.
 *
 * O QUE ESTES TESTES PROTEGEM não é o desenho do seletor: é a porta. A API do
 * Kommo CRIA a etiqueta quando recebe um nome que ainda não existe na conta — e
 * depois não a renomeia nem a apaga, nem pela API nem pelo painel (verificado na
 * referência v4 e no suporte, em 22/09/2026). Um nome que escape daqui vira
 * sujeira permanente na conta do comercial.
 *
 * Por isso a lista é fechada, a comparação é tolerante e o nome que segue para o
 * Kommo é sempre o DESTA lista, nunca o que chegou na requisição.
 */
import { describe, it, expect } from 'vitest'
import {
  ETIQUETAS_DA_PRECIFICACAO,
  ABA_APROVADOS_EXTERNO,
  ABA_EM_PRECIFICACAO_EXTERNO,
  ABA_REPROVADOS_EXTERNO,
  coresDasTags,
  etiquetaCanonica,
  etiquetasDaAba,
  etiquetasPorDestino,
  irmasDaEtiqueta,
  mensagemDaProposta,
  mesmaEtiqueta,
  ordenarEtiquetas,
  normalizarEtiqueta,
  tomDaTag,
} from '@/lib/kommo'
import { comissoesDoFundo } from '../../../supabase/functions/_shared/etiquetasDoFundo.ts'

describe('as etiquetas da precificação', () => {
  // OS SETE FUNDOS QUE A OPERAÇÃO DITOU em 29/09/2026, no molde "‹ato› ‹fundo›"
  // que o comercial já usava. Cada nome aqui vira etiqueta na conta do Kommo na
  // primeira vez que for aplicado — e não se apaga depois. Mudar um nome é
  // decisão, não ajuste.
  it('são exatamente as que a casa usa', () => {
    expect(ETIQUETAS_DA_PRECIFICACAO.map((e) => e.nome)).toEqual([
      'Enviado PJus',
      'Cotado PJus',
      'Reprovado PJus',
      // O ERRO DA PLATAFORMA (07/10/2026): só os dois fundos de plataforma própria.
      'Erro PJus',
      // O "ENVIADO BTG" ENTROU EM 07/10/2026 — MUDOU DE PROPÓSITO: é o crédito
      // de atacado, que o BTG analisa fora da plataforma e responde depois.
      'Enviado BTG',
      'Cotado BTG',
      'Reprovado BTG',
      'Erro BTG',
      'Enviado PX Ativos',
      'Cotado PX Ativos',
      'Reprovado PX Ativos',
      'Enviado Invest Precatórios',
      'Cotado Invest Precatórios',
      'Reprovado Invest Precatórios',
      'Enviado K & WC Ativos',
      'Cotado K & WC Ativos',
      'Reprovado K & WC Ativos',
      'Enviado Precatur',
      'Cotado Precatur',
      'Reprovado Precatur',
      'Enviado Carbon',
      'Cotado Carbon',
      'Reprovado Carbon',
    ])
  })

  // O LUIZ SAIU DA LISTA: a etiqueta dele que já está num card continua lá, mas
  // a plataforma não a põe nem a tira mais.
  it('o Luiz não é mais um destino da casa', () => {
    expect(etiquetaCanonica('Pendente Luiz')).toBeNull()
    expect(etiquetaCanonica('Cotado Luiz')).toBeNull()
  })

  // A ORDEM DENTRO DO GRUPO É A DO PERCURSO: onde o crédito está, a cotação que
  // voltou, e por fim a recusa — que é sempre a última.
  it('a recusa fecha cada destino, e é uma só', () => {
    const grupos = etiquetasPorDestino()
    expect(grupos.map((g) => g.destino)).toEqual([
      'PJus',
      'BTG',
      'PX Ativos',
      'Invest Precatórios',
      'K & WC Ativos',
      'Precatur',
      'Carbon',
    ])
    for (const g of grupos) {
      const recusas = g.etiquetas.filter((e) => /^Reprovado /.test(e.nome))
      expect(recusas, g.destino).toHaveLength(1)
      // A RECUSA FECHA O PERCURSO; depois dela, só o erro da plataforma (BTG e PJus).
      const percurso = g.etiquetas.filter((e) => e.ato !== 'Erro')
      expect(percurso[percurso.length - 1].nome, g.destino).toMatch(/^Reprovado /)
    }
  })
})

/**
 * O QUE O SELETOR MOSTRA AO LADO DE CADA FUNDO: os atos dele, na ordem do
 * percurso. Até 07/10/2026 o BTG tinha só dois (sem "Enviado"); MUDOU DE
 * PROPÓSITO em 07/10/2026: o "Enviado BTG" é o crédito de atacado.
 */
describe('os atos de cada fundo', () => {
  it('três em cada fundo; o BTG e a PJus com o Erro da plataforma (07/10/2026)', () => {
    const atos = Object.fromEntries(etiquetasPorDestino().map((g) => [g.destino, g.etiquetas.map((e) => e.ato)]))
    for (const f of ['PX Ativos', 'Invest Precatórios', 'K & WC Ativos', 'Precatur', 'Carbon']) {
      expect(atos[f], f).toEqual(['Enviado', 'Cotado', 'Reprovado'])
    }
    for (const f of ['PJus', 'BTG']) expect(atos[f], f).toEqual(['Enviado', 'Cotado', 'Reprovado', 'Erro'])
  })

  // A OBSERVAÇÃO DISCRETA DO SELETOR: só o "Enviado BTG" a tem, e diz quando usar.
  it('o "Enviado BTG" é "só para atacado" — e é a única etiqueta com observação', () => {
    const com = ETIQUETAS_DA_PRECIFICACAO.filter((e) => e.observacao)
    expect(com.map((e) => [e.nome, e.observacao])).toEqual([['Enviado BTG', 'só para atacado']])
  })
})

/**
 * A COMISSÃO DE CADA FUNDO (07/10/2026): o BTG só a limitada — nunca há spread
 * nele. É propriedade do fundo, e é dela que a janela e o servidor tiram a regra.
 */
describe('comissoesDoFundo', () => {
  it('o BTG só aceita a limitada; os outros, limitada e spread', () => {
    expect(comissoesDoFundo('BTG')).toEqual(['limitada'])
    expect(comissoesDoFundo(' btg ')).toEqual(['limitada'])
    for (const f of ['PJus', 'PX Ativos', 'Invest Precatórios', 'K & WC Ativos', 'Precatur', 'Carbon']) {
      expect(comissoesDoFundo(f), f).toEqual(['limitada', 'spread'])
    }
  })

  it('fundo fora da lista (ou nenhum) aceita as duas, como antes', () => {
    expect(comissoesDoFundo('Luiz')).toEqual(['limitada', 'spread'])
    expect(comissoesDoFundo(undefined)).toEqual(['limitada', 'spread'])
  })
})

/**
 * UMA ETIQUETA POR DESTINO. O crédito está cotado no BTG ou reprovado no BTG,
 * não nos dois — e quem opera pediu que a tela não deixasse as duas conviverem.
 * A exclusão mora aqui, e não na tela, porque quem a executa é o servidor: a
 * troca vai num PATCH só, com a nova em `tags_to_add` e a irmã em
 * `tags_to_delete`.
 */
describe('irmasDaEtiqueta', () => {
  it('as alternativas do mesmo destino saem quando esta entra', () => {
    // O BTG COM TRÊS (07/10/2026, mudou de propósito): o "Cotado" do varejo
    // tira o "Enviado" do atacado — é a resposta que chegou por e-mail.
    // O ERRO É IRMÃO TAMBÉM (07/10/2026): uma etiqueta só por fundo.
    expect(irmasDaEtiqueta('Cotado BTG')).toEqual(['Enviado BTG', 'Reprovado BTG', 'Erro BTG'])
    expect(irmasDaEtiqueta('Reprovado BTG')).toEqual(['Enviado BTG', 'Cotado BTG', 'Erro BTG'])
    expect(irmasDaEtiqueta('Enviado BTG')).toEqual(['Cotado BTG', 'Reprovado BTG', 'Erro BTG'])
    expect(irmasDaEtiqueta('Erro BTG')).toEqual(['Enviado BTG', 'Cotado BTG', 'Reprovado BTG'])
    expect(irmasDaEtiqueta('Erro PJus')).toEqual(['Enviado PJus', 'Cotado PJus', 'Reprovado PJus'])
    // TRÊS NO DESTINO, DUAS IRMÃS: cotar um crédito que estava só enviado apaga
    // o "Enviado", que é a notícia velha.
    expect(irmasDaEtiqueta('Cotado PJus')).toEqual(['Enviado PJus', 'Reprovado PJus', 'Erro PJus'])
    expect(irmasDaEtiqueta('Enviado PJus')).toEqual(['Cotado PJus', 'Reprovado PJus', 'Erro PJus'])
    expect(irmasDaEtiqueta('Reprovado Carbon')).toEqual(['Enviado Carbon', 'Cotado Carbon'])
    // O "&" e o acento não confundem a troca.
    expect(irmasDaEtiqueta('Cotado K & WC Ativos')).toEqual(['Enviado K & WC Ativos', 'Reprovado K & WC Ativos'])
    expect(irmasDaEtiqueta('cotado invest precatorios')).toEqual([
      'Enviado Invest Precatórios',
      'Reprovado Invest Precatórios',
    ])
  })

  // ENTRE DESTINOS NÃO HÁ EXCLUSÃO: cotado no BTG e reprovado no PJus é o estado
  // normal de um crédito em precificação, e é o que a fila precisa mostrar.
  it('nenhuma irmã é de outro destino', () => {
    for (const e of ETIQUETAS_DA_PRECIFICACAO) {
      const destinos = irmasDaEtiqueta(e.nome).map(
        (n) => ETIQUETAS_DA_PRECIFICACAO.find((x) => x.nome === n)?.destino,
      )
      expect(new Set(destinos), e.nome).toEqual(new Set([e.destino]))
    }
  })

  it('o que não é da casa não arrasta ninguém', () => {
    expect(irmasDaEtiqueta('Cotado XP')).toEqual([])
    expect(irmasDaEtiqueta('')).toEqual([])
    expect(irmasDaEtiqueta(null)).toEqual([])
  })

  it('a comparação tolera caixa e espaço, como no resto', () => {
    expect(irmasDaEtiqueta(' cotado   btg ')).toEqual(['Enviado BTG', 'Reprovado BTG', 'Erro BTG'])
  })
})

/**
 * A ORDEM NO CARD É A DA CASA, e não a do Kommo.
 *
 * A do Kommo é a ordem em que alguém etiquetou, e muda de card para card: numa
 * coluna de trinta, o mesmo fundo aparece ora no começo, ora no fim, e não há
 * como varrer a fila sem ler cada linha. Fixa, a posição vira informação.
 */
describe('ordenarEtiquetas', () => {
  it('na ordem dos fundos — PJus, BTG, PX Ativos… —, venham como vierem', () => {
    expect(
      ordenarEtiquetas(['Reprovado Carbon', 'Cotado BTG', 'Enviado Precatur', 'Enviado PJus']),
    ).toEqual(['Enviado PJus', 'Cotado BTG', 'Enviado Precatur', 'Reprovado Carbon'])
  })

  it('dentro do destino, a ordem é a do percurso', () => {
    expect(ordenarEtiquetas(['Reprovado PJus', 'Cotado PJus', 'Enviado PJus'])).toEqual([
      'Enviado PJus',
      'Cotado PJus',
      'Reprovado PJus',
    ])
  })

  // ETIQUETA DE FORA É DE QUEM A PÔS: vai para o fim, na ordem em que veio.
  // Inventar posição para ela seria fingir que a conhecemos.
  it('o que não é da casa fica no fim, na ordem original', () => {
    expect(
      ordenarEtiquetas(['zzz', 'Reprovado BTG', 'urgente', 'Enviado PJus']),
    ).toEqual(['Enviado PJus', 'Reprovado BTG', 'zzz', 'urgente'])
  })

  it('não perde nem inventa etiqueta', () => {
    const doCard = ['Sem proposta', 'Cotado Luiz', 'Cotado Precatur', 'Enviado PJus']
    expect(ordenarEtiquetas(doCard).slice().sort()).toEqual(doCard.slice().sort())
    expect(ordenarEtiquetas([])).toEqual([])
  })
})

/**
 * A PORTA DO SERVIDOR. Fora desta lista, a Edge Function recusa — e é o que
 * impede um nome digitado errado em qualquer ponto do caminho de virar etiqueta
 * nova na conta.
 */
describe('etiquetaCanonica', () => {
  it('devolve o nome da lista, e não o que chegou', () => {
    expect(etiquetaCanonica('enviado pjus')).toBe('Enviado PJus')
    // A GRAFIA DE ANTES DE 01/10/2026, que continua nos cards antigos.
    expect(etiquetaCanonica('Enviado PJUS')).toBe('Enviado PJus')
    expect(mesmaEtiqueta('Reprovado PJUS', 'Reprovado PJus')).toBe(true)
    expect(etiquetaCanonica('  REPROVADO   BTG  ')).toBe('Reprovado BTG')
    expect(etiquetaCanonica('enviado invest precatorios')).toBe('Enviado Invest Precatórios')
    expect(etiquetaCanonica('reprovado k & wc ativos')).toBe('Reprovado K & WC Ativos')
  })

  // O QUE NÃO ESTÁ NA LISTA NÃO PASSA — inclusive o que se PARECE com ela.
  // "Cotado XP" é uma etiqueta plausível e ainda assim não existe na conta:
  // aceitá-la seria criá-la.
  it('recusa o que a casa não nomeou', () => {
    for (const fora of ['Cotado XP', 'Enviado', 'Reprovado', 'urgente', '', '   ']) {
      expect(etiquetaCanonica(fora), fora).toBeNull()
    }
    expect(etiquetaCanonica(null)).toBeNull()
    expect(etiquetaCanonica(undefined)).toBeNull()
  })
})

/**
 * A COMPARAÇÃO É TOLERANTE porque o que está no card veio do Kommo, e caixa ou
 * espaço a mais ali deixariam a etiqueta MARCADA aparecer como desmarcada — e o
 * clique seguinte mandaria acrescentar o que já existe.
 */
describe('mesmaEtiqueta', () => {
  it('ignora caixa, acento e espaço', () => {
    expect(mesmaEtiqueta('Reprovado PJus', 'REPROVADO PJus')).toBe(true)
    expect(mesmaEtiqueta('Enviado  PJus', ' enviado pjus ')).toBe(true)
    expect(mesmaEtiqueta('Pendente Luiz', 'Pendente Luís')).toBe(false)
  })

  it('não confunde etiquetas de destinos diferentes', () => {
    expect(mesmaEtiqueta('Reprovado PJus', 'Reprovado BTG')).toBe(false)
  })

  it('normaliza sem perder a distinção', () => {
    expect(normalizarEtiqueta(' Cotado   BTG ')).toBe('COTADO BTG')
  })
})

/**
 * MOSTRAR E EDITAR SÃO PORTAS DIFERENTES. As três abas terminais do Externo
 * mostram etiqueta; só "Em precificação" deixa mexer, porque só nela o crédito
 * ainda está em jogo. Em Aprovados e Reprovados a etiqueta é registro do que já
 * aconteceu.
 */
describe('etiquetasDaAba', () => {
  it('só a precificação oferece etiquetas', () => {
    expect(etiquetasDaAba(ABA_EM_PRECIFICACAO_EXTERNO)).toEqual(ETIQUETAS_DA_PRECIFICACAO)
  })

  it('as outras abas ficam só na leitura', () => {
    for (const aba of [
      ABA_APROVADOS_EXTERNO,
      ABA_REPROVADOS_EXTERNO,
      'ext-qualificacao',
      'int-analise',
      'pendentes',
      '',
      null,
      undefined,
    ]) {
      expect(etiquetasDaAba(aba), String(aba)).toHaveLength(0)
    }
  })
})

/**
 * A COR DAS SEIS. Todas caem numa regra de ato — nenhuma depende da paleta de
 * reserva, que só distingue e não diz nada. Numa coluna em que cada card espera
 * resposta de um fundo, é a cor que responde antes do texto.
 */
describe('a cor das etiquetas da precificação', () => {
  it('o ato manda, inclusive no que está pendente', () => {
    expect(tomDaTag('Enviado PJus')).toBe('blue')
    expect(tomDaTag('Cotado BTG')).toBe('green')
    // O "ENVIADO BTG" (07/10/2026) no azul dos outros "Enviado": esperando resposta.
    expect(tomDaTag('Enviado BTG')).toBe('blue')
    expect(tomDaTag('Enviado PX Ativos')).toBe('blue')
    expect(tomDaTag('Cotado K & WC Ativos')).toBe('green')
    expect(tomDaTag('Reprovado PJus')).toBe('red')
    expect(tomDaTag('Reprovado BTG')).toBe('red')
    expect(tomDaTag('Reprovado Carbon')).toBe('red')
  })

  // O CARD REAL desta aba tem uma etiqueta por destino, e as três precisam se
  // ler de relance: uma esperando, uma cotada, uma recusada.
  it('um card com três destinos sai com três cores', () => {
    const cores = coresDasTags(['Enviado PJus', 'Cotado BTG', 'Reprovado Carbon'])
    expect(cores.get('Enviado PJus')).toBe('blue')
    expect(cores.get('Cotado BTG')).toBe('green')
    expect(cores.get('Reprovado Carbon')).toBe('red')
  })
})

/** A NOTA DA PROPOSTA ESCOLHIDA, com o artigo de cada fundo. */
describe('mensagemDaProposta', () => {
  it('o BTG é "do", os outros são "da"', () => {
    expect(mensagemDaProposta('BTG')).toBe('Seguir com a proposta do BTG.')
    expect(mensagemDaProposta('PX Ativos')).toBe('Seguir com a proposta da PX Ativos.')
    expect(mensagemDaProposta('invest precatorios')).toBe('Seguir com a proposta da Invest Precatórios.')
  })
})

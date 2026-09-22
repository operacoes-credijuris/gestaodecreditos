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
  mesmaEtiqueta,
  normalizarEtiqueta,
  tomDaTag,
} from '@/lib/kommo'

describe('as etiquetas da precificação', () => {
  // AS SEIS QUE A OPERAÇÃO DITOU em 22/09/2026, com o verbo de cada destino. O
  // primeiro muda — "Enviado", "Cotado", "Pendente" — porque é o vocabulário que
  // o comercial já usa no Kommo; uniformizá-lo aqui criaria etiquetas NOVAS lá
  // dentro em vez de casar com as que existem.
  it('são exatamente as que a casa usa', () => {
    expect(ETIQUETAS_DA_PRECIFICACAO.map((e) => e.nome)).toEqual([
      'Enviado PJUS',
      'Cotado PJUS',
      'Reprovado PJUS',
      'Cotado BTG',
      'Reprovado BTG',
      'Pendente Luiz',
      'Cotado Luiz',
      'Reprovado Luiz',
    ])
  })

  // A ORDEM DENTRO DO GRUPO É A DO PERCURSO: onde o crédito está, a cotação que
  // voltou, e por fim a recusa — que é sempre a última.
  it('a recusa fecha cada destino, e é uma só', () => {
    const grupos = etiquetasPorDestino()
    expect(grupos.map((g) => g.destino)).toEqual(['PJUS', 'BTG', 'Luiz'])
    for (const g of grupos) {
      const recusas = g.etiquetas.filter((e) => /^Reprovado /.test(e.nome))
      expect(recusas, g.destino).toHaveLength(1)
      expect(g.etiquetas[g.etiquetas.length - 1].nome, g.destino).toMatch(/^Reprovado /)
    }
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
    expect(irmasDaEtiqueta('Cotado BTG')).toEqual(['Reprovado BTG'])
    expect(irmasDaEtiqueta('Reprovado BTG')).toEqual(['Cotado BTG'])
    // TRÊS NO DESTINO, DUAS IRMÃS: cotar um crédito que estava só enviado apaga
    // o "Enviado", que é a notícia velha.
    expect(irmasDaEtiqueta('Cotado PJUS')).toEqual(['Enviado PJUS', 'Reprovado PJUS'])
    expect(irmasDaEtiqueta('Enviado PJUS')).toEqual(['Cotado PJUS', 'Reprovado PJUS'])
    expect(irmasDaEtiqueta('Reprovado Luiz')).toEqual(['Pendente Luiz', 'Cotado Luiz'])
  })

  // ENTRE DESTINOS NÃO HÁ EXCLUSÃO: cotado no BTG e reprovado no PJUS é o estado
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
    expect(irmasDaEtiqueta(' cotado   btg ')).toEqual(['Reprovado BTG'])
  })
})

/**
 * A PORTA DO SERVIDOR. Fora desta lista, a Edge Function recusa — e é o que
 * impede um nome digitado errado em qualquer ponto do caminho de virar etiqueta
 * nova na conta.
 */
describe('etiquetaCanonica', () => {
  it('devolve o nome da lista, e não o que chegou', () => {
    expect(etiquetaCanonica('enviado pjus')).toBe('Enviado PJUS')
    expect(etiquetaCanonica('  REPROVADO   BTG  ')).toBe('Reprovado BTG')
    expect(etiquetaCanonica('Pendente Luiz')).toBe('Pendente Luiz')
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
    expect(mesmaEtiqueta('Reprovado PJUS', 'REPROVADO PJUS')).toBe(true)
    expect(mesmaEtiqueta('Enviado  PJUS', ' enviado pjus ')).toBe(true)
    expect(mesmaEtiqueta('Pendente Luiz', 'Pendente Luís')).toBe(false)
  })

  it('não confunde etiquetas de destinos diferentes', () => {
    expect(mesmaEtiqueta('Reprovado PJUS', 'Reprovado BTG')).toBe(false)
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
    expect(tomDaTag('Enviado PJUS')).toBe('blue')
    expect(tomDaTag('Cotado BTG')).toBe('green')
    expect(tomDaTag('Pendente Luiz')).toBe('yellow')
    expect(tomDaTag('Reprovado PJUS')).toBe('red')
    expect(tomDaTag('Reprovado BTG')).toBe('red')
    expect(tomDaTag('Reprovado Luiz')).toBe('red')
  })

  // O CARD REAL desta aba tem uma etiqueta por destino, e as três precisam se
  // ler de relance: uma esperando, uma cotada, uma recusada.
  it('um card com três destinos sai com três cores', () => {
    const cores = coresDasTags(['Enviado PJUS', 'Cotado BTG', 'Reprovado Luiz'])
    expect(cores.get('Enviado PJUS')).toBe('blue')
    expect(cores.get('Cotado BTG')).toBe('green')
    expect(cores.get('Reprovado Luiz')).toBe('red')
  })
})

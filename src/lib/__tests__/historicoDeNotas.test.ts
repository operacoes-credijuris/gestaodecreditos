import { describe, it, expect } from 'vitest'
import { agruparNotas } from '../historicoDeNotas'
import { semEntidadesHtml } from '../../../supabase/functions/_shared/textoDoKommo.ts'
import type { KommoNota } from '../types'

/**
 * O HISTÓRICO DE UM CARD, COMO SE LÊ.
 *
 * No Kommo o anexo é uma NOTA SEPARADA: quem sobe um arquivo cria uma nota do
 * tipo `attachment`, sem texto, e o comentário que o explica é outra nota,
 * escrita segundos antes ou depois. Não existe campo ligando as duas — a
 * ligação está no relógio e em quem fez.
 */
const nota = (
  id: number,
  criado_em: string,
  extras: Partial<KommoNota> = {},
): KommoNota => ({ id, texto: `nota ${id}`, criado_em, autor: null, tipo: 'common', ...extras })

const anexo = (id: number, criado_em: string, extras: Partial<KommoNota> = {}): KommoNota =>
  nota(id, criado_em, { tipo: 'attachment', texto: `📎 arquivo-${id}.pdf`, ...extras })

describe('agruparNotas', () => {
  it('gruda o anexo na anotação mais próxima', () => {
    const blocos = agruparNotas([
      anexo(1, '2026-09-16T16:18:41Z'),
      nota(2, '2026-09-16T16:19:01Z'),
    ])
    expect(blocos).toHaveLength(1)
    expect(blocos[0].nota.id).toBe(2)
    expect(blocos[0].anexos.map((a) => a.id)).toEqual([1])
  })

  it('o anexo pode vir depois da anotação', () => {
    const blocos = agruparNotas([
      nota(1, '2026-09-16T16:19:01Z'),
      anexo(2, '2026-09-16T16:19:20Z'),
    ])
    expect(blocos).toHaveLength(1)
    expect(blocos[0].anexos.map((a) => a.id)).toEqual([2])
  })

  it('vários arquivos na mesma anotação', () => {
    const blocos = agruparNotas([
      nota(1, '2026-09-16T16:19:01Z'),
      anexo(2, '2026-09-16T16:19:05Z'),
      anexo(3, '2026-09-16T16:19:09Z'),
    ])
    expect(blocos).toHaveLength(1)
    expect(blocos[0].anexos.map((a) => a.id)).toEqual([2, 3])
  })

  /**
   * ERRAR PARA O LADO DE NÃO AGRUPAR É INOFENSIVO — o anexo aparece sozinho,
   * como aparecia. Agrupar demais prende um arquivo à anotação errada, e quem lê
   * passa a atribuir um documento a um comentário que não falava dele.
   */
  it('longe demais, o anexo fica por conta própria', () => {
    const blocos = agruparNotas([
      nota(1, '2026-09-16T16:00:00Z'),
      anexo(2, '2026-09-16T16:30:00Z'),
    ])
    expect(blocos.map((b) => b.nota.id)).toEqual([1, 2])
    expect(blocos.every((b) => b.anexos.length === 0)).toBe(true)
  })

  it('autores diferentes não se juntam', () => {
    const blocos = agruparNotas([
      nota(1, '2026-09-16T16:19:01Z', { autor: 'Maria' }),
      anexo(2, '2026-09-16T16:19:05Z', { autor: 'Pedro' }),
    ])
    expect(blocos).toHaveLength(2)
  })

  // NULO NÃO CONTRADIZ NINGUÉM: o Kommo devolve autor nulo no que a automação
  // escreve, e exigir igualdade estrita deixaria de agrupar o caso mais comum.
  it('autor nulo de um dos lados ainda agrupa', () => {
    const blocos = agruparNotas([
      nota(1, '2026-09-16T16:19:01Z', { autor: 'Maria' }),
      anexo(2, '2026-09-16T16:19:05Z', { autor: null }),
    ])
    expect(blocos).toHaveLength(1)
  })

  it('entre duas anotações, o anexo fica com a mais próxima', () => {
    const blocos = agruparNotas([
      nota(1, '2026-09-16T16:00:00Z'),
      anexo(2, '2026-09-16T16:02:40Z'),
      nota(3, '2026-09-16T16:02:50Z'),
    ])
    expect(blocos.map((b) => b.nota.id)).toEqual([1, 3])
    expect(blocos[1].anexos.map((a) => a.id)).toEqual([2])
  })

  it('sem data não há como aproximar, e o anexo fica sozinho', () => {
    const blocos = agruparNotas([
      nota(1, '2026-09-16T16:19:01Z'),
      { ...anexo(2, ''), criado_em: null },
    ])
    expect(blocos).toHaveLength(2)
  })

  it('lista vazia devolve lista vazia', () => {
    expect(agruparNotas([])).toEqual([])
  })

  /**
   * O ENVIO EM LOTE, que é como um processo chega: dezoito peças no mesmo
   * segundo, nenhuma com comentário ao lado. Sem agrupar os órfãos entre si, o
   * histórico do card virava uma coluna de dezoito faixas iguais, cada uma com
   * um nome de arquivo dentro e um selo "anexo" em cima.
   */
  it('vários arquivos sem anotação viram um bloco só', () => {
    const lote = Array.from({ length: 18 }, (_, i) => anexo(i + 1, '2026-09-14T18:30:15Z'))
    const blocos = agruparNotas(lote)
    expect(blocos).toHaveLength(1)
    expect(blocos[0].anexos).toHaveLength(17)
  })

  // MEDIDOS CONTRA O PRIMEIRO do grupo: um bloco nunca cobre mais que a janela
  // inteira, por mais arquivos que entrem nele em cadeia.
  it('o lote não cresce indefinidamente em cadeia', () => {
    const blocos = agruparNotas([
      anexo(1, '2026-09-14T18:30:00Z'),
      anexo(2, '2026-09-14T18:32:00Z'),
      anexo(3, '2026-09-14T18:34:00Z'),
    ])
    expect(blocos).toHaveLength(2)
    expect(blocos[0].anexos.map((a) => a.id)).toEqual([2])
    expect(blocos[1].nota.id).toBe(3)
  })

  it('o lote não engole a anotação que vem no meio', () => {
    const blocos = agruparNotas([
      anexo(1, '2026-09-14T18:00:00Z'),
      nota(2, '2026-09-14T18:20:00Z'),
      anexo(3, '2026-09-14T18:40:00Z'),
    ])
    expect(blocos.map((b) => b.nota.id)).toEqual([1, 2, 3])
  })

  // Linha gravada antes de 17/09/2026 não tem `tipo`: nada é anexo, e o
  // histórico continua saindo como saía.
  it('sem tipo, nada vira anexo', () => {
    const antigas = [
      { id: 1, texto: 'a', criado_em: '2026-09-01T10:00:00Z', autor: null },
      { id: 2, texto: 'b', criado_em: '2026-09-01T10:00:10Z', autor: null },
    ]
    expect(agruparNotas(antigas)).toHaveLength(2)
  })
})

/**
 * O KOMMO GUARDA A NOTA COMO HTML e a devolve escapada. Num feed que renderiza
 * HTML isso é invisível; no nosso `<pre>`, que mostra texto cru, aparece
 * literalmente — e o mesmo texto vai para a IA na análise seguinte.
 */
describe('semEntidadesHtml', () => {
  it('desfaz o que aparece numa anotação de CRM', () => {
    expect(semEntidadesHtml('TRIAGEM AUTOMATICA -&gt; PRECATORIO_EXTERNO')).toBe(
      'TRIAGEM AUTOMATICA -> PRECATORIO_EXTERNO',
    )
    expect(semEntidadesHtml('Silva &amp; Souza')).toBe('Silva & Souza')
    expect(semEntidadesHtml('&lt;sem risco&gt;')).toBe('<sem risco>')
    expect(semEntidadesHtml('R&#36; 1.000')).toBe('R$ 1.000')
    expect(semEntidadesHtml('R&#x24; 1.000')).toBe('R$ 1.000')
  })

  /**
   * `&amp;` POR ÚLTIMO, e é a única ordem que funciona. O Kommo escapa em
   * cascata: um ">" digitado num texto que já tinha entidade chega como
   * `&amp;gt;`. Trocando `&amp;` primeiro, viraria `&gt;` e a passada seguinte o
   * transformaria em ">" — desfazendo um escape a mais do que houve.
   */
  it('não desfaz escape em cascata além do que houve', () => {
    expect(semEntidadesHtml('a &amp;gt; b')).toBe('a &gt; b')
  })

  it('texto sem entidade nenhuma passa intacto', () => {
    expect(semEntidadesHtml('Aprovado com ressalvas. Valor: R$ 210.902,62')).toBe(
      'Aprovado com ressalvas. Valor: R$ 210.902,62',
    )
    expect(semEntidadesHtml(null)).toBe('')
    expect(semEntidadesHtml(undefined)).toBe('')
  })

  // Entidade malformada numa anotação não pode derrubar a sincronização do card.
  it('código fora da faixa não estoura', () => {
    expect(semEntidadesHtml('x&#99999999;y')).toBe('xy')
    expect(semEntidadesHtml('50% &rarr; 60%')).toBe('50% &rarr; 60%')
  })
})

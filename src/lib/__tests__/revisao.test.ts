import { describe, it, expect } from 'vitest'
import { aplicarPatch } from '../../../supabase/functions/_shared/revisao.ts'

/**
 * O patch do chat de revisão.
 *
 * Cada teste aqui corresponde a uma coisa que o operador tentou fazer e que a
 * ferramenta ou recusava, ou — pior — dizia ter feito sem fazer.
 */
const CAMPOS = new Set([
  'bruto_total', 'ir', 'inss', 'honorarios', 'm2',
  'roteiro_prazo', 'bloco_g_riscos', 'auditoria_divergencias', 'etapa_atual',
])
const LISTAS = new Set(['roteiro_prazo', 'bloco_g_riscos', 'auditoria_divergencias'])

const base = () => ({
  bruto_total: 72186.12,
  roteiro_prazo: [
    { ato: 'homologar', dias: 30 },
    { ato: 'expedir RPV', dias: 60 },
    { ato: 'pagamento', dias: 60 },
  ],
  bloco_g_riscos: [{ risco: 'a' }, { risco: 'b' }, { risco: 'c' }],
  m2: { '10': { resposta: 'Sim' }, '11': { resposta: 'Não' } },
})

const patch = (alt: Record<string, unknown>, rem: string[] = []) =>
  aplicarPatch(base(), alt, rem, CAMPOS, LISTAS)

describe('editar item de lista sem apagar os outros', () => {
  it('mexer num ato do roteiro preserva os demais', () => {
    // O defeito antigo: mandar um roteiro com um ato substituía os três.
    const r = patch({ roteiro_prazo: { 1: { dias: 90 } } })
    const lista = r.dados.roteiro_prazo as Array<Record<string, unknown>>
    expect(lista).toHaveLength(3)
    expect(lista[1]).toEqual({ ato: 'expedir RPV', dias: 90 })  // mescla, não troca
    expect(lista[0]).toEqual({ ato: 'homologar', dias: 30 })
  })

  it('acrescentar um ato ao fim', () => {
    const r = patch({ roteiro_prazo: { '+': { ato: 'alvará', dias: 21 } } })
    const lista = r.dados.roteiro_prazo as unknown[]
    expect(lista).toHaveLength(4)
    expect(r.mudancas.join(' ')).toMatch(/acrescentado/)
  })

  it('mandar a lista inteira ainda substitui — quando é isso que se quer', () => {
    const r = patch({ roteiro_prazo: [{ ato: 'só um', dias: 10 }] })
    expect(r.dados.roteiro_prazo).toHaveLength(1)
    expect(r.mudancas.join(' ')).toMatch(/lista inteira substituída/)
  })
})

describe('remover de qualquer lista, não só de riscos', () => {
  it('remove um ato do roteiro', () => {
    const r = patch({}, ['roteiro_prazo.1'])
    const lista = r.dados.roteiro_prazo as Array<Record<string, unknown>>
    expect(lista.map((a) => a.ato)).toEqual(['homologar', 'pagamento'])
  })

  it('remove vários de trás para frente, sem deslocar índice', () => {
    // Removendo 0 e 2 na ordem ingênua, o 2 viraria o item errado.
    const r = patch({}, ['bloco_g_riscos.0', 'bloco_g_riscos.2'])
    expect((r.dados.bloco_g_riscos as Array<{ risco: string }>).map((x) => x.risco)).toEqual(['b'])
  })

  it('"riscos.N" continua funcionando — é como o prompt sempre chamou', () => {
    const r = patch({}, ['riscos.1'])
    expect((r.dados.bloco_g_riscos as Array<{ risco: string }>).map((x) => x.risco)).toEqual(['a', 'c'])
  })

  it('remove uma linha do questionário', () => {
    const r = patch({}, ['m2.10'])
    expect(Object.keys(r.dados.m2 as object)).toEqual(['11'])
  })

  it('remoção que não acha nada é RELATADA, não engolida', () => {
    const r = patch({}, ['roteiro_prazo.99', 'm2.44'])
    // A ordem não importa: as remoções de lista são coletadas e aplicadas ao
    // fim, de trás para frente. O que importa é nenhuma sumir.
    expect([...r.remocoesVazias].sort()).toEqual(['m2.44', 'roteiro_prazo.99'])
  })
})

describe('nome de campo errado não vira campo novo', () => {
  it('recusa o desconhecido e diz qual foi', () => {
    // O defeito antigo: "valor_bruto" era gravado, ignorado pelo motor, e o
    // chat respondia que estava feito.
    const r = patch({ valor_bruto: 99999 })
    expect(r.desconhecidos).toEqual(['valor_bruto'])
    expect(r.dados.valor_bruto).toBeUndefined()
    expect(r.dados.bruto_total).toBe(72186.12)
  })

  it('e o campo certo passa normalmente', () => {
    const r = patch({ bruto_total: 80000 })
    expect(r.dados.bruto_total).toBe(80000)
    expect(r.desconhecidos).toEqual([])
  })
})

describe('o questionário mescla, nunca substitui', () => {
  it('mexer numa linha não apaga as outras', () => {
    const r = patch({ m2: { '10': { resposta: 'Não' } } })
    expect(Object.keys(r.dados.m2 as object).sort()).toEqual(['10', '11'])
    expect((r.dados.m2 as Record<string, { resposta: string }>)['10'].resposta).toBe('Não')
  })
})

describe('o relatório do que mudou', () => {
  it('descreve cada alteração, para a resposta poder ser conferida', () => {
    const r = patch({ bruto_total: 80000, roteiro_prazo: { 0: { dias: 45 } } })
    expect(r.mudancas).toHaveLength(2)
    expect(r.mudancas[0]).toMatch(/bruto_total/)
    expect(r.mudancas[1]).toMatch(/roteiro_prazo/)
  })

  it('valor igual ao que já estava não conta como mudança', () => {
    const r = patch({ bruto_total: 72186.12 })
    expect(r.mudancas).toEqual([])
  })

  it('sem nada a fazer, o relatório é vazio — e é isso que denuncia o no-op', () => {
    const r = patch({})
    expect(r.mudancas).toEqual([])
    expect(r.desconhecidos).toEqual([])
  })
})

describe('o questionário inteiro não se apaga por acidente', () => {
  it('"m2" sem índice é RECUSADO, e a recusa é dita', () => {
    // Um pedido como "tira o questionário" quase nunca quer dizer apagar as 29
    // linhas — e o estrago só apareceria na planilha, depois de salva.
    const r = patch({}, ['m2'])
    expect(r.dados.m2).toEqual({ '10': { resposta: 'Sim' }, '11': { resposta: 'Não' } })
    expect(r.remocoesVazias).toContain('m2')
    expect(r.mudancas.join(' ')).toMatch(/NÃO apaguei o m2 inteiro/)
  })

  it('"m2.10" continua apagando UMA linha', () => {
    const r = patch({}, ['m2.10'])
    expect(r.dados.m2).toEqual({ '11': { resposta: 'Não' } })
    expect(r.m2Tocadas).toEqual(['10'])
  })
})

describe('quais linhas do questionário vieram de ordem do chat', () => {
  it('escrever numa linha marca ela', () => {
    const r = patch({ m2: { '10': { resposta: 'Não' } } })
    expect(r.m2Tocadas).toEqual(['10'])
  })

  it('escrever em várias marca todas, sem repetir', () => {
    const r = patch({ m2: { '10': { resposta: 'Não' }, '19': { resposta: 'Procedência' } } }, ['m2.10'])
    expect(r.m2Tocadas.sort()).toEqual(['10', '19'])
  })

  it('pedido que não toca no questionário não marca nada', () => {
    const r = patch({ bruto_total: 80000 })
    expect(r.m2Tocadas).toEqual([])
  })

  // O QUESTIONÁRIO NÃO SE APAGA POR ESCALAR.
  //
  // A guarda existia só no caminho `remover`: `{"m2": null}`, `{"m2": []}` e
  // `{"m2": ""}` em `alteracoes` caíam no ramo escalar e substituíam as 29
  // linhas de uma vez. O estrago só reaparece na planilha, depois de salva.
  it('m2 que não é objeto é recusado, não aplicado', () => {
    const atual = { m2: { '10': { resposta: 'Não' }, '11': { resposta: 'Sim' } } }
    for (const valor of [null, [], "", 0, "x"]) {
      const r = aplicarPatch(atual, { m2: valor }, [], new Set(['m2']), new Set())
      expect(Object.keys(r.dados.m2 as object).sort()).toEqual(['10', '11'])
      expect(r.remocoesVazias).toContain('m2')
      expect(r.mudancas.join(' ')).toMatch(/NÃO apaguei o m2 inteiro/)
    }
  })

  it('m2 objeto continua mesclando linha a linha', () => {
    const atual = { m2: { '10': { resposta: 'Não' }, '11': { resposta: 'Sim' } } }
    const r = aplicarPatch(atual, { m2: { '10': { resposta: 'Sim' } } }, [], new Set(['m2']), new Set())
    expect(r.dados.m2).toEqual({ '10': { resposta: 'Sim' }, '11': { resposta: 'Sim' } })
  })

  // CHAVE VAZIA EDITAVA O ITEM 0: `Number("")` é 0 e passa em isInteger.
  it('chave de lista sem dígito não edita o primeiro item', () => {
    const atual = { riscos: [{ risco: 'a' }, { risco: 'b' }] }
    for (const chave of ["", " ", "x", "-1", "1.5"]) {
      const r = aplicarPatch(atual, { riscos: { [chave]: { risco: 'INVADIU' } } }, [], new Set(['riscos']), new Set(['riscos']))
      expect(r.dados.riscos).toEqual([{ risco: 'a' }, { risco: 'b' }])
    }
  })

  it('índice numérico continua editando por posição', () => {
    const atual = { riscos: [{ risco: 'a' }, { risco: 'b' }] }
    const r = aplicarPatch(atual, { riscos: { '1': { risco: 'c' } } }, [], new Set(['riscos']), new Set(['riscos']))
    expect(r.dados.riscos).toEqual([{ risco: 'a' }, { risco: 'c' }])
  })
})

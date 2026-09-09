import { describe, it, expect } from 'vitest'
import {
  aplicarPatch,
  CAMPOS_LISTA,
  resetarLinhasDeBase,
} from '../../../supabase/functions/_shared/revisao.ts'

/**
 * AS LINHAS DE BASE, e o que acontece quando o chat dita o número.
 *
 * POR QUE ISTO É O CENTRO. O objeto da análise viaja entre as ações — analisar,
 * cada mensagem do chat, reprecificar, salvar — e vários blocos do motor
 * ACRESCENTAM a um campo em vez de recalculá-lo. O IR faltante somava o imposto
 * estimado ao `ir`, e como o objeto volta do navegador com o valor já somado,
 * cada passada somava outra vez: a tela mostra sempre a consolidação, então ela
 * saía com o IR dobrado, e cada frase no chat dobrava mais. Isso esteve em
 * produção.
 *
 * A cura é guardar o valor LIDO e reconstruir a partir dele. Esta função é o par
 * obrigatório disso: sozinha, a linha de base congelaria o número na primeira
 * passada e quem escrevesse "o IR é R$ 5.000" no chat veria o valor voltar ao
 * lido na seguinte.
 */
describe('resetarLinhasDeBase', () => {
  const cheio = () => ({
    ir: 1_500,
    _ir_lido: 1_000,
    principal_liquido: 60_000,
    _liquido_lido: 60_500,
    auditoria_justificativa: 'texto novo',
    _auditoria_justificativa_lida: 'texto lido',
    _honorarios_lido: 8_000,
    auditoria_ir_faltante: [{ base: 5_000, meses: 12 }],
    _sucumbDentroDoBruto: { antes: 72_000, depois: 64_782, sucumbenciais: 7_218 },
    _honorarioEraOPrincipal: 16_778.83,
    _bruto_do_portao: 90_000,
    _bruto_da_segunda_leitura: 84_320.1,
  })

  it('sem nada tocado, nada se move', () => {
    const d = cheio()
    expect(resetarLinhasDeBase(d, [])).toEqual([])
    expect(d).toEqual(cheio())
  })

  // IR DITADO: a base se refaz a partir do que a pessoa escreveu, e a estimativa
  // automática SAI — somar a nossa conta por cima de um número afirmado é cobrar
  // o imposto duas vezes, e desta vez contra quem tem razão.
  it('IR ditado apaga a base e a estimativa, e diz que apagou', () => {
    const d = cheio()
    const m = resetarLinhasDeBase(d, ['ir'])
    expect(d._ir_lido).toBeUndefined()
    expect(d.auditoria_ir_faltante).toBeUndefined()
    expect(m.join(' ')).toMatch(/estimativa automática do imposto foi descartada/)
  })

  it('sem estimativa a relatar, o IR ditado não inventa mudança', () => {
    const d = { ...cheio(), auditoria_ir_faltante: [] }
    expect(resetarLinhasDeBase(d, ['ir'])).toEqual([])
    expect(d._ir_lido).toBeUndefined()
  })

  // BRUTO NOVO: `dados.ir` viaja INFLADO (o lido mais a nossa estimativa), e
  // apagar a base com o campo nesse estado fazia a passada seguinte tomar o
  // valor já somado como se fosse o lido — somando o imposto DE NOVO. Cada
  // correção de bruto no chat acrescentava mais uma vez.
  it('bruto ditado DEVOLVE o IR lido antes de apagar a base', () => {
    const d = cheio()
    resetarLinhasDeBase(d, ['bruto_total'])
    expect(d.ir).toBe(1_000)
    expect(d.principal_liquido).toBe(60_500)
    expect(d._ir_lido).toBeUndefined()
    expect(d._liquido_lido).toBeUndefined()
  })

  it('bruto ditado apaga as origens que já não valem', () => {
    const d = cheio()
    resetarLinhasDeBase(d, ['bruto_total'])
    expect(d._sucumbDentroDoBruto).toBeUndefined()
    expect(d._honorarioEraOPrincipal).toBeUndefined()
    expect(d._bruto_do_portao).toBeUndefined()
    expect(d._bruto_da_segunda_leitura).toBeUndefined()
  })

  // TOCANDO OS DOIS, quem manda é o que a pessoa escreveu no campo: a devolução
  // não pode sobrepor o IR ditado na mesma mensagem.
  it('IR e bruto na mesma mensagem: o IR ditado fica', () => {
    const d = cheio()
    resetarLinhasDeBase(d, ['ir', 'bruto_total'])
    expect(d.ir).toBe(1_500)
    expect(d._ir_lido).toBeUndefined()
  })

  it('líquido ditado na mesma mensagem que o bruto também fica', () => {
    const d = cheio()
    resetarLinhasDeBase(d, ['principal_liquido', 'bruto_total'])
    expect(d.principal_liquido).toBe(60_000)
  })

  it('a justificativa ditada vira a nova base', () => {
    const d = cheio()
    resetarLinhasDeBase(d, ['auditoria_justificativa'])
    expect(d._auditoria_justificativa_lida).toBeUndefined()
  })

  // O HONORÁRIO DITADO DESLIGA O PERCENTUAL DO CARD, e a marca sai quando o chat
  // mexe no próprio percentual — senão não haveria como voltar atrás.
  it('honorário ditado marca e apaga a base; o percentual desmarca', () => {
    const d = cheio()
    resetarLinhasDeBase(d, ['honorarios'])
    expect(d._honorarios_lido).toBeUndefined()
    expect((d as Record<string, unknown>)._honorarios_ditado).toBe(true)
    resetarLinhasDeBase(d, ['honorarios_contratuais_pct'])
    expect((d as Record<string, unknown>)._honorarios_ditado).toBeUndefined()
  })

  // O CONSERVADOR DITADO FICA: o recálculo pelo Banco Central roda em toda
  // passada e gravava por cima — o chat dizia "Aplicado: 61.200 → 58.000" e a
  // tela mostrava 61.200.
  it('conservador ditado marca, e mexer nos itens devolve o automático', () => {
    const d = cheio() as Record<string, unknown>
    const m = resetarLinhasDeBase(d, ['auditoria_bruto_conservador'])
    expect(d._conservador_ditado).toBe(true)
    expect(m.join(' ')).toMatch(/não vai sobrepô-lo/)
    resetarLinhasDeBase(d, ['auditoria_recalculo'])
    expect(d._conservador_ditado).toBeUndefined()
  })

  // TODA LINHA DE BASE TEM QUEM A RESETE. Sem isto, um campo `_*_lido` novo
  // entraria no motor congelando um valor que o chat não consegue mais corrigir
  // — que é o defeito que esta função existe para não deixar voltar.
  it('nenhuma linha de base fica sem campo que a refaça', () => {
    const bases = Object.keys(cheio()).filter((k) => /^_.*_lid[oa]$/.test(k))
    expect(bases.sort()).toEqual([
      '_auditoria_justificativa_lida', '_honorarios_lido', '_ir_lido', '_liquido_lido',
    ])
    const campos = ['ir', 'principal_liquido', 'auditoria_justificativa', 'honorarios']
    for (const campo of campos) {
      const d = cheio() as Record<string, unknown>
      resetarLinhasDeBase(d, [campo])
      expect(bases.some((b) => d[b] === undefined)).toBe(true)
    }
  })
})

/**
 * AS LISTAS DE PRODUÇÃO, e não uma cópia no teste.
 *
 * O teste do patch definia o próprio conjunto — que já havia divergido do
 * handler: `auditoria_confronto`, `auditoria_recalculo`, `auditoria_ir_faltante`
 * e `notas_celulas` são listas em produção e não tinham um caso escrito. Campo
 * de lista que o patch não reconhece é SUBSTITUÍDO inteiro quando a IA manda uma
 * linha só.
 */
describe('CAMPOS_LISTA', () => {
  const CAMPOS = new Set([...CAMPOS_LISTA, 'bruto_total', 'm2'])

  it('as sete listas do motor estão declaradas', () => {
    expect([...CAMPOS_LISTA].sort()).toEqual([
      'auditoria_confronto',
      'auditoria_divergencias',
      'auditoria_ir_faltante',
      'auditoria_recalculo',
      'bloco_g_riscos',
      'notas_celulas',
      'roteiro_prazo',
    ])
  })

  // O CAMINHO QUE MOTIVOU O ACHADO: "o período de apuração é 01/2015 a 12/2021"
  // patcha `auditoria_ir_faltante[0]`. Sem o campo declarado como lista, a
  // edição de um item apagaria os outros.
  it('editar um item de cada lista preserva os demais', () => {
    for (const campo of CAMPOS_LISTA) {
      const atual = { [campo]: [{ a: 1 }, { a: 2 }, { a: 3 }] }
      const r = aplicarPatch(atual, { [campo]: { 1: { a: 9 } } }, [], CAMPOS, CAMPOS_LISTA)
      expect(r.dados[campo]).toEqual([{ a: 1 }, { a: 9 }, { a: 3 }])
    }
  })

  it('remover por caminho funciona em todas elas', () => {
    for (const campo of CAMPOS_LISTA) {
      const atual = { [campo]: [{ a: 1 }, { a: 2 }] }
      const r = aplicarPatch(atual, {}, [`${campo}.0`], CAMPOS, CAMPOS_LISTA)
      expect(r.dados[campo]).toEqual([{ a: 2 }])
    }
  })
})

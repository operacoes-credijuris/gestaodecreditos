/**
 * A TROCA PARA O OPUS 5.5 (05/10/2026): "tudo o que for Opus 5 ou versão
 * anterior, mude para 5.5". O que o 5.5 recusa ou devolve diferente — e o que
 * aqui segura cada coisa:
 *
 *   - raciocínio sempre ligado: a resposta começa por blocos `thinking`
 *     (`textoDaResposta`, e nenhum `content[0]` no código);
 *   - ferramenta forçada dá 400: a extração do crédito virou saída estruturada
 *     (`ESQUEMA_DA_EXTRACAO` cabe no subconjunto aceito) e a da RPV conferência
 *     com segunda volta (`pedidoParaChamarAFerramenta`);
 *   - esforço padrão caiu para 'medium': todo pedido declara o seu
 *     (`PedidoAoOpus`, conferido pelo compilador);
 *   - o Opus guardado no navegador antes da troca vira o 5.5
 *     (`modeloVigente`).
 *
 * Nada aqui chama a Anthropic.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import {
  chamadaDaFerramenta,
  ESFORCO_PADRAO_DO_OPUS,
  lerSaidaEstruturada,
  pedidoParaChamarAFerramenta,
  semCercaDeMarkdown,
  textoDaResposta,
  type BlocoDaResposta,
  type NoFormatoDoOpus,
  type PedidoAoOpus,
} from '../../../supabase/functions/_shared/respostaDoClaude.ts'
import {
  MODELO_PADRAO_DO_ASSISTENTE,
  MODELOS_DO_ASSISTENTE,
  modeloVigente,
  OPUS_VIGENTE,
  resolverModeloDoAssistente,
} from '../../../supabase/functions/_shared/modeloDoAssistente.ts'
import {
  CAMPOS_DO_CREDITO,
  CHAVES_DO_CREDITO,
  ESQUEMA_DA_EXTRACAO,
  saidaDaExtracao,
} from '../../../supabase/functions/_shared/extracaoDoCredito.ts'

/** Uma resposta do 5.5 como ela chega: raciocínio (vazio, por padrão) antes do texto. */
const PENSAMENTO: BlocoDaResposta = { type: 'thinking', thinking: '', signature: 'abc' } as BlocoDaResposta

describe('a leitura da resposta ignora o raciocínio', () => {
  it('junta só os blocos de texto, mesmo com o raciocínio na frente', () => {
    const content = [PENSAMENTO, { type: 'text', text: '{"a":' }, PENSAMENTO, { type: 'text', text: '1}' }]
    expect(textoDaResposta(content)).toBe('{"a":1}')
    expect(textoDaResposta(content, '\n')).toBe('{"a":\n1}')
  })

  it('sem texto nenhum, devolve vazio (e não o raciocínio)', () => {
    expect(textoDaResposta([PENSAMENTO])).toBe('')
    expect(textoDaResposta([{ type: 'thinking', thinking: 'pensei' } as BlocoDaResposta])).toBe('')
    expect(textoDaResposta(null)).toBe('')
    expect(textoDaResposta(undefined)).toBe('')
  })

  it('tira a cerca de markdown do JSON', () => {
    expect(semCercaDeMarkdown('```json\n{"a":1}\n```')).toBe('{"a":1}')
  })
})

describe('a ferramenta em auto é conferida', () => {
  const chamada = { type: 'tool_use', id: 'tu_1', name: 'registrar_valores', input: { bruto_total: 10 } }

  it('acha a ferramenta pelo nome, depois do raciocínio', () => {
    expect(chamadaDaFerramenta([PENSAMENTO, chamada], 'registrar_valores')).toEqual({ bruto_total: 10 })
  })

  it('outra ferramenta, ou nenhuma, é null', () => {
    expect(chamadaDaFerramenta([PENSAMENTO, chamada], 'registrar_documento')).toBeNull()
    expect(chamadaDaFerramenta([PENSAMENTO, { type: 'text', text: 'oi' }], 'registrar_valores')).toBeNull()
    expect(chamadaDaFerramenta([{ ...chamada, input: [1] }], 'registrar_valores')).toBeNull()
  })

  it('a segunda volta devolve a resposta INTACTA e pede a ferramenta pelo nome', () => {
    const content = [PENSAMENTO, { type: 'text', text: 'Vou ler os valores.' }]
    const [assistente, usuario] = pedidoParaChamarAFerramenta(content, 'registrar_valores')
    expect(assistente.role).toBe('assistant')
    // Os mesmos blocos, na mesma ordem: bloco de raciocínio editado ou tirado é 400.
    expect(assistente.content).toEqual(content)
    expect(assistente.content[0]).toBe(PENSAMENTO)
    expect(usuario.role).toBe('user')
    expect(usuario.content).toHaveLength(1)
    expect(JSON.stringify(usuario.content)).toContain('registrar_valores')
  })

  it('a ferramenta errada recebe um tool_result de erro antes do pedido', () => {
    const errada = { type: 'tool_use', id: 'tu_9', name: 'registrar_documento', input: {} }
    const [, usuario] = pedidoParaChamarAFerramenta([PENSAMENTO, errada], 'registrar_valores')
    const [resultado, texto] = usuario.content as Record<string, unknown>[]
    expect(resultado).toMatchObject({ type: 'tool_result', tool_use_id: 'tu_9', is_error: true })
    expect(texto).toMatchObject({ type: 'text' })
  })
})

describe('a saída estruturada é lida com as duas exceções da garantia', () => {
  it('lê o JSON do bloco de texto, depois do raciocínio', () => {
    const r = lerSaidaEstruturada<{ a: number }>({
      stop_reason: 'end_turn',
      content: [PENSAMENTO, { type: 'text', text: '{"a":1}' }],
    })
    expect(r).toEqual({ ok: true, valor: { a: 1 } })
  })

  it('recusa e corte não viram JSON, mesmo que o texto pareça um', () => {
    const texto = [{ type: 'text', text: '{"a":1}' }]
    expect(lerSaidaEstruturada({ stop_reason: 'refusal', content: texto })).toMatchObject({ ok: false, motivo: 'recusa' })
    expect(lerSaidaEstruturada({ stop_reason: 'max_tokens', content: texto })).toMatchObject({ ok: false, motivo: 'cortada' })
  })

  it('vazio e inválido têm motivo próprio', () => {
    expect(lerSaidaEstruturada({ stop_reason: 'end_turn', content: [PENSAMENTO] })).toMatchObject({ ok: false, motivo: 'vazia' })
    expect(lerSaidaEstruturada({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{"a":' }] })).toMatchObject({
      ok: false,
      motivo: 'invalida',
    })
  })
})

describe('o esquema da extração do crédito cabe na saída estruturada', () => {
  type No = Record<string, unknown>
  /** Todos os nós de esquema, com o caminho — para dizer onde está o problema. */
  const nos = (no: unknown, caminho = '$'): [string, No][] => {
    if (!no || typeof no !== 'object') return []
    const n = no as No
    const filhos: [string, No][] = []
    for (const [k, v] of Object.entries((n.properties ?? {}) as No)) filhos.push(...nos(v, `${caminho}.${k}`))
    if (n.items) filhos.push(...nos(n.items, `${caminho}[]`))
    for (const alt of ((n.anyOf ?? []) as unknown[])) filhos.push(...nos(alt, `${caminho}|`))
    return [[caminho, n], ...filhos]
  }
  const todos = nos(ESQUEMA_DA_EXTRACAO)

  it('todo objeto fecha as chaves (additionalProperties: false)', () => {
    const abertos = todos.filter(([, n]) => n.type === 'object' && n.additionalProperties !== false).map(([c]) => c)
    expect(abertos).toEqual([])
  })

  it('nenhuma restrição fora do subconjunto (maxItems, minLength, minimum…)', () => {
    const proibidas = ['maxItems', 'minLength', 'maxLength', 'minimum', 'maximum', 'multipleOf', 'exclusiveMinimum', 'exclusiveMaximum']
    const achadas = todos.flatMap(([c, n]) => proibidas.filter((p) => p in n).map((p) => `${c}.${p}`))
    expect(achadas).toEqual([])
    const minItems = todos.filter(([, n]) => 'minItems' in n && n.minItems !== 0 && n.minItems !== 1)
    expect(minItems).toEqual([])
  })

  it('no máximo 16 campos com tipo em união, e nenhum opcional', () => {
    const unioes = todos.filter(([, n]) => Array.isArray(n.type) || Array.isArray(n.anyOf))
    expect(unioes.length).toBeLessThanOrEqual(16)
    // Todo objeto exige todas as suas chaves: opcional custa (limite de 24) e
    // aqui "não achou" é null, não ausência.
    for (const [c, n] of todos.filter(([, n]) => n.type === 'object')) {
      expect([c, [...((n.required ?? []) as string[])].sort()]).toEqual([c, Object.keys((n.properties ?? {}) as No).sort()])
    }
  })

  it('a procedência aponta só para campos que existem', () => {
    expect(CHAVES_DO_CREDITO).toEqual([...Object.keys(CAMPOS_DO_CREDITO), 'tipo_credito', 'instrumento', 'indice_atualizacao'])
    const campo = ESQUEMA_DA_EXTRACAO.properties.procedencia.items.properties.campo
    expect(campo.enum).toEqual([...CHAVES_DO_CREDITO])
  })
})

describe('a resposta da extração chega à tela no formato de sempre', () => {
  it('a procedência volta a ser {campo: arquivo}', () => {
    const s = saidaDaExtracao({
      campos: { tribunal: 'TJGO', valor_face: 1000 },
      procedencia: [
        { campo: 'tribunal', arquivo: 'analise.xlsx' },
        { campo: 'valor_face', arquivo: 'oficio.pdf' },
      ],
      observacoes: ['Capital = 90.000 de preço + 4.500 de comissão'],
    })
    expect(s).toEqual({
      campos: { tribunal: 'TJGO', valor_face: 1000 },
      procedencia: { tribunal: 'analise.xlsx', valor_face: 'oficio.pdf' },
      observacoes: ['Capital = 90.000 de preço + 4.500 de comissão'],
    })
  })

  it('o mesmo campo duas vezes soma os arquivos, como o valor composto', () => {
    const s = saidaDaExtracao({
      campos: {},
      procedencia: [
        { campo: 'capital_investido', arquivo: 'contrato.pdf' },
        { campo: 'capital_investido', arquivo: 'comprovante.pdf' },
      ],
      observacoes: [],
    })
    expect(s.procedencia).toEqual({ capital_investido: 'contrato.pdf + comprovante.pdf' })
  })

  it('lixo não derruba: volta vazio', () => {
    expect(saidaDaExtracao(null)).toEqual({ campos: {}, procedencia: {}, observacoes: [] })
    expect(saidaDaExtracao({ campos: [], procedencia: {}, observacoes: [1, 'a'] })).toEqual({
      campos: {},
      procedencia: {},
      observacoes: ['a'],
    })
  })
})

describe('o Opus do assistente é o 5.5', () => {
  it('o Opus 5 guardado antes da troca vira o 5.5, e os anteriores também', () => {
    expect(OPUS_VIGENTE).toBe('claude-opus-5-5')
    expect(modeloVigente('claude-opus-5')).toBe('claude-opus-5-5')
    expect(modeloVigente('claude-opus-4-8')).toBe('claude-opus-5-5')
    expect(modeloVigente('claude-opus-5-5')).toBe('claude-opus-5-5')
  })

  it('Sonnet e Haiku passam como estão: a troca foi só do Opus', () => {
    expect(modeloVigente('claude-sonnet-5')).toBe('claude-sonnet-5')
    expect(modeloVigente('claude-haiku-4-5-20251001')).toBe('claude-haiku-4-5-20251001')
  })

  it('o servidor aceita só a lista; o resto cai no padrão', () => {
    expect(resolverModeloDoAssistente('claude-opus-5')).toBe('claude-opus-5-5')
    expect(resolverModeloDoAssistente('claude-sonnet-5')).toBe('claude-sonnet-5')
    expect(resolverModeloDoAssistente('gpt-qualquer')).toBe(MODELO_PADRAO_DO_ASSISTENTE)
    expect(resolverModeloDoAssistente(undefined)).toBe(MODELO_PADRAO_DO_ASSISTENTE)
    expect(resolverModeloDoAssistente(42)).toBe(MODELO_PADRAO_DO_ASSISTENTE)
  })

  it('o seletor tem um Opus só, o vigente, e o padrão está na lista', () => {
    const opus = MODELOS_DO_ASSISTENTE.filter((m) => m.key.startsWith('claude-opus-'))
    expect(opus).toEqual([{ key: OPUS_VIGENTE, label: 'Opus' }])
    expect(MODELOS_DO_ASSISTENTE.some((m) => m.key === MODELO_PADRAO_DO_ASSISTENTE)).toBe(true)
  })
})

describe('o pedido ao Opus 5.5, conferido pelo compilador', () => {
  // Estes casos valem no `tsc --noEmit`: cada `@ts-expect-error` FALHA a
  // checagem se a linha de baixo passar a compilar — isto é, se o tipo deixar
  // de recusar o que o 5.5 recusa.
  const base = { model: OPUS_VIGENTE, max_tokens: 1000, output_config: { effort: ESFORCO_PADRAO_DO_OPUS } }

  it('aceita o que o 5.5 aceita', () => {
    const pedidos: PedidoAoOpus[] = [
      base,
      { ...base, thinking: { type: 'adaptive' } },
      { ...base, thinking: { type: 'adaptive', display: 'summarized' } },
      { ...base, tool_choice: { type: 'auto', disable_parallel_tool_use: true } },
      { ...base, tool_choice: { type: 'none' } },
      { ...base, output_config: { effort: 'low', format: { type: 'json_schema', schema: {} } } },
      { ...base, system: 'x', messages: [], tools: [] },
    ]
    expect(pedidos).toHaveLength(7)
    expect(ESFORCO_PADRAO_DO_OPUS).toBe('high')
  })

  it('recusa o que o 5.5 recusa', () => {
    const recusados = [
      // @ts-expect-error — raciocínio desligado: 400 no 5.5
      { ...base, thinking: { type: 'disabled' } } satisfies PedidoAoOpus,
      // @ts-expect-error — orçamento de raciocínio: 400 no 5.5
      { ...base, thinking: { type: 'enabled', budget_tokens: 2000 } } satisfies PedidoAoOpus,
      // @ts-expect-error — ferramenta forçada: 400 no 5.5
      { ...base, tool_choice: { type: 'tool', name: 'x' } } satisfies PedidoAoOpus,
      // @ts-expect-error — ferramenta forçada: 400 no 5.5
      { ...base, tool_choice: { type: 'any' } } satisfies PedidoAoOpus,
      // @ts-expect-error — temperatura fora do padrão: 400
      { ...base, temperature: 0 } satisfies PedidoAoOpus,
      // @ts-expect-error — top_p: 400
      { ...base, top_p: 0.9 } satisfies PedidoAoOpus,
      // @ts-expect-error — sem esforço: rodaria em 'medium' sem ninguém decidir
      { model: OPUS_VIGENTE, max_tokens: 1000 } satisfies PedidoAoOpus,
      // @ts-expect-error — esforço que não existe
      { ...base, output_config: { effort: 'altissimo' } } satisfies PedidoAoOpus,
    ]
    expect(recusados).toHaveLength(8)
  })

  it('pelo SDK, as regras valem junto com o tipo do SDK', () => {
    // Um tipo de SDK de mentira, com o mesmo jeito do verdadeiro: o literal
    // 'text' tem de sobreviver, e a temperatura que o SDK aceita, não.
    type ParametrosDoSdk = { model: string; max_tokens: number; system?: { type: 'text'; text: string }[]; temperature?: number }
    const ok = { ...base, system: [{ type: 'text', text: 'x' }] } satisfies NoFormatoDoOpus<ParametrosDoSdk>
    // @ts-expect-error — o SDK aceita temperatura; o 5.5 não
    const recusado = { ...base, temperature: 0.2 } satisfies NoFormatoDoOpus<ParametrosDoSdk>
    expect([ok, recusado]).toHaveLength(2)
  })
})

describe('nenhuma chamada ao Opus fica no formato antigo (varredura dos fontes)', () => {
  const RAIZ = join(__dirname, '..', '..', '..')
  const FUNCOES = join(RAIZ, 'supabase', 'functions')
  const arquivos = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const p = join(dir, n)
      return statSync(p).isDirectory() ? arquivos(p) : /\.tsx?$/.test(n) ? [p] : []
    })
  /** O código sem comentários: eles citam os padrões antigos para explicar a troca. */
  const semComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  const todos = [...arquivos(FUNCOES), ...arquivos(join(RAIZ, 'src')).filter((p) => !p.includes('__tests__'))]
  const fonte = (p: string) => semComentarios(readFileSync(p, 'utf8'))

  /** As que chamam o Opus pelo nome — e não os dois módulos que só o descrevem. */
  const DESCRITIVOS = ['modeloDoAssistente.ts', 'respostaDoClaude.ts']
  const doOpus = arquivos(FUNCOES).filter((p) => {
    if (DESCRITIVOS.some((d) => p.endsWith(d))) return false
    const s = fonte(p)
    return s.includes(`'${OPUS_VIGENTE}'`) || s.includes(`"${OPUS_VIGENTE}"`)
  })

  it('acha as chamadas (senão a varredura não está varrendo nada)', () => {
    expect(doOpus.length).toBeGreaterThanOrEqual(12)
  })

  it('nenhum Opus anterior ao 5.5 sobrou no código', () => {
    const antigos = todos.flatMap((p) =>
      [...fonte(p).matchAll(/claude-opus-\d[\w-]*/g)]
        .map((m) => m[0])
        .filter((id) => id !== OPUS_VIGENTE)
        .map((id) => `${relative(RAIZ, p)}: ${id}`),
    )
    expect(antigos).toEqual([])
  })

  it('nada que o 5.5 recusa, e nada lido pela posição do bloco', () => {
    const PROIBIDOS: [string, RegExp][] = [
      ['ferramenta forçada', /tool_choice:\s*\{\s*type:\s*['"](tool|any)['"]/],
      ['raciocínio desligado ou com orçamento', /thinking:\s*\{\s*type:\s*['"](disabled|enabled)['"]|budget_tokens/],
      ['amostragem', /\b(temperature|top_p|top_k)\s*:/],
      ['texto pela posição', /content\??\.?\[\s*0\s*\]/],
    ]
    const achados = doOpus.flatMap((p) =>
      PROIBIDOS.filter(([, re]) => re.test(fonte(p))).map(([nome]) => `${relative(RAIZ, p)}: ${nome}`),
    )
    expect(achados).toEqual([])
  })

  it('toda chamada ao Opus passa pelo tipo que exige o esforço', () => {
    const semTipo = doOpus.flatMap((p) => {
      const s = fonte(p)
      const chamadas = [...s.matchAll(/\bmodel:\s*(MODELO|CLAUDE_MODEL)\b/g)].length
      const conferidas = [...s.matchAll(/satisfies\s+(PedidoAoOpus\b|NoFormatoDoOpus<)/g)].length
      return chamadas === conferidas ? [] : [`${relative(RAIZ, p)}: ${chamadas} chamadas, ${conferidas} conferidas`]
    })
    expect(semTipo).toEqual([])
  })
})

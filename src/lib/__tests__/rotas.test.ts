// Teste de caracterização dos endereços (etapa 0A do redesenho).
//
// Prende o que existe HOJE: cada um dos 19 endereços abre a mesma tela, atrás
// do mesmo guarda, ou redireciona para o mesmo lugar. O redesenho mexe no menu,
// no layout e nas telas; nada disso pode, sem querer, mandar alguém para outra
// tela, abrir Configurações para quem não é administrador ou matar um link
// salvo em favorito.
//
// São três camadas, e cada uma pega um erro diferente:
//   1. a tabela `HOJE`, congelada aqui, contra a lista `ROTAS` passada pelo
//      `matchRoutes` do react-router (o mesmo casamento que o App usa);
//   2. a lista `ROTAS` contra o `App.tsx` lido como TEXTO, nos dois sentidos —
//      o App não lê a lista (ver o porquê em `rotas.ts`), então é isto que
//      impede os dois de divergirem;
//   3. os redirecionamentos terminam numa tela de verdade.
//
// Mudar uma rota DE PROPÓSITO é atualizar App, `rotas.ts` e a tabela abaixo,
// e dizer no commit por quê.
//
// ETAPA 3 (o Quadro numa moldura com abas): mudaram DE PROPÓSITO o espelho do
// App (`objetosDeRota`, agora com a rota-mãe da moldura) e o leitor do App (que
// passa a aceitar a moldura como rota-mãe). A tabela `HOJE` NÃO mudou: os 19
// endereços levam à mesma tela, com o mesmo guarda. A moldura em volta das
// cinco telas do Quadro é conferida à parte, no fim do arquivo.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { matchRoutes, type RouteObject } from 'react-router-dom'
import {
  MOLDURAS, ROTAS, type Guarda, type Moldura, type Rota, type Tela,
} from '@/components/layout/rotas'
import { ABAS_DO_QUADRO, INICIO } from '@/components/layout/navigation'

// ─── 1. A tabela de hoje ────────────────────────────────────────────────────

type Destino = { tela: Tela } | { redireciona: string }

/**
 * O comportamento de 02/10/2026, escrito à mão de propósito: NÃO é derivado de
 * `ROTAS`, senão um erro na lista passaria por certo.
 */
const HOJE: ReadonlyArray<{ endereco: string; guarda: Guarda } & Destino> = [
  { endereco: '/login', guarda: 'nenhuma', tela: 'Login' },
  { endereco: '/', guarda: 'sessao', redireciona: '/operacional/analise' },
  { endereco: '/estrategica', guarda: 'sessao', redireciona: '/operacional/analise' },
  { endereco: '/inteligencia', guarda: 'sessao', tela: 'inteligencia/VisaoGeral' },
  { endereco: '/inteligencia/performance', guarda: 'sessao', tela: 'inteligencia/Performance' },
  { endereco: '/inteligencia/previsoes', guarda: 'sessao', tela: 'inteligencia/Previsoes' },
  { endereco: '/inteligencia/recortes', guarda: 'sessao', tela: 'inteligencia/Recortes' },
  { endereco: '/inteligencia/carteiras', guarda: 'sessao', tela: 'comercial/CarteirasInvestidores' },
  { endereco: '/comercial/contratos', guarda: 'sessao', tela: 'comercial/GeracaoContratos' },
  { endereco: '/comercial/carteiras', guarda: 'sessao', redireciona: '/inteligencia/carteiras' },
  { endereco: '/comercial/dados-pessoais', guarda: 'sessao', tela: 'comercial/DadosPessoaisBancarios' },
  { endereco: '/operacional/analise', guarda: 'sessao', tela: 'operacional/AnaliseCredito' },
  {
    endereco: '/operacional/execucao/publicacoes',
    guarda: 'sessao',
    tela: 'operacional/execucao/PublicacoesMovimentacoes',
  },
  { endereco: '/operacional/execucao/tarefas', guarda: 'sessao', tela: 'operacional/execucao/TarefasAdvbox' },
  { endereco: '/operacional/execucao/processos', guarda: 'sessao', tela: 'operacional/execucao/Processos' },
  {
    endereco: '/operacional/execucao/requerimentos',
    guarda: 'sessao',
    tela: 'operacional/execucao/Requerimentos',
  },
  {
    endereco: '/operacional/execucao/contatos',
    guarda: 'sessao',
    tela: 'operacional/execucao/ContatosServentias',
  },
  { endereco: '/configuracoes', guarda: 'admin', tela: 'configuracoes/Configuracoes' },
  // O 19º: qualquer endereço desconhecido cai na rota `*`.
  { endereco: '/um-endereco-que-nao-existe', guarda: 'sessao', tela: 'NotFound' },
]

/**
 * A lista no formato do react-router, com o MESMO aninhamento do App: o login
 * solto e todo o resto como filho de uma rota-mãe sem caminho (a do
 * `ProtectedRoute` + `AppLayout`). A raiz é a `index` dessa mãe.
 *
 * MUDOU DE PROPÓSITO NA ETAPA 3: as rotas com `moldura` vão para dentro de uma
 * segunda rota-mãe, com o caminho da moldura (`MOLDURAS`), como no App — a
 * primeira tela como `index` dela e as outras com o caminho relativo. Assim o
 * casamento abaixo passa pelo mesmo aninhamento que o App monta, e não por uma
 * lista plana que o App deixou de ter.
 */
function objetosDeRota(rotas: readonly Rota[]): RouteObject[] {
  const folha = (r: Rota): RouteObject =>
    r.caminho === '/' ? { index: true, handle: r } : { path: r.caminho, handle: r }
  const filhaDaMoldura = (base: string) => (r: Rota): RouteObject => {
    if (r.caminho === base) return { index: true, handle: r }
    if (!r.caminho.startsWith(`${base}/`)) {
      throw new Error(`rotas.ts: ${r.caminho} está na moldura de ${base}, mas fora do caminho dela`)
    }
    return { path: r.caminho.slice(base.length + 1), handle: r }
  }
  const molduras = Object.entries(MOLDURAS) as Array<[Moldura, string]>
  const doLayout = rotas.filter((r) => r.guarda !== 'nenhuma')
  return [
    ...rotas.filter((r) => r.guarda === 'nenhuma').map(folha),
    {
      children: [
        ...doLayout.filter((r) => !r.moldura).map(folha),
        ...molduras.map(([moldura, base]): RouteObject => ({
          path: base,
          handle: { mae: moldura },
          children: doLayout.filter((r) => r.moldura === moldura).map(filhaDaMoldura(base)),
        })),
      ],
    },
  ]
}

const OBJETOS = objetosDeRota(ROTAS)

/** A rota que o react-router escolhe para o endereço (a folha do casamento). */
function resolver(endereco: string): Rota | undefined {
  const casou = matchRoutes(OBJETOS, endereco)
  return casou?.[casou.length - 1]?.route.handle as Rota | undefined
}

/** A moldura que o react-router desenha em volta da tela do endereço, se há. */
function molduraEm(endereco: string): Moldura | undefined {
  const casou = matchRoutes(OBJETOS, endereco) ?? []
  return casou
    .map((c) => (c.route.handle as { mae?: Moldura } | undefined)?.mae)
    .find((m) => m !== undefined)
}

/** O que a pessoa vê: a tela ou o redirecionamento, e o guarda. */
function oQueAbre(r: Rota | undefined) {
  if (!r) return undefined
  return r.tela !== undefined
    ? { guarda: r.guarda, tela: r.tela }
    : { guarda: r.guarda, redireciona: r.redireciona }
}

describe('rotas: os 19 endereços de hoje', () => {
  it('a tabela tem os 19, sem repetir', () => {
    expect(HOJE).toHaveLength(19)
    expect(new Set(HOJE.map((h) => h.endereco)).size).toBe(19)
    expect(ROTAS).toHaveLength(19)
    expect(new Set(ROTAS.map((r) => r.caminho)).size).toBe(19)
  })

  it.each(HOJE)('$endereco abre o mesmo de hoje', ({ endereco, ...esperado }) => {
    expect(oQueAbre(resolver(endereco))).toEqual(esperado)
  })

  it('só o login é aberto sem sessão; só Configurações pede administrador', () => {
    expect(ROTAS.filter((r) => r.guarda === 'nenhuma').map((r) => r.caminho)).toEqual(['/login'])
    expect(ROTAS.filter((r) => r.guarda === 'admin').map((r) => r.caminho)).toEqual(['/configuracoes'])
  })

  it('casa como o react-router casa hoje: barra no fim, maiúsculas e subcaminho', () => {
    // Comportamento do react-router v6 que os links salvos já usam. Se alguém
    // ligar `caseSensitive` ou trocar uma rota por outra com `/*`, estes mudam.
    expect(oQueAbre(resolver('/operacional/analise/'))).toEqual({
      guarda: 'sessao', tela: 'operacional/AnaliseCredito',
    })
    expect(oQueAbre(resolver('/Operacional/Analise'))).toEqual({
      guarda: 'sessao', tela: 'operacional/AnaliseCredito',
    })
    // Subcaminho de tela existente NÃO abre a tela: vai à 404, com sessão.
    for (const e of ['/inteligencia/recortes/x', '/configuracoes/usuarios', '/login/x']) {
      expect(oQueAbre(resolver(e)), e).toEqual({ guarda: 'sessao', tela: 'NotFound' })
    }
  })
})

describe('rotas: redirecionamentos', () => {
  it('todo redirecionamento termina numa tela, sem passar por outro nem pela 404', () => {
    const redirecionamentos = ROTAS.filter((r) => r.redireciona !== undefined)
    expect(redirecionamentos.map((r) => r.caminho)).toEqual([
      '/', '/estrategica', '/comercial/carteiras',
    ])
    for (const r of redirecionamentos) {
      const destino = resolver(r.redireciona!)
      expect(destino?.tela, r.caminho).toBeDefined()
      expect(destino?.tela, r.caminho).not.toBe('NotFound')
    }
  })

  it('o início é a Análise de Crédito', () => {
    // `INICIO` também é para onde o `AdminRoute` manda quem não é admin e
    // para onde o login leva quando não havia endereço pedido.
    expect(INICIO).toBe('/operacional/analise')
    expect(resolver(INICIO)?.tela).toBe('operacional/AnaliseCredito')
  })
})

// ─── 2. A lista contra o App.tsx ────────────────────────────────────────────
//
// Um leitor mínimo de JSX, só para o formato que o App usa. É ESTRITO: rota
// com atributo desconhecido (`caseSensitive`, `loader`…), elemento em forma
// nova ou rota-mãe que não seja a do layout nem uma moldura conhecida
// (`MOLDURAS`, no caminho dela) faz o teste falhar com o motivo, em vez de ser
// ignorada. Melhor um alarme a mais que uma rota fora da conta.

const APP = readFileSync(fileURLToPath(new URL('../../App.tsx', import.meta.url)), 'utf-8')

/** Índice logo depois da chave que fecha a que abre em `i`. */
function fimDasChaves(s: string, i: number): number {
  let profundidade = 0
  for (let j = i; j < s.length; j++) {
    if (s[j] === '{') profundidade++
    else if (s[j] === '}' && --profundidade === 0) return j + 1
  }
  throw new Error('App.tsx: chave sem par')
}

/** Lê os atributos de uma tag `<Route`, a partir de logo depois do nome. */
function lerTag(s: string, i: number) {
  const atributos = new Map<string, string | true>()
  let j = i
  for (;;) {
    while (j < s.length && /\s/.test(s[j])) j++
    if (s.startsWith('/>', j)) return { atributos, fechaSozinha: true, fim: j + 2 }
    if (s[j] === '>') return { atributos, fechaSozinha: false, fim: j + 1 }
    const nome = /^[A-Za-z]+/.exec(s.slice(j))?.[0]
    if (!nome) throw new Error(`App.tsx: atributo ilegível em "${s.slice(j, j + 40)}"`)
    j += nome.length
    if (s[j] !== '=') {
      atributos.set(nome, true)
      continue
    }
    j++
    if (s[j] === '"') {
      const fim = s.indexOf('"', j + 1)
      atributos.set(nome, s.slice(j + 1, fim))
      j = fim + 1
    } else if (s[j] === '{') {
      const fim = fimDasChaves(s, j)
      atributos.set(nome, s.slice(j + 1, fim - 1))
      j = fim
    } else {
      throw new Error(`App.tsx: valor ilegível no atributo ${nome}`)
    }
  }
}

/** JSX sem as quebras de linha e espaços que a formatação põe ou tira. */
function normalizar(jsx: string): string {
  return jsx
    .replace(/\s+/g, ' ')
    .replace(/\s*(\/?>)/g, '$1')
    .replace(/>\s+</g, '><')
    .trim()
}

const LAYOUT = '<ProtectedRoute><AppLayout/></ProtectedRoute>'
const ATRIBUTOS_CONHECIDOS = ['path', 'index', 'element']

/** As rotas do App.tsx, no formato de `ROTAS`. */
function rotasDoApp(fonte: string): Rota[] {
  // Comentários de JSX citam caminhos ("/login", "*") e não são rota.
  const s = fonte.replace(/\{\/\*[\s\S]*?\*\/\}/g, '')

  // Componente → módulo em src/pages, pelos imports.
  const modulos = new Map<string, string>()
  for (const m of s.matchAll(/^import (\w+) from '@\/pages\/([^']+)'/gm)) modulos.set(m[1], m[2])
  const moduloDe = (componente: string): string => {
    const modulo = modulos.get(componente)
    if (!modulo) throw new Error(`App.tsx: <${componente} /> não vem de um import de @/pages`)
    return modulo
  }
  const telaDe = (componente: string): Tela => moduloDe(componente) as Tela
  const ehMoldura = (modulo: string): modulo is Moldura =>
    Object.prototype.hasOwnProperty.call(MOLDURAS, modulo)

  const pilha: Array<{ caminho: string; guarda: Guarda; moldura?: Moldura }> = [
    { caminho: '', guarda: 'nenhuma' },
  ]
  const rotas: Rota[] = []
  // `(?=[\s/>])`: não confundir com `<Routes>`.
  const marca = /<Route(?=[\s/>])|<\/Route>/g
  let m: RegExpExecArray | null
  while ((m = marca.exec(s))) {
    if (m[0] === '</Route>') {
      pilha.pop()
      continue
    }
    const tag = lerTag(s, m.index + '<Route'.length)
    marca.lastIndex = tag.fim
    const pai = pilha[pilha.length - 1]

    const estranhos = [...tag.atributos.keys()].filter((a) => !ATRIBUTOS_CONHECIDOS.includes(a))
    if (estranhos.length) throw new Error(`App.tsx: atributo novo em <Route>: ${estranhos.join(', ')}`)
    const elemento = normalizar(String(tag.atributos.get('element') ?? ''))
    const path = tag.atributos.get('path')

    // O caminho inteiro: absoluto como está, ou relativo à rota-mãe.
    const caminhoDe = (p: string) => (p.startsWith('/') || !pai.caminho ? p : `${pai.caminho}/${p}`)

    if (!tag.fechaSozinha) {
      // Rota-mãe. São dois tipos, e só eles: a do layout, sem caminho...
      if (elemento === LAYOUT && path === undefined && !tag.atributos.has('index')) {
        pilha.push({ caminho: pai.caminho, guarda: 'sessao' })
        continue
      }
      // ...e, dentro do layout, uma MOLDURA (etapa 3): caminho próprio e, como
      // elemento, o módulo de uma moldura conhecida, no caminho que `MOLDURAS`
      // diz. As filhas herdam o guarda do layout e ganham a moldura.
      const x = /^<(\w+)\/>$/.exec(elemento)
      const modulo = x && x[1] !== 'Navigate' ? moduloDe(x[1]) : null
      if (
        modulo && ehMoldura(modulo) && typeof path === 'string' &&
        pai.guarda === 'sessao' && !pai.moldura && !tag.atributos.has('index')
      ) {
        const caminho = caminhoDe(path)
        if (caminho !== MOLDURAS[modulo]) {
          throw new Error(`App.tsx: moldura ${modulo} em ${caminho}, e não em ${MOLDURAS[modulo]}`)
        }
        pilha.push({ caminho, guarda: pai.guarda, moldura: modulo })
        continue
      }
      throw new Error(`App.tsx: rota-mãe nova (${elemento})`)
    }

    let caminho: string
    if (tag.atributos.has('index')) caminho = pai.caminho || '/'
    else if (typeof path === 'string') caminho = caminhoDe(path)
    else throw new Error(`App.tsx: <Route> sem path nem index (${elemento})`)

    // `moldura` só aparece nas filhas de uma moldura (undefined no resto, que o
    // `toEqual` trata como ausente).
    const { moldura } = pai
    let x: RegExpExecArray | null
    if ((x = /^<Navigate to=\{INICIO\} replace\/>$/.exec(elemento))) {
      rotas.push({ caminho, guarda: pai.guarda, redireciona: INICIO, moldura })
    } else if ((x = /^<Navigate to="([^"]+)" replace\/>$/.exec(elemento))) {
      rotas.push({ caminho, guarda: pai.guarda, redireciona: x[1], moldura })
    } else if ((x = /^<AdminRoute><(\w+)\/><\/AdminRoute>$/.exec(elemento))) {
      rotas.push({ caminho, guarda: 'admin', tela: telaDe(x[1]), moldura })
    } else if ((x = /^<(\w+)\/>$/.exec(elemento)) && x[1] !== 'Navigate') {
      rotas.push({ caminho, guarda: pai.guarda, tela: telaDe(x[1]), moldura })
    } else {
      throw new Error(`App.tsx: elemento em forma nova na rota ${caminho}: ${elemento}`)
    }
  }
  if (pilha.length !== 1) throw new Error('App.tsx: <Route> sem fechamento')
  return rotas
}

describe('rotas: a lista é a do App.tsx', () => {
  // Lido DENTRO de cada teste: se o leitor reclamar do App, a reclamação aparece
  // como falha com o motivo, e os outros testes do arquivo continuam rodando.
  const porCaminho = (a: Rota, b: Rota) => a.caminho.localeCompare(b.caminho)

  it('o leitor acha as rotas do App (senão o teste não está testando nada)', () => {
    expect(rotasDoApp(APP)).toHaveLength(19)
  })

  it('cada rota do App está na lista, com a mesma tela, o mesmo guarda e a mesma moldura, e vice-versa', () => {
    // Comparadas por caminho, não pela ordem: o react-router classifica as
    // rotas pela especificidade, e reordenar o App não muda nada para quem usa.
    expect([...rotasDoApp(APP)].sort(porCaminho)).toEqual([...ROTAS].sort(porCaminho))
  })

  it('o leitor reclama de forma que ele não conhece (prova de que é estrito)', () => {
    const base = (rota: string) => `
      <Routes>
        <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
          ${rota}
        </Route>
      </Routes>`
    expect(() => rotasDoApp(base('<Route path="/x" caseSensitive element={<Login />} />')))
      .toThrow(/atributo novo/)
    expect(() => rotasDoApp(base('<Route path="/x" element={<Navigate to="/y" />} />')))
      .toThrow(/forma nova/)
    expect(() => rotasDoApp(base('<Route path="/x" element={<Fantasma />} />')))
      .toThrow(/não vem de um import/)
    expect(rotasDoApp(base(''))).toEqual([])

    // A MOLDURA (etapa 3). A conhecida, no caminho dela, é aceita, e as filhas
    // saem com o endereço inteiro e a moldura...
    const comImports = (rota: string) =>
      "import Login from '@/pages/Login'\n" +
      "import MolduraDoQuadro from '@/pages/inteligencia/Moldura'\n" +
      base(rota)
    expect(rotasDoApp(comImports(`
      <Route path="/inteligencia" element={<MolduraDoQuadro />}>
        <Route index element={<Login />} />
        <Route path="y" element={<Login />} />
      </Route>`))).toEqual([
      { caminho: '/inteligencia', guarda: 'sessao', tela: 'Login', moldura: 'inteligencia/Moldura' },
      { caminho: '/inteligencia/y', guarda: 'sessao', tela: 'Login', moldura: 'inteligencia/Moldura' },
    ])
    // ...em outro caminho, não...
    expect(() => rotasDoApp(comImports(
      '<Route path="/quadro" element={<MolduraDoQuadro />}><Route index element={<Login />} /></Route>',
    ))).toThrow(/moldura inteligencia\/Moldura em \/quadro/)
    // ...nem dentro de outra moldura...
    expect(() => rotasDoApp(comImports(
      '<Route path="/inteligencia" element={<MolduraDoQuadro />}>' +
      '<Route path="/inteligencia" element={<MolduraDoQuadro />}></Route></Route>',
    ))).toThrow(/rota-mãe nova/)
    // ...e rota-mãe com uma tela qualquer no lugar da moldura, também não.
    expect(() => rotasDoApp(comImports(
      '<Route path="/x" element={<Login />}><Route index element={<Login />} /></Route>',
    ))).toThrow(/rota-mãe nova/)
  })
})

// ─── 4. A moldura do Quadro econômico (etapa 3) ─────────────────────────────

/** Os cinco endereços do Quadro, escritos à mão (não derivados de `ROTAS`). */
const QUADRO = [
  '/inteligencia',
  '/inteligencia/previsoes',
  '/inteligencia/performance',
  '/inteligencia/recortes',
  '/inteligencia/carteiras',
]

/** O fonte de um módulo de `src/pages`, sem os comentários de JSX. */
function fonteDaPagina(modulo: string): string {
  const url = new URL(`../../pages/${modulo}.tsx`, import.meta.url)
  return readFileSync(fileURLToPath(url), 'utf-8').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
}

/** O `nivel` de cada `<PageHeader>` do fonte ('1' quando ele não diz, o padrão). */
function niveisDoCabecalho(fonte: string): string[] {
  return [...fonte.matchAll(/<PageHeader(?=\s)/g)].map((m) => {
    const nivel = lerTag(fonte, (m.index ?? 0) + '<PageHeader'.length).atributos.get('nivel')
    return nivel === undefined ? '1' : String(nivel)
  })
}

describe('rotas: a moldura do Quadro econômico', () => {
  it('as cinco telas do Quadro abrem dentro da moldura, e nenhum outro endereço', () => {
    for (const { endereco } of HOJE) {
      expect(molduraEm(endereco), endereco)
        .toBe(QUADRO.includes(endereco) ? 'inteligencia/Moldura' : undefined)
    }
    // O endereço antigo das Carteiras continua levando à aba, dentro da moldura.
    expect(resolver('/comercial/carteiras')?.redireciona).toBe('/inteligencia/carteiras')
    // Barra no fim e maiúsculas, como links salvos já usam: a mesma aba, na moldura.
    expect(oQueAbre(resolver('/Inteligencia/Previsoes/')))
      .toEqual({ guarda: 'sessao', tela: 'inteligencia/Previsoes' })
    expect(molduraEm('/Inteligencia/Previsoes/')).toBe('inteligencia/Moldura')
    // Subcaminho que nenhuma aba declara: a página não encontrada, FORA da moldura.
    expect(oQueAbre(resolver('/inteligencia/recortes/x')))
      .toEqual({ guarda: 'sessao', tela: 'NotFound' })
    expect(molduraEm('/inteligencia/recortes/x')).toBeUndefined()
  })

  it('as abas que a moldura desenha são as rotas dela, na mesma ordem', () => {
    // A moldura desenha `ABAS_DO_QUADRO`; o App monta as rotas. Aba sem rota
    // abriria a página não encontrada; rota sem aba abriria sem aba acesa.
    const rotasDaMoldura = ROTAS.filter((r) => r.moldura === 'inteligencia/Moldura')
    expect(ABAS_DO_QUADRO.map((a) => a.to)).toEqual(rotasDaMoldura.map((r) => r.caminho))
    expect(ABAS_DO_QUADRO.map((a) => a.to)).toEqual(QUADRO)
  })

  it('um h1 só por tela: o da moldura; o cabeçalho de cada aba é h2', () => {
    // Lido como TEXTO, como o App: renderizar as telas no Vitest puxaria o
    // cliente do Supabase e os gráficos.
    expect(niveisDoCabecalho(fonteDaPagina('inteligencia/Moldura'))).toEqual(['1'])
    const telas = ROTAS.filter((r) => r.moldura).map((r) => r.tela as Tela)
    expect(telas).toHaveLength(5)
    for (const tela of telas) {
      const fonte = fonteDaPagina(tela)
      const niveis = niveisDoCabecalho(fonte)
      expect(niveis.length, tela).toBeGreaterThan(0)
      expect(new Set(niveis), tela).toEqual(new Set(['2']))
      expect(fonte, tela).not.toMatch(/<h1[\s>]/)
    }
  })
})

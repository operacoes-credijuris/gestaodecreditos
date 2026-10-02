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

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { matchRoutes, type RouteObject } from 'react-router-dom'
import { ROTAS, type Guarda, type Rota, type Tela } from '@/components/layout/rotas'
import { INICIO } from '@/components/layout/navigation'

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
 */
function objetosDeRota(rotas: readonly Rota[]): RouteObject[] {
  const folha = (r: Rota): RouteObject =>
    r.caminho === '/' ? { index: true, handle: r } : { path: r.caminho, handle: r }
  return [
    ...rotas.filter((r) => r.guarda === 'nenhuma').map(folha),
    { children: rotas.filter((r) => r.guarda !== 'nenhuma').map(folha) },
  ]
}

const OBJETOS = objetosDeRota(ROTAS)

/** A rota que o react-router escolhe para o endereço (a folha do casamento). */
function resolver(endereco: string): Rota | undefined {
  const casou = matchRoutes(OBJETOS, endereco)
  return casou?.[casou.length - 1]?.route.handle as Rota | undefined
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
// nova ou rota-mãe que não seja a do layout faz o teste falhar com o motivo,
// em vez de ser ignorada. Melhor um alarme a mais que uma rota fora da conta.

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
  const telaDe = (componente: string): Tela => {
    const modulo = modulos.get(componente)
    if (!modulo) throw new Error(`App.tsx: <${componente} /> não vem de um import de @/pages`)
    return modulo as Tela
  }

  const pilha: Array<{ caminho: string; guarda: Guarda }> = [{ caminho: '', guarda: 'nenhuma' }]
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

    if (!tag.fechaSozinha) {
      // Rota-mãe. Hoje só existe uma: a do layout, sem caminho.
      if (elemento !== LAYOUT || path !== undefined || tag.atributos.has('index')) {
        throw new Error(`App.tsx: rota-mãe nova (${elemento})`)
      }
      pilha.push({ caminho: pai.caminho, guarda: 'sessao' })
      continue
    }

    let caminho: string
    if (tag.atributos.has('index')) caminho = pai.caminho || '/'
    else if (typeof path === 'string') {
      caminho = path.startsWith('/') || !pai.caminho ? path : `${pai.caminho}/${path}`
    } else throw new Error(`App.tsx: <Route> sem path nem index (${elemento})`)

    let x: RegExpExecArray | null
    if ((x = /^<Navigate to=\{INICIO\} replace\/>$/.exec(elemento))) {
      rotas.push({ caminho, guarda: pai.guarda, redireciona: INICIO })
    } else if ((x = /^<Navigate to="([^"]+)" replace\/>$/.exec(elemento))) {
      rotas.push({ caminho, guarda: pai.guarda, redireciona: x[1] })
    } else if ((x = /^<AdminRoute><(\w+)\/><\/AdminRoute>$/.exec(elemento))) {
      rotas.push({ caminho, guarda: 'admin', tela: telaDe(x[1]) })
    } else if ((x = /^<(\w+)\/>$/.exec(elemento)) && x[1] !== 'Navigate') {
      rotas.push({ caminho, guarda: pai.guarda, tela: telaDe(x[1]) })
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

  it('cada rota do App está na lista, com a mesma tela e o mesmo guarda, e vice-versa', () => {
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
  })
})

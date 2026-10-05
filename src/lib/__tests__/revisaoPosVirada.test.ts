/**
 * REVISÃO PÓS-VIRADA (03/10/2026): os defeitos do que é global — layout, topo,
 * assistente, rotas —, conferidos pelo texto dos fontes (o ambiente de teste é
 * node, sem navegador). Cada bloco diz o defeito que prende.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { deslocamentoParaCaber, MARGEM_DA_JANELA } from '@/lib/dentroDaJanela'

const ler = (arq: string) => readFileSync(join(__dirname, '..', '..', arq), 'utf8')
/** O código sem os comentários (que citam os padrões que o código não pode ter). */
const semComentarios = (s: string) =>
  s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

describe('o menu do usuário fecha com clique fora', () => {
  it('o topo tem desfoque, e por isso nada `fixed` dentro dele faz de camada de tela', () => {
    // `backdrop-filter` no ancestral faz o `fixed` se medir por ele: a camada
    // `fixed inset-0` cobria só os 64px do topo, e clicar na página não fechava
    // o menu.
    const topo = semComentarios(ler('components/layout/Topbar.tsx'))
    expect(topo).toMatch(/backdrop-blur/)
    expect(topo).not.toMatch(/fixed inset-0/)
    expect(topo).toMatch(/addEventListener\('mousedown'/)
  })
})

describe('um Escape fecha uma coisa só', () => {
  it('o balão "?" da tela para o Escape (o assistente ouve depois, na janela)', () => {
    const ajuda = semComentarios(ler('components/layout/AjudaDaTela.tsx'))
    expect(ajuda).toMatch(/e\.key === 'Escape'[\s\S]{0,80}\{\s*e\.stopPropagation\(\)/)
  })

  it('o assistente fecha primeiro a lista aberta e o histórico, e só depois o painel', () => {
    const a = semComentarios(ler('components/Assistente.tsx'))
    expect(a).toMatch(/camadas\.current\.menu\)[\s\S]{0,120}setModeloAberto\(false\)/)
    expect(a).toMatch(/camadas\.current\.historico\)[\s\S]{0,60}setHistoricoAberto\(false\)/)
  })
})

describe('o título da aba do navegador vale em todo endereço', () => {
  it('fica acima das rotas (main.tsx), e não no layout atrás do ProtectedRoute', () => {
    // No layout, só era posto depois da sessão e do perfil, e ao sair dele (a
    // tela de Entrar) ficava o título da última tela.
    expect(semComentarios(ler('main.tsx'))).toMatch(/<TituloDaAba \/>/)
    expect(semComentarios(ler('components/layout/AppLayout.tsx'))).not.toMatch(/document\.title/)
  })
})

/** A posição `i` do código está dentro do bloco do `try {` mais próximo antes dela? */
function dentroDoTry(codigo: string, i: number): boolean {
  const inicio = codigo.lastIndexOf('try {', i)
  if (inicio < 0) return false
  let profundidade = 0
  for (const c of codigo.slice(inicio + 'try '.length, i)) {
    if (c === '{') profundidade++
    if (c === '}') profundidade--
    if (profundidade <= 0) return false
  }
  return true
}

describe('o assistente não derruba a plataforma', () => {
  it('lê e grava o modelo no localStorage só dentro de try', () => {
    const a = semComentarios(ler('components/Assistente.tsx'))
    const usos = [...a.matchAll(/localStorage\.(get|set)Item/g)].map((m) => m.index ?? 0)
    expect(usos.length).toBeGreaterThan(0)
    // DENTRO do bloco do `try`, e não só logo depois dele: a leitura do modelo
    // passou a guardar o valor numa constante antes de traduzi-lo (o Opus 5
    // guardado vira o 5.5), e a checagem antiga só aceitava o acesso colado ao
    // `try {`. Vale o que ela garantia: do `try {` mais próximo até o acesso,
    // nenhum bloco se fechou sem ter sido aberto ali — o acesso está lá dentro.
    for (const i of usos) expect(dentroDoTry(a, i)).toBe(true)
  })

  it('a checagem acima reprova o acesso fora do try (senão ela não testa nada)', () => {
    const fora = 'function f() {\n  try {\n    x()\n  } catch {}\n  localStorage.getItem(k)\n}'
    expect(dentroDoTry(fora, fora.indexOf('localStorage'))).toBe(false)
    const dentro = 'function f() {\n  try {\n    const g = localStorage.getItem(k)\n  } catch {}\n}'
    expect(dentroDoTry(dentro, dentro.indexOf('localStorage'))).toBe(true)
  })

  it('a lista de Skills mora sob a chave das Configurações, que a invalida', () => {
    expect(ler('components/Assistente.tsx')).toMatch(/queryKey: \['assistente_skills', 'ativas'\]/)
  })

  it('o histórico fechado sai da ordem do Tab', () => {
    expect(ler('components/Assistente.tsx')).toMatch(/'invisible -translate-x-full pointer-events-none'/)
  })
})

describe('o pacote de entrada não carrega a plataforma inteira', () => {
  it('as telas do App vêm sob demanda (só Entrar, 404 e a moldura do Quadro no pacote de entrada)', () => {
    const app = ler('App.tsx')
    const estaticas = [...app.matchAll(/^import (\w+) from '@\/pages\/([^']+)'/gm)].map((m) => m[2])
    expect(estaticas.sort()).toEqual(['Login', 'NotFound', 'inteligencia/Moldura'])
    expect(app.match(/telaSobDemanda\(/g)?.length).toBeGreaterThanOrEqual(14)
  })

  it('o layout não importa direto a busca, o Markdown nem a janela de petição', () => {
    expect(ler('components/layout/Consultas.tsx')).not.toMatch(/^import \{ BuscaGeral \}/m)
    const a = ler('components/Assistente.tsx')
    expect(a).not.toMatch(/^import \{ TextoIA \}/m)
    expect(a).not.toMatch(/^import \{ PeticaoModal \}/m)
  })
})

describe('o balão do "?" e a dica do termo não saem pela direita no celular', () => {
  it('não precisa puxar quando cabe', () => {
    expect(deslocamentoParaCaber(20, 340, 1280)).toBe(0)
    expect(deslocamentoParaCaber(23, 340, 375)).toBe(0)
  })

  it('puxa para a esquerda o quanto passa da borda (com a margem)', () => {
    // "?" em x=250 num celular de 375px: o balão de 340px ia até 590.
    expect(deslocamentoParaCaber(250, 340, 375)).toBe(-(250 + 340 - (375 - MARGEM_DA_JANELA)))
  })

  it('nunca puxa além da margem esquerda', () => {
    const dx = deslocamentoParaCaber(100, 400, 375)
    expect(100 + dx).toBe(MARGEM_DA_JANELA)
  })

  it('os dois balões usam a medida', () => {
    expect(ler('components/layout/AjudaDaTela.tsx')).toMatch(/useDentroDaJanela\(balaoRef, aberto\)/)
    expect(ler('components/layout/TextoComTermos.tsx')).toMatch(/useDentroDaJanela\(dicaRef, aberta\)/)
  })
})

describe('o Quadro não troca os números por erro num soluço de rede', () => {
  it('o usePainel só acusa erro quando não há carteira em mãos', () => {
    expect(ler('pages/inteligencia/compartilhado.tsx')).toMatch(/erro: processos\.data \? null : processos\.error/)
  })
})

describe('um aviso não redesenha a plataforma inteira', () => {
  it('o valor do contexto dos avisos (Toast) é memorizado', () => {
    // Recriado a cada render, cada aviso que aparecia ou sumia redesenhava todo
    // componente que usa useToast.
    expect(semComentarios(ler('components/ui/Toast.tsx'))).toMatch(/const value = useMemo<ToastContextValue>/)
  })
})

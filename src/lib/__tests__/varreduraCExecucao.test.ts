// Varredura C (23/10/2026): telas de execução do Operacional — Créditos,
// Requerimentos, Publicações e movimentações, Fase processual, Tarefas e
// Contatos — e as fichas delas.
//
// Um bloco por defeito corrigido. Cada um falharia antes da correção: ou porque
// a função pura não existia/devolvia errado, ou porque o fonte ainda tinha o
// desenho que quebrava.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { lerTodasAsPaginas, type PaginaDaLeitura } from '../leituraPaginada'
import { localizarPorDigitos } from '../situacaoDaFase'

const ler = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf-8')

/** Um servidor com teto de `teto` linhas por resposta, como o PostgREST. */
function servidorComTeto(total: number, teto = 1000) {
  const pedidos: [number, number][] = []
  const pagina: PaginaDaLeitura = async (de, ate) => {
    pedidos.push([de, ate])
    const fim = Math.min(ate, de + teto - 1, total - 1)
    const data = fim < de ? [] : Array.from({ length: fim - de + 1 }, (_, i) => de + i)
    return { data, error: null }
  }
  return { pagina, pedidos }
}

describe('Leitura paginada: o teto calado de 1000 linhas não esconde nada', () => {
  it('lê além das primeiras mil linhas', async () => {
    const { pagina, pedidos } = servidorComTeto(2350)
    const linhas = await lerTodasAsPaginas<number>(pagina)
    expect(linhas).toHaveLength(2350)
    expect(linhas[2349]).toBe(2349)
    expect(pedidos).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ])
  })

  it('para na página incompleta, sem pedido a mais', async () => {
    const { pagina, pedidos } = servidorComTeto(10)
    expect(await lerTodasAsPaginas<number>(pagina)).toHaveLength(10)
    expect(pedidos).toHaveLength(1)
  })

  it('respeita o teto de páginas da tela', async () => {
    const { pagina } = servidorComTeto(9000)
    expect(await lerTodasAsPaginas<number>(pagina, { maxPaginas: 5 })).toHaveLength(5000)
  })

  it('erro em qualquer página lança: lista pela metade não passa por inteira', async () => {
    let n = 0
    const pagina: PaginaDaLeitura = async () =>
      ++n === 2
        ? { data: null, error: { message: 'tempo esgotado' } }
        : { data: Array.from({ length: 1000 }, () => 0), error: null }
    await expect(lerTodasAsPaginas(pagina)).rejects.toThrow('tempo esgotado')
  })

  it('a Fase processual e os Paralisados leem em páginas, e não com `.limit(5000)`', () => {
    const fase = ler('../../pages/operacional/execucao/FaseProcessual.tsx')
    const pub = ler('../../pages/operacional/execucao/PublicacoesMovimentacoes.tsx')
    // No CÓDIGO (o comentário que conta a história ainda cita o `.limit`).
    for (const src of [fase, pub]) expect(src).not.toMatch(/^\s*\.limit\(5000\)|\)\.limit\(5000\)/m)
    expect(fase).toMatch(/lerTodasAsPaginas<FaseRow>/)
    expect(pub).toMatch(/lerTodasAsPaginas<StatusRow>/)
  })

  it('os apensos da Fase processual ficam sob a raiz que a exclusão invalida', () => {
    const fase = ler('../../pages/operacional/execucao/FaseProcessual.tsx')
    expect(fase).toMatch(/queryKey: \['apensos', 'fase_processual'\]/)
    expect(fase).not.toMatch(/queryKey: \['apensos_fase_processual'\]/)
  })
})

describe('Fase processual: "Nº do processo e Enter" não abre o crédito errado', () => {
  const p = (id: string, numero_cnj: string) => ({ id, numero_cnj })
  const carteira = [
    p('a', '0001234-56.2023.8.05.0001'),
    p('b', '0005678-90.2023.8.05.0001'),
    p('c', '1000123-45.2019.4.01.3300'),
  ]

  it('o número inteiro casa direto, com ou sem pontuação', () => {
    expect(localizarPorDigitos(carteira, '0005678-90.2023.8.05.0001')).toEqual({ tipo: 'um', processo: carteira[1] })
    expect(localizarPorDigitos(carteira, '00056789020238050001')).toEqual({ tipo: 'um', processo: carteira[1] })
  })

  it('um trecho que só um contém abre esse', () => {
    expect(localizarPorDigitos(carteira, '5678')).toEqual({ tipo: 'um', processo: carteira[1] })
  })

  it('um trecho de vários é ambíguo — antes abria o primeiro', () => {
    expect(localizarPorDigitos(carteira, '2023')).toEqual({ tipo: 'varios', quantos: 2 })
  })

  it('nada casa: nenhum', () => {
    expect(localizarPorDigitos(carteira, '9999')).toEqual({ tipo: 'nenhum' })
    expect(localizarPorDigitos(carteira, '')).toEqual({ tipo: 'nenhum' })
  })

  it('a tela usa a localização, e não o primeiro `includes`', () => {
    const fase = ler('../../pages/operacional/execucao/FaseProcessual.tsx')
    expect(fase).toMatch(/localizarPorDigitos\(processos, alvo\)/)
    expect(fase).not.toMatch(/processos\.find\(\(p\) => dig\(p\.numero_cnj\)\.includes\(alvo\)\)/)
  })
})

describe('Situação da fase: o Esc fecha o menu, e não a ficha por baixo', () => {
  const fase = ler('../../pages/operacional/execucao/FaseProcessual.tsx')
  it('o invólucro do menu consome o Esc enquanto ele está aberto', () => {
    expect(fase).toMatch(
      /if \(e\.key !== 'Escape' \|\| !aberto\) return\s*e\.stopPropagation\(\)\s*setAberto\(false\)/,
    )
  })
  it('o Esc dos campos de editar e criar desfaz só a edição', () => {
    expect(fase).toMatch(/if \(e\.key === 'Escape'\) \{\s*e\.stopPropagation\(\)\s*setEditandoId\(null\)/)
    expect(fase).toMatch(/if \(e\.key === 'Escape'\) \{\s*e\.stopPropagation\(\)\s*setNovoAberto\(false\)/)
  })
})

describe('Publicações e movimentações: a janela de dias anda com o dia', () => {
  const pub = ler('../../pages/operacional/execucao/PublicacoesMovimentacoes.tsx')
  it('a pílula e a lista usam o mesmo relógio, e nenhuma congela a data', () => {
    expect(pub).not.toMatch(/useMemo\(\(\) => isoDiasAtras\(\d+\), \[\]\)/)
    expect(pub.match(/useInicioDaJanela\(30\)/g)?.length).toBe(2)
    expect(pub.match(/useInicioDaJanela\(20\)/g)?.length).toBe(2)
  })
  it('a aba Fase processual espera os créditos em vez de mostrar zero', () => {
    expect(pub).toMatch(/if \(isLoading\) return <Loading label="Carregando créditos…" \/>/)
  })
})

describe('Ficha e atalhos', () => {
  it('a ficha do requerimento lê a versão mais nova da lista', () => {
    const req = ler('../../pages/operacional/execucao/Requerimentos.tsx')
    expect(req).toMatch(/data\?\.find\(\(r\) => r\.id === detalheClicado\.id\) \?\? detalheClicado/)
  })
  it('o Ctrl+K em Contatos zera o filtro de tribunal', () => {
    const ct = ler('../../pages/operacional/execucao/ContatosServentias.tsx')
    expect(ct).toMatch(/setBusca\(filtrarContatos\)\s*setFiltroTribunal\('todos'\)/)
  })
  it('a pasta já conhecida também avisa quando o navegador bloqueia a aba', () => {
    const drive = ler('../../components/NumeroProcessoDrive.tsx')
    expect(drive.match(/if \(!abrirEmNovaAba\(link\)\)/g)?.length).toBe(2)
    expect(drive).not.toMatch(/window\.open\(linkDaPasta\(processo\.drive_pasta_id\)/)
  })
  it('Tarefas usa o relógio da plataforma, sem cópia própria', () => {
    const tar = ler('../../pages/operacional/execucao/TarefasAdvbox.tsx')
    expect(tar).toMatch(/const hoje = useHojeQueAnda\(\)/)
    expect(tar).not.toMatch(/setInterval\(sincronizar/)
  })
})

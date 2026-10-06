import { describe, it, expect } from 'vitest'
import {
  acertarEnderecosLocais,
  criarCacheDeLinks,
  criarLimitador,
  ehImagem,
  grupoDeMiniaturas,
  validadeDoLink,
  VALIDADE_PADRAO_MS,
  MARGEM_DO_VENCIMENTO_MS,
  type LinkDoAnexo,
} from '../previaDoAnexo'
import type { KommoNota } from '../types'
import { previaPequena } from '../../../supabase/functions/_shared/previaDoDrive.ts'

/**
 * A PRÉVIA DA IMAGEM ANEXADA: o que é imagem, o grupo de miniaturas, a validade
 * do link assinado, o cache e o limite de pedidos ao mesmo tempo.
 */

const anexo = (id: number, nome: string, uuid: string | null = `uuid-${id}`): KommoNota => ({
  id,
  texto: `📎 ${nome}`,
  criado_em: '2026-10-06T12:00:00Z',
  autor: null,
  tipo: 'attachment',
  arquivo_uuid: uuid,
})

/** Uma promessa que o teste resolve quando quiser. */
function adiada<T>() {
  let ok!: (v: T) => void
  let falha!: (e: unknown) => void
  const promessa = new Promise<T>((a, b) => {
    ok = a
    falha = b
  })
  return { promessa, ok, falha }
}

const tique = () => new Promise((r) => setTimeout(r, 0))

describe('ehImagem', () => {
  it('reconhece png, jpg, jpeg, gif e webp pelo nome, sem ligar para a caixa', () => {
    for (const n of ['a.png', 'b.JPG', 'c.jpeg', 'd.gif', 'e.WebP', 'print de tela.PNG']) {
      expect(ehImagem(n), n).toBe(true)
    }
  })

  it('PDF, planilha, HEIC, SVG e nome sem extensão não são', () => {
    for (const n of ['autos.pdf', 'conta.xlsx', 'foto.heic', 'logo.svg', 'imagem', 'png', 'a.png.pdf']) {
      expect(ehImagem(n), n).toBe(false)
    }
  })

  it('o tipo, quando vem, manda', () => {
    expect(ehImagem('foto.png', 'application/pdf')).toBe(false)
    expect(ehImagem('sem-extensao', 'image/jpeg')).toBe(true)
    expect(ehImagem('x', 'image/webp')).toBe(true)
    expect(ehImagem('x.png', 'image/svg+xml')).toBe(false)
  })

  it('o tipo genérico do drive (ou vazio) devolve a decisão ao nome', () => {
    expect(ehImagem('foto.jpg', 'application/octet-stream')).toBe(true)
    expect(ehImagem('autos.pdf', 'application/octet-stream')).toBe(false)
    expect(ehImagem('foto.jpg', '')).toBe(true)
    expect(ehImagem('foto.jpg', null)).toBe(true)
  })
})

describe('grupoDeMiniaturas', () => {
  it('uma imagem: miniatura, sem selo', () => {
    const g = grupoDeMiniaturas([anexo(1, 'rg.jpg')])
    expect(g.imagens.map((a) => a.id)).toEqual([1])
    expect(g.outros).toEqual([])
    expect(g.selo).toBeNull()
  })

  it('três imagens: a primeira à vista e "+2"', () => {
    const g = grupoDeMiniaturas([anexo(1, 'a.png'), anexo(2, 'b.jpg'), anexo(3, 'c.webp')])
    expect(g.imagens.map((a) => a.id)).toEqual([1, 2, 3])
    expect(g.selo).toBe('+2')
  })

  it('PDF continua na lista; a ordem de cada lado é a do histórico', () => {
    const g = grupoDeMiniaturas([anexo(1, 'autos.pdf'), anexo(2, 'rg.png'), anexo(3, 'conta.xlsx'), anexo(4, 'cpf.jpg')])
    expect(g.imagens.map((a) => a.id)).toEqual([2, 4])
    expect(g.outros.map((a) => a.id)).toEqual([1, 3])
    expect(g.selo).toBe('+1')
  })

  it('imagem sem uuid (nota antiga) fica na lista: achá-la custaria uma busca por nome', () => {
    const g = grupoDeMiniaturas([anexo(1, 'rg.png', null), anexo(2, 'cpf.png')])
    expect(g.imagens.map((a) => a.id)).toEqual([2])
    expect(g.outros.map((a) => a.id)).toEqual([1])
    expect(g.selo).toBeNull()
  })

  it('sem arquivo nenhum, nada', () => {
    expect(grupoDeMiniaturas([])).toEqual({ imagens: [], outros: [], selo: null })
  })
})

describe('validadeDoLink', () => {
  const agora = Date.UTC(2026, 9, 6, 12, 0, 0)

  it('sem prazo escrito: o padrão de dez minutos', () => {
    expect(validadeDoLink('https://drive-g.kommo.com/download/a/b/rg.png', agora)).toBe(agora + VALIDADE_PADRAO_MS)
  })

  it('endereço que não é URL: o padrão, sem lançar', () => {
    expect(validadeDoLink('não é url', agora)).toBe(agora + VALIDADE_PADRAO_MS)
  })

  it('`expires` em segundos: vale o do link, menos a margem', () => {
    const vence = agora + 5 * 60 * 1000
    const url = `https://drive-g.kommo.com/download/x.png?expires=${vence / 1000}&sig=abc`
    expect(validadeDoLink(url, agora)).toBe(vence - MARGEM_DO_VENCIMENTO_MS)
  })

  it('`Expires` em milissegundos também', () => {
    const vence = agora + 3 * 60 * 1000
    expect(validadeDoLink(`https://x.invalid/a.png?Expires=${vence}`, agora)).toBe(vence - MARGEM_DO_VENCIMENTO_MS)
  })

  it('o par X-Amz-Date + X-Amz-Expires', () => {
    const url = 'https://s3.invalid/a.png?X-Amz-Date=20261006T115800Z&X-Amz-Expires=300&X-Amz-Signature=f'
    // assinado às 11:58 por 300 s: vence às 12:03; menos a margem, 12:02.
    expect(validadeDoLink(url, agora)).toBe(Date.UTC(2026, 9, 6, 12, 2, 0))
  })

  it('prazo longo no link não passa do padrão', () => {
    const umDia = agora + 24 * 3600 * 1000
    expect(validadeDoLink(`https://x.invalid/a.png?expires=${umDia / 1000}`, agora)).toBe(agora + VALIDADE_PADRAO_MS)
  })

  it('link que vence dentro da margem já não serve', () => {
    const quase = agora + 30 * 1000
    expect(validadeDoLink(`https://x.invalid/a.png?expires=${quase / 1000}`, agora)).toBeLessThanOrEqual(agora)
  })
})

describe('criarLimitador', () => {
  it('nunca passa do limite, e a fila anda na ordem', async () => {
    const naFila = criarLimitador(2)
    let correndo = 0
    let pico = 0
    const ordem: number[] = []
    const portas = [0, 1, 2, 3, 4].map(() => adiada<void>())
    const tarefas = portas.map((p, i) =>
      naFila(async () => {
        correndo += 1
        pico = Math.max(pico, correndo)
        ordem.push(i)
        await p.promessa
        correndo -= 1
        return i
      }),
    )
    await tique()
    expect(ordem).toEqual([0, 1])
    portas[1].ok()
    await tique()
    expect(ordem).toEqual([0, 1, 2])
    for (const p of portas) p.ok()
    expect(await Promise.all(tarefas)).toEqual([0, 1, 2, 3, 4])
    expect(pico).toBe(2)
    expect(ordem).toEqual([0, 1, 2, 3, 4])
  })

  it('a tarefa que falha (até a que lança sem promessa) libera a vaga', async () => {
    const naFila = criarLimitador(1)
    const a = naFila(() => Promise.reject(new Error('rede')))
    const b = naFila(() => {
      throw new Error('síncrono')
    })
    const c = naFila(async () => 'ok')
    await expect(a).rejects.toThrow('rede')
    await expect(b).rejects.toThrow('síncrono')
    await expect(c).resolves.toBe('ok')
  })
})

describe('criarCacheDeLinks', () => {
  const link = (uuid: string, extra: Partial<LinkDoAnexo> = {}): LinkDoAnexo => ({
    download: `https://drive.invalid/${uuid}.png`,
    ...extra,
  })

  it('dois pedidos do mesmo arquivo ao mesmo tempo: uma ida só', async () => {
    const pedidos: string[] = []
    const cache = criarCacheDeLinks({ buscar: async (u) => (pedidos.push(u), link(u)) })
    const [a, b] = await Promise.all([cache.obter('u1'), cache.obter('u1')])
    expect(a).toBe(b)
    expect(pedidos).toEqual(['u1'])
  })

  it('dentro da validade, o link guardado; vencido, pede de novo', async () => {
    let t = 1_000_000
    const pedidos: string[] = []
    const cache = criarCacheDeLinks({ buscar: async (u) => (pedidos.push(u), link(u)), agora: () => t })
    await cache.obter('u1')
    await tique()
    t += VALIDADE_PADRAO_MS - 1
    await cache.obter('u1')
    expect(pedidos).toEqual(['u1'])
    t += 2
    await cache.obter('u1')
    expect(pedidos).toEqual(['u1', 'u1'])
  })

  it('o prazo é o do link que vence primeiro (a miniatura pode vencer antes)', async () => {
    let t = Date.UTC(2026, 9, 6, 12, 0, 0)
    const pedidos: string[] = []
    const vence = t + 4 * 60 * 1000
    const cache = criarCacheDeLinks({
      buscar: async (u) => (pedidos.push(u), link(u, { miniatura: `https://drive.invalid/p.png?expires=${vence / 1000}` })),
      agora: () => t,
    })
    await cache.obter('u1')
    await tique()
    t = vence - MARGEM_DO_VENCIMENTO_MS - 1
    await cache.obter('u1')
    expect(pedidos).toHaveLength(1)
    t += 1
    await cache.obter('u1')
    expect(pedidos).toHaveLength(2)
  })

  it('falha não fica guardada: a próxima tentativa vai ao servidor', async () => {
    let vez = 0
    const cache = criarCacheDeLinks({
      buscar: async (u) => {
        vez += 1
        if (vez === 1) throw new Error('HTTP 502')
        return link(u)
      },
    })
    await expect(cache.obter('u1')).rejects.toThrow('502')
    await tique()
    expect(cache.tamanho).toBe(0)
    await expect(cache.obter('u1')).resolves.toEqual(link('u1'))
    expect(vez).toBe(2)
  })

  it('`esquecer` joga fora o link que não abriu', async () => {
    let vez = 0
    const cache = criarCacheDeLinks({ buscar: async (u) => (vez++, link(u)) })
    await cache.obter('u1')
    cache.esquecer('u1')
    await cache.obter('u1')
    expect(vez).toBe(2)
  })

  it('arquivos diferentes respeitam o limite de pedidos ao mesmo tempo', async () => {
    let correndo = 0
    let pico = 0
    const portas = new Map<string, { ok: () => void }>()
    const cache = criarCacheDeLinks({
      concorrencia: 2,
      buscar: async (u) => {
        correndo += 1
        pico = Math.max(pico, correndo)
        const p = adiada<void>()
        portas.set(u, p)
        await p.promessa
        correndo -= 1
        return link(u)
      },
    })
    const todos = ['a', 'b', 'c', 'd', 'e'].map((u) => cache.obter(u))
    await tique()
    expect([...portas.keys()]).toEqual(['a', 'b'])
    for (let i = 0; i < 5; i++) {
      for (const p of portas.values()) p.ok()
      await tique()
    }
    await Promise.all(todos)
    expect(pico).toBe(2)
    expect([...portas.keys()]).toEqual(['a', 'b', 'c', 'd', 'e'])
  })
})

describe('acertarEnderecosLocais', () => {
  const blob = (n: string) => new Blob([n])

  it('cria para o que entrou, mantém o que ficou e revoga o que saiu', () => {
    let seq = 0
    const criados: string[] = []
    const revogados: string[] = []
    const criar = () => {
      const u = `blob:${++seq}`
      criados.push(u)
      return u
    }
    const revogar = (u: string) => {
      revogados.push(u)
    }

    const m1 = acertarEnderecosLocais(new Map(), [{ chave: 'a', arquivo: blob('a') }, { chave: 'b', arquivo: blob('b') }], criar, revogar)
    expect([...m1]).toEqual([['a', 'blob:1'], ['b', 'blob:2']])

    // tirou o "a", colou o "c"
    const m2 = acertarEnderecosLocais(m1, [{ chave: 'b', arquivo: blob('b') }, { chave: 'c', arquivo: blob('c') }], criar, revogar)
    expect([...m2]).toEqual([['b', 'blob:2'], ['c', 'blob:3']])
    expect(revogados).toEqual(['blob:1'])

    // enviou tudo
    const m3 = acertarEnderecosLocais(m2, [], criar, revogar)
    expect(m3.size).toBe(0)
    expect(revogados).toEqual(['blob:1', 'blob:2', 'blob:3'])
    expect(criados).toEqual(['blob:1', 'blob:2', 'blob:3'])
  })
})

describe('previaPequena (kommo-anexo)', () => {
  it('sem prévia (o caso comum no drive): nulo, e a tela usa o arquivo', () => {
    expect(previaPequena(null)).toBeNull()
    expect(previaPequena(undefined)).toBeNull()
    expect(previaPequena([])).toBeNull()
    expect(previaPequena({})).toBeNull()
  })

  it('a menor que ainda tenha 160px de largura', () => {
    const p = [
      { download_link: 'https://drive.invalid/p1600.jpg', width: 1600, height: 1200 },
      { download_link: 'https://drive.invalid/p100.jpg', width: 100, height: 75 },
      { download_link: 'https://drive.invalid/p400.jpg', width: 400, height: 300 },
    ]
    expect(previaPequena(p)).toBe('https://drive.invalid/p400.jpg')
  })

  it('nenhuma tão larga: a maior', () => {
    const p = [
      { download_link: 'https://drive.invalid/a.jpg', width: 64 },
      { download_link: 'https://drive.invalid/b.jpg', width: 120 },
    ]
    expect(previaPequena(p)).toBe('https://drive.invalid/b.jpg')
  })

  it('lê objeto em vez de lista, e o link no formato _links', () => {
    expect(previaPequena({ 0: { _links: { download: { href: 'https://drive.invalid/x.jpg' } }, width: 300 } })).toBe(
      'https://drive.invalid/x.jpg',
    )
  })

  it('link que não é https não serve', () => {
    expect(previaPequena([{ download_link: 'javascript:alert(1)', width: 300 }, { download_link: '', width: 400 }])).toBeNull()
  })
})

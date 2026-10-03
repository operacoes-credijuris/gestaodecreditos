// Testes do menu e da resolução de rota.
//
// Nasceram de um defeito silencioso: `/inteligencia` é prefixo de
// `/inteligencia/performance`, e `findNavLocation` devolvia o PRIMEIRO item
// que casasse. Como Visão Geral (`/inteligencia`) era o primeiro da seção, o
// cabeçalho e o título da aba diziam "Visão Geral" nas quatro subtelas.
//
// Ninguém percebeu porque nada quebra: a página certa aparece, só o rótulo
// acima dela é que está errado. É o tipo de coisa que teste pega e revisão
// visual não.
//
// ETAPA 3 DO REDESENHO (o menu reagrupado e o Quadro numa moldura com abas):
// quatro verificações mudaram DE PROPÓSITO, cada uma com o porquê ao lado
// ("MUDOU DE PROPÓSITO"): os rótulos das telas do Quadro, a seção delas, a
// subrota que cai na aba e a ordem alfabética. As outras ficaram como estavam;
// as novas estão nos três últimos blocos (item aceso, título, caminho no topo).

import { describe, it, expect } from 'vitest'
import {
  ABAS_DO_QUADRO, ITENS_DO_MENU, NAVIGATION, NAV_CONFIG,
  caminhoNoTopo, findNavLocation, itemAcende, itemAtivo, resolverNav, tituloDaAba,
  type NavSection,
} from '@/components/layout/navigation'
import { ROTAS } from '@/components/layout/rotas'

const TODAS = NAVIGATION.flatMap((s) => s.items)

describe('findNavLocation', () => {
  it('resolve cada item do menu para ele mesmo', () => {
    // O caso que estava quebrado: toda rota tem de encontrar a SUA folha.
    for (const leaf of TODAS) {
      expect(findNavLocation(leaf.to)?.leaf.label).toBe(leaf.label)
    }
  })

  it('a aba-raiz do Quadro econômico não sequestra as outras abas', () => {
    // MUDOU DE PROPÓSITO (etapa 3): as cinco telas viraram ABAS de um item só,
    // "Quadro econômico" — então o nome da tela é o da aba (`aba`), e o item é
    // o mesmo nas cinco. Os rótulos seguem a amostra: só a inicial maiúscula
    // ("Visão geral") e, na aba, só "Carteiras". A regra que este teste prende
    // é a mesma de antes: a Visão geral (/inteligencia) é a PRIMEIRA aba e
    // prefixo das outras quatro — a ordem hostil do defeito original.
    for (const e of ['/inteligencia', '/inteligencia/performance', '/inteligencia/carteiras']) {
      expect(findNavLocation(e)?.leaf.label, e).toBe('Quadro econômico')
    }
    expect(findNavLocation('/inteligencia')?.aba?.label).toBe('Visão geral')
    expect(findNavLocation('/inteligencia/performance')?.aba?.label).toBe('Performance')
    expect(findNavLocation('/inteligencia/previsoes')?.aba?.label).toBe('Previsões')
    expect(findNavLocation('/inteligencia/recortes')?.aba?.label).toBe('Recortes')
    expect(findNavLocation('/inteligencia/carteiras')?.aba?.label).toBe('Carteiras')
  })

  it('escolhe o mais específico mesmo com a raiz declarada em primeiro', () => {
    // ESTE é o teste que pega o defeito. Um menu montado na pior ordem: a
    // rota-raiz antes das filhas, que era exatamente o arranjo em produção
    // antes da ordenação alfabética. Com a lógica de "primeiro que casa", a
    // raiz vence e este teste falha.
    const hostil: NavSection[] = [{
      title: 'Hostil',
      items: [
        { label: 'Raiz', to: '/inteligencia', icon: NAV_CONFIG.icon },
        { label: 'Filha', to: '/inteligencia/performance', icon: NAV_CONFIG.icon },
        { label: 'Neta', to: '/inteligencia/performance/detalhe', icon: NAV_CONFIG.icon },
      ],
    }]
    expect(resolverNav(hostil, '/inteligencia')?.leaf.label).toBe('Raiz')
    expect(resolverNav(hostil, '/inteligencia/performance')?.leaf.label).toBe('Filha')
    expect(resolverNav(hostil, '/inteligencia/performance/detalhe')?.leaf.label).toBe('Neta')
  })

  it('devolve a seção junto com a página', () => {
    // MUDOU DE PROPÓSITO (etapa 3): a seção "Quadro Econômico" deixou de
    // existir; o Quadro é um item de Operacional (decisão do dono).
    expect(findNavLocation('/inteligencia/recortes')?.section).toBe('Operacional')
    expect(findNavLocation('/comercial/contratos')?.section).toBe('Comercial')
  })

  it('subrota não cadastrada cai na página mãe', () => {
    // MUDOU DE PROPÓSITO (etapa 3): Recortes agora é ABA do Quadro, não item;
    // a subrota continua caindo nela, agora lida em `aba`.
    expect(findNavLocation('/inteligencia/recortes/qualquer-coisa')?.aba?.label).toBe('Recortes')
  })

  it('configurações resolve fora das seções', () => {
    expect(findNavLocation(NAV_CONFIG.to)?.leaf.label).toBe('Configurações')
  })

  it('rota desconhecida devolve null em vez de chutar', () => {
    expect(findNavLocation('/nao-existe')).toBeNull()
  })
})

describe('menu', () => {
  it('as abas do Quadro econômico estão na ordem das perguntas', () => {
    // MUDOU DE PROPÓSITO (etapa 3): era "o Quadro Econômico está em ordem
    // alfabética". Como itens de uma lista vertical, procurava-se pelo nome;
    // como abas lado a lado, vale a ordem das perguntas da amostra — como está
    // a carteira, o que vem, o que já rendeu, onde está o capital e, por fim,
    // cada investidor. Lista explícita: trocar a ordem tem de ser de propósito.
    expect(ABAS_DO_QUADRO.map((a) => a.label)).toEqual([
      'Visão geral', 'Previsões', 'Performance', 'Recortes', 'Carteiras',
    ])
  })

  it('não há dois itens apontando para a mesma rota', () => {
    const rotas = TODAS.map((i) => i.to)
    expect(new Set(rotas).size).toBe(rotas.length)
  })

  it('a Revisão de Dados saiu do menu', () => {
    expect(TODAS.some((i) => i.to.includes('anomalias'))).toBe(false)
  })

  it('a Análise de crédito fica no topo, numa seção sem título', () => {
    expect(NAVIGATION[0].title).toBeNull()
    expect(NAVIGATION[0].items.map((i) => i.to)).toEqual(['/operacional/analise'])
    expect(NAVIGATION.map((s) => s.title)).toEqual([null, 'Comercial', 'Operacional'])
  })

  it('o Quadro econômico é um item só, o último de Operacional, com as cinco abas', () => {
    const operacional = NAVIGATION.find((s) => s.title === 'Operacional')!
    const quadro = operacional.items[operacional.items.length - 1]
    expect(quadro.label).toBe('Quadro econômico')
    expect(quadro.to).toBe('/inteligencia')
    expect(quadro.abas).toBe(ABAS_DO_QUADRO)
    // A primeira aba é a do próprio item: clicar no item abre a Visão geral.
    expect(ABAS_DO_QUADRO[0].to).toBe(quadro.to)
    // Nenhum outro item aponta para dentro do Quadro.
    expect(TODAS.filter((i) => i.to.startsWith('/inteligencia'))).toEqual([quadro])
  })

  it('os rótulos têm só a inicial maiúscula, como na amostra', () => {
    // "Geração de Contratos" virou "Geração de contratos". Sem nome próprio no
    // menu hoje; quando entrar um, ele vem para a lista de exceções aqui.
    const rotulos = [...ITENS_DO_MENU.map((i) => i.label), ...ABAS_DO_QUADRO.map((a) => a.label)]
    for (const rotulo of rotulos) {
      const [, ...resto] = rotulo.split(' ')
      expect(resto.filter((p) => p[0] !== p[0].toLowerCase()), rotulo).toEqual([])
    }
  })
})

// ─── Etapa 3: o item aceso, o título da aba e o caminho no topo ─────────────

/**
 * Cada endereço → o item que acende no menu, escrito à mão (não derivado do
 * menu, senão um erro no menu passaria por certo). null = nenhum aceso.
 */
const ACESO: ReadonlyArray<[string, string | null]> = [
  ['/operacional/analise', 'Análise de crédito'],
  ['/comercial/dados-pessoais', 'Dados cadastrais'],
  ['/comercial/contratos', 'Geração de contratos'],
  ['/operacional/execucao/publicacoes', 'Publicações e movimentações'],
  ['/operacional/execucao/tarefas', 'Tarefas'],
  ['/operacional/execucao/processos', 'Créditos'],
  ['/operacional/execucao/requerimentos', 'Requerimentos administrativos'],
  ['/operacional/execucao/contatos', 'Contatos'],
  // O item do Quadro acende nas CINCO abas.
  ['/inteligencia', 'Quadro econômico'],
  ['/inteligencia/previsoes', 'Quadro econômico'],
  ['/inteligencia/performance', 'Quadro econômico'],
  ['/inteligencia/recortes', 'Quadro econômico'],
  ['/inteligencia/carteiras', 'Quadro econômico'],
  ['/configuracoes', 'Configurações'],
  // As variantes que o react-router aceita para a mesma tela (rotas.test.ts).
  ['/operacional/analise/', 'Análise de crédito'],
  ['/Inteligencia/Previsoes', 'Quadro econômico'],
  // A página não encontrada não acende nada — nem embaixo de uma aba.
  ['/um-endereco-que-nao-existe', null],
  ['/inteligencia/recortes/x', null],
]

const rotuloDe = (to: string | null) => ITENS_DO_MENU.find((i) => i.to === to)?.label ?? null

/** Os endereços de tela dentro do layout, pela lista de rotas: o destino de cada uma. */
const TELAS_DO_LAYOUT = ROTAS.filter(
  (r) => r.guarda !== 'nenhuma' && r.tela !== 'NotFound',
).map((r) => r.redireciona ?? r.caminho)

describe('itemAtivo: um e só um item aceso por endereço', () => {
  it.each(ACESO)('%s acende %s', (endereco, rotulo) => {
    expect(rotuloDe(itemAtivo(endereco))).toBe(rotulo)
    expect(ITENS_DO_MENU.filter((i) => itemAcende(i, endereco))).toHaveLength(rotulo ? 1 : 0)
  })

  it('todo endereço de tela da lista de rotas acende exatamente um item', () => {
    // Os redirecionamentos contam pelo destino: é lá que a pessoa chega.
    expect(TELAS_DO_LAYOUT.length).toBeGreaterThan(10)
    for (const endereco of TELAS_DO_LAYOUT) {
      expect(ITENS_DO_MENU.filter((i) => itemAcende(i, endereco)), endereco).toHaveLength(1)
    }
  })

  it('acende por igualdade, nunca por prefixo (o defeito de e9c405e não volta)', () => {
    // Um item sem abas em /inteligencia — o "Visão Geral" de antes — não pode
    // acender nas telas embaixo dele: era o defeito, dois itens marcados.
    const raiz = { label: 'Raiz', to: '/inteligencia', icon: NAV_CONFIG.icon }
    expect(itemAcende(raiz, '/inteligencia')).toBe(true)
    for (const e of ['/inteligencia/performance', '/inteligencia/previsoes', '/inteligencia/x']) {
      expect(itemAcende(raiz, e), e).toBe(false)
    }
  })
})

describe('tituloDaAba: cada endereço tem título próprio na aba do navegador', () => {
  it('cada tela tem o seu, e nenhuma fica com o título genérico', () => {
    const titulos = TELAS_DO_LAYOUT.map(tituloDaAba)
    expect(titulos).not.toContain('Credijuris — Gestão de Créditos')
    // Sem repetir: o destino de um redirecionamento já está na lista como tela.
    const unicos = new Set(TELAS_DO_LAYOUT)
    expect(new Set(titulos).size).toBe(unicos.size)
  })

  it('no Quadro, o título é o da aba', () => {
    expect(tituloDaAba('/inteligencia')).toBe('Visão geral — Credijuris')
    expect(tituloDaAba('/inteligencia/previsoes')).toBe('Previsões — Credijuris')
    expect(tituloDaAba('/inteligencia/performance')).toBe('Performance — Credijuris')
    expect(tituloDaAba('/inteligencia/recortes')).toBe('Recortes — Credijuris')
    expect(tituloDaAba('/inteligencia/carteiras')).toBe('Carteiras — Credijuris')
  })

  it('fora do Quadro, o do item; sem lugar no menu, o genérico', () => {
    expect(tituloDaAba('/operacional/analise')).toBe('Análise de crédito — Credijuris')
    expect(tituloDaAba('/operacional/execucao/tarefas')).toBe('Tarefas — Credijuris')
    expect(tituloDaAba('/configuracoes')).toBe('Configurações — Credijuris')
    expect(tituloDaAba('/um-endereco-que-nao-existe')).toBe('Credijuris — Gestão de Créditos')
  })
})

describe('caminhoNoTopo', () => {
  it('a Análise, sem seção, mostra só o nome — o caminho não quebra', () => {
    expect(caminhoNoTopo('/operacional/analise')).toEqual(['Análise de crédito'])
  })

  it('no Quadro: setor › item › aba', () => {
    expect(caminhoNoTopo('/inteligencia/previsoes'))
      .toEqual(['Operacional', 'Quadro econômico', 'Previsões'])
    expect(caminhoNoTopo('/inteligencia')).toEqual(['Operacional', 'Quadro econômico', 'Visão geral'])
  })

  it('o resto: setor › tela; Configurações sem setor; a página não encontrada, vazio', () => {
    expect(caminhoNoTopo('/operacional/execucao/tarefas')).toEqual(['Operacional', 'Tarefas'])
    expect(caminhoNoTopo('/comercial/contratos')).toEqual(['Comercial', 'Geração de contratos'])
    expect(caminhoNoTopo('/configuracoes')).toEqual(['Configurações'])
    expect(caminhoNoTopo('/um-endereco-que-nao-existe')).toEqual([])
  })
})

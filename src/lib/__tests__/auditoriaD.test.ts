// Auditoria D (12/11/2026): Comercial, Quadro econômico, Configurações, layout,
// kit de interface e sessão.
//
// Um bloco por defeito corrigido. Cada um falharia antes da correção: ou a
// função pura não existia/devolvia errado, ou o fonte ainda tinha o desenho que
// quebrava.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Processo } from '../types'
import { avisoDosResumos, montarCarteiraDoInvestidor } from '../carteiraInvestidor'
import { evolucao } from '../relatorioCarteira'

const ler = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf-8')

describe('Carteiras: o `ok: false` da carteira-resumo (HTTP 200) é falha', () => {
  const base = { gerados: 0, pulados: 0, falhas: 0, restantes: 0 }

  it('"Gerar novamente" com o texto gerado mas não gravado: erro, não "Resumo gerado."', () => {
    const r = avisoDosResumos({ ...base, ok: false, gerados: 1, erro: 'não consegui gravar 1 resumo(s)' }, true)
    expect(r.avisos).toHaveLength(1)
    expect(r.avisos[0].tipo).toBe('erro')
    expect(r.avisos[0].texto).toMatch(/não consegui gravar/)
  })

  it('"Gerar novamente" que deu certo continua dizendo "Resumo gerado."', () => {
    expect(avisoDosResumos({ ...base, ok: true, gerados: 1 }, true).avisos).toEqual([
      { tipo: 'sucesso', texto: 'Resumo gerado.' },
    ])
  })

  it('varredura que não leu os créditos: erro, e não "nenhum crédito teve novidade"', () => {
    const r = avisoDosResumos({ ...base, ok: false, erro: 'não consegui ler os créditos da carteira: x' }, false)
    expect(r.acompanhar).toBe(false)
    expect(r.avisos.map((a) => a.tipo)).toEqual(['erro'])
    expect(r.avisos.some((a) => /novidade/.test(a.texto))).toBe(false)
  })

  it('lote que falhou com a cadeia seguindo: avisa a falha E acompanha os textos', () => {
    const r = avisoDosResumos({ ...base, ok: false, falhas: 6, restantes: 80, erro: 'lote' }, false)
    expect(r.acompanhar).toBe(true)
    expect(r.avisos.map((a) => a.tipo)).toEqual(['erro'])
  })

  it('último lote com todo crédito falhando: erro com a contagem', () => {
    const r = avisoDosResumos({ ...base, ok: true, falhas: 3 }, false)
    expect(r.avisos).toEqual([{ tipo: 'erro', texto: 'Nenhum resumo gerado. 3 créditos falharam.' }])
  })

  it('o caminho feliz não mudou', () => {
    expect(avisoDosResumos({ ...base, ok: true, restantes: 10 }, false)).toEqual({
      avisos: [{ tipo: 'sucesso', texto: 'Gerando os resumos — os textos vão aparecendo aqui.' }],
      acompanhar: true,
    })
    expect(avisoDosResumos({ ...base, ok: true, gerados: 2 }, false).avisos).toEqual([
      { tipo: 'sucesso', texto: '2 resumos gerados.' },
    ])
    expect(avisoDosResumos({ ...base, ok: true }, false).avisos[0].texto).toMatch(/Nenhum crédito teve novidade/)
  })

  it('a tela usa a regra, e os dois botões ficam desligados enquanto qualquer geração corre', () => {
    const src = ler('../../pages/comercial/CarteirasInvestidores.tsx')
    expect(src).toMatch(/avisoDosResumos\(r, !!vars\.processo_id\)/)
    expect(src).not.toMatch(/if \(r\.falhas > 0\) toast\.error/)
    // Os dois botões da mesma mutação: "Gerar resumos" e "Gerar novamente".
    expect(src.match(/disabled=\{gerar\.isPending\}/g)?.length).toBe(2)
  })
})

describe('Relatório da carteira: o teto de 120 meses não deixa o "hoje" de fora', () => {
  const HOJE = '2026-09-01'
  const proc = (p: Partial<Processo>): Processo =>
    ({
      id: 'x',
      numero_cnj: '50000000000000000001',
      tribunal: 'TJGO',
      cessionario: 'Investidor Teste',
      data_aquisicao: '2025-09-01',
      expectativa_liquidacao: '2026-12-01',
      status: 'ativo',
      data_liquidacao: null,
      especie_requisitorio: 'rpv',
      tipo_credito: ['principal'],
      capital_investido: 10_000,
      valor_face: 14_000,
      data_referencia: '2025-09-01',
      indice_atualizacao: 'selic',
      ja_recebido: null,
      valor_estimado_complementar: null,
      ...p,
    }) as Processo

  const calcular = (carteira: Processo[]) =>
    montarCarteiraDoInvestidor({
      investidor: 'Investidor Teste',
      mesRef: 'setembro de 2026',
      carteira,
      resumos: undefined,
      ultimaMov: undefined,
      capitalTotal: 20_000,
      jaRecebidoTotal: null,
      parametros: { selic_aa: 15, ipca_12m_aa: 4.5, data_referencia: HOJE },
      hoje: HOJE,
    })

  it('aquisição digitada como 2002 (era 2022): o mês de hoje está na janela', () => {
    const e = evolucao(calcular([proc({ id: 'a' }), proc({ id: 'b', data_aquisicao: '2002-03-10' })]))!
    expect(e.meses[e.idxHoje]).toBe('2026-09')
    expect(e.meses.length).toBeLessThanOrEqual(120)
    // A operação de 2002 continua no capital (a soma é acumulada, não por janela).
    expect(e.capital[e.idxHoje]).toBe(20_000)
  })

  it('carteira normal: a janela começa na data mais antiga, como sempre', () => {
    const e = evolucao(calcular([proc({ id: 'a', data_aquisicao: '2024-01-15' })]))!
    expect(e.meses[0]).toBe('2024-01')
    expect(e.meses[e.idxHoje]).toBe('2026-09')
  })
})

describe('Atalho "G e a letra": a espera acaba mesmo quando a tela consome a tecla', () => {
  it('o prefixo é zerado antes do `defaultPrevented`', () => {
    const src = ler('../../components/layout/Consultas.tsx')
    const zera = src.indexOf('prefixoEm.current = null')
    const sai = src.indexOf('if (e.defaultPrevented) return')
    expect(zera).toBeGreaterThan(-1)
    expect(sai).toBeGreaterThan(zera)
  })
})

describe('Sessão: perfil de outro usuário não sobrevive à falha de leitura', () => {
  it('a falha mantém o perfil só se for do mesmo usuário', () => {
    const src = ler('../../contexts/AuthContext.tsx')
    expect(src).toMatch(/else setProfile\(\(p\) => \(p && p\.id !== userId \? null : p\)\)/)
  })

  it('o administrador que corrige o próprio nome vê o nome novo sem recarregar', () => {
    const auth = ler('../../contexts/AuthContext.tsx')
    expect(auth).toMatch(/recarregarPerfil: \(\) => Promise<void>/)
    const usuarios = ler('../../pages/configuracoes/SecaoUsuarios.tsx')
    expect(usuarios).toMatch(/if \(editando\.id === user\?\.id\) await recarregarPerfil\(\)/)
  })

  it('o Ativar (sem confirmação) não manda duas atualizações', () => {
    const usuarios = ler('../../pages/configuracoes/SecaoUsuarios.tsx')
    expect(usuarios).toMatch(/function pedirTroca\(p: Profile\) \{[\s\S]{0,200}if \(trocando\) return/)
  })
})

describe('Integrações: OAB ilegível e responsável que saiu da ADVBOX', () => {
  const src = ler('../../pages/configuracoes/SecoesIntegracoes.tsx')

  it('a OAB ilegível pode sair da lista (antes, o Salvar a regravava para sempre)', () => {
    expect(src).toMatch(/setIlegiveis\(\[\]\)\s*\r?\n\s*pendencia\(true\)/)
  })

  it('o responsável gravado que não está mais na lista aparece, em vez de "Escolha…"', () => {
    expect(src).toMatch(/não está mais na ADVBOX/)
  })
})

describe('Geração de contratos: o card anterior sai ao trocar de card', () => {
  it('o efeito do card zera o `doCard` antes de ler o novo', () => {
    const src = ler('../../pages/comercial/GeracaoContratos.tsx')
    expect(src).toMatch(/originadorDoCardAplicado\.current = false[\s\S]{0,400}setDoCard\(null\)[\s\S]{0,80}\.from\('kommo_leads'\)/)
  })
})

describe('Quadro econômico: o "Tentar novamente" espera as duas leituras', () => {
  it('usePainel devolve a promessa das duas releituras', () => {
    const src = ler('../../pages/inteligencia/compartilhado.tsx')
    expect(src).toMatch(/const tentarDeNovo = \(\) => Promise\.all\(\[processos\.refetch\(\), params\.refetch\(\)\]\)/)
  })
})

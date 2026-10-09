// Auditoria de bugs do front (09/10/2026), fora da Análise de crédito.
//
// Um bloco por defeito corrigido. Cada um falharia antes da correção: ou
// porque a função pura não existia/devolvia errado, ou porque o fonte ainda
// tinha o desenho que quebrava.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { destinoDaResposta } from '../conversaDoAssistente'

const ler = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf-8')

describe('Assistente: a resposta volta para a conversa em que se perguntou', () => {
  it('a conversa não mudou: vai para a tela e é gravada nela', () => {
    expect(destinoDaResposta(3, 3, 'a')).toEqual({ naTela: true, gravarEm: 'a' })
    expect(destinoDaResposta(0, 0, null)).toEqual({ naTela: true, gravarEm: null })
  })

  it('abriu outra conversa enquanto esperava: grava na de origem, sem tocar a tela', () => {
    expect(destinoDaResposta(3, 4, 'a')).toEqual({ naTela: false, gravarEm: 'a' })
  })

  it('o componente grava pelo id do envio, não pelo id da conversa aberta agora', () => {
    const src = ler('../../components/Assistente.tsx')
    // Antes: `salvarConversa(comResposta)` lia `conversaAtualId` — a conversa
    // aberta no momento, que podia já ser outra.
    expect(src).not.toMatch(/salvarConversa\(comResposta\)/)
    expect(src).toMatch(/salvarConversa\(comResposta, destino\.gravarEm, marca\)/)
    expect(src).toMatch(/if \(destino\.naTela\) setMensagens\(comResposta\)/)
    // As duas trocas de conversa mudam a marca.
    expect(src.match(/marcaDaConversa\.current \+= 1/g)?.length).toBe(2)
  })
})

describe('Fase processual: situação e data não se desfazem uma à outra', () => {
  it('o pedido entra no cache na hora, e o pedido seguinte parte dele', async () => {
    const { aplicarSituacao } = await import('../situacaoDaFase')
    const linhas = [
      { processo_id: 'p1', situacao_id: 's-velha', situacao_data: '2026-10-01', outro: 1 },
      { processo_id: 'p2', situacao_id: null, situacao_data: null, outro: 2 },
    ]
    // 1º: grava a data nova (a situação vai como está).
    const r1 = linhas.find((l) => l.processo_id === 'p1')!
    const depoisDaData = aplicarSituacao(linhas, {
      processo_id: 'p1',
      situacao_id: r1.situacao_id,
      situacao_data: '2026-10-09',
    })
    // 2º: escolhe a situação — a data que segue junto é a NOVA, não a do carregamento.
    const r2 = depoisDaData.find((l) => l.processo_id === 'p1')!
    expect(r2.situacao_data).toBe('2026-10-09')
    expect(r2.outro).toBe(1)
    expect(depoisDaData[1]).toBe(linhas[1])
  })

  it('a lista e a gaveta usam o mesmo hook, com fila e atualização imediata do cache', () => {
    const src = ler('../../pages/operacional/execucao/FaseProcessual.tsx')
    expect(src).toMatch(/scope: \{ id: 'definir_situacao' \}/)
    expect(src).toMatch(/onMutate: async/)
    expect(src.match(/useDefinirSituacao\(\)/g)?.length).toBe(3) // definição + 2 usos
  })
})

describe('Quadro: valor abreviado não escreve "1.000 mil"', () => {
  it('valorAbreviado e brlCurto passam a "mi" quando o "mil" arredondaria para 1.000', async () => {
    const { valorAbreviado } = await import('../graficosDoQuadro')
    const { brlCurto } = await import('../numerosDosCreditos')
    expect(valorAbreviado(999_700)).toBe('1 mi')
    expect(brlCurto(999_700)).toBe('R$ 1 mi')
    expect(valorAbreviado(-999_700)).toBe('-1 mi')
    // Abaixo do corte, continua em mil.
    expect(valorAbreviado(999_400)).toBe('999 mil')
    expect(brlCurto(840_000)).toBe('R$ 840 mil')
  })
})

describe('tempoDecorrido: nunca "há 0 anos"', () => {
  it('de 360 a 364 dias diz "há 1 ano"', async () => {
    const { tempoDecorrido } = await import('../format')
    const agora = new Date(2026, 9, 9, 12)
    expect(tempoDecorrido('2025-10-14', agora)).toBe('há 1 ano') // 360 dias
    expect(tempoDecorrido('2025-10-10', agora)).toBe('há 1 ano') // 364 dias
    expect(tempoDecorrido('2025-11-13', agora)).toBe('há 11 meses')
  })
})

describe('Aviso repetido com "Desfazer" fica com a ação do último', () => {
  it('mesma mensagem com ação nova: sai o antigo, entra o novo com a ação dele', async () => {
    const { juntarAviso } = await import('../avisos')
    const desfazA = () => 'A'
    const desfazB = () => 'B'
    const a = { id: 1, type: 'success' as const, message: 'Publicação marcada como tratada.', action: { label: 'Desfazer', onClick: desfazA } }
    const b = { id: 2, type: 'success' as const, message: 'Publicação marcada como tratada.', action: { label: 'Desfazer', onClick: desfazB } }
    const r = juntarAviso([a], b)
    expect(r.repetido).toBeNull()
    expect(r.pilha).toHaveLength(1)
    expect(r.pilha[0].action.onClick()).toBe('B')
  })

  it('sem ação, continua juntando (renova o que está na tela)', async () => {
    const { juntarAviso } = await import('../avisos')
    const a = { id: 1, type: 'error' as const, message: 'Falhou.' }
    expect(juntarAviso([a], { id: 2, type: 'error', message: 'Falhou.' }).repetido).toBe(a)
  })
})

describe('CNPJ: município da Receita fora da lista do IBGE avisa', () => {
  it('cidade em branco vem com aviso, e não calada', async () => {
    const { ufCidadeDoCnpj } = await import('../cnpj')
    const mun = { RJ: ['Paraty', 'Rio de Janeiro'] }
    const r = ufCidadeDoCnpj({ uf: '', cidade: '' }, { uf: 'RJ', cidade: 'PARATI' }, mun)
    expect(r.uf).toBe('RJ')
    expect(r.cidade).toBe('')
    expect(r.aviso).toMatch(/PARATI/)
    // O que casa continua sem aviso.
    expect(ufCidadeDoCnpj({ uf: '', cidade: '' }, { uf: 'RJ', cidade: 'PARATY' }, mun)).toEqual({
      uf: 'RJ',
      cidade: 'Paraty',
      aviso: null,
    })
  })
})

describe('Relatório da carteira: capital de operação vencida e não paga não some do gráfico', () => {
  it('fica no comprometido até o mês de hoje e sai junto com a entrada no projetado', async () => {
    const { montarCarteiraDoInvestidor } = await import('../carteiraInvestidor')
    const { evolucao } = await import('../relatorioCarteira')
    const p = {
      id: 'id-1', numero_cnj: '50000000000000000001', numero_processo_administrativo: null,
      tribunal: 'TJGO', comarca: null, vara: null, cedente: 'Ana', cedente_advogado: null,
      cessionario: 'Investidor', originador: null, entidade_devedora: 'Estado',
      data_aquisicao: '2026-01-15', expectativa_liquidacao: '2026-06-30', instrumento: null,
      numero_rtdpj: null, status: 'ativo', data_liquidacao: null, especie_requisitorio: 'rpv',
      tipo_credito: ['principal'], capital_investido: 100_000, valor_face: 140_000,
      data_referencia: '2026-01-15', indice_atualizacao: 'selic', ja_recebido: null,
      valor_estimado_complementar: null, advbox_lawsuit_id: null, drive_pasta_id: null,
      created_at: '2026-01-15T00:00:00Z', updated_at: '2026-01-15T00:00:00Z',
    }
    const c = montarCarteiraDoInvestidor({
      investidor: 'Investidor', mesRef: 'outubro de 2026',
      carteira: [p as never], resumos: undefined, ultimaMov: undefined,
      capitalTotal: 100_000, jaRecebidoTotal: null,
      parametros: { selic_aa: 15, ipca_12m_aa: 4.5, data_referencia: '2026-10-09' },
      hoje: '2026-10-09',
    })
    const ev = evolucao(c)!
    const capitalEm = (mes: string) => ev.capital[ev.meses.indexOf(mes)]
    // Julho a outubro: a expectativa venceu, mas o dinheiro não entrou.
    for (const mes of ['2026-07', '2026-08', '2026-09', '2026-10']) expect(capitalEm(mes)).toBe(100_000)
    expect(ev.recebido[ev.meses.indexOf('2026-10')]).toBe(0)
  })
})

describe('Crédito pela pasta: a 2ª onda não apaga a correção feita à mão', () => {
  it('só escreve no campo que continua como a onda anterior deixou', async () => {
    const { mesclarOndaDaPasta } = await import('../ondasDaPasta')
    const depoisDa1a = { numero_cnj: '1', tribunal: 'TJGO', capital_investido: null as number | null, tipo_credito: ['principal'] }
    // Entre as ondas, a pessoa corrigiu o tribunal.
    const atual = { ...depoisDa1a, tribunal: 'TRF-1' }
    const r = mesclarOndaDaPasta(atual, depoisDa1a, { tribunal: 'TJGO', capital_investido: 50_000, tipo_credito: ['principal'] })
    expect(r.tribunal).toBe('TRF-1')
    expect(r.capital_investido).toBe(50_000)
    expect(r.numero_cnj).toBe('1')
  })

  it('a leitura em voo morre quando a aba "Pela pasta" desmonta; a escolha segue a pasta, não a posição', () => {
    const src = ler('../../components/NovoCreditoDoDrive.tsx')
    expect(src).toMatch(/\(\) => \(\) => \{\s*escolhaAtual\.current\+\+/)
    expect(src).toMatch(/setEscolhidaId\(c\?\.id \?\? null\)/)
    expect(src).not.toMatch(/valor=\{escolhida\}/)
  })
})

describe('Janelas: o foco entra no painel já no primeiro render aberto', () => {
  it('Drawer e menu do celular desenham com `open`, sem esperar o `rendered`', () => {
    expect(ler('../../components/ui/Drawer.tsx')).toMatch(/if \(!open && !rendered\) return null/)
    expect(ler('../../components/layout/Sidebar.tsx')).toMatch(/\{\(rendered \|\| mobileOpen\) && \(/)
  })

  it('a gaveta do menu fecha ao mudar de tela e ao virar tela de computador', () => {
    const src = ler('../../components/layout/AppLayout.tsx')
    expect(src).toMatch(/useEffect\(\(\) => \{\s*setMobileOpen\(false\)\s*\}, \[pathname\]\)/)
    expect(src).toMatch(/matchMedia\(LARGURA_DO_MENU_FIXO\)/)
  })

  it('Combobox e MultiCombobox fecham a lista ao sair do campo', () => {
    const src = ler('../../components/ui/Combobox.tsx')
    // Os três campos (Combobox, ComboboxTexto e MultiCombobox).
    expect(src.match(/onBlur=\{/g)?.length).toBe(3)
  })
})

describe('Geração de contratos: vir do card RPV não muda a categoria lembrada', () => {
  it('o preenchimento usa o ajuste sem gravar', () => {
    const src = ler('../../pages/comercial/GeracaoContratos.tsx')
    expect(src).toMatch(/ajustarCategoria\(CATEGORIA_RPV\)/)
    expect(src).not.toMatch(/setCategoria\(CATEGORIA_RPV\)/)
    expect(ler('../lembrarNaTela.ts')).toMatch(/return \[valor, escolher, setValor\]/)
  })
})

describe('Planilha para a IA: data que vem de fórmula sai no dia certo', () => {
  it('=HOJE() de 12/08/2026 é 2026-08-12, e não o dia anterior às 21h', async () => {
    const tzAntes = process.env.TZ
    process.env.TZ = 'America/Sao_Paulo'
    try {
      const ExcelJS = (await import('exceljs')).default
      const wb = new ExcelJS.Workbook()
      const aba = wb.addWorksheet('A')
      const c = aba.getCell('A1')
      c.value = { formula: 'TODAY()', result: new Date(Date.UTC(2026, 7, 12)) }
      c.numFmt = 'dd/mm/yyyy'
      const bytes = (await wb.xlsx.writeBuffer()) as ArrayBuffer
      const { textoDeXlsx } = await import('../textoDeArquivo')
      const texto = await textoDeXlsx(bytes)
      expect(texto).toContain('2026-08-12')
      expect(texto).not.toMatch(/GMT/)
    } finally {
      process.env.TZ = tzAntes
    }
  }, 120_000) // o ExcelJS demora a carregar
})

describe('Quadro: avisos que sumiam ou diziam o contrário', () => {
  it('Previsões: o aviso dos incalculáveis aparece também sem bloco', () => {
    expect(ler('../../pages/inteligencia/Previsoes.tsx')).toMatch(
      /\(forecast\.blocos\.length > 0 \|\| incalculaveis\.length > 0\) &&/,
    )
  })
  it('Performance: "média muitas vezes maior" só com mediana positiva; extremos vazios não dizem "nenhuma encerrada"', () => {
    const src = ler('../../pages/inteligencia/Performance.tsx')
    expect(src).toMatch(/carteira\.tir\.mediana > 0 && carteira\.tir\.media > carteira\.tir\.mediana \* 2/)
    expect(src).toMatch(/Nenhuma operação extrema/)
  })
  it('Créditos e a ficha do crédito: o "hoje" anda com o dia', () => {
    for (const f of ['../../pages/operacional/execucao/Processos.tsx', '../../components/CreditoDrawer.tsx']) {
      const src = ler(f)
      expect(src).not.toMatch(/useMemo\(\(\) => hojeISO\(\), \[\]\)/)
      expect(src).toMatch(/useHojeQueAnda\(\)/)
    }
  })
})

describe('Drive: token recusado é esquecido; pasta com mais de 200 arquivos é lida inteira', () => {
  it('401 esquece o token e pede outro; listarArquivos segue o nextPageToken', async () => {
    const { vi } = await import('vitest')
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'cliente-de-teste')
    const guardado: Record<string, string> = {
      'credijuris.drive.token': JSON.stringify({ valor: 'tok', expiraEm: Date.now() + 3_600_000 }),
    }
    vi.stubGlobal('sessionStorage', {
      getItem: (k: string) => guardado[k] ?? null,
      setItem: (k: string, v: string) => void (guardado[k] = v),
      removeItem: (k: string) => void delete guardado[k],
    })
    const paginas = [
      { files: [{ id: 'a', name: 'a.pdf', mimeType: 'application/pdf' }], nextPageToken: 'p2' },
      { files: [{ id: 'b', name: 'b.pdf', mimeType: 'application/pdf' }] },
    ]
    const pedidos: string[] = []
    vi.stubGlobal('fetch', async (url: string) => {
      pedidos.push(url)
      return new Response(JSON.stringify(paginas[pedidos.length - 1]), { status: 200 })
    })
    try {
      vi.resetModules()
      const drive = await import('../drive')
      const lidos = await drive.listarArquivos('pasta')
      expect(lidos.map((a) => a.id)).toEqual(['a', 'b'])
      expect(pedidos[1]).toMatch(/pageToken=p2/)

      expect(() => drive.tratarTokenRecusado(403)).not.toThrow()
      expect(() => drive.tratarTokenRecusado(401)).toThrow(/Tente de novo/)
      expect(guardado['credijuris.drive.token']).toBeUndefined()
    } finally {
      vi.unstubAllGlobals()
      vi.unstubAllEnvs()
    }
  })
})

describe('DJEN: a tela lê as OABs gravadas como o servidor lê', () => {
  it('"54.162/GO", "SP/54162", "54162-SP" e "OAB/SP 54162" não viram outra OAB', async () => {
    const { lerOabGravada } = await import('../formulariosDasConfiguracoes')
    expect(lerOabGravada('54.162/GO')).toEqual({ numero: '54162', uf: 'GO' })
    expect(lerOabGravada('SP/54162')).toEqual({ numero: '54162', uf: 'SP' })
    expect(lerOabGravada('54162-SP')).toEqual({ numero: '54162', uf: 'SP' })
    expect(lerOabGravada('OAB/SP 54162')).toEqual({ numero: '54162', uf: 'SP' })
    expect(lerOabGravada('54162/GO')).toEqual({ numero: '54162', uf: 'GO' })
    expect(lerOabGravada('OAB 54162')).toBeNull()
  })

  it('o que não dá para ler volta ao banco no Salvar, em vez de sumir', () => {
    const src = ler('../../pages/configuracoes/SecoesIntegracoes.tsx')
    expect(src).toMatch(/lerOabGravada\(s\)/)
    expect(src).toMatch(/\.concat\(ilegiveis\)/)
    expect(src).not.toMatch(/\?\? 'GO'\)\.toUpperCase\(\)/)
  })
})

describe('Fase processual: data pela metade não apaga a gravada; janela de 7 dias local e paginada', () => {
  it('dataIncompleta só com o campo vazio E o navegador acusando entrada ruim', async () => {
    const { dataIncompleta } = await import('../situacaoDaFase')
    expect(dataIncompleta('', true)).toBe(true)
    expect(dataIncompleta('', false)).toBe(false) // limpou de propósito
    expect(dataIncompleta('2026-10-09', false)).toBe(false)
  })
  it('o campo de data passa pela checagem; a janela usa a data local e lê em páginas', () => {
    const src = ler('../../pages/operacional/execucao/FaseProcessual.tsx')
    expect(src).toMatch(/onBlur=\{\(e\) => gravarSeCompleta\(e\.target\)\}/)
    expect(src).not.toMatch(/toISOString\(\)\.slice\(0, 10\)/)
    expect(src).toMatch(/const desde = isoDiasAtras\(7\)/)
    expect(src).not.toMatch(/^\s*\.limit\(3000\)/m)
  })
})

describe('Publicações e Movimentações: nada escondido pelo teto; sem sincronização dupla', () => {
  const src = ler('../../pages/operacional/execucao/PublicacoesMovimentacoes.tsx')
  it('as listas leem a janela em páginas', () => {
    expect(src.match(/lerEmPaginas<(DjenRow|MovRow)>/g)?.length).toBe(2)
    expect(src).not.toMatch(/use a busca para encontrar/)
  })
  it('voltar à aba não dispara outra sincronização com uma em curso', () => {
    expect(src).toMatch(/if \(qc\.isMutating\(\{ mutationKey: \[\.\.\.chave\] \}\) > 0\) return/)
    expect(src).toMatch(/mutationKey: SYNC_DJEN/)
    expect(src).toMatch(/mutationKey: SYNC_ADVBOX/)
    expect(src).not.toMatch(/sync\.isPending/)
  })
})

describe('Configurações: travas e pendências', () => {
  const src = ler('../../pages/configuracoes/SecoesAssistente.tsx')
  it('Skills: ativar/desativar e remover não correm duas vezes', () => {
    expect(src).toMatch(/if \(emCursoRef\.current\.has\(id\)\) return/)
    expect(src).toMatch(/loading=\{emCurso\.has\(s\.id\)\}/)
  })
  it('Roteiro e Justificativa: o gravado entra no cache antes de soltar o campo', () => {
    const roteiro = src.slice(src.indexOf('export function SecaoRoteiro'), src.indexOf('export function SecaoJustificativa'))
    expect(roteiro.indexOf('qc.setQueryData')).toBeGreaterThan(-1)
    expect(roteiro.indexOf('qc.setQueryData')).toBeLessThan(roteiro.indexOf('setTocado(false)'))
    const just = src.slice(src.indexOf('export function SecaoJustificativa'))
    expect(just.indexOf('qc.setQueryData')).toBeGreaterThan(-1)
    expect(just.indexOf('qc.setQueryData')).toBeLessThan(just.indexOf('setTocado(false)'))
  })
  it('Escavador: salvar um token não apaga a pendência do outro', () => {
    const esc = ler('../../pages/configuracoes/SecoesConsultas.tsx')
    expect(esc).toMatch(/pendencia\(!!token\.trim\(\)\)/)
    expect(esc).toMatch(/pendencia\(!!tokenCallback\.trim\(\)\)/)
  })
  it('Cotação: X e Esc não fecham a janela durante o envio', () => {
    expect(ler('../../components/JanelaDeCotacao.tsx')).toMatch(/if \(!enviando\) onFechar\(\)/)
  })
})

describe('Aba nova depois de esperar: bloqueada, o link vai num botão', () => {
  it('abrirEmNovaAba diz se abriu e corta o vínculo com a página', async () => {
    const { abrirEmNovaAba } = await import('../abrirEmNovaAba')
    const aba = { opener: {} as unknown }
    expect(abrirEmNovaAba('https://x', () => aba as unknown as Window)).toBe(true)
    expect(aba.opener).toBeNull()
    expect(abrirEmNovaAba('https://x', () => null)).toBe(false)
  })
  it('pasta do crédito e petição salva usam o detector', () => {
    expect(ler('../../components/NumeroProcessoDrive.tsx')).toMatch(/if \(!abrirEmNovaAba\(link\)\)/)
    expect(ler('../../components/PeticaoModal.tsx')).toMatch(/if \(abrirEmNovaAba\(link\)\)/)
  })
})

describe('ComboboxTexto: Escape com a lista fora da vista é da janela', () => {
  it('não consome o Escape quando não há lista à vista', () => {
    expect(ler('../../components/ui/Combobox.tsx')).toMatch(
      /if \(e\.key === 'Escape' && !\(filtradas\.length > 0 \|\| consulta\)\) \{\s*setAberto\(false\)\s*return/,
    )
  })
})

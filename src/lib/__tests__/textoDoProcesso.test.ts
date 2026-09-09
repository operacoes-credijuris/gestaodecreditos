import { describe, it, expect } from 'vitest'
import { montarTextoDoProcesso, semRodapeDeAssinatura, type PaginaLida } from '../textoDoProcesso'

/**
 * O texto do processo que a IA recebe, quando ele não cabe inteiro.
 *
 * Testado porque a seleção decide o que a IA vê. O corte antigo guardava 60%
 * do início e 40% do fim: petição inicial e movimentações recentes, sem a conta
 * da contadoria que fica no meio — e a IA precificava o valor da causa.
 */

const pag = (arquivo: string, numero: number, texto: string): PaginaLida => ({ arquivo, numero, texto })
const enche = (n: number, semente = 'x') => Array.from({ length: n }, (_, i) => `${semente}${i % 10}`).join(' ')

describe('montarTextoDoProcesso', () => {
  it('cabendo tudo, vai tudo, na ordem, com cabeçalho por arquivo e marcador por página', () => {
    const r = montarTextoDoProcesso(
      [pag('a.pdf', 1, 'um'), pag('a.pdf', 2, 'dois'), pag('b.pdf', 1, 'tres')],
      10_000,
    )
    expect(r.cortou).toBe(false)
    expect(r.incluidas).toBe(3)
    expect(r.omitidas).toBe(0)
    expect(r.texto).toContain('===== ARQUIVO: a.pdf (2 pág.) =====')
    expect(r.texto).toContain('===== ARQUIVO: b.pdf (1 pág.) =====')
    expect(r.texto.indexOf('[p.1]\num')).toBeLessThan(r.texto.indexOf('[p.2]\ndois'))
    expect(r.texto.indexOf('[p.2]\ndois')).toBeLessThan(r.texto.indexOf('[p.1]\ntres'))
  })

  it('página em branco não conta', () => {
    const r = montarTextoDoProcesso([pag('a.pdf', 1, '   '), pag('a.pdf', 2, 'x')], 10_000)
    expect(r.incluidas).toBe(1)
  })

  it('sem página nenhuma devolve vazio sem quebrar', () => {
    expect(montarTextoDoProcesso([], 1000).texto).toBe('')
  })

  it('não cabendo, prefere a página que fala da conta à petição inicial do meio', () => {
    // 60 páginas de 400 caracteres = 24 mil; orçamento de 8 mil. As páginas 7
    // a 56 são "recheio"; a 30 é a conta da contadoria.
    const paginas: PaginaLida[] = []
    for (let i = 1; i <= 60; i++) {
      const texto =
        i === 30
          ? 'CONTADORIA JUDICIAL — cálculo homologado. Valor bruto atualizado R$ 84.320,10. Imposto de renda. INSS. Requisitório. ' + enche(50)
          : `petição ${enche(70)}`
      paginas.push(pag('processo.pdf', i, texto))
    }
    const r = montarTextoDoProcesso(paginas, 8_000)
    expect(r.cortou).toBe(true)
    expect(r.texto).toContain('[p.30]')
    expect(r.texto).toContain('CONTADORIA JUDICIAL')
    // As primeiras (identificação) e as últimas (andamento atual) sempre vão.
    expect(r.texto).toContain('[p.1]')
    expect(r.texto).toContain('[p.6]')
    expect(r.texto).toContain('[p.60]')
    expect(r.texto).toContain('[p.57]')
    // E o buraco é marcado, com a contagem.
    expect(r.texto).toMatch(/\[… \d+ página\(s\) omitida\(s\) por tamanho …\]/)
    expect(r.incluidas + r.omitidas).toBe(60)
  })

  it('empatando na pontuação, a página mais recente vence', () => {
    // Duas páginas idênticas de recheio disputando a última vaga: fica a de
    // número maior — mais perto do andamento atual.
    const paginas: PaginaLida[] = []
    for (let i = 1; i <= 40; i++) paginas.push(pag('p.pdf', i, `recheio ${enche(60)}`))
    const r = montarTextoDoProcesso(paginas, 6_000)
    // Obrigatórias: 1-6 e 37-40. O que sobrar do orçamento vai para as páginas
    // do meio MAIS RECENTES: um bloco contíguo terminando na 36.
    const incluidasDoMeio = [...r.texto.matchAll(/\[p\.(\d+)\]/g)]
      .map((m) => Number(m[1]))
      .filter((n) => n > 6 && n < 37)
    expect(incluidasDoMeio.length).toBeGreaterThan(0)
    expect(Math.max(...incluidasDoMeio)).toBe(36)
    expect(Math.min(...incluidasDoMeio)).toBe(37 - incluidasDoMeio.length)
  })

  it('respeita o teto mesmo com uma página gigante', () => {
    const r = montarTextoDoProcesso([pag('a.pdf', 1, enche(20_000))], 5_000)
    expect(r.texto.length).toBeLessThanOrEqual(5_000)
  })

  it('a ordem de saída é a do processo, não a da prioridade', () => {
    const paginas: PaginaLida[] = []
    for (let i = 1; i <= 30; i++) {
      paginas.push(pag('p.pdf', i, i === 15 ? 'homologação do cálculo ' + enche(60) : `x ${enche(60)}`))
    }
    const r = montarTextoDoProcesso(paginas, 6_000)
    const ordem = [...r.texto.matchAll(/\[p\.(\d+)\]/g)].map((m) => Number(m[1]))
    expect(ordem).toEqual([...ordem].sort((a, b) => a - b))
    expect(ordem).toContain(15)
  })
})

/**
 * O rodapé de assinatura sai da CONTA de densidade — e só ele.
 *
 * A regressão que isto fixa: cada página do PDF chega como UMA linha, e a
 * versão anterior do filtro (`^.*frase.*$` com flag m) casava a linha inteira.
 * Página de petição com carimbo no pé media zero, o processo virava
 * "digitalização" e todas as páginas iam para a esteira de imagens.
 */
describe('semRodapeDeAssinatura', () => {
  const carimbo =
    'Documento assinado digitalmente conforme MP nº 2.200-2/2001 de 24/08/2001. ' +
    'Este documento pode ser verificado no endereço eletrônico http://www.tjgo.jus.br/verificar ' +
    'código de verificação 3F2A-91BC-77D0. Página 12 de 140'
  const peticao =
    'EXCELENTÍSSIMO SENHOR DOUTOR JUIZ DE DIREITO. NAZARENO SANTANA FLORAMBEL FILHO requer a ' +
    'execução dos honorários arbitrados em 117 UHDs, no valor atualizado de R$ 23.588,37, conforme memória de cálculo anexa.'

  it('mantém o conteúdo da página quando o carimbo está no fim', () => {
    const t = semRodapeDeAssinatura(`${peticao} ${carimbo}`)
    expect(t).toContain('R$ 23.588,37')
    expect(t).toContain('117 UHDs')
    expect(t).not.toContain('2.200-2')
    expect(t).not.toContain('3F2A-91BC-77D0')
  })

  it('mantém o conteúdo quando o carimbo está no começo ou no meio', () => {
    expect(semRodapeDeAssinatura(`${carimbo} ${peticao}`)).toContain('R$ 23.588,37')
    const meio = `${peticao.slice(0, 60)} assinado eletronicamente por JOÃO DA SILVA ${peticao.slice(60)}`
    const t = semRodapeDeAssinatura(meio)
    expect(t).toContain('EXCELENTÍSSIMO')
    expect(t).toContain('memória de cálculo anexa')
  })

  // A propriedade que a versão antiga violava: página com conteúdo de verdade
  // nunca mede abaixo do mínimo só por ter carimbo.
  it('página de petição com carimbo continua acima do mínimo de 80 caracteres', () => {
    expect(semRodapeDeAssinatura(`${peticao} ${carimbo}`).length).toBeGreaterThan(80)
  })

  // E a digitalização continua sendo reconhecida: sobrando só o carimbo,
  // sobra quase nada.
  it('página só com carimbo fica abaixo do mínimo', () => {
    expect(semRodapeDeAssinatura(carimbo).length).toBeLessThan(80)
    expect(semRodapeDeAssinatura(`${carimbo} ${carimbo}`).length).toBeLessThan(80)
  })

  it('funciona no texto inteiro, com páginas separadas por quebra de linha', () => {
    const doc = [`${peticao} ${carimbo}`, `Decisão: homologo os cálculos. ${carimbo}`, carimbo].join('\n')
    const t = semRodapeDeAssinatura(doc)
    expect(t).toContain('R$ 23.588,37')
    expect(t).toContain('homologo os cálculos')
    expect(t).not.toContain('Página 12 de 140')
  })

  it('texto sem carimbo passa intacto (a menos do espaço normalizado)', () => {
    expect(semRodapeDeAssinatura('  a   b  ')).toBe('a b')
    expect(semRodapeDeAssinatura('')).toBe('')
  })

  // #67 A FOLGA TEM DE CONTAR OS BURACOS.
  //
  // Cada trecho omitido escreve "[… N página(s) omitida(s) por tamanho …]", uns
  // 46 caracteres, e a escolha por pontuação pega páginas ESPALHADAS: um
  // processo em que só as ímpares pontuam gera um buraco por página escolhida.
  // A folga antiga (80 por arquivo) não cobria nada disso, o texto estourava e
  // a defesa final fatiava o FIM — as páginas do andamento atual —, com
  // `incluidas` continuando a contá-las.
  it('cabe no teto mesmo com um buraco por página escolhida', () => {
    const paginas = Array.from({ length: 200 }, (_, i) =>
      // Só as ímpares pontuam: a seleção fica intercalada, e cada escolhida
      // vira um buraco.
      pag('autos.pdf', i + 1, i % 2 === 0 ? enche(40, 'z') : `sentença honorários juros ${enche(30)}`))
    const r = montarTextoDoProcesso(paginas, 20_000)
    expect(r.cortou).toBe(true)
    expect(r.texto.length).toBeLessThanOrEqual(20_000)
  })

  it('o texto termina com uma página inteira, não numa fatia', () => {
    const paginas = Array.from({ length: 120 }, (_, i) =>
      pag('autos.pdf', i + 1, i % 2 === 0 ? enche(60, 'w') : `sentença juros correção ${enche(50)}`))
    const r = montarTextoDoProcesso(paginas, 15_000)
    expect(r.texto.length).toBeLessThanOrEqual(15_000)
    // O número de marcadores de página tem de bater com a contagem informada:
    // uma fatia no fim deixava um marcador pela metade e a contagem mentindo.
    expect((r.texto.match(/\[p\.\d+\]/g) ?? []).length).toBe(r.incluidas)
    expect(r.incluidas + r.omitidas).toBe(120)
  })

  // #71 A CONTA É FEITA DE DINHEIRO, e a pontuação era só de palavra: a folha
  // de rosto da contadoria batia o teto e as folhas de TOTAL — colunas de
  // datas, índices e reais — perdiam para qualquer petição com vinte
  // ocorrências de "sentença/honorários/juros", que num processo há às centenas.
  it('a folha de valores entra na frente da petição de recheio', () => {
    const recheio = `sentença honorários juros correção monetária ${'sentença honorários juros '.repeat(10)}`
    const paginas = [
      pag('autos.pdf', 1, 'capa'),
      ...Array.from({ length: 60 }, (_, i) => pag('autos.pdf', i + 2, recheio)),
      pag('autos.pdf', 62, 'CONTADORIA JUDICIAL memória de cálculo homologação'),
      pag('autos.pdf', 63, 'R$ 84.320,10 R$ 12.500,00 R$ 3.200,00 R$ 1.100,50 R$ 96.820,60 R$ 7.218,00'),
      pag('autos.pdf', 64, 'R$ 45.000,00 R$ 2.000,00 R$ 500,00 R$ 47.500,00 R$ 9.000,00 R$ 1.234,56'),
      pag('autos.pdf', 65, 'andamento atual'),
    ]
    // Teto apertado: cabe pouca coisa, e o que couber revela a preferência.
    const r = montarTextoDoProcesso(paginas, 6_000)
    expect(r.cortou).toBe(true)
    expect(r.texto).toContain('R$ 84.320,10')
    expect(r.texto).toContain('R$ 45.000,00')
    // E o recheio, que só tem palavra, fica de fora do que sobrou.
    expect(r.omitidas).toBeGreaterThan(40)
  })

  // O BÔNUS DE VIZINHANÇA: a memória de cálculo tem uma folha de rosto e as
  // folhas de tabela em sequência. A de rosto pontua alto por palavra; as de
  // tabela herdam metade dela e entram junto, que é como existem nos autos.
  it('a página vizinha de uma que pontua alto herda parte da pontuação', () => {
    const neutra = enche(30, 'n')
    const paginas = [
      pag('autos.pdf', 1, 'capa'),
      ...Array.from({ length: 30 }, (_, i) => pag('autos.pdf', i + 2, neutra)),
      pag('autos.pdf', 32, 'CONTADORIA cálculo homologação sentença honorários juros correção INSS IR'),
      pag('autos.pdf', 33, neutra),
      pag('autos.pdf', 34, 'fim'),
    ]
    const r = montarTextoDoProcesso(paginas, 3_200)
    expect(r.texto).toContain('CONTADORIA')
    // A vizinha da folha de rosto entra antes de uma neutra distante.
    expect(r.texto).toContain('[p.33]')
  })
})

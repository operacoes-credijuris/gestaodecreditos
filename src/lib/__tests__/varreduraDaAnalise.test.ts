/**
 * A VARREDURA DE 23/10/2026 NA ANÁLISE DE CRÉDITO (tela e consultas): os
 * defeitos achados, presos pelo código-fonte — a tela não roda sem navegador
 * aqui, e cada um deles é uma linha que pode voltar sem ninguém notar.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const tela = readFileSync(join(__dirname, '..', '..', 'pages/operacional/AnaliseCredito.tsx'), 'utf8')
const kommo = readFileSync(join(__dirname, '..', 'kommo.ts'), 'utf8')

/** O corpo de uma função do arquivo, do nome até o próximo `export function`/`function` do mesmo nível. */
function trecho(texto: string, inicio: string, tamanho = 2500): string {
  const i = texto.indexOf(inicio)
  expect(i, `não achei "${inicio}"`).toBeGreaterThanOrEqual(0)
  return texto.slice(i, i + tamanho)
}

describe('as janelas que movem esquecem o movimento sem nota ao fechar', () => {
  it('o "Sem proposta" também — era a única que não esquecia', () => {
    const dialogo = trecho(tela, 'open={semPropostaDe !== null}', 3000)
    expect(dialogo).toMatch(/onClose=\{\(\) => \{\s*if \(semPropostaDe\) esquecerMovimentos\(semPropostaDe\.kommo_lead_id\)/)
  })
})

describe('a fila dos autos lê o cache de agora', () => {
  it('lerArquivosComCache consulta o ref, e não o estado do render em que nasceu', () => {
    const f = trecho(tela, 'async function lerArquivosComCache(', 900)
    expect(f).toContain('arquivosCacheAtual.current[id]')
    expect(f).not.toMatch(/const lidos = arquivosCache\[id\]/)
    expect(tela).toContain('arquivosCacheAtual.current = arquivosCache')
  })
})

describe('a busca não relê o cadastro da coluna a cada tecla', () => {
  it('o mapa de "tem número" depende da coluna, e não da lista filtrada', () => {
    const m = trecho(tela, 'const temNumero = useMemo(', 300)
    expect(m).toContain('[colunaAberta]')
    expect(m).not.toContain('[lista]')
  })
})

describe('o "Ver histórico (+N)" conta o que o histórico mostra', () => {
  it('pelos blocos (anexo junto da anotação), e não pelas notas cruas', () => {
    expect(tela).toContain('const posteriores = grupos.length - 1')
    expect(tela).not.toContain('const posteriores = notas.length - 1')
  })
})

describe('a régua do motivo é uma só', () => {
  it('a janela da mensagem usa MINIMO_DO_MOTIVO, sem o 10 escrito à mão', () => {
    const janela = tela.slice(tela.indexOf('function JanelaDeMensagem('), tela.indexOf('function AvisoDoRascunho('))
    expect(janela.length).toBeGreaterThan(1000)
    expect(janela).not.toMatch(/\.trim\(\)\.length (<|>=) 10\b/)
    expect(janela).toContain('{MINIMO_DO_MOTIVO} caracteres ou mais')
  })
})

describe('a pílula das propostas: o nome que se ouve contém o que se lê', () => {
  it('"Ver as 3 propostas cadastradas", com o texto da pílula dentro', () => {
    expect(tela).toContain('const rotulo = `Ver as ${rotuloDasPropostas(propostas.length)} cadastradas`')
  })
})

describe('as consultas do espelho não perdem nem repetem linha', () => {
  it('os cards paginam por uma ordem que não muda durante a leitura', () => {
    const f = trecho(kommo, 'export function useKommoLeads(', 2000)
    expect(f).toContain(".order('kommo_lead_id', { ascending: false })")
    expect(f).not.toContain(".order('atualizado_em'")
  })

  it('as análises prontas paginam, em vez de parar no teto do PostgREST', () => {
    const f = trecho(kommo, 'export function useAnalisesProntas(', 2000)
    expect(f).toContain(".from('kommo_analise_interna')")
    expect(f).toContain('.range(de, de + POR_PAGINA - 1)')
    expect(f).toContain(".order('kommo_lead_id')")
  })

  it('o comentário do agruparPorAba fica em cima dele (e não do dataDaEtapa)', () => {
    const i = kommo.indexOf('export function agruparPorAba(')
    const antes = kommo.slice(Math.max(0, i - 1200), i)
    expect(antes).toContain('Separa os cards nas abas')
    const j = kommo.indexOf('export function dataDaEtapa(')
    expect(kommo.slice(Math.max(0, j - 900), j)).not.toContain('Separa os cards nas abas')
  })
})

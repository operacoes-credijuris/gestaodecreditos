import { describe, it, expect } from 'vitest'
import {
  FORMA_DA_ENTREGA,
  montarEntrega,
  type AutosGuardados,
} from '../../../supabase/functions/_shared/entregaDosAutos.ts'

/**
 * O QUE A FERRAMENTA ENTREGA quando o Claude vem buscar os autos.
 *
 * Este texto decide como a análise sai — o método que ela segue, onde ela é
 * escrita e o que nela é prova. Vale testar, e não conferir a olho.
 */
const guardado: AutosGuardados = {
  lead_id: 15269795,
  titulo: 'Dr. Gabriel Perin - Kauá Henrique Silva Barros - 5012860-38.2023.4.03.6105 - Honorários contratuais - 30%',
  criado_em: '2026-09-11T03:12:00.000Z',
  arquivos: [
    { nome: 'processo.pdf', paginas: 239, texto: 'TEOR DOS AUTOS PRINCIPAIS' },
    { nome: 'requisitorio.pdf', paginas: 3, texto: 'TEOR DO REQUISITORIO' },
  ],
}

describe('montarEntrega', () => {
  // A ORDEM É O ARGUMENTO: o método antes do material. O roteiro diz o que fazer
  // com o que vem depois dele, então tem de vir antes.
  it('põe o método antes dos autos', () => {
    const t = montarEntrega(guardado)
    expect(t.indexOf('# PROMPT — Qualificação Jurídica Preliminar')).toBe(0)
    expect(t.indexOf('FORMA DA ENTREGA')).toBeLessThan(t.indexOf('## AUTOS ANEXOS'))
    expect(t.indexOf('## DADOS DO CARD')).toBeLessThan(t.indexOf('## AUTOS ANEXOS'))
  })

  it('entrega todos os arquivos, numerados e na ordem', () => {
    const t = montarEntrega(guardado)
    expect(t).toContain('=== ARQUIVO 1/2: processo.pdf (239 páginas) ===')
    expect(t).toContain('=== ARQUIVO 2/2: requisitorio.pdf (3 páginas) ===')
    expect(t).toContain('TEOR DOS AUTOS PRINCIPAIS')
    expect(t).toContain('TEOR DO REQUISITORIO')
    expect(t.indexOf('processo.pdf')).toBeLessThan(t.indexOf('requisitorio.pdf'))
  })

  // CADASTRO NÃO É PROVA, e o texto tem de dizer isso: o roteiro exige documento
  // e página para cada campo da ficha, e o título do card é o que o comercial
  // escreveu.
  it('rotula o título do card como cadastro, não como fonte', () => {
    const t = montarEntrega(guardado)
    expect(t).toContain('NÃO é fonte documental')
    expect(t).toContain(guardado.titulo)
    expect(t).toContain('divergência entre o card e os autos')
  })

  it('sem título, o card não finge ter um', () => {
    expect(montarEntrega({ ...guardado, titulo: '' })).toContain('(card sem título)')
  })

  /**
   * O ROTEIRO É EDITÁVEL PELA OPERAÇÃO, e o padrão do repositório é o CHÃO.
   *
   * Quem edita está num campo de texto, e um salvamento em branco não pode
   * significar uma análise sem método — sairia uma redação convincente sem ficha,
   * sem eixos e sem regra de ancoragem, que é a pior forma de errar aqui.
   */
  it('usa o roteiro que a operação editou', () => {
    const t = montarEntrega(guardado, '# ROTEIRO NOVO DA CASA')
    expect(t.indexOf('# ROTEIRO NOVO DA CASA')).toBe(0)
    expect(t).not.toContain('# PROMPT — Qualificação Jurídica Preliminar')
    // O resto da entrega não depende de qual roteiro está em vigor.
    expect(t).toContain('FORMA DA ENTREGA')
    expect(t).toContain('TEOR DOS AUTOS PRINCIPAIS')
  })

  it('roteiro vazio ou em branco cai no padrão do sistema', () => {
    for (const vazio of ['', '   ', '\n\n']) {
      expect(montarEntrega(guardado, vazio), JSON.stringify(vazio)).toContain(
        '# PROMPT — Qualificação Jurídica Preliminar',
      )
    }
    expect(montarEntrega(guardado)).toContain('# PROMPT — Qualificação Jurídica Preliminar')
  })

  it('arquivo sem contagem de páginas não inventa uma', () => {
    const t = montarEntrega({
      ...guardado,
      arquivos: [{ nome: 'anexo.pdf', paginas: 0, texto: 'x' }],
    })
    expect(t).toContain('=== ARQUIVO 1/1: anexo.pdf ===')
    expect(t).not.toContain('0 páginas')
  })
})

describe('FORMA_DA_ENTREGA', () => {
  /**
   * A ANÁLISE É A RESPOSTA, NÃO O ANEXO DELA.
   *
   * A conversa nasce no Cowork, que é superfície de trabalho: deixada à própria
   * sorte, ela produz arquivo. Aí o que a operação precisa ler fica a um
   * download de distância — fora do histórico da conversa e fora do que se cola
   * numa nota do Kommo.
   */
  it('manda escrever na própria resposta e proíbe gerar arquivo', () => {
    expect(FORMA_DA_ENTREGA).toContain('NA PRÓPRIA RESPOSTA')
    expect(FORMA_DA_ENTREGA).toMatch(/Não crie arquivo, documento, planilha, artefato nem anexo/)
    expect(FORMA_DA_ENTREGA).toContain('A resposta é o entregável.')
  })

  // Proibir o arquivo sem dizer onde as tabelas vão convidaria a resposta a
  // abandoná-las — e elas são metade do roteiro.
  it('diz onde as tabelas do roteiro devem sair', () => {
    expect(FORMA_DA_ENTREGA).toContain('Markdown')
    expect(FORMA_DA_ENTREGA).toContain('Eixo 2')
    expect(FORMA_DA_ENTREGA).toContain('Eixo 7')
  })

  it('vai junto na entrega', () => {
    expect(montarEntrega(guardado)).toContain(FORMA_DA_ENTREGA)
  })
})

/**
 * O CADASTRO DO CARD, lido num lugar só.
 *
 * Até 28/09/2026 só a tela o lia. O conector passou a gravar a planilha jurídica
 * que o Claude entrega, e precisa dos mesmos campos — a verba cedida, o número,
 * o cedente e o originador que nomeiam a pasta do Drive. A leitura mudou para
 * _shared/cadastroDoCard.ts e as duas pontas a usam; estes testes guardam as
 * regras que ela trouxe da tela.
 */
import { describe, it, expect } from 'vitest'
import { lerCadastroDoCard } from '../../../supabase/functions/_shared/cadastroDoCard.ts'

const titulo =
  'Dr. Ricardo Costa - Iana Kelle Pontes - 8018315-51.2025.8.05.0000 - Crédito principal, honorários contratuais - 10%'

describe('lerCadastroDoCard', () => {
  it('lê tudo do título quando não há anotação', () => {
    const c = lerCadastroDoCard({ nome: titulo })
    expect(c.numero).toBe('8018315-51.2025.8.05.0000')
    expect(c.cedente).toBe('Iana Kelle Pontes')
    expect(c.intermediador).toBe('Dr. Ricardo Costa')
    expect(c.tipo_aquisicao).toBe('ambos')
    expect(c.honorarios_pct).toBe('10')
  })

  // A ANOTAÇÃO VENCE para cedente, parcela e percentual — é a declaração mais
  // explícita, e os cards antigos a têm.
  it('a anotação de gente vence o título onde existe', () => {
    const c = lerCadastroDoCard({
      nome: titulo,
      notas: [{ texto: 'CEDENTE: Iana K. O. F. Pontes\nPARCELA CEDIDA: principal\nHONORÁRIOS C.: 30%' }],
    })
    expect(c.cedente).toBe('Iana K. O. F. Pontes')
    expect(c.tipo_aquisicao).toBe('principal')
    expect(c.honorarios_pct).toBe('30')
  })

  // O NÚMERO É O CONTRÁRIO: o do título primeiro. Um CNJ citado numa nota
  // (processo conexo) venceria o do crédito.
  it('o número do título vence o citado numa anotação', () => {
    const c = lerCadastroDoCard({
      nome: titulo,
      notas: [{ texto: 'PROCESSO: 0000150-70.2009.8.05.0221 (conexo)' }],
    })
    expect(c.numero).toBe('8018315-51.2025.8.05.0000')
  })

  // A NOTA DE MÁQUINA NÃO É CADASTRO: a ficha que a análise escreveu voltaria
  // como "o que o card diz", e o sistema confirmaria a si mesmo.
  it('ignora as notas automáticas', () => {
    const c = lerCadastroDoCard({
      nome: titulo,
      notas: [{ texto: 'PARCELA CEDIDA: sucumbenciais', automatica: true }],
    })
    expect(c.tipo_aquisicao).toBe('ambos')
  })

  it('sem número no título, cai no espelho', () => {
    const c = lerCadastroDoCard({ nome: 'Fulano - Beltrano', processo_cnj: '0001234-56.2024.8.13.0000' })
    expect(c.numero).toBe('0001234-56.2024.8.13.0000')
  })
})

import { describe, it, expect } from 'vitest'
import { classificarParcelaCedida, lerTituloCard } from '../kommo'

/**
 * Os campos do crédito escritos no TÍTULO do card.
 *
 * Testado porque o título vai virar a única fonte. O comercial vem encurtando o
 * cadastro, e o destino é o título carregar tudo — intermediador, cedente,
 * número, parcela cedida e percentual de honorários —, sem anotação nenhuma.
 *
 * O que faz isto perigoso é que erro aqui NÃO FALHA: a análise sai completa e
 * plausível, precificando a verba errada. Ler por posição bastaria se nenhum
 * nome de empresa tivesse " - " dentro; como têm, o que ancora a leitura é o
 * número CNJ.
 */

const FORMATO_NOVO = 'ACME Cessões - Maria da Silva - 0001234-56.2023.8.17.0001 - principal - 30%'

describe('lerTituloCard', () => {
  it('lê os cinco campos do formato novo', () => {
    expect(lerTituloCard(FORMATO_NOVO)).toEqual({
      intermediador: 'ACME Cessões',
      cedente: 'Maria da Silva',
      numero: '0001234-56.2023.8.17.0001',
      parcelaCedida: 'principal',
      honorariosPct: '30',
    })
  })

  it('nome com " - " dentro sobrevive inteiro, e não desloca os campos', () => {
    // O caso que a leitura posicional erra em silêncio: "SILVA - ADVOGADOS"
    // empurraria a parcela cedida para o lugar do número, e a análise sairia
    // precificando outra verba.
    const t = lerTituloCard(
      'ACME - SILVA - ADVOGADOS ASSOCIADOS - 0001234-56.2023.8.17.0001 - honorários sucumbenciais - 20%',
    )
    expect(t.intermediador).toBe('ACME')
    expect(t.cedente).toBe('SILVA - ADVOGADOS ASSOCIADOS')
    expect(t.parcelaCedida).toBe('honorários sucumbenciais')
    expect(t.honorariosPct).toBe('20')
  })

  it('aceita o número sem máscara e devolve pontuado', () => {
    const t = lerTituloCard('ACME - Maria da Silva - 00012345620238170001 - principal')
    expect(t.numero).toBe('0001234-56.2023.8.17.0001')
    expect(t.cedente).toBe('Maria da Silva')
  })

  it('parcela e porcentagem em qualquer ordem', () => {
    const a = lerTituloCard('ACME - Maria - 0001234-56.2023.8.17.0001 - 30% - principal')
    const b = lerTituloCard('ACME - Maria - 0001234-56.2023.8.17.0001 - principal - 30%')
    expect(a.parcelaCedida).toBe('principal')
    expect(a.honorariosPct).toBe('30')
    expect(a.honorariosPct).toBe(b.honorariosPct)
  })

  it('porcentagem com decimal, com vírgula ou com ponto', () => {
    const v = lerTituloCard('A - B - 0001234-56.2023.8.17.0001 - principal - 12,5%')
    const p = lerTituloCard('A - B - 0001234-56.2023.8.17.0001 - principal - 12.5%')
    // Prontas para Number(): porcentagem não tem separador de milhar, então o
    // ponto é decimal e não há o que descartar.
    expect(v.honorariosPct).toBe('12.5')
    expect(p.honorariosPct).toBe('12.5')
    expect(Number(v.honorariosPct)).toBe(12.5)
  })

  it('porcentagem sem o sinal também vale', () => {
    expect(lerTituloCard('A - B - 0001234-56.2023.8.17.0001 - principal - 30').honorariosPct).toBe('30')
  })

  it('cedente chamado "Principal" não vira parcela cedida', () => {
    // As palavras de verba só são procuradas DEPOIS do número.
    const t = lerTituloCard('ACME - Principal Logística Ltda - 0001234-56.2023.8.17.0001')
    expect(t.cedente).toBe('Principal Logística Ltda')
    expect(t.parcelaCedida).toBe('')
  })

  it('o formato antigo, de três partes, continua lido', () => {
    // Cards de hoje: intermediador, cedente e número. Sem parcela nem
    // porcentagem no título — quem os traz é a anotação.
    expect(lerTituloCard('ACME - Maria da Silva - 0001234-56.2023.8.17.0001')).toEqual({
      intermediador: 'ACME',
      cedente: 'Maria da Silva',
      numero: '0001234-56.2023.8.17.0001',
      parcelaCedida: '',
      honorariosPct: '',
    })
  })

  it('título sem número cai na leitura posicional das duas primeiras partes', () => {
    // Sem a âncora não há como saber onde o nome termina, então não se adivinha:
    // devolve o que é seguro e deixa o resto vazio.
    expect(lerTituloCard('ACME - Maria da Silva - alguma coisa')).toEqual({
      intermediador: 'ACME',
      cedente: 'Maria da Silva',
      numero: '',
      parcelaCedida: '',
      honorariosPct: '',
    })
  })

  it('título só com o número não inventa intermediador', () => {
    const t = lerTituloCard('0001234-56.2023.8.17.0001')
    expect(t.intermediador).toBe('')
    expect(t.cedente).toBe('')
    expect(t.numero).toBe('0001234-56.2023.8.17.0001')
  })

  it('aceita o travessão, que é o hífen depois da correção automática', () => {
    // Não é outro formato: é o mesmo caractere vindo do teclado ou de um colar
    // do Word. Exigir o hífen exato fazia o título virar uma parte só, e daí
    // nem o intermediador se lê — a análise não começava.
    const t = lerTituloCard('ACME – Maria da Silva – 0001234-56.2023.8.17.0001 – principal – 30%')
    expect(t.intermediador).toBe('ACME')
    expect(t.cedente).toBe('Maria da Silva')
    expect(t.honorariosPct).toBe('30')
  })

  it('o hífen do número não é separador, porque separador exige espaço em volta', () => {
    // Se o hífen sem espaços separasse, "0001234-56.2023..." se partiria em
    // dois e o número deixaria de ser reconhecido.
    expect(lerTituloCard('ACME - Maria - 0001234-56.2023.8.17.0001').numero).toBe(
      '0001234-56.2023.8.17.0001',
    )
  })

  it('porcentagem colada na verba, sem separar, é aproveitada', () => {
    const t = lerTituloCard('ACME - Maria - 0001234-56.2023.8.17.0001 - principal + honorários 30%')
    expect(t.parcelaCedida).toBe('principal + honorários')
    expect(t.honorariosPct).toBe('30')
    expect(classificarParcelaCedida(t.parcelaCedida)).toBe('ambos')
  })

  it('porcentagem escrita fora de lugar não entra no nome do cedente', () => {
    // Nenhum nome é um número solto, então ela é colhida onde estiver e
    // retirada antes de o resto ser interpretado.
    const t = lerTituloCard('ACME - Maria da Silva - 30% - 0001234-56.2023.8.17.0001 - principal')
    expect(t.cedente).toBe('Maria da Silva')
    expect(t.honorariosPct).toBe('30')
  })

  it('um ano solto não é confundido com porcentagem', () => {
    // O limite de três dígitos é o que garante isto.
    const t = lerTituloCard('ACME - Maria 2023 - 0001234-56.2023.8.17.0001 - principal')
    expect(t.cedente).toBe('Maria 2023')
    expect(t.honorariosPct).toBe('')
  })

  it('verbas separadas pelo hífen contam as duas', () => {
    // "principal - honorários" é escrita provável, porque o hífen é o que o
    // comercial já usa para tudo no título. Pegando só a primeira parte, isso
    // virava cessão SÓ DO PRINCIPAL e o honorário caía fora do negócio.
    const t = lerTituloCard(
      'ACME - Maria - 0001234-56.2023.8.17.0001 - principal - honorários contratuais - 30%',
    )
    expect(classificarParcelaCedida(t.parcelaCedida)).toBe('ambos')
    expect(t.honorariosPct).toBe('30')
  })

  it('uma verba só continua sendo uma verba só', () => {
    // A guarda do teste de cima: juntar as partes não pode inventar verba.
    const t = lerTituloCard('ACME - Maria - 0001234-56.2023.8.17.0001 - honorários sucumbenciais')
    expect(classificarParcelaCedida(t.parcelaCedida)).toBe('sucumbenciais')
  })

  it('separador diferente do combinado falha ALTO, não em silêncio', () => {
    // Barra, ponto-e-vírgula, hífen sem espaço: o título vira uma parte só. O
    // número ainda sai (é achado por conteúdo), mas o intermediador fica vazio
    // — e ele é obrigatório na função de análise, que recusa dizendo isso. É a
    // falha que se quer: visível, e não um preço sobre campos em branco.
    for (const t of [
      'ACME / Maria / 0001234-56.2023.8.17.0001 / principal / 30%',
      'ACME-Maria-0001234-56.2023.8.17.0001-principal-30%',
    ]) {
      const lido = lerTituloCard(t)
      expect(lido.intermediador).toBe('')
      expect(lido.numero).toBe('0001234-56.2023.8.17.0001')
    }
  })

  it('tolera vazio, nulo e espaço sobrando', () => {
    expect(lerTituloCard('')).toEqual({
      intermediador: '', cedente: '', numero: '', parcelaCedida: '', honorariosPct: '',
    })
    expect(lerTituloCard(null).intermediador).toBe('')
    expect(lerTituloCard('  ACME  -  Maria  - 0001234-56.2023.8.17.0001 ').cedente).toBe('Maria')
  })
})

/**
 * O par que decide o preço: a parcela lida do título tem de chegar classificada.
 *
 * Sem isto tudo caía em 'auto', e 'auto' assume que o principal está no negócio
 * — uma cessão só de sucumbenciais era precificada como principal + honorários.
 */
describe('a parcela cedida do título chega classificada', () => {
  const CASOS: Array<[string, string]> = [
    ['principal', 'principal'],
    ['crédito principal', 'principal'],
    ['principal + honorários', 'ambos'],
    ['honorários contratuais + sucumbenciais', 'honorarios'],
    ['honorários sucumbenciais', 'sucumbenciais'],
    ['honorários contratuais', 'contratuais'],
    // "Honorários" sem dizer quais manda a pergunta para os autos: no Juizado
    // Especial não há sucumbência em primeiro grau, então quase sempre existe um
    // honorário só e não há ambiguidade. O motor só para quando o processo tem
    // as duas verbas.
    ['honorários', 'indefinido'],
  ]

  for (const [escrito, esperado] of CASOS) {
    it(`"${escrito}" -> ${esperado}`, () => {
      const t = lerTituloCard(`ACME - Maria - 0001234-56.2023.8.17.0001 - ${escrito} - 30%`)
      expect(t.parcelaCedida).toBe(escrito)
      expect(classificarParcelaCedida(t.parcelaCedida)).toBe(esperado)
    })
  }

  it('título sem parcela nenhuma devolve "auto" — e aí quem decide é a contadoria', () => {
    const t = lerTituloCard('ACME - Maria - 0001234-56.2023.8.17.0001')
    expect(classificarParcelaCedida(t.parcelaCedida)).toBe('auto')
  })
})

// _shared/titularesDaCessao.ts
// DE QUEM É A PARCELA QUE ESTAMOS COMPRANDO — e, por consequência, de quem a
// due diligence precisa apurar as dívidas.
//
// A PERGUNTA QUE ISTO RESPONDE é a que vinha antes de tudo e não tinha resposta:
// "o que despachar para a diligência?". Até aqui a tela pedia o CPF do cedente e
// a OAB do advogado à mão, de todo card, como se fossem sempre os dois. Não são:
// quem responde por uma dívida é o TITULAR da verba cedida, e o título do card
// já diz qual verba é.
//
//   principal      o titular é o exequente — quem ganhou a ação
//   contratuais    o titular é o ADVOGADO: o honorário sai do bolo do principal
//                  por força do contrato, e é dele
//   sucumbenciais  o titular é o ADVOGADO: vêm por fora, pagos pelo vencido
//
// POR QUE ISSO MUDA A DILIGÊNCIA, e não é detalhe de cadastro. Numa cessão só de
// honorários o exequente não é parte do negócio: as dívidas dele não alcançam o
// que estamos comprando, e apurá-las é gastar consulta paga para produzir um
// alerta que não decide nada. Na direção oposta — cessão só do principal —, as
// execuções contra o advogado não ameaçam o crédito, e uma penhora em nome dele
// listada na planilha faz alguém recusar um crédito bom.
//
// E O CEDENTE NEM SEMPRE É O EXEQUENTE. Na cessão de honorários quem vende é o
// próprio advogado; o "cedente" do título do card é ele. Confundir os dois é o
// que faz a linha 10 do questionário falar de uma pessoa e a 11 de outra, quando
// as duas falam da mesma.
//
// SEM `npm:`, DE PROPÓSITO: o vitest e o navegador alcançam este módulo direto.

/** O que `classificarParcelaCedida` (src/lib/kommo.ts) devolve. */
export type ParcelaCedida =
  | 'principal'
  | 'ambos'
  | 'honorarios'
  | 'sucumbenciais'
  | 'contratuais'
  | 'indefinido'
  | 'auto'

/** Os papéis de dd_historico que esta apuração sabe preencher. */
export type PapelApurado = 'CEDENTE' | 'ADVOGADO'

export interface AlvosDaCessao {
  /** Quem precisa ser apurado, na ordem em que a tela os mostra. */
  papeis: PapelApurado[]
  /** As verbas que o card diz estar comprando, em português, para a tela. */
  verbas: string
  /**
   * Numa cessão só de honorários, quem cede É o advogado.
   *
   * A tela precisa saber para não pedir "CPF do cedente" e "OAB do advogado"
   * como se fossem duas pessoas — e para a planilha não responder as linhas 10
   * e 11 como se fossem dois históricos independentes.
   */
  cedenteEhOAdvogado: boolean
  /** Por que estes papéis, em uma frase, para a tela mostrar sem adivinhar. */
  porque: string
}

/**
 * Quem a diligência tem de apurar, dada a parcela que o card diz estar cedendo.
 *
 * NA DÚVIDA, OS DOIS. 'indefinido' é "honorários, sem dizer quais" e 'auto' é
 * card sem a informação: em ambos não se sabe qual verba vem, e deixar um
 * titular de fora é deixar de apurar dívida de quem responde pelo crédito.
 * Apurar a mais custa uma consulta; apurar a menos custa a diligência inteira.
 */
export function alvosDaCessao(parcela: ParcelaCedida | string): AlvosDaCessao {
  switch (parcela) {
    case 'principal':
      return {
        papeis: ['CEDENTE'],
        verbas: 'crédito principal',
        cedenteEhOAdvogado: false,
        porque:
          'O card cede só o principal: o titular é o exequente. As dívidas do advogado ' +
          'não alcançam esta verba.',
      }
    case 'contratuais':
      return {
        papeis: ['ADVOGADO'],
        verbas: 'honorários contratuais',
        cedenteEhOAdvogado: true,
        porque:
          'O card cede só os honorários contratuais, que são do advogado — é ele quem ' +
          'cede, e é a dívida dele que alcança o crédito.',
      }
    case 'sucumbenciais':
      return {
        papeis: ['ADVOGADO'],
        verbas: 'honorários sucumbenciais',
        cedenteEhOAdvogado: true,
        porque:
          'O card cede só os sucumbenciais, que são do advogado e vêm por fora, pagos ' +
          'pelo vencido — é ele quem cede.',
      }
    case 'honorarios':
      return {
        papeis: ['ADVOGADO'],
        verbas: 'honorários (contratuais e sucumbenciais)',
        cedenteEhOAdvogado: true,
        porque: 'O card cede as duas verbas de honorários, e as duas são do advogado.',
      }
    case 'ambos':
      return {
        papeis: ['CEDENTE', 'ADVOGADO'],
        verbas: 'principal e honorários',
        cedenteEhOAdvogado: false,
        porque:
          'O card cede o principal e os honorários: são dois titulares, e a dívida de ' +
          'qualquer um deles alcança a sua parte.',
      }
    default:
      // 'indefinido' e 'auto', e qualquer coisa que o título traga escrita de um
      // jeito que ninguém previu.
      return {
        papeis: ['CEDENTE', 'ADVOGADO'],
        verbas: 'não declaradas no título do card',
        cedenteEhOAdvogado: false,
        porque:
          'O título do card não diz quais verbas estão sendo cedidas. Na dúvida a ' +
          'apuração cobre os dois titulares — deixar um de fora seria não apurar quem ' +
          'talvez responda pelo crédito.',
      }
  }
}

// ---------------------------------------------------------------------------
// O que a leitura dos autos devolve
// ---------------------------------------------------------------------------

export interface TitularLido {
  papel: PapelApurado
  nome: string
  /** CPF ou CNPJ, só dígitos. Vazio quando os autos não o trazem. */
  documento: string
  /** "GO 12345" — só faz sentido no advogado. */
  oab: string
  tipoPessoa: 'PF' | 'PJ' | ''
  /** O trecho dos autos que sustenta o achado. Sem ele, não se confere nada. */
  evidencia: string
}

const soDigitos = (v: unknown) => String(v ?? '').replace(/\D/g, '')
const texto = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim()

/**
 * A resposta da IA, conferida antes de virar alvo de busca paga.
 *
 * O QUE ESTA FUNÇÃO IMPEDE: documento com 9 dígitos porque o modelo comeu dois,
 * papel inventado, nome vazio com CPF preenchido. Nada disso daria erro — daria
 * uma consulta ao Escavador por um CPF que não existe, cobrada igual, e um "nada
 * consta" que se lê como diligência feita.
 *
 * DOCUMENTO INVÁLIDO NÃO INVALIDA O ACHADO: o nome e a evidência continuam
 * valendo, e a tela mostra o campo vazio para quem confere preencher. Descartar
 * a linha inteira faria o operador redigitar o que a leitura já tinha achado.
 */
export function normalizarTitulares(bruto: unknown): TitularLido[] {
  const lista = Array.isArray(bruto) ? bruto : []
  const saida: TitularLido[] = []
  const vistos = new Set<string>()

  for (const item of lista) {
    const o = (item ?? {}) as Record<string, unknown>
    const papel = String(o.papel ?? '').toUpperCase()
    if (papel !== 'CEDENTE' && papel !== 'ADVOGADO') continue

    const nome = texto(o.nome).slice(0, 200)
    const doc = soDigitos(o.documento ?? o.cpf ?? o.cnpj)
    const documento = doc.length === 11 || doc.length === 14 ? doc : ''
    const oab = texto(o.oab).toUpperCase().slice(0, 20)
    if (!nome && !documento && !oab) continue

    // Um papel, um titular. Dois advogados no mesmo processo é caso real, mas
    // quem cede é UM — e apurar o escritório inteiro multiplicaria a conta da
    // API por gente que não é parte do negócio.
    const chave = papel + '|' + (documento || nome.toUpperCase())
    if (vistos.has(chave)) continue
    vistos.add(chave)

    const tipoDito = String(o.tipo_pessoa ?? o.tipoPessoa ?? '').toUpperCase()
    saida.push({
      papel,
      nome,
      documento,
      oab: papel === 'ADVOGADO' ? oab : '',
      tipoPessoa:
        documento.length === 14 ? 'PJ' : documento.length === 11 ? 'PF' : tipoDito === 'PJ' ? 'PJ' : tipoDito === 'PF' ? 'PF' : '',
      evidencia: texto(o.evidencia).slice(0, 400),
    })
  }
  return saida
}

/**
 * O que a apuração ainda não tem, dito em voz alta.
 *
 * A LACUNA PRECISA APARECER. Sem estes avisos, um card cujos autos não trazem o
 * CPF do cedente abriria a tela com o campo vazio e nenhuma explicação — e a
 * leitura, que custou tempo e tokens, pareceria não ter feito nada.
 */
export function lacunasDaLeitura(
  alvos: AlvosDaCessao,
  titulares: TitularLido[],
): string[] {
  const avisos: string[] = []
  for (const papel of alvos.papeis) {
    const achado = titulares.find((t) => t.papel === papel)
    const quem = papel === 'CEDENTE' ? 'do cedente' : 'do advogado'
    if (!achado) {
      avisos.push(
        `Não identifiquei o titular ${quem} nos autos — preencha à mão antes de apurar.`,
      )
      continue
    }
    if (!achado.documento && !(papel === 'ADVOGADO' && achado.oab)) {
      avisos.push(
        `Achei o nome ${quem} (${achado.nome}) mas não o documento. ` +
          (papel === 'ADVOGADO'
            ? 'Sem CPF nem OAB não há como procurar dívida em nome dele.'
            : 'A busca por nome acha homônimo: confira o CPF antes de apurar.'),
      )
    }
  }
  return avisos
}

// ---------------------------------------------------------------------------
// O que sobra quando um titular é recusado
// ---------------------------------------------------------------------------

export interface VerbasQueSobram {
  /**
   * A parcela cedida DEPOIS da recusa, no vocabulário de `classificarParcelaCedida`.
   *
   * `null` quando não sobra nada — é o caso em que o card vai mesmo para
   * Reprovados, porque não há segundo crédito para analisar.
   */
  parcela: ParcelaCedida | null
  /** Como dizer isso na tela e na anotação do card. */
  descricao: string
  /** A verba que caiu, em texto corrido. */
  recusada: string
  /**
   * O TÍTULO EXATO da anotação que vai ao card.
   *
   * Fixo aqui, como os de _shared/desfecho.ts e pelo mesmo motivo: é o que faz a
   * coluna do CRM ficar legível de cima a baixo. Quem varre o funil precisa
   * distinguir de relance o card que perdeu UMA verba do que foi recusado
   * inteiro — e "Crédito Recusado" nos dois casos apagaria a diferença.
   */
  tituloDaRecusa: string
  /** Recusaram tudo o que havia: não é reprovação parcial, é reprovação. */
  tudoRecusado: boolean
}

/**
 * O QUE AINDA SE COMPRA depois de recusar o titular de uma das verbas.
 *
 * A pergunta que isto responde é comercial, não jurídica: achada uma execução
 * contra o cedente, os honorários do advogado continuam compráveis? Continuam —
 * o honorário destacado é crédito dele, e a penhora contra o exequente não o
 * alcança. Reprovar o card inteiro nesse caso joga fora um negócio bom por causa
 * de outro ruim que só divide o número do processo com ele.
 *
 * A TRADUÇÃO É A MESMA DE `alvosDaCessao`, PELO AVESSO: lá a verba diz quem
 * apurar, aqui o titular recusado diz que verba cai. Principal ↔ cedente,
 * honorários ↔ advogado.
 *
 * NA DÚVIDA NÃO SOBRA NADA. Card cuja parcela o título não declara ('auto',
 * 'indefinido') tem os dois titulares apurados; recusado um deles, não dá para
 * afirmar que o outro tem crédito próprio ali — pode ser uma cessão só do
 * principal em que o advogado nem é parte do negócio. Deixar seguir seria
 * analisar uma verba que talvez não exista.
 */
export function verbasQueSobram(
  parcela: ParcelaCedida | string,
  papeisRecusados: PapelApurado[],
): VerbasQueSobram {
  const recusouCedente = papeisRecusados.includes('CEDENTE')
  const recusouAdvogado = papeisRecusados.includes('ADVOGADO')
  const nada = (recusada: string, tituloDaRecusa: string): VerbasQueSobram => ({
    parcela: null,
    descricao: 'nenhuma verba',
    recusada,
    tituloDaRecusa,
    tudoRecusado: true,
  })

  if (!recusouCedente && !recusouAdvogado) {
    return {
      parcela: parcela as ParcelaCedida,
      descricao: 'tudo o que o card cede',
      recusada: '',
      tituloDaRecusa: '',
      tudoRecusado: false,
    }
  }

  const dosDois = recusouCedente && recusouAdvogado
  if (dosDois) return nada('Crédito principal e honorários', 'Crédito Recusado')

  switch (parcela) {
    case 'ambos':
      return recusouCedente
        ? {
            parcela: 'honorarios',
            descricao: 'os honorários',
            recusada: 'Crédito principal',
            tituloDaRecusa: 'Crédito Principal Recusado',
            tudoRecusado: false,
          }
        : {
            parcela: 'principal',
            descricao: 'o crédito principal',
            recusada: 'Créditos de honorários',
            tituloDaRecusa: 'Créditos de Honorários Recusados',
            tudoRecusado: false,
          }
    // Cessão de uma verba só: recusar o titular dela é recusar a cessão. Não há
    // segundo crédito escondido — o outro titular nem entrou no negócio.
    case 'principal':
      return nada('Crédito principal', 'Crédito Principal Recusado')
    case 'honorarios':
    case 'contratuais':
    case 'sucumbenciais':
      return nada('Créditos de honorários', 'Créditos de Honorários Recusados')
    default:
      return nada(
        recusouCedente ? 'Crédito principal' : 'Créditos de honorários',
        recusouCedente ? 'Crédito Principal Recusado' : 'Créditos de Honorários Recusados',
      )
  }
}

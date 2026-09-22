// AS ETIQUETAS QUE A PLATAFORMA PODE PÔR E TIRAR DE UM CARD DO KOMMO.
//
// Uma lista fechada, e é este o ponto do arquivo. A API do Kommo CRIA a etiqueta
// quando recebe um nome que ainda não existe na conta — mandar texto livre daqui
// faria nascer "Enviado PJUS ", "enviado pjus" e "Enviado Pjus" como três
// etiquetas distintas, cada uma com a sua cor, e a coluna do comercial ficaria
// com uma sujeira que a API não sabe desfazer: o Kommo não tem endpoint para
// renomear nem para apagar etiqueta (verificado em 22/09/2026 na referência
// v4 — só listar, criar, vincular e desvincular).
//
// MÓDULO PURO — sem `npm:` e sem `Deno.` —, então o mesmo arquivo roda no vitest
// do site, no navegador (importado por caminho relativo) e na Edge Function. A
// tela desenha o seletor a partir desta lista, e a `kommo-etiquetar` decide o
// que aceita a partir DELA TAMBÉM: foi a lição das trilhas, onde duas listas que
// precisavam concordar divergiram no primeiro dia.

/** Uma etiqueta da casa, e o destino de que ela fala. */
export interface EtiquetaDoFundo {
  /** O nome EXATO como está escrito no Kommo — é ele que vai no PATCH. */
  nome: string
  /**
   * O destino a que a etiqueta se refere: o fundo, ou a pessoa que negocia.
   *
   * AGRUPA E EXCLUI. As etiquetas de um destino são os fins possíveis daquela
   * mesma tentativa — passou adiante, ou voltou recusada —, e o crédito está num
   * deles, não em dois: marcar "Reprovado BTG" tira "Cotado BTG" do card. Quem
   * opera pediu assim em 22/09/2026, depois de ver as duas conviverem.
   *
   * ENTRE DESTINOS NÃO HÁ EXCLUSÃO NENHUMA: o mesmo crédito pode estar cotado no
   * BTG e reprovado no PJUS, e é exatamente isso que a fila precisa mostrar.
   */
  destino: string
}

/**
 * AS ETIQUETAS DA ABA "EM PRECIFICAÇÃO", ditadas por quem opera em 22/09/2026.
 *
 * O PRIMEIRO VERBO MUDA DE DESTINO PARA DESTINO — "Enviado", "Cotado",
 * "Pendente" — e não é descuido: é o vocabulário que o comercial já usa no
 * kanban, e uniformizá-lo aqui criaria etiquetas novas no Kommo em vez de casar
 * com as que estão lá. A última de cada destino é sempre "Reprovado ‹destino›".
 *
 * A ORDEM É A DA LISTA NA TELA, e é a do próprio percurso do crédito: primeiro
 * onde ele está (enviado, pendente), depois a cotação que voltou, e por fim a
 * recusa. Como só uma vale por destino, subir um degrau apaga o anterior — que é
 * o que se quer: "Cotado PJUS" substituindo "Enviado PJUS" é a notícia de que o
 * fundo respondeu.
 */
export const ETIQUETAS_DA_PRECIFICACAO: readonly EtiquetaDoFundo[] = [
  { destino: 'PJUS', nome: 'Enviado PJUS' },
  { destino: 'PJUS', nome: 'Cotado PJUS' },
  { destino: 'PJUS', nome: 'Reprovado PJUS' },
  { destino: 'BTG', nome: 'Cotado BTG' },
  { destino: 'BTG', nome: 'Reprovado BTG' },
  { destino: 'Luiz', nome: 'Pendente Luiz' },
  { destino: 'Luiz', nome: 'Cotado Luiz' },
  { destino: 'Luiz', nome: 'Reprovado Luiz' },
]

/** Acento, caixa e espaço a mais não podem decidir se duas etiquetas são a mesma. */
export function normalizarEtiqueta(nome: unknown): string {
  return String(nome ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
}

/** As duas são a mesma etiqueta, escrita de jeitos diferentes? */
export function mesmaEtiqueta(a: unknown, b: unknown): boolean {
  return normalizarEtiqueta(a) === normalizarEtiqueta(b)
}

/**
 * O nome CANÔNICO da etiqueta, ou null se ela não é uma das que a casa oferece.
 *
 * DEVOLVE O NOME DESTA LISTA, e não o que chegou na requisição — é o que impede
 * um "enviado pjus" digitado noutra caixa de virar etiqueta nova lá dentro. E é
 * a lista de permissão do servidor: fora dela, a função recusa.
 */
export function etiquetaCanonica(nome: unknown): string | null {
  return ETIQUETAS_DA_PRECIFICACAO.find((e) => mesmaEtiqueta(e.nome, nome))?.nome ?? null
}

/**
 * As OUTRAS etiquetas do mesmo destino — as que saem quando esta entra.
 *
 * É AQUI QUE A EXCLUSÃO MORA, e não na tela, porque quem a executa é o servidor:
 * a troca vai num PATCH só (`tags_to_add` com a nova, `tags_to_delete` com as
 * irmãs), e não em duas chamadas. Duas deixariam o card num estado intermediário
 * visível — sem etiqueta nenhuma, ou com as duas — se a segunda falhasse.
 *
 * DEVOLVE TODAS AS IRMÃS, tenha o card alguma ou não: pedir ao Kommo que
 * desvincule uma etiqueta que não está lá não é erro, e perguntar antes custaria
 * uma consulta para evitar coisa nenhuma.
 */
export function irmasDaEtiqueta(
  nome: unknown,
  etiquetas: readonly EtiquetaDoFundo[] = ETIQUETAS_DA_PRECIFICACAO,
): string[] {
  const dela = etiquetas.find((e) => mesmaEtiqueta(e.nome, nome))
  if (!dela) return []
  return etiquetas
    .filter((e) => e.destino === dela.destino && !mesmaEtiqueta(e.nome, dela.nome))
    .map((e) => e.nome)
}

/**
 * As etiquetas de um card NA ORDEM DA CASA: PJUS, depois BTG, depois Luiz.
 *
 * A ORDEM QUE VINHA ERA A DO KOMMO — isto é, a ordem em que alguém etiquetou —,
 * e ela muda de card para card. Numa coluna de trinta, isso obriga a LER cada
 * linha: o mesmo fundo aparece ora no começo, ora no fim. Com a ordem fixa, a
 * posição vira informação: a primeira etiqueta é sempre a do PJUS, e a ausência
 * dela se nota pelo que não está ali.
 *
 * É A MESMA ORDEM DO SELETOR, e de propósito: quem marca e quem lê veem a mesma
 * sequência. Sai da lista, então basta reordenar lá para a tela acompanhar.
 *
 * O QUE NÃO É DA CASA VAI PARA O FIM, guardando a ordem em que veio — é etiqueta
 * de quem a pôs, e inventar posição para ela seria fingir que a conhecemos.
 */
export function ordenarEtiquetas(
  nomes: readonly string[],
  etiquetas: readonly EtiquetaDoFundo[] = ETIQUETAS_DA_PRECIFICACAO,
): string[] {
  const posicao = (nome: string) => {
    const i = etiquetas.findIndex((e) => mesmaEtiqueta(e.nome, nome))
    return i === -1 ? etiquetas.length : i
  }
  return nomes
    .map((nome, entrada) => ({ nome, entrada, ordem: posicao(nome) }))
    // O DESEMPATE PELA ENTRADA mantém estável o que a lista não ordena: duas
    // etiquetas de fora saem na ordem em que o Kommo as devolveu, sempre.
    .sort((a, b) => a.ordem - b.ordem || a.entrada - b.entrada)
    .map((x) => x.nome)
}

/** As etiquetas agrupadas por destino, na ordem da lista — como o seletor as mostra. */
export function etiquetasPorDestino(
  etiquetas: readonly EtiquetaDoFundo[] = ETIQUETAS_DA_PRECIFICACAO,
): { destino: string; etiquetas: EtiquetaDoFundo[] }[] {
  const grupos: { destino: string; etiquetas: EtiquetaDoFundo[] }[] = []
  for (const e of etiquetas) {
    const grupo = grupos.find((g) => g.destino === e.destino)
    if (grupo) grupo.etiquetas.push(e)
    else grupos.push({ destino: e.destino, etiquetas: [e] })
  }
  return grupos
}

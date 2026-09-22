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
   * Agrupa o seletor, e só. As duas de um destino são os dois fins possíveis
   * daquela tentativa — passou adiante, ou voltou recusada.
   */
  destino: string
}

/**
 * AS SEIS ETIQUETAS DA ABA "EM PRECIFICAÇÃO", ditadas por quem opera em 22/09/2026.
 *
 * O PRIMEIRO VERBO MUDA DE DESTINO PARA DESTINO — "Enviado", "Cotado",
 * "Pendente" — e não é descuido: é o vocabulário que o comercial já usa no
 * kanban, e uniformizá-lo aqui criaria etiquetas novas no Kommo em vez de casar
 * com as que estão lá. A segunda é sempre "Reprovado ‹destino›".
 *
 * A ORDEM É A DA LISTA NA TELA. Cada destino traz primeiro o desfecho vivo e
 * depois o recusado, que é a ordem em que os dois acontecem.
 */
export const ETIQUETAS_DA_PRECIFICACAO: readonly EtiquetaDoFundo[] = [
  { destino: 'PJUS', nome: 'Enviado PJUS' },
  { destino: 'PJUS', nome: 'Reprovado PJUS' },
  { destino: 'BTG', nome: 'Cotado BTG' },
  { destino: 'BTG', nome: 'Reprovado BTG' },
  { destino: 'Luiz', nome: 'Pendente Luiz' },
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

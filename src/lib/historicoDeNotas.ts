// O histórico de um card, como se lê: a anotação com os arquivos dela junto.
//
// NO KOMMO O ANEXO É UMA NOTA SEPARADA. Quem sobe um arquivo cria uma nota do
// tipo `attachment`, com o nome do arquivo e sem texto; o comentário que explica
// o arquivo é OUTRA nota, de outro tipo, escrita segundos antes ou depois. Não
// existe campo ligando as duas — a ligação está no relógio e em quem fez.
//
// Exibidas como o espelho as guarda, elas aparecem como dois registros soltos, e
// o anexo ocupa um bloco inteiro para dizer um nome de arquivo. Aqui elas
// voltam a ser uma coisa só.
//
// A APROXIMAÇÃO É HEURÍSTICA, e é por isso que ela é apertada: três minutos e,
// quando os dois lados dizem quem os escreveu, o mesmo autor. Errar para o lado
// de NÃO agrupar é inofensivo — o anexo aparece sozinho, como aparecia; errar
// para o lado de agrupar demais prende um arquivo à anotação errada, e quem lê
// passa a atribuir um documento a um comentário que não falava dele.

import type { KommoNota } from '@/lib/types'

/** Uma anotação e os arquivos que subiram junto com ela. */
export interface BlocoDoHistorico {
  nota: KommoNota
  anexos: KommoNota[]
}

/** Quanto tempo separa um arquivo da anotação que o comenta. */
export const JANELA_DO_ANEXO_MS = 3 * 60 * 1000

/** A nota é um arquivo anexado? */
export const ehAnexo = (n: KommoNota): boolean => n.tipo === 'attachment'

/**
 * O nome do arquivo, sem o clipe que o espelho põe na frente.
 *
 * O CLIPE É DO TEXTO, e não um campo. A nota de anexo não tem texto nenhum no
 * Kommo — só o nome do arquivo noutro campo —, e o kommo-sync monta
 * "📎 nome.pdf" para a nota ter o que mostrar. Quem vai procurar esse arquivo
 * pelo nome na API precisa do nome limpo.
 */
export function nomeDoAnexo(n: KommoNota): string {
  return String(n.texto ?? '').replace(/^📎\s*/u, '').trim()
}

const instante = (n: KommoNota): number => {
  const t = n.criado_em ? Date.parse(n.criado_em) : NaN
  return Number.isNaN(t) ? NaN : t
}

/**
 * Os mesmos autores, ou pelo menos nenhum que se contradiga.
 *
 * NULO NÃO CONTRADIZ NINGUÉM: o Kommo devolve `created_by = 0` para o que a
 * automação escreve, e o espelho guarda autor nulo nesses casos. Exigir
 * igualdade estrita deixaria de agrupar justamente o caso mais comum — o
 * arquivo que entra por integração ao lado da anotação que o anuncia.
 */
function autoresCompativeis(a: KommoNota, b: KommoNota): boolean {
  if (!a.autor || !b.autor) return true
  return a.autor === b.autor
}

/**
 * Junta cada anexo à anotação mais próxima no tempo.
 *
 * O ANEXO ÓRFÃO CONTINUA APARECENDO, como bloco próprio: sumir com ele para
 * esconder que não achamos dono seria perder a informação de que o arquivo
 * existe — que é a única coisa que aquela nota tem a dizer.
 */
export function agruparNotas(notas: KommoNota[]): BlocoDoHistorico[] {
  const blocos: BlocoDoHistorico[] = notas.map((nota) => ({ nota, anexos: [] }))
  const hospedeiros = blocos
    .map((b, i) => ({ b, i }))
    .filter(({ b }) => !ehAnexo(b.nota))

  const adotados = new Set<number>()
  for (const [i, bloco] of blocos.entries()) {
    if (!ehAnexo(bloco.nota)) continue
    const quando = instante(bloco.nota)
    if (Number.isNaN(quando)) continue

    let melhor: { i: number; dist: number } | null = null
    for (const { b, i: j } of hospedeiros) {
      if (!autoresCompativeis(bloco.nota, b.nota)) continue
      const t = instante(b.nota)
      if (Number.isNaN(t)) continue
      const dist = Math.abs(t - quando)
      if (dist > JANELA_DO_ANEXO_MS) continue
      // EMPATE FICA COM O DE DEPOIS: o arquivo sobe primeiro e o comentário que
      // o explica vem em seguida — é a ordem de quem anexa e então escreve.
      if (!melhor || dist < melhor.dist || (dist === melhor.dist && j > i)) {
        melhor = { i: j, dist }
      }
    }
    if (melhor) {
      blocos[melhor.i].anexos.push(bloco.nota)
      adotados.add(i)
    }
  }

  // OS ÓRFÃOS SE AGRUPAM ENTRE SI, e é o que salva o envio em lote. Um processo
  // que chega em dezoito peças — todas no mesmo segundo, nenhuma com comentário
  // ao lado — virava dezoito blocos idênticos, cada um com um nome de arquivo
  // dentro e um selo "anexo" em cima. A página do card ficava com uma coluna de
  // dezoito faixas para dizer o que cabe numa.
  //
  // CONSECUTIVOS, e medidos contra o PRIMEIRO do grupo: assim um bloco nunca
  // cobre mais que a janela inteira, por mais arquivos que entrem nele.
  const sobraram = blocos.filter((_, i) => !adotados.has(i))
  const juntos: BlocoDoHistorico[] = []
  for (const bloco of sobraram) {
    const anterior = juntos[juntos.length - 1]
    if (
      anterior &&
      ehAnexo(anterior.nota) &&
      ehAnexo(bloco.nota) &&
      autoresCompativeis(anterior.nota, bloco.nota) &&
      Math.abs(instante(bloco.nota) - instante(anterior.nota)) <= JANELA_DO_ANEXO_MS
    ) {
      anterior.anexos.push(bloco.nota)
      continue
    }
    juntos.push(bloco)
  }
  return juntos
}

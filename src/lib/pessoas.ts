// Quem entra na operação: INVESTIDOR (o cessionário do crédito) e ORIGINADOR
// (quem originou a aquisição).
//
// A lista tem DUAS ORIGENS, e é por isso que ela vive aqui e não dentro de uma
// tela:
//
//   • os nomes que aparecem nos Créditos, nos campos Cessionário e Originador;
//   • as fichas cadastradas direto na aba "Dados pessoais e bancários".
//
// A segunda origem existe porque o comercial vem ANTES do operacional: o
// investidor é cadastrado para se fazer o contrato, e o crédito só é lançado
// depois de o negócio fechar. Enquanto isso, a ficha precisa existir sem crédito
// nenhum.
//
// As duas telas dependem da mesma lista: a aba de dados a exibe, e o formulário
// de Créditos a oferece nos dois campos — quem lança o crédito escolhe o nome que
// já existe em vez de digitar de novo e criar uma segunda versão da mesma pessoa.
import { normalizarNome } from './format'
import type { InvestidorDados, TipoPessoa } from './queries'
import type { Processo } from './types'

/** De qual campo do crédito sai o nome de cada papel. */
export const COLUNA_POR_TIPO: Record<
  TipoPessoa,
  'cessionario' | 'originador'
> = {
  investidor: 'cessionario',
  originador: 'originador',
}

export interface PessoaLista {
  /** Nome normalizado. É o que casa com nome_chave da ficha. */
  chave: string
  nome: string
  /**
   * Aparece em pelo menos um crédito. Falso = ficha cadastrada na aba, ainda sem
   * crédito lançado — o estado normal de quem o comercial acabou de cadastrar.
   */
  emCredito: boolean
}

/**
 * Os nomes distintos de um papel, em ordem alfabética, das duas origens.
 *
 * `dados` é o mapa de useInvestidorDados; `undefined` nos dois argumentos é
 * tratado como lista vazia, para a função servir também a quem ainda está
 * carregando.
 */
export function listarPessoas(
  tipo: TipoPessoa,
  processos: Pick<Processo, 'cessionario' | 'originador'>[] | undefined,
  dados: Map<string, InvestidorDados> | undefined,
): PessoaLista[] {
  const coluna = COLUNA_POR_TIPO[tipo]
  const porChave = new Map<string, PessoaLista>()
  // CRÉDITOS PRIMEIRO: quando a mesma pessoa está nas duas origens, a grafia do
  // crédito é a que vale, porque é a que aparece na tabela de Créditos, na ficha
  // lateral e nas exportações. Duas grafias na tela, uma em cada lugar, pareceria
  // erro de cadastro.
  for (const p of processos ?? []) {
    const nome = (p[coluna] ?? '').trim()
    if (!nome) continue
    const chave = normalizarNome(nome)
    if (!porChave.has(chave)) porChave.set(chave, { chave, nome, emCredito: true })
  }
  for (const d of dados?.values() ?? []) {
    if (d.tipo !== tipo || porChave.has(d.nome_chave)) continue
    // nome_chave é o reserva: a coluna nome_exibicao é anulável, e linha gravada
    // sem ela apareceria sem nome nenhum na tabela.
    porChave.set(d.nome_chave, {
      chave: d.nome_chave,
      nome: d.nome_exibicao?.trim() || d.nome_chave,
      emCredito: false,
    })
  }
  return [...porChave.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
}

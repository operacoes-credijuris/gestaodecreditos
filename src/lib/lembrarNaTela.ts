// A tela lembra a última escolha de quem usa: o filtro, a ordenação ou a aba de
// uma lista, de uma visita para a outra (revisão de qualidade de vida, 03/10/2026).
//
// POR QUE: quem trabalha o dia inteiro em "Encerrados" de Créditos, ou na visão
// "Sem prazo" de Tarefas, refazia o mesmo clique a cada vez que abria a tela.
//
// O QUE ENTRA AQUI: só escolha FECHADA (uma lista conhecida de valores) e que
// aparece na própria tela — o filtro lembrado está à vista no seletor, com a
// contagem, e não esconde nada. A BUSCA DIGITADA NÃO ENTRA: voltar à tela com a
// lista filtrada por um texto esquecido faria parecer que o registro sumiu.
//
// NO NAVEGADOR, pelas mesmas razões das outras preferências (lib/preferencias.ts):
// é escolha de tela, de um computador, e perder não causa dano. Tudo em
// try/catch lá dentro: sem armazenamento a tela funciona igual, só sem lembrar.
import { useCallback, useState } from 'react'
import { gravarPreferencia, lerPreferencia, type Armazenamento } from './preferencias'

/** As chaves de cada tela, num lugar só, para duas telas não brigarem pela mesma. */
export const LEMBRAR = {
  creditosStatus: 'tela.creditos.status',
  creditosOrdem: 'tela.creditos.ordem',
  creditosSentido: 'tela.creditos.sentido',
  requerimentosSentido: 'tela.requerimentos.sentido',
  tarefasPrazo: 'tela.tarefas.prazo',
  faseTrilha: 'tela.fase.trilha',
  cadastrosVisao: 'tela.cadastros.visao',
  contratosCategoria: 'tela.contratos.categoria',
} as const

/**
 * O valor lembrado, SE AINDA FOR UMA ESCOLHA VÁLIDA; senão, o padrão.
 *
 * A conferência é o que torna seguro lembrar: o valor guardado pode ter vindo de
 * uma versão anterior da tela (um filtro que mudou de nome ou saiu), ou ter sido
 * mexido à mão no navegador. Sem ela, o seletor abriria numa opção que não existe
 * e a lista viria vazia sem explicação.
 */
export function escolhaLembrada<T extends string>(
  lido: unknown,
  permitidas: readonly T[],
  padrao: T,
): T {
  return typeof lido === 'string' && (permitidas as readonly string[]).includes(lido)
    ? (lido as T)
    : padrao
}

/** Lê a escolha guardada de uma tela, já conferida. */
export function lerEscolha<T extends string>(
  chave: string,
  permitidas: readonly T[],
  padrao: T,
  armazenamento?: Armazenamento | null,
): T {
  return escolhaLembrada(lerPreferencia<unknown>(chave, padrao, armazenamento), permitidas, padrao)
}

/**
 * `useState` que lembra: abre com a última escolha válida e grava cada troca.
 *
 * `permitidas` é lida só na abertura — passe uma lista fixa (constante do módulo),
 * não uma montada a cada render.
 */
export function useEscolhaLembrada<T extends string>(
  chave: string,
  permitidas: readonly T[],
  padrao: T,
): [T, (valor: T) => void] {
  const [valor, setValor] = useState<T>(() => lerEscolha(chave, permitidas, padrao))
  const escolher = useCallback(
    (novo: T) => {
      setValor(novo)
      gravarPreferencia(chave, novo)
    },
    [chave],
  )
  return [valor, escolher]
}

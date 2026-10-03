// As consultas das Configurações que o MENU e os CARTÕES leem juntos.
//
// FICAM NUM LUGAR SÓ, chamadas uma vez pela tela (Configuracoes.tsx) e passadas
// às seções por props. O menu mostra o ponto de estado de cada integração e o
// saldo do Escavador e da BullAI; os cartões mostram o selo e o mesmo saldo. Se
// cada um chamasse a sua, o saldo — que é `staleTime: 0` — podia sair em duas
// consultas a cada abertura, e o menu e o cartão chegariam a mostrar números de
// momentos diferentes.

import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { invokeFunction } from '@/lib/functions'
import type { Integracao, ServicoIntegracao } from '@/lib/types'

export function useIntegracao(servico: ServicoIntegracao) {
  return useQuery({
    queryKey: ['integracoes', servico],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('integracoes')
        .select('*')
        .eq('servico', servico)
        .maybeSingle()
      if (error) throw new Error(error.message)
      return (data as Integracao) ?? null
    },
  })
}

export type ConsultaIntegracao = ReturnType<typeof useIntegracao>

/** O `configurado` que as Edge Functions de token gravam no config da integração. */
export function configuradoDe(data: Integracao | null | undefined): boolean {
  return Boolean((data?.config as { configurado?: boolean } | null | undefined)?.configurado)
}

// ----------------------- Escavador: o saldo -----------------------

export interface SaldoEscavador {
  creditos: number
  saldo: number
  descricao: string
}

/**
 * O saldo da API do Escavador, perguntado sempre que a tela abre.
 *
 * ELE JÁ VINHA, mas só no instante em que alguém gravava um token novo: a função
 * que confere a chave usa a mesma chamada, e o número aparecia no aviso daquele
 * salvamento. Quem abrisse Configurações no dia seguinte não via nada — e o
 * saldo acabava no meio de uma apuração, chegando como um 402 numa diligência,
 * longe da tela onde se resolve.
 *
 * A CHAMADA NÃO CONSOME CRÉDITO. É por isso que ela serve para conferir o token,
 * e é por isso que dá para fazê-la a cada abertura sem pensar duas vezes.
 *
 * SÓ COM TOKEN CONFIGURADO (`habilitada`): antes o componente do saldo só era
 * montado com o token gravado; agora que a consulta subiu para a tela, é o
 * `enabled` que faz esse papel.
 */
export function useSaldoEscavador(habilitada: boolean) {
  return useQuery({
    queryKey: ['escavador', 'saldo'],
    enabled: habilitada,
    // A CONSULTA É SOZINHA, ao abrir a tela: é a única pergunta desta página
    // cuja resposta MUDA sem ninguém mexer aqui — todo o resto é configuração,
    // que só muda quando alguém a edita. Um saldo atrás de um clique seria um
    // saldo que ninguém olha.
    //
    // SEM CACHE: ele anda a cada diligência, e número velho na tela é pior que
    // número nenhum — é o que faz alguém começar uma apuração confiando em
    // crédito que já foi gasto.
    staleTime: 0,
    retry: false,
    queryFn: async () =>
      (await invokeFunction<{ saldo: SaldoEscavador }>('escavador-saldo', {})).saldo,
  })
}

export type ConsultaSaldo = ReturnType<typeof useSaldoEscavador>

// ----------------------- BullAI: o catálogo e o plano -----------------------

export interface CreditosBullai {
  restantes: number | null
  limite: number | null
  usadas: number
  excedente: number
  fimDoPeriodo: string | null
}

export interface PortalBullai {
  chave: string
  rotulo: string
  criterio: string
  documento: 'CPF' | 'CNPJ'
  presencial: boolean
}

/**
 * O catálogo da BullAI (as certidões que ela sabe buscar) e o plano da conta,
 * consultados ao abrir a tela — só com a chave configurada.
 */
export function useCatalogoBullai(habilitada: boolean) {
  return useQuery({
    queryKey: ['bullai', 'catalogo'],
    enabled: habilitada,
    staleTime: 0,
    retry: false,
    queryFn: () =>
      invokeFunction<{ creditos: CreditosBullai; portais: PortalBullai[] }>('bullai-catalogo', {}),
  })
}

export type ConsultaCatalogo = ReturnType<typeof useCatalogoBullai>

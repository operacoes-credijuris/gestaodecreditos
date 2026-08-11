import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { makeCrud } from './crud'
import { supabase } from './supabase'
import { onlyDigits } from './format'
import type { ParametrosAtualizacao } from './projecao'
import type {
  AnaliseCredito,
  Apenso,
  Cessao,
  ContatoServentia,
  Contrato,
  ContratoTemplate,
  Investidor,
  Investimento,
  Processo,
  Requerimento,
} from './types'

/**
 * ⚠️ REGRA DESTE ARQUIVO: o supabase-js NÃO LANÇA. Ele devolve `{ data, error }`,
 * e ignorar o `error` faz a consulta terminar com SUCESSO devolvendo vazio — o
 * React Query cacheia isso como dado bom, não retenta, não liga isError, e num
 * refetch de fundo o vazio SUBSTITUI o dado que estava certo. A tela então não
 * tem como distinguir "falhou" de "não existe". Onde esse vazio alimenta
 * formulário, vira apagamento de dado; onde alimenta cálculo, vira número
 * errado apresentado como certo.
 *
 * Então: `if (error) throw`, como em crud.ts. A única exceção deliberada está
 * documentada em useUltimaMovimentacao.
 */

/**
 * Parâmetros globais de atualização monetária (linha única, id = 1). Alimentam
 * a coluna "Valor projetado" da carteira.
 */
export function useParametrosAtualizacao() {
  return useQuery({
    queryKey: ['parametros_atualizacao'],
    queryFn: async (): Promise<ParametrosAtualizacao> => {
      const { data, error } = await supabase
        .from('parametros_atualizacao')
        .select('selic_aa, ipca_12m_aa, data_referencia')
        .eq('id', 1)
        .maybeSingle()
      // Vazio aqui é indistinguível de "nunca cadastrado": para a projeção da
      // carteira toda e faz o modal gravar nulo por cima da SELIC real.
      if (error) throw new Error(error.message)
      return {
        selic_aa: data?.selic_aa ?? null,
        ipca_12m_aa: data?.ipca_12m_aa ?? null,
        data_referencia: data?.data_referencia ?? null,
      }
    },
    staleTime: 5 * 60 * 1000,
  })
}

export function useSalvarParametrosAtualizacao() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (p: ParametrosAtualizacao) => {
      const { data: sessao } = await supabase.auth.getUser()
      // upsert e não update: a linha é semeada pela migração, mas se o banco
      // for recriado sem o seed a tela não deve quebrar.
      const { error } = await supabase.from('parametros_atualizacao').upsert({
        id: 1,
        selic_aa: p.selic_aa,
        ipca_12m_aa: p.ipca_12m_aa,
        data_referencia: p.data_referencia,
        atualizado_em: new Date().toISOString(),
        atualizado_por: sessao.user?.id ?? null,
      })
      if (error) throw new Error(error.message)
    },
    onSuccess: () => {
      // Invalida a carteira também: o valor projetado depende destes números.
      qc.invalidateQueries({ queryKey: ['parametros_atualizacao'] })
    },
  })
}

/** Papel da pessoa na operação. Faz parte da chave (migrações 0027 e 0029). */
export type TipoPessoa = 'investidor' | 'originador'

/** Chave do mapa: o papel importa, porque a mesma pessoa pode ter os dois. */
export const chavePessoa = (tipo: TipoPessoa, nomeChave: string) =>
  `${tipo}|${nomeChave}`

export interface InvestidorDados {
  tipo: TipoPessoa
  nome_chave: string
  nome_exibicao: string | null
  cpf: string | null
  rg: string | null
  banco: string | null
  agencia: string | null
  conta: string | null
  pix: string | null
  /** Texto corrido legado; a exibição prefere as partes abaixo. */
  endereco: string | null
  logradouro: string | null
  numero: string | null
  complemento: string | null
  bairro: string | null
  cidade: string | null
  uf: string | null
  cep: string | null
  atualizado_em: string
}


/**
 * Dados pessoais e bancários, indexados por PAPEL + NOME NORMALIZADO.
 *
 * Uma linha aqui pode ter nascido de duas maneiras: preenchendo a ficha de quem
 * já aparece num crédito, ou cadastrando a pessoa direto na aba — o comercial
 * cadastra o investidor para fazer o contrato, antes de existir crédito. Quem
 * monta a lista das duas origens é listarPessoas, em lib/pessoas.ts.
 */
export function useInvestidorDados() {
  return useQuery({
    queryKey: ['investidor_dados'],
    queryFn: async () => {
      // Lista de colunas em literal, e não numa constante: o supabase-js infere
      // o tipo do retorno lendo a string do select, e uma const widened para
      // `string` derruba a inferência.
      const { data, error } = await supabase
        .from('investidor_dados')
        .select(
          'tipo, nome_chave, nome_exibicao, cpf, rg, banco, agencia, conta, pix, endereco, logradouro, numero, complemento, bairro, cidade, uf, cep, atualizado_em',
        )
      // Este mapa alimenta o formulário, e o Salvar é upsert da LINHA INTEIRA:
      // mapa vazio abriria o formulário em branco e apagaria CPF, banco, conta e
      // endereço no salvamento seguinte.
      if (error) throw new Error(error.message)
      const m = new Map<string, InvestidorDados>()
      for (const r of (data ?? []) as InvestidorDados[])
        m.set(chavePessoa(r.tipo, r.nome_chave), r)
      return m
    },
    staleTime: 60 * 1000,
  })
}

export function useSalvarInvestidorDados() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (d: Omit<InvestidorDados, 'atualizado_em'>) => {
      const { data: sessao } = await supabase.auth.getUser()
      // upsert pela chave (tipo, nome_chave): a mesma chamada cria a linha e
      // atualiza a que já existe. Quem chama é que decide se pode sobrescrever —
      // a tela barra o cadastro de um nome cuja ficha já existe.
      const { error } = await supabase.from('investidor_dados').upsert({
        ...d,
        atualizado_em: new Date().toISOString(),
        atualizado_por: sessao.user?.id ?? null,
      })
      if (error) throw new Error(error.message)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['investidor_dados'] }),
  })
}

/**
 * Apaga uma ficha. A tela só oferece isto para quem NÃO aparece em crédito
 * nenhum: apagar a ficha de quem está num crédito não removeria a pessoa (o nome
 * continua vindo de lá) — só perderia CPF, conta e endereço, sem parecer perda.
 */
export function useExcluirInvestidorDados() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      tipo,
      nome_chave,
    }: {
      tipo: TipoPessoa
      nome_chave: string
    }) => {
      const { error } = await supabase
        .from('investidor_dados')
        .delete()
        .eq('tipo', tipo)
        .eq('nome_chave', nome_chave)
      if (error) throw new Error(error.message)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['investidor_dados'] }),
  })
}

export interface CarteiraResumo {
  processo_id: string
  estagio_processual: string | null
  providencias: string | null
  erro: string | null
  gerado_em: string
}

/**
 * Estágio processual e providências por crédito, escritos pela Edge Function
 * carteira-resumo (Claude) a partir das movimentações e tarefas do ADVBOX.
 * Indexado por processo_id — a carteira lê direto pelo id da linha.
 */
export function useCarteiraResumos(poll = false) {
  return useQuery({
    queryKey: ['carteira_resumos', 'mapa'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('carteira_resumos')
        .select('processo_id, estagio_processual, providencias, erro, gerado_em')
      // Resumo em branco por falha de leitura é indistinguível de "ainda não
      // gerado", e levaria a mandar gerar de novo o que já existe — pagando
      // chamada de IA à toa.
      if (error) throw new Error(error.message)
      const m = new Map<string, CarteiraResumo>()
      for (const r of (data ?? []) as CarteiraResumo[]) m.set(r.processo_id, r)
      return m
    },
    // A varredura roda em lotes auto-encadeados no servidor: a resposta da
    // primeira chamada volta antes do fim. Com `poll`, a tela acompanha os
    // textos chegando em vez de exigir recarregar a página.
    staleTime: poll ? 0 : 60 * 1000,
    refetchInterval: poll ? 5000 : false,
  })
}

/**
 * Data da última movimentação por processo, vinda do cache que a Edge Function
 * advbox-movimentacoes mantém (sincronizado pelo cron de 2h e ao abrir a aba
 * Movimentações). Casa por DÍGITOS porque o número que o ADVBOX devolve tem
 * formatação própria, diferente do numero_cnj cadastrado aqui.
 *
 * ÚNICA EXCEÇÃO À REGRA DO ARQUIVO, e é deliberada: falha em silêncio (mapa
 * vazio), a coluna mostra "—" e o resto da tela segue funcionando. Vale aqui
 * porque nenhuma tela DEPENDE do ADVBOX estar de pé, e porque este mapa é só
 * exibição — não alimenta formulário nem cálculo, então o vazio não vira
 * apagamento nem número errado.
 *
 * Compartilhado entre a tabela de Créditos e a carteira do investidor: as duas
 * mostram a mesma data e devem concordar sempre.
 */
export function useUltimaMovimentacao() {
  return useQuery({
    queryKey: ['advbox_processo_status', 'mapa'],
    queryFn: async () => {
      const { data } = await supabase
        .from('advbox_processo_status')
        .select('numero_processo, ultima_movimentacao')
      const m = new Map<string, string>()
      for (const r of (data ?? []) as {
        numero_processo: string | null
        ultima_movimentacao: string | null
      }[]) {
        const d = onlyDigits(r.numero_processo)
        if (d.length >= 6 && r.ultima_movimentacao) m.set(d, r.ultima_movimentacao)
      }
      return m
    },
    staleTime: 5 * 60 * 1000,
  })
}

export const analisesCrud = makeCrud<AnaliseCredito, Partial<AnaliseCredito>>(
  'analises_credito',
)

export const processosCrud = makeCrud<Processo, Partial<Processo>>('processos')

export const requerimentosCrud = makeCrud<Requerimento, Partial<Requerimento>>(
  'requerimentos',
)

export const apensosCrud = makeCrud<Apenso, Partial<Apenso>>('apensos', {
  orderBy: 'created_at',
  ascending: true,
})

export const contatosCrud = makeCrud<ContatoServentia, Partial<ContatoServentia>>(
  'contatos_serventias',
  { orderBy: 'orgao', ascending: true },
)

export const investidoresCrud = makeCrud<Investidor, Partial<Investidor>>(
  'investidores',
  { orderBy: 'nome', ascending: true },
)

export const cessoesCrud = makeCrud<Cessao, Partial<Cessao>>('cessoes')

export const investimentosCrud = makeCrud<Investimento, Partial<Investimento>>(
  'investimentos',
)

export const templatesCrud = makeCrud<ContratoTemplate, Partial<ContratoTemplate>>(
  'contrato_templates',
  { orderBy: 'nome', ascending: true },
)

export const contratosCrud = makeCrud<Contrato, Partial<Contrato>>('contratos')

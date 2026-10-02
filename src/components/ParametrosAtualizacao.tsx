// Janela dos parâmetros de atualização monetária usados na projeção da carteira.
//
// Quatro linhas. SELIC e IPCA vêm do Banco Central — pelo cron semanal ou pelo botão
// "Buscar no Banco Central" — e continuam editáveis à mão: automação que não deixa
// corrigir vira automação que se contorna por fora. IPCA + 2% é derivado na hora e
// não tem campo, porque guardar um derivado abriria a chance de ele discordar da
// parcela que o originou. A data de referência nasce como hoje e é editável.
import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Download } from 'lucide-react'
import { invokeFunction } from '@/lib/functions'
import {
  useParametrosAtualizacao,
  useSalvarParametrosAtualizacao,
} from '@/lib/queries'
import { ipcaMais2 } from '@/lib/projecao'
import {
  formatDate,
  formatPercentInput,
  hojeISO,
  parsePercentInput,
} from '@/lib/format'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Field'
import { useToast } from '@/components/ui/Toast'

function LinhaParametro({
  rotulo,
  children,
}: {
  rotulo: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-borda py-2.5 last:border-b-0">
      <span className="text-sm text-texto-2">{rotulo}</span>
      <div className="w-40 shrink-0">{children}</div>
    </div>
  )
}

/** O que a busca no Banco Central deixou nos campos, e a data-base que gravou. */
export interface ResultadoDaBusca {
  selic: number | null
  ipca: number | null
  data: string
}

/**
 * Data-base que o Salvar grava.
 *
 * Em regra é HOJE: a competência do relatório, sem campo para editar.
 *
 * EXCEÇÃO: OS NÚMEROS QUE VIERAM DO BANCO CENTRAL, INTOCADOS. A busca já gravou
 * como data-base o último mês que os dois índices fecharam; salvar os mesmos
 * números com a data de hoje faria a data prometer um fechamento que os índices
 * ainda não têm. Mexeu em algum número, a conta passa a ser de quem digitou, e a
 * data volta a ser hoje.
 */
export function dataBaseAoSalvar(
  campos: { selic: number | null; ipca: number | null },
  daBusca: ResultadoDaBusca | null,
  hoje: string,
): string {
  return daBusca && campos.selic === daBusca.selic && campos.ipca === daBusca.ipca
    ? daBusca.data
    : hoje
}

export function ModalParametrosAtualizacao({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const params = useParametrosAtualizacao()
  const salvar = useSalvarParametrosAtualizacao()
  const toast = useToast()
  const qc = useQueryClient()

  // Guarda NÚMERO, não texto: o campo é mascarado (dígitos pela direita), então
  // não existe estado intermediário inválido para preservar.
  const [selic, setSelic] = useState<number | null>(null)
  const [ipca, setIpca] = useState<number | null>(null)

  // Ver dataBaseAoSalvar.
  const [daBusca, setDaBusca] = useState<ResultadoDaBusca | null>(null)

  // Recarrega o formulário a cada abertura, para não mostrar rascunho antigo.
  useEffect(() => {
    if (!open) return
    setSelic(params.data?.selic_aa ?? null)
    setIpca(params.data?.ipca_12m_aa ?? null)
  }, [open, params.data])

  // A busca vale só para a abertura em que foi feita.
  useEffect(() => {
    if (open) setDaBusca(null)
  }, [open])

  const derivado = ipcaMais2(ipca)
  // Competência é sempre HOJE, sem campo para editar — salvo logo depois da busca
  // no Banco Central (ver dataBaseAoSalvar).
  const hoje = hojeISO()
  const dataBase = dataBaseAoSalvar({ selic, ipca }, daBusca, hoje)

  const [buscando, setBuscando] = useState(false)

  /**
   * Busca os dois índices no Banco Central, grava e traz para os campos.
   *
   * A FUNÇÃO GRAVA, e o recado diz isso: o texto antigo pedia "Confira e salve",
   * mas os índices já estavam valendo para a carteira inteira desde a resposta.
   * Os campos continuam editáveis para corrigir à mão o que vier errado.
   */
  async function buscarNoBcb() {
    setBuscando(true)
    try {
      const r = await invokeFunction<{
        ok?: boolean
        selic_aa?: number | null
        ipca_12m_aa?: number | null
        data_referencia?: string | null
        avisos?: string[]
      }>('parametros-bcb', {})
      // A função já gravou no banco; aqui só refletimos nos campos. O índice que
      // falhou não foi tocado lá, e o campo dele mostra o que continua gravado —
      // é também o que a recarga logo abaixo poria nele.
      const novaSelic =
        typeof r.selic_aa === 'number' ? r.selic_aa : (params.data?.selic_aa ?? null)
      const novoIpca =
        typeof r.ipca_12m_aa === 'number' ? r.ipca_12m_aa : (params.data?.ipca_12m_aa ?? null)
      setSelic(novaSelic)
      setIpca(novoIpca)
      if (r.data_referencia) {
        setDaBusca({ selic: novaSelic, ipca: novoIpca, data: r.data_referencia })
      }
      // O resto da plataforma (carteira, Quadro Econômico) lê estes parâmetros
      // do cache: sem invalidar, mostraria os números de antes da gravação.
      void qc.invalidateQueries({ queryKey: ['parametros_atualizacao'] })
      if (r.avisos?.length) r.avisos.forEach((a) => toast.error(a))
      else toast.success('Índices do Banco Central atualizados e já gravados.')
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBuscando(false)
    }
  }

  async function handleSalvar() {
    try {
      await salvar.mutateAsync({
        selic_aa: selic,
        ipca_12m_aa: ipca,
        data_referencia: dataBase,
      })
      toast.success('Parâmetros salvos.')
      onClose()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Parâmetros de atualização"
      size="md"
      footer={
        <>
          {/* À esquerda dos botões de decisão: buscar não é confirmar nem cancelar.
              O mr-auto empurra Cancelar e Salvar para a direita. */}
          <Button
            variant="outline"
            className="mr-auto"
            icon={<Download className="h-4 w-4" />}
            loading={buscando}
            onClick={buscarNoBcb}
          >
            Buscar no Banco Central
          </Button>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            loading={salvar.isPending}
            disabled={params.isLoading || params.isError}
            onClick={handleSalvar}
          >
            Salvar
          </Button>
        </>
      }
    >
      <div>
        {/* Falha de leitura não pode virar formulário em branco: os campos
            nasceriam vazios, idênticos a "nunca cadastrado", e o Salvar gravaria
            nulo por cima da SELIC e do IPCA reais — parando a projeção de toda a
            carteira. Por isso o aviso, e o Salvar desabilitado abaixo. */}
        {params.isError && (
          <p className="mb-3 rounded-md border border-aviso-borda bg-aviso-fundo px-3 py-2 text-sm text-aviso">
            Não foi possível ler os parâmetros atuais, então não é seguro salvar
            por cima. Feche e abra novamente.{' '}
            <button
              type="button"
              className="font-medium underline"
              onClick={() => void params.refetch()}
            >
              Tentar de novo
            </button>
          </p>
        )}
        {/* Máscara de duas casas: os dígitos entram pela direita, então "1550"
            vira 15,50 e o campo nunca fica sem as casas decimais. */}
        <LinhaParametro rotulo="SELIC vigente (% a.a.)">
          <Input
            className="text-right tabular-nums"
            inputMode="numeric"
            placeholder="0,00"
            value={formatPercentInput(selic)}
            onChange={(e) => setSelic(parsePercentInput(e.target.value))}
          />
        </LinhaParametro>

        <LinhaParametro rotulo="IPCA acumulado 12m (% a.a.)">
          <Input
            className="text-right tabular-nums"
            inputMode="numeric"
            placeholder="0,00"
            value={formatPercentInput(ipca)}
            onChange={(e) => setIpca(parsePercentInput(e.target.value))}
          />
        </LinhaParametro>

        <LinhaParametro rotulo="IPCA + 2% a.a.">
          {/* Sem campo: é o IPCA acima somado a 2, calculado na hora. */}
          <div className="rounded-lg bg-superficie-2 px-3 py-2 text-right text-sm font-medium tabular-nums text-texto">
            {derivado === null ? '—' : formatPercentInput(derivado)}
          </div>
        </LinhaParametro>

        <LinhaParametro rotulo="Data de referência do relatório">
          {/* Fixa em hoje, sem campo: é a competência do relatório que está
              sendo gerado, não uma escolha. Logo depois da busca no Banco
              Central, é a competência que ela gravou (ver dataBaseAoSalvar). */}
          <div className="rounded-lg bg-superficie-2 px-3 py-2 text-right text-sm font-medium tabular-nums text-texto">
            {formatDate(dataBase)}
          </div>
        </LinhaParametro>
      </div>
    </Modal>
  )
}

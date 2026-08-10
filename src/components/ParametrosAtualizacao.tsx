// Janela dos parâmetros de atualização monetária usados na projeção da carteira.
//
// Quatro linhas. SELIC e IPCA são digitados; IPCA + 2% é derivado na hora e não
// tem campo — guardar um derivado abriria a chance de ele discordar da parcela
// que o originou. A data de referência nasce como hoje e é editável.
import { useEffect, useState } from 'react'
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
    <div className="flex items-center justify-between gap-4 border-b border-slate-100 py-2.5 last:border-b-0">
      <span className="text-sm text-slate-600">{rotulo}</span>
      <div className="w-40 shrink-0">{children}</div>
    </div>
  )
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

  // Guarda NÚMERO, não texto: o campo é mascarado (dígitos pela direita), então
  // não existe estado intermediário inválido para preservar.
  const [selic, setSelic] = useState<number | null>(null)
  const [ipca, setIpca] = useState<number | null>(null)

  // Recarrega o formulário a cada abertura, para não mostrar rascunho antigo.
  useEffect(() => {
    if (!open) return
    setSelic(params.data?.selic_aa ?? null)
    setIpca(params.data?.ipca_12m_aa ?? null)
  }, [open, params.data])

  const derivado = ipcaMais2(ipca)
  // Competência é sempre HOJE, sem campo para editar.
  const hoje = hojeISO()

  async function handleSalvar() {
    try {
      await salvar.mutateAsync({
        selic_aa: selic,
        ipca_12m_aa: ipca,
        data_referencia: hoje,
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
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={salvar.isPending} onClick={handleSalvar}>
            Salvar
          </Button>
        </>
      }
    >
      <div>
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
          <div className="rounded-lg bg-slate-50 px-3 py-2 text-right text-sm font-medium tabular-nums text-slate-700">
            {derivado === null ? '—' : formatPercentInput(derivado)}
          </div>
        </LinhaParametro>

        <LinhaParametro rotulo="Data de referência do relatório">
          {/* Fixa em hoje, sem campo: é a competência do relatório que está
              sendo gerado, não uma escolha. */}
          <div className="rounded-lg bg-slate-50 px-3 py-2 text-right text-sm font-medium tabular-nums text-slate-700">
            {formatDate(hoje)}
          </div>
        </LinhaParametro>
      </div>
    </Modal>
  )
}

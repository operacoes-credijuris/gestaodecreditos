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
import { hojeISO } from '@/lib/format'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Field'
import { useToast } from '@/components/ui/Toast'

/** "6,5" e "6.5" viram 6.5; vazio vira null. */
function paraNumero(v: string): number | null {
  const s = v.trim().replace(',', '.')
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/** Sempre com duas casas e vírgula decimal, que é como se lê aqui. */
function comDuasCasas(n: number | null): string {
  return n === null ? '' : n.toFixed(2).replace('.', ',')
}

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

  // Texto durante a digitação, para não reformatar a cada tecla.
  const [selic, setSelic] = useState('')
  const [ipca, setIpca] = useState('')
  const [dataRef, setDataRef] = useState('')

  // Recarrega o formulário a cada abertura, para não mostrar rascunho antigo.
  useEffect(() => {
    if (!open) return
    setSelic(comDuasCasas(params.data?.selic_aa ?? null))
    setIpca(comDuasCasas(params.data?.ipca_12m_aa ?? null))
    setDataRef(params.data?.data_referencia ?? hojeISO())
  }, [open, params.data])

  const ipcaNum = paraNumero(ipca)
  const derivado = ipcaMais2(ipcaNum)

  async function handleSalvar() {
    try {
      await salvar.mutateAsync({
        selic_aa: paraNumero(selic),
        ipca_12m_aa: ipcaNum,
        data_referencia: dataRef || null,
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
        <LinhaParametro rotulo="SELIC vigente (% a.a.)">
          <Input
            className="text-right tabular-nums"
            inputMode="decimal"
            placeholder="0,00"
            value={selic}
            onChange={(e) => setSelic(e.target.value)}
            // Formata ao sair do campo: durante a digitação, forçar duas casas
            // brigaria com quem está no meio de "15,2".
            onBlur={() => setSelic(comDuasCasas(paraNumero(selic)))}
          />
        </LinhaParametro>

        <LinhaParametro rotulo="IPCA acumulado 12m (% a.a.)">
          <Input
            className="text-right tabular-nums"
            inputMode="decimal"
            placeholder="0,00"
            value={ipca}
            onChange={(e) => setIpca(e.target.value)}
            onBlur={() => setIpca(comDuasCasas(paraNumero(ipca)))}
          />
        </LinhaParametro>

        <LinhaParametro rotulo="IPCA + 2% a.a.">
          {/* Sem campo: é o IPCA acima somado a 2, calculado na hora. */}
          <div className="rounded-lg bg-slate-50 px-3 py-2 text-right text-sm font-medium tabular-nums text-slate-700">
            {derivado === null ? '—' : comDuasCasas(derivado)}
          </div>
        </LinhaParametro>

        <LinhaParametro rotulo="Data de referência do relatório">
          <Input
            type="date"
            className="tabular-nums"
            value={dataRef}
            onChange={(e) => setDataRef(e.target.value)}
          />
        </LinhaParametro>
      </div>
    </Modal>
  )
}

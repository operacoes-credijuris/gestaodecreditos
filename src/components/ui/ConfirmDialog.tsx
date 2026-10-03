import type { ReactNode } from 'react'
import { AlertTriangle, Trash2 } from 'lucide-react'
import { Modal } from './Modal'
import { Button } from './Button'

/**
 * Confirmação para o que pede um "tem certeza?".
 *
 * O DESENHO DA AMOSTRA (`confirmar` em base.js): na ação de perigo, o ícone de
 * alerta ao lado do texto e a lixeira no botão, que repete o verbo; o "Cancelar"
 * é discreto (ghost), para o olho cair no que decide. Quando e como se confirma
 * não mudou: as mesmas props, os mesmos cliques.
 */
export function ConfirmDialog({
  open,
  title = 'Confirmar ação',
  message,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  danger = false,
  loading = false,
  onConfirm,
  onClose,
}: {
  open: boolean
  title?: ReactNode
  message: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  loading?: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            onClick={onConfirm}
            loading={loading}
            icon={danger ? <Trash2 className="h-[16px] w-[16px]" aria-hidden /> : undefined}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {danger ? (
        // O `.confirm` da amostra: o alerta no vermelho de perigo, ao lado do texto.
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-[20px] w-[20px] shrink-0 text-perigo" aria-hidden />
          <p className="text-corpo text-texto-2">{message}</p>
        </div>
      ) : (
        <p className="text-corpo text-texto-2">{message}</p>
      )}
    </Modal>
  )
}

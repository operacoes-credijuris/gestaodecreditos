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
  iconeDoBotao,
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
  /**
   * O ícone do botão de confirmar. No perigo, o padrão é a lixeira — certo para
   * excluir, errado para o que não apaga nada ("Desativar" um usuário). Passe
   * `null` para tirar o ícone, ou outro ícone. Sem a prop, nada muda.
   */
  iconeDoBotao?: ReactNode
  onConfirm: () => void
  onClose: () => void
}) {
  // ENQUANTO CONFIRMA, NÃO FECHA (23/10/2026): o Cancelar já ficava desligado,
  // mas o X e o Esc fechavam no meio da gravação. A ação seguia no servidor e,
  // ao terminar, o `finally` de quem chamou fechava a confirmação SEGUINTE —
  // aberta para outro registro nesse meio-tempo. Agora as três saídas esperam.
  const fechar = loading ? () => {} : onClose
  return (
    <Modal
      open={open}
      onClose={fechar}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={fechar} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            onClick={onConfirm}
            loading={loading}
            icon={
              iconeDoBotao !== undefined
                ? iconeDoBotao ?? undefined
                : danger
                  ? <Trash2 className="h-[16px] w-[16px]" aria-hidden />
                  : undefined
            }
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

import { useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import {
  registrarJanelaDeDescarte,
  responderDescarte,
  textoDoDescarte,
  type LugarDoDescarte,
} from '@/lib/descarte'

/**
 * A janela "Descartar alterações?" (a da amostra), POR CIMA da que ia fechar.
 *
 * MONTADA UMA VEZ, na raiz do app (main.tsx): quem pergunta é `perguntarDescarte`
 * (lib/descarte.ts), de qualquer tela, e espera a resposta. É um Modal como os
 * outros — entra na pilha de diálogos, prende o foco e trava a rolagem —, então
 * o Escape fecha só ela, e a janela de baixo continua aberta com o que foi
 * digitado. Fechar pelo X, pelo Escape ou por fora é "continuar editando": na
 * dúvida, nada se perde.
 */
export function JanelaDeDescarte() {
  const [aberta, setAberta] = useState(false)
  // "NESTA JANELA" OU "NESTA FICHA": quem pergunta diz onde está o que se perde
  // (o Drawer pede a ficha). Guardado só ao ABRIR, para o texto não trocar
  // durante a animação de saída.
  const [lugar, setLugar] = useState<LugarDoDescarte>('janela')
  useEffect(
    () =>
      registrarJanelaDeDescarte((sim, onde) => {
        if (sim) setLugar(onde)
        setAberta(sim)
      }),
    [],
  )

  return (
    <Modal
      open={aberta}
      onClose={() => responderDescarte(false)}
      title="Descartar alterações?"
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={() => responderDescarte(false)}>
            Continuar editando
          </Button>
          <Button variant="danger" onClick={() => responderDescarte(true)}>
            Descartar e fechar
          </Button>
        </>
      }
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-6 w-6 shrink-0 text-aviso" aria-hidden />
        <p className="text-corpo text-texto-2">{textoDoDescarte(lugar)}</p>
      </div>
    </Modal>
  )
}

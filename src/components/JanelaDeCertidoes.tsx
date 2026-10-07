// A janela só das certidões, para a Obtenção de documentação do Externo.
//
// O MESMO PAINEL DA DUE DILIGENCE DO INTERNO (ver PainelCertidoes): cedente,
// checklist e a emissão pela BullAI. Pedido de 29/09/2026 — na formalização o
// fundo pede as certidões do cedente, e quem as tira é a casa.
//
// SEM A ABA DE PROCESSOS E SEM DESFECHO: nesta etapa o crédito já foi
// qualificado, revisado e vendido. O trabalho aqui é juntar os documentos, e
// "Seguir" ou "Reprovar" no rodapé pareceriam decisões que esta etapa não toma.
import { useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { IdentificacaoDoCard } from '@/components/analise/Pecas'
import { Button } from '@/components/ui/Button'
import { PainelCertidoes } from '@/components/PainelCertidoes'
import { perguntarDescarte } from '@/lib/descarte'
import type { ArquivoLido } from '@/pages/operacional/AnaliseCredito'

export function JanelaDeCertidoes({
  leadId,
  tituloDoCard,
  cedenteDoCard,
  arquivos,
  lendoPdf,
  avisoPdf,
  onClose,
}: {
  leadId: number
  tituloDoCard: string
  cedenteDoCard: string
  arquivos: ArquivoLido[]
  lendoPdf: boolean
  avisoPdf: string | null
  onClose: () => void
}) {
  const [sujo, setSujo] = useState(false)
  // O FECHAR DO RODAPÉ PERGUNTA COMO O X: antes ele descartava o formulário
  // mexido sem dizer nada.
  const fechar = async () => {
    if (sujo && !(await perguntarDescarte())) return
    onClose()
  }
  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      dirty={sujo}
      title="Certidões do crédito"
      // O TÍTULO DO CARD COMO APOIO, como na amostra: a janela cobre o quadro, e
      // é este texto que diz de QUAL crédito são as certidões.
      description={tituloDoCard ? <IdentificacaoDoCard titulo={tituloDoCard} /> : undefined}
      footer={
        <Button variant="ghost" onClick={() => void fechar()}>
          Fechar
        </Button>
      }
    >
      <PainelCertidoes
        leadId={leadId}
        tituloDoCard={tituloDoCard}
        cedenteDoCard={cedenteDoCard}
        arquivos={arquivos}
        lendoPdf={lendoPdf}
        avisoPdf={avisoPdf}
        ativo
        onDirtyChange={setSujo}
      />
    </Modal>
  )
}

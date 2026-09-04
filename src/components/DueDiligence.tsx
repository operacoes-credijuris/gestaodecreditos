// Janela de due diligence do crédito, com as duas frentes da diligência.
//
// AS DUAS FRENTES SÃO DO MODELO, não invenção da tela: no "Modelo - Análise de
// Precatórios.xlsx", o bloco "Histórico do Cedente" pede as certidões (CND
// Federal, CNDT, unificadas dos TRFs, CENPROT, tributárias de estado e
// município, do cedente e do cônjuge) E, em cada linha positiva, manda "indicar
// o n° do processo, seu objeto, se há valor sendo cobrado, e o estágio
// processual". Certidão diz que existe dívida; processo diz o quanto ela ameaça
// a cessão. São perguntas diferentes, e por isso duas abas.
//
// O PAINEL DE CERTIDÕES ERA UM MODAL e virou aba (ver PainelCertidoes): as ações
// dele ficam no fim do próprio painel, e o rodapé daqui tem só "Fechar" — um
// "Gravar e montar checklist" no rodapé da janela pareceria valer para as duas
// abas.
//
// AS DUAS ABAS FICAM MONTADAS, e a inativa apenas oculta. Trocar de aba não pode
// perder um formulário meio preenchido, e `display:none` também tira os campos
// do foco, então o focus trap do modal continua correto.
import { useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Tabs } from '@/components/ui/Tabs'
import { EmptyState } from '@/components/ui/Table'
import { PainelCertidoes } from '@/components/PainelCertidoes'
import type { ArquivoLido } from '@/pages/operacional/AnaliseCredito'

type Aba = 'certidoes' | 'processos'

export function DueDiligence({
  leadId,
  cedenteDoCard,
  arquivos,
  lendoPdf,
  avisoPdf,
  open,
  onClose,
}: {
  leadId: number
  cedenteDoCard: string
  arquivos: ArquivoLido[]
  lendoPdf: boolean
  avisoPdf: string | null
  open: boolean
  onClose: () => void
}) {
  const [aba, setAba] = useState<Aba>('certidoes')
  // Reportado PELO painel: só ele sabe que há formulário mexido e não salvo, e
  // só a janela pode pedir a confirmação de descarte. `setSujo` é setState, cuja
  // identidade é estável — passar uma arrow inline aqui faria o efeito do painel
  // disparar a cada render.
  const [sujo, setSujo] = useState(false)

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      dirty={sujo}
      title="Due diligence do crédito"
      footer={
        <div className="flex items-center justify-end">
          <Button variant="ghost" onClick={onClose}>
            Fechar
          </Button>
        </div>
      }
    >
      <Tabs
        items={[
          { key: 'certidoes', label: 'Certidões' },
          { key: 'processos', label: 'Processos judiciais' },
        ]}
        value={aba}
        onChange={(v) => setAba(v as Aba)}
      />

      <div className="mt-4">
        <div hidden={aba !== 'certidoes'}>
          <PainelCertidoes
            leadId={leadId}
            cedenteDoCard={cedenteDoCard}
            arquivos={arquivos}
            lendoPdf={lendoPdf}
            avisoPdf={avisoPdf}
            ativo={aba === 'certidoes'}
            onDirtyChange={setSujo}
          />
        </div>

        <div hidden={aba !== 'processos'}>
          {/* Vazia de propósito, e DIZENDO o que vem — uma aba em branco sem
              explicação se lê como defeito de carregamento. O texto descreve a
              pergunta que o bloco "Histórico do Cedente" do modelo faz e que a
              aba de Certidões não responde. */}
          <EmptyState
            title="Ainda não implementado"
            description="Aqui vão os processos judiciais dos sujeitos do crédito — o que cada certidão positiva revelou: número do processo, objeto, valor cobrado e estágio. É o que separa uma certidão positiva inofensiva de um risco de fraude à execução. Por ora, essa apuração continua fora da plataforma."
          />
        </div>
      </div>
    </Modal>
  )
}

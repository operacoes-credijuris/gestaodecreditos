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
import { PainelCertidoes } from '@/components/PainelCertidoes'
import { PainelProcessosJudiciais } from '@/components/PainelProcessosJudiciais'
import type { ArquivoLido } from '@/pages/operacional/AnaliseCredito'
import type { AcaoTela } from '@/lib/kommo'

type Aba = 'certidoes' | 'processos'

export function DueDiligence({
  leadId,
  tituloDoCard,
  cedenteDoCard,
  arquivos,
  lendoPdf,
  avisoPdf,
  open,
  onClose,
  comCertidoes,
  acaoRecusar,
  onMover,
}: {
  leadId: number
  /** O título do card: é dele que sai QUAIS verbas estão sendo cedidas. */
  tituloDoCard: string
  cedenteDoCard: string
  arquivos: ArquivoLido[]
  lendoPdf: boolean
  avisoPdf: string | null
  open: boolean
  onClose: () => void
  /**
   * A frente de certidões faz parte desta diligência.
   *
   * Falso em RPV: lá não se faz diligência de certidões, só de processos
   * judiciais. Com uma frente só, a régua de abas some — uma aba solitária não
   * é uma escolha, e mostrar a régua sugeriria que existe outra a explorar.
   *
   * O painel de certidões nem é montado quando isto é falso: ele consulta o
   * banco (sujeitos, checklist, completude) e montá-lo para nada seria consulta
   * jogada fora.
   */
  comCertidoes: boolean
  /** A recusa da etapa aberta, quando ela existe. Ver o painel de processos. */
  acaoRecusar?: AcaoTela | null
  onMover?: (statusId: number, comentario: string) => Promise<void>
}) {
  const [aba, setAba] = useState<Aba>(comCertidoes ? 'certidoes' : 'processos')
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
      {comCertidoes && (
        <Tabs
          items={[
            { key: 'certidoes', label: 'Certidões' },
            { key: 'processos', label: 'Processos judiciais' },
          ]}
          value={aba}
          onChange={(v) => setAba(v as Aba)}
        />
      )}

      <div className={comCertidoes ? 'mt-4' : undefined}>
        {comCertidoes && (
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
        )}

        {/* A SEGUNDA FRENTE, que era um EmptyState "Ainda não implementado" até
            a integração com o Escavador existir. O que faltava não era tela: era
            FONTE. Buscar dívida é buscar por CPF, e o advogado — a linha 11 do
            questionário — só tem OAB nos autos; o Escavador liga uma coisa à
            outra. Ver _shared/escavador.ts e a migração 0061. */}
        <div hidden={aba !== 'processos'}>
          <PainelProcessosJudiciais
            leadId={leadId}
            tituloDoCard={tituloDoCard}
            cedenteDoCard={cedenteDoCard}
            arquivos={arquivos}
            ativo={aba === 'processos'}
            acaoRecusar={acaoRecusar}
            onMover={onMover}
          />
        </div>
      </div>
    </Modal>
  )
}

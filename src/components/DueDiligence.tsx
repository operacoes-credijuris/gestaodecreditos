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
// dele ficam no fim do próprio painel — um "Gravar e montar checklist" no rodapé
// da janela pareceria valer para as duas abas.
//
// O DESFECHO, ESSE FICA NO RODAPÉ, e é a exceção com razão. Ele não pertence a
// uma aba: é o que se faz DEPOIS de ler a diligência inteira, e a evidência que
// o sustenta está aqui dentro — os processos que a apuração acabou de achar. Sem
// os botões aqui, decidir exigia fechar a janela, achar o card na lista e abrir
// outra coisa, com a lista de processos já fora da vista.
//
// AS DUAS ABAS FICAM MONTADAS, e a inativa apenas oculta. Trocar de aba não pode
// perder um formulário meio preenchido, e `display:none` também tira os campos
// do foco, então o focus trap do modal continua correto.
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/components/ui/Toast'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Tabs } from '@/components/ui/Tabs'
import { PainelCertidoes } from '@/components/PainelCertidoes'
import { PainelProcessosJudiciais } from '@/components/PainelProcessosJudiciais'
import { JanelaDeDesfecho, type ItemDeRisco } from '@/components/JanelaDeDesfecho'
import { invokeFunction } from '@/lib/functions'
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
  acaoReprovar,
  onMover,
  onSeguir,
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
  /**
   * A recusa, quando ela cabe.
   *
   * DUAS SAÍDAS, E SÓ DUAS: seguir ou recusar. "Exigir diligência" saiu daqui —
   * ela pede documento que falta nos autos, que é assunto da análise, e no
   * rodapé de uma janela sobre dívidas de terceiro virava uma terceira opção
   * sem pergunta correspondente. Ela continua no card, onde sempre esteve.
   *
   * VEM DE FORA porque a coluna de destino é do FUNIL: RPV e Precatório numeram
   * as mesmas colunas com ids diferentes, e quem sabe em qual funil o card está é
   * a tela que o listou.
   */
  acaoReprovar?: AcaoTela | null
  onMover?: (statusId: number, comentario: string) => Promise<void>
  /**
   * O que vem depois de "Seguir": a análise do crédito.
   *
   * A janela não sabe QUAL análise é — em RPV é o motor que precifica, no
   * precatório interno é a jurídica, e na trilha dos Fundos não há nenhuma.
   * Quem sabe é a tela que abriu esta janela. Sem ela, "Seguir" só libera e
   * fecha, que continua sendo uma decisão inteira.
   */
  onSeguir?: () => void
}) {
  const [aba, setAba] = useState<Aba>(comCertidoes ? 'certidoes' : 'processos')
  // Reportado PELO painel: só ele sabe que há formulário mexido e não salvo, e
  // só a janela pode pedir a confirmação de descarte. `setSujo` é setState, cuja
  // identidade é estável — passar uma arrow inline aqui faria o efeito do painel
  // disparar a cada render.
  const [sujo, setSujo] = useState(false)
  const [desfecho, setDesfecho] = useState<AcaoTela | null>(null)
  /**
   * Os processos apurados, que sobem do painel para virar itens marcáveis.
   *
   * A JANELA NÃO OS BUSCA: quem consulta o banco é o painel, e uma segunda
   * consulta aqui criaria duas listas que divergem enquanto uma apuração corre.
   * `setItens` é setState — identidade estável, então o efeito que reporta lá
   * dentro não dispara a cada render.
   */
  const [itens, setItens] = useState<ItemDeRisco[]>([])
  const [seguindo, setSeguindo] = useState(false)
  const toast = useToast()

  /**
   * SEGUIR É UMA DECISÃO, e é por isso que ela fica gravada.
   *
   * O motor de RPV é conservador por construção: qualquer processo em que o
   * titular esteja no polo passivo vira "Sim, tem dívida" nas linhas 10 e 11 do
   * questionário. Quem lê a lista frequentemente conclui o contrário — a
   * execução é de mil e seiscentos reais, está em juizado, e o crédito é de
   * trinta mil. Clicar em Seguir é declarar isso, e `liberado_em` é onde a
   * declaração fica (migração 0062): a partir dela as duas linhas voltam a
   * responder "Não".
   *
   * NÃO APAGA A APURAÇÃO. A coluna D da planilha continua listando os processos,
   * com a marca de que o "Não" foi decisão de quem revisou — esconder o que a
   * busca achou seria pior do que não tê-la feito.
   */
  async function seguir() {
    setSeguindo(true)
    try {
      const { error } = await supabase
        .from('dd_historico')
        .update({ liberado_em: new Date().toISOString() })
        .eq('kommo_lead_id', leadId)
        // O check da 0062 recusa liberado sem apuração: só se libera o que foi
        // olhado, e olhar exige que a busca tenha corrido.
        .eq('status', 'APURADO')
      if (error) throw new Error(error.message)
      onSeguir?.()
      onClose()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSeguindo(false)
    }
  }

  /**
   * A IA redige o desfecho a partir dos processos marcados.
   *
   * `origem: 'diligencia'` não é etiqueta: é o que faz o texto explicar COMO um
   * processo de terceiro alcança esta operação — penhora do crédito cedido,
   * fraude à execução, massa falida. Sem isso a anotação listaria números de
   * processo e deixaria a conclusão por conta de quem lê.
   */
  async function redigir(tipo: string, marcados: string[], texto: string) {
    const r = await invokeFunction<{ mensagem?: string }>('redigir-desfecho', {
      desfecho: tipo,
      itens: marcados,
      texto,
      origem: 'diligencia',
      cedente: cedenteDoCard || null,
    })
    const m = String(r?.mensagem ?? '').trim()
    if (!m) throw new Error('A IA não devolveu texto para a anotação.')
    return m
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      dirty={sujo}
      title="Due diligence do crédito"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          {/* Os desfechos à esquerda, o Fechar à direita: são atos de peso
              diferente, e enfileirá-los juntos faria "Fechar" parecer a quarta
              opção de uma decisão. */}
          <div className="flex flex-wrap items-center gap-2">
            {/* SEGUIR NÃO MOVE O CARD, e por isso não sai da lista de ações da
                etapa: "Enviar para validação" e "Aprovar" são passos do funil,
                decididos com a análise à frente. Aqui a pergunta é outra — os
                processos que a diligência achou impedem a cessão? —, e a
                resposta "não impedem" é o que destrava o trabalho seguinte. */}
            <Button size="sm" onClick={seguir} loading={seguindo}>
              Seguir
            </Button>
            {acaoReprovar && (
              <Button
                size="sm"
                variant={acaoReprovar.variant}
                onClick={() => setDesfecho(acaoReprovar)}
                disabled={!onMover || seguindo}
              >
                {acaoReprovar.label}
              </Button>
            )}
          </div>
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
            lendoPdf={lendoPdf}
            ativo={aba === 'processos'}
            onItensDeRisco={setItens}
          />
        </div>
      </div>

      {desfecho && onMover && (
        <JanelaDeDesfecho
          acao={desfecho}
          achados={itens}
          onRedigir={redigir}
          onMover={async (statusId, comentario) => {
            await onMover(statusId, comentario)
            setDesfecho(null)
          }}
          onFechar={() => setDesfecho(null)}
        />
      )}
    </Modal>
  )
}

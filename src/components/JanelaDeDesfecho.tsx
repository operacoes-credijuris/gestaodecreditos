// A JANELA DO DESFECHO — a que interrompe o negócio: diligência e recusa.
//
// FORA DA ANÁLISE DE RPV, e é por isso que ela vive aqui. Nasceu dentro do
// AnaliseRpvModal porque só a análise de RPV tinha desfecho; hoje o precatório
// interno também reprova, e a recusa por DUE DILIGENCE — em qualquer funil —
// pede exatamente a mesma coisa: marcar o que motivou, escrever, deixar a IA
// redigir para quem vai ler no card. Copiá-la para o segundo lugar faria as
// duas divergirem na primeira mudança de uma delas.
//
// O QUE SE MARCA MUDA, o resto não. Na análise são os ACHADOS deste processo
// (divergência de conta, documento faltante); na diligência são OUTROS
// PROCESSOS, dívidas de terceiro que alcançam este crédito. Os dois chegam aqui
// como ItemDeRisco — grau, texto, fundamento —, e quem sabe traduzir é quem
// chama.
import { useId, useState } from 'react'
import { AlertTriangle, Info, Sparkles, XCircle } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Textarea } from '@/components/ui/Field'
import { CaixaDeAviso, DicaDeAviso, IdentificacaoDoCard, icSelo } from '@/components/analise/Pecas'
import { perguntarDescarte } from '@/lib/descarte'
import type { AcaoTela } from '@/lib/kommo'
import type { GrauRisco } from '../../supabase/functions/_shared/graus.ts'

export type { GrauRisco }

// A ESCADA DE CINCO DEGRAUS, COM A COR DO RISCO DA AUDITORIA VISUAL (03/10/2026,
// C6): o vermelho vai do ALTO para cima, o amarelo é da ATENÇÃO e o neutro, da
// NOTA. Antes o ALTO era âmbar — a mesma família da ATENÇÃO —, e na due
// diligence o maior risco da tabela não se destacava dos outros.
// IMPEDITIVO e ALTO dividem o vermelho e SE DISTINGUEM PELO ÍCONE (o círculo de
// bloqueio × o alerta) e pelo nome escrito; MODERADO fica no azul. O texto do
// selo fica sempre no contraste de leitura.
export const COR_GRAU: Record<GrauRisco, string> = {
  IMPEDITIVO: 'border-perigo-borda bg-perigo-fundo text-perigo',
  ALTO: 'border-perigo-borda bg-perigo-fundo text-perigo',
  MODERADO: 'border-info-borda bg-info-fundo text-info',
  'ATENÇÃO': 'border-aviso-borda bg-aviso-fundo text-aviso',
  NOTA: 'border-transparent bg-superficie-3 text-texto-2',
}

/** O ícone de cada grau: a cor nunca vai sozinha (WCAG 1.4.1). */
const ICONE_DO_GRAU: Record<GrauRisco, typeof AlertTriangle> = {
  IMPEDITIVO: XCircle,
  ALTO: AlertTriangle,
  MODERADO: Info,
  'ATENÇÃO': AlertTriangle,
  NOTA: Info,
}

/**
 * O selo do grau (o `.pill` da amostra), inline no parágrafo.
 *
 * INLINE, E NÃO BLOCO: a análise de RPV o põe no começo de cada item, e fora do
 * parágrafo cada um deixava uma faixa vazia embaixo do selo.
 */
export function Selo({ grau }: { grau: GrauRisco }) {
  const Icone = ICONE_DO_GRAU[grau] ?? Info
  return (
    <span
      className={cn(
        // O SELO `md` DE ui (auditoria visual, §0.8): 20px, 8px de lado.
        'mr-s2 inline-flex h-[20px] items-center gap-s1 whitespace-nowrap rounded-full border px-s2 align-middle text-xs font-semibold',
        COR_GRAU[grau],
      )}
    >
      <Icone className={icSelo} aria-hidden />
      {grau}
    </span>
  )
}

export interface ItemDeRisco {
  grau: GrauRisco
  texto: string
  fundamento?: string
  /**
   * A QUEM ESTE ITEM PERTENCE — o titular, na diligência.
   *
   * A lista chega dividida porque a decisão pode ser dividida: achada execução
   * contra o cedente, o principal cai e os honorários do advogado seguem. Sem o
   * grupo, marcar dois processos não diria de quem eles são, e a recusa só
   * poderia ser do card inteiro.
   *
   * Vazio nos achados da análise, que falam todos do mesmo processo.
   */
  grupo?: string
}

/**
 * A JANELA DO DESFECHO que interrompe o negócio: diligência e reprovação.
 *
 * JANELA, E NÃO UMA SEÇÃO QUE CRESCE EMBAIXO. O painel inline empurrava o
 * conteúdo e ficava fora da vista justamente quando havia muito o que marcar —
 * a lista de achados de uma análise ruim é longa, e ela é o motivo pelo qual a
 * janela existe. Aqui ela tem a tela inteira.
 *
 * O MOTIVO ESCRITO É O ÚNICO REQUISITO, e ele é obrigatório nos dois desfechos.
 * "Diligência" sem dizer o que falta transfere ao comercial a tarefa de
 * adivinhar o que apurar, e "Reprovar" sem motivo apaga o trabalho de quem
 * analisou: seis meses depois o card diz que foi reprovado e ninguém sabe por
 * quê — nem para não repetir o mesmo cedente, nem para reabrir se a razão
 * deixou de valer.
 *
 * MARCAR NÃO É REQUISITO, e nunca deveria ter travado o botão. A razão de
 * recusar frequentemente NÃO ESTÁ na lista: a análise levantou três divergências
 * e quem decide recusa por uma quarta coisa, que só ele viu. As marcas servem
 * para a IA redigir; quem escreve a própria razão confirma sem tocar nelas.
 *
 * Mandar para validação não passa por aqui: é o caminho normal, não pede
 * justificativa, e está no rodapé como um clique só.
 */
export function JanelaDeDesfecho({
  acao,
  achados: achadosRecebidos,
  onRedigir,
  onMover,
  onFechar,
  motivoSugerido,
  onGruposMarcados,
  rotuloConfirmar,
  subtitulo,
}: {
  acao: AcaoTela
  /** O título do card, sob o título da janela (opcional). */
  subtitulo?: string
  /** Os achados da análise, para marcar em vez de redigitar. */
  achados: ItemDeRisco[]
  /** Manda a IA reescrever o motivo para quem vai ler no card. */
  onRedigir: (desfecho: string, itens: string[], texto: string) => Promise<string>
  /**
   * Quais GRUPOS têm item marcado, sempre que a marcação muda.
   *
   * É o que permite a quem chama distinguir "recusar o crédito" de "recusar a
   * verba deste titular" — e, na segunda, seguir com a outra em vez de mover o
   * card para Reprovados.
   */
  onGruposMarcados?: (grupos: string[]) => void
  /** O rótulo do Confirmar, quando o que ele faz deixa de ser mover o card. */
  rotuloConfirmar?: string
  onMover: (statusId: number, comentario: string) => Promise<void>
  onFechar: () => void
  /** Texto que já entra no campo, quando existe um pronto. */
  motivoSugerido?: string
}) {
  const [motivo, setMotivo] = useState(motivoSugerido ?? '')
  // IDS POR JANELA, e não fixos: a janela abre por cima da análise de RPV ou da
  // due diligence, e um id repetido na página liga o rótulo ao campo errado.
  const idDoMotivo = useId()
  const idDosMotivos = useId()
  // OS ACHADOS CONGELAM AO ABRIR.
  //
  // `marcados` guarda POSIÇÕES na lista, e a lista vem de `atual` — que pode
  // mudar com esta janela aberta: um levantamento de cartório disparado pelo
  // chat faz `setAtual` em segundo plano e a lista de avisos muda ("cartório não
  // incluído" sai). As marcas passavam a apontar para outros itens, e o texto
  // que a IA já redigiu deixava de corresponder ao que está marcado.
  const [achados] = useState(achadosRecebidos)
  const [marcados, setMarcados] = useState<Set<number>>(new Set())
  const [enviando, setEnviando] = useState(false)
  const [redigindo, setRedigindo] = useState(false)
  /**
   * O texto no campo já incorpora os achados marcados, pela mão da IA.
   *
   * NÃO É COSMÉTICO: é o que libera o Confirmar quando há achado marcado. Sem
   * ele, marcar dois riscos e confirmar mandava ao card o despejo cru —
   * "- [IMPEDITIVO] ... - [ALTO] ..." numa linha só —, que é exatamente o que a
   * redação pela IA existe para evitar.
   */
  const [revisado, setRevisado] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  // Os grupos com item marcado sobem a cada mudança: quem chama decide o que
  // fazer com "só o cedente" antes mesmo de o Confirmar existir.
  //
  // O AVISO AO PAI SAI FORA DO ATUALIZADOR: o React pode rodar o atualizador
  // durante o render (e duas vezes, no modo dev), e mexer no estado de outro
  // componente dali é o "Cannot update a component while rendering" dele.
  const marcar = (i: number) => {
    const n = new Set(marcados)
    if (n.has(i)) n.delete(i)
    else n.add(i)
    setMarcados(n)
    onGruposMarcados?.([...new Set([...n].map((j) => achados[j]?.grupo ?? '').filter(Boolean))])
    // MUDOU A MARCAÇÃO, a redação anterior não vale mais: o texto no campo fala
    // de achados que não são estes.
    setRevisado(false)
  }

  /** Os achados por titular, na ordem em que chegaram. */
  const grupos = (() => {
    const mapa = new Map<string, number[]>()
    achados.forEach((a, i) => {
      const chave = a.grupo ?? ''
      mapa.set(chave, [...(mapa.get(chave) ?? []), i])
    })
    return [...mapa.entries()]
  })()

  /** O rótulo curto do desfecho, que o servidor usa para escolher o tom. */
  const tipoDoDesfecho =
    acao.papel === 'diligenciar' ? 'diligencia' : acao.papel === 'reprovar' ? 'reprovado' : 'validacao'

  const itensMarcados = () =>
    [...marcados].sort((a, b) => a - b).map((i) => {
      const it = achados[i]
      // O FUNDAMENTO VAI JUNTO. É onde estão a norma e a conta, e é isso que
      // faz a anotação sustentar a decisão em vez de só afirmá-la.
      return it.fundamento ? `[${it.grau}] ${it.texto} — ${it.fundamento}` : `[${it.grau}] ${it.texto}`
    })

  async function redigir() {
    setErro(null)
    setRedigindo(true)
    try {
      const texto = await onRedigir(tipoDoDesfecho, itensMarcados(), motivo.trim())
      // SUBSTITUI o campo, e é o comportamento certo: a redação da IA JÁ INCLUI
      // o que a pessoa escreveu (vai na entrada dela, com precedência). Somar
      // os dois deixaria o mesmo argumento duas vezes na anotação.
      setMotivo(texto)
      setRevisado(true)
    } catch (e) {
      setErro((e as Error)?.message ?? String(e))
    } finally {
      setRedigindo(false)
    }
  }

  async function confirmar() {
    setErro(null)
    setEnviando(true)
    try {
      // VAI SÓ O TEXTO DO CAMPO, e é o que quem confirma acabou de ler.
      //
      // Os achados marcados entram nele pela mão da IA, quando ela redige;
      // confirmado sem redigir, eles ficam de fora — o aviso ao lado do botão
      // diz isso. Anexar a lista crua aqui era o que enchia o card de
      // "- [IMPEDITIVO] ..." em vez da mensagem.
      await onMover(acao.statusId, motivo.trim())
      onFechar()
    } catch (e) {
      setErro((e as Error)?.message ?? String(e))
    } finally {
      setEnviando(false)
    }
  }

  /**
   * O QUE LIBERA O CONFIRMAR É O TEXTO ESCRITO, e só ele.
   *
   * MARCAR NUNCA FOI OBRIGATÓRIO, mas marcar e depois não redigir travava o
   * botão — e a razão de alguém recusar frequentemente NÃO ESTÁ na lista: a
   * análise levantou três divergências de conta e quem decide recusa por uma
   * quarta coisa, que só ele viu. Nesse caso a lista é ruído, e exigir que ela
   * passasse pela IA era exigir que a pessoa apagasse as marcas para poder
   * confirmar o texto que já tinha escrito.
   *
   * CINQUENTA CARACTERES, e não dez: dez cabem em "não passa", que é o que se
   * escreve com pressa e é exatamente o que não serve. Quem lê é o comercial,
   * sem a análise à frente, seis meses depois.
   *
   * O que a marcação faz continua valendo: ela alimenta a redação da IA. Só
   * deixou de ser um pedágio.
   */
  const MINIMO_DO_MOTIVO = 50
  /**
   * O MOTIVO É OBRIGATÓRIO NO QUE INTERROMPE, e no que aprova.
   *
   * Diligência sem dizer o que falta transfere ao comercial a tarefa de
   * adivinhar o que apurar; recusa sem motivo apaga o trabalho de quem analisou
   * — seis meses depois o card diz que não passou e ninguém sabe por quê.
   * Aprovar entra na mesma régua por outro motivo: é o que a coluna seguinte lê
   * para montar a proposta, e um card que sobe sem uma linha sobre o que se está
   * comprando chega vazio do outro lado.
   *
   * ENVIAR PARA VALIDAÇÃO é o caminho normal e fica de fora: quem valida tem a
   * análise inteira à frente, e exigir um parágrafo para seguir o fluxo previsto
   * é pedágio.
   */
  const motivoObrigatorio = acao.papel !== 'validar'
  const podeEnviar =
    !enviando &&
    !redigindo &&
    (!motivoObrigatorio || motivo.trim().length >= MINIMO_DO_MOTIVO)

  // UMA REGRA SÓ PARA TODO JEITO DE FECHAR: o X, o Escape e o fundo passam pelo
  // `dirty` do Modal, e o Cancelar do rodapé passa por aqui — antes ele fechava
  // sem perguntar, e o motivo escrito ia embora com um clique.
  const sujo = motivo.trim().length > 0
  const cancelar = async () => {
    if (sujo && !(await perguntarDescarte())) return
    onFechar()
  }

  return (
    <Modal
      open
      // NÃO FECHA COM A MOVIMENTAÇÃO NO AR: o X, o Esc e o fundo fechavam, e se
      // o card movesse e a nota falhasse, o erro caía numa janela que já não
      // existia — o card ficava sem o motivo, e ninguém sabia.
      onClose={enviando ? () => undefined : onFechar}
      size="lg"
      title={acao.label}
      // O CARD DE QUE SE FALA, sob o título (o apoio da amostra): a janela abre
      // por cima de outra, e é este texto que diz qual crédito vai ser movido.
      description={subtitulo ? <IdentificacaoDoCard titulo={subtitulo} /> : undefined}
      dirty={sujo}
      // O RODAPÉ NA ORDEM ÚNICA DAS JANELAS (auditoria visual de 03/10/2026,
      // §0.6/C8): `[Cancelar] [Confirmar]`, à direita, o ato por último. Antes o
      // Cancelar ficava sozinho na outra ponta — a terceira ordem de rodapé da
      // plataforma. Esta janela não tem alternativa para o lado esquerdo: o
      // Confirmar JÁ É o desfecho (o vermelho cheio da confirmação final).
      footer={
        <>
          <Button variant="ghost" onClick={() => void cancelar()} disabled={enviando || redigindo}>
            Cancelar
          </Button>
          <Button variant={acao.variant} onClick={confirmar} disabled={!podeEnviar} loading={enviando}>
            {rotuloConfirmar ?? 'Confirmar'}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {/* OS ACHADOS DA PRÓPRIA ANÁLISE, para marcar em vez de redigitar.
            Eles estão na tela de trás, já graduados e fundamentados; obrigar a
            pessoa a copiá-los à mão é pedir que reescreva o que a máquina
            acabou de escrever — e o que se reescreve à mão sai encurtado e sem
            a norma.

            NÃO É VINCULANTE: marcar é atalho, não formulário. Dá para confirmar
            sem marcar nada, escrevendo do zero, e dá para marcar três e
            escrever uma ressalva que contradiz uma delas. */}
        {achados.length > 0 && (
          <div className="space-y-2">
            <p id={idDosMotivos} className="text-corpo font-semibold text-texto">
              Selecionar motivos
            </p>
            {/* AGRUPADOS COMO A TABELA, e pelo mesmo motivo: são dois créditos
                com donos diferentes. Marcar só os processos de um titular é
                dizer que a verba DELE cai — e é isso que deixa a outra seguir.
                Numa lista corrida essa distinção não existiria, e a recusa
                voltaria a ser do card inteiro. */}
            {/* A CAIXA DOS MOTIVOS (`.motivos` da amostra): moldura própria e
                rolagem própria, para a lista longa de uma análise ruim não
                empurrar o campo da anotação para fora da janela. */}
            <div
              role="group"
              aria-labelledby={idDosMotivos}
              className="max-h-[230px] space-y-2 overflow-y-auto rounded-campo border border-borda px-[10px] py-2 scrollbar-thin"
            >
              {grupos.map(([nome, indices]) => (
                <div key={nome}>
                  {/* O TITULAR COMO SUBTÍTULO, COM A CONTAGEM (auditoria visual,
                      A4): rótulos em caixa alta empilhados competiam com o
                      título da janela. */}
                  {nome && (
                    <p className="mt-s1 text-sm font-semibold text-texto-2">
                      {nome} <span className="font-normal tabular-nums text-texto-3">· {indices.length}</span>
                    </p>
                  )}
                  <ul className="mt-s1 space-y-s0.5">
                    {indices.map((i) => (
                      <li key={i}>
                        {/* A LINHA INTEIRA É O ALVO: a caixa de 16px sozinha
                            ficaria abaixo dos 24px de alvo de clique. */}
                        <label className="flex min-h-[24px] cursor-pointer items-start gap-2 rounded-controle py-0.5 text-corpo text-texto">
                          <input
                            type="checkbox"
                            className="mt-[3px] h-[16px] w-[16px] flex-none cursor-pointer accent-marca focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-anel focus-visible:ring-offset-1 disabled:cursor-not-allowed"
                            checked={marcados.has(i)}
                            disabled={enviando || redigindo}
                            onChange={() => marcar(i)}
                          />
                          <span>
                            <Selo grau={achados[i].grau} />
                            {achados[i].texto}
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        )}

        <div>
          <label className="mb-2 block text-corpo font-semibold text-texto" htmlFor={idDoMotivo}>
            Anotação no card
          </label>
          <Textarea
            id={idDoMotivo}
            rows={5}
            className="min-h-[140px]"
            placeholder={
              acao.papel === 'diligenciar'
                ? 'O que falta apurar. Ex.: "a conta da contadoria não está nos autos — pedir ao advogado antes de precificar".'
                : acao.papel === 'reprovar'
                  ? 'Por que não passa. Ex.: "precatório expedido, não RPV" · "crédito de R$ 12 mil, abaixo do mínimo".'
                  : acao.papel === 'aprovar'
                    ? 'O que a proposta precisa saber: o que se está comprando, por quanto, e o que ficou de ressalva.'
                    : 'Opcional — o que o próximo a pegar este card precisa saber.'
            }
            value={motivo}
            disabled={enviando || redigindo}
            // EDITAR NÃO DESFAZ A REVISÃO: os achados continuam dentro do
            // texto, e quem edita acabou de ler a redação. Zerar aqui travaria
            // o Confirmar e obrigaria a redigir de novo, jogando fora o ajuste.
            onChange={(e) => setMotivo(e.target.value)}
          />

          {/* A REDAÇÃO PELA IA, e num botão — não no confirmar.
              Quem escreve a razão é quem acabou de auditar, e escreve como quem
              auditou: "SELIC de 02/2024 sobre parcela com termo inicial em
              09/2024". Quem lê é o comercial, que vai falar com o cedente e não
              tem a análise à frente. A IA reescreve mantendo os termos técnicos
              e explicando a consequência ao lado de cada um.

              EXPLÍCITO, e não automático no confirmar: o texto vai para o card
              sob o nome de quem clicou, e ninguém deve assinar um parágrafo que
              não leu.

              JUNTO DO CAMPO, como na amostra: o botão reescreve aquele texto, e
              o recado de conferir fala dele. */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              icon={<Sparkles className="h-[16px] w-[16px]" aria-hidden />}
              onClick={redigir}
              disabled={enviando || redigindo || (marcados.size === 0 && !motivo.trim())}
              loading={redigindo}
            >
              {revisado ? 'Redigir de novo' : 'Redigir com a IA'}
            </Button>
            {revisado && (
              <span className="text-sm text-texto-3">
                Texto reescrito pela IA — confira e edite antes de confirmar.
              </span>
            )}
          </div>
          {/* AVISO, E NÃO TRAVA. O que vai para o card é o texto do campo; os
              achados marcados só entram nele pela mão da IA. Confirmar sem
              redigir é legítimo — é o caso de quem recusa por uma razão que não
              está na lista —, mas então as marcas não vão a lugar nenhum, e
              isso precisa estar dito. */}
          {!revisado && marcados.size > 0 && (
            <DicaDeAviso>
              {marcados.size === 1 ? '1 achado marcado' : `${marcados.size} achados marcados`} — eles
              só chegam ao card se a IA redigir. Confirmando assim, vai só o texto acima.
            </DicaDeAviso>
          )}
        </div>

        {/* O ERRO NUMA CAIXA, e não numa linha de 12px: é o envio que não
            aconteceu, e a janela fica aberta com o texto para tentar de novo. */}
        {erro && (
          <CaixaDeAviso tom="perigo" role="alert">
            {erro}
          </CaixaDeAviso>
        )}
        {motivoObrigatorio && motivo.trim().length > 0 && motivo.trim().length < MINIMO_DO_MOTIVO && (
          <DicaDeAviso>
            Escreva a razão por extenso — faltam {MINIMO_DO_MOTIVO - motivo.trim().length}{' '}
            caracteres. O comercial lê isso sem ter a análise à mão.
          </DicaDeAviso>
        )}
      </div>
    </Modal>
  )
}

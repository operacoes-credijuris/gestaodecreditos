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
import { useState } from 'react'
import { Sparkles } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import type { AcaoTela } from '@/lib/kommo'
import type { GrauRisco } from '../../supabase/functions/_shared/graus.ts'

export type { GrauRisco }

export const COR_GRAU: Record<GrauRisco, string> = {
  IMPEDITIVO: 'bg-red-50 text-red-700 ring-red-200/70',
  ALTO: 'bg-amber-50 text-amber-800 ring-amber-200/70',
  MODERADO: 'bg-slate-100 text-slate-600 ring-slate-200/70',
  'ATENÇÃO': 'bg-slate-50 text-slate-500 ring-slate-200/70',
  NOTA: 'bg-slate-50 text-slate-400 ring-slate-200/60',
}

/** O selo do grau, inline no parágrafo. */
export function Selo({ grau }: { grau: GrauRisco }) {
  return (
    <span
      className={cn(
        'mr-2 inline-block rounded px-1.5 align-[2px] text-[10px] font-semibold uppercase tracking-wide ring-1 ring-inset',
        COR_GRAU[grau],
      )}
    >
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
 * O MOTIVO É OBRIGATÓRIO nos dois desfechos. "Diligência" sem dizer o que falta
 * transfere ao comercial a tarefa de adivinhar o que apurar, e "Reprovar" sem
 * motivo apaga o trabalho de quem analisou: seis meses depois o card diz que
 * foi reprovado e ninguém sabe por quê — nem para não repetir o mesmo cedente,
 * nem para reabrir se a razão deixou de valer.
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
}: {
  acao: AcaoTela
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
  const marcar = (i: number) => {
    setMarcados((s) => {
      const n = new Set(s)
      if (n.has(i)) n.delete(i)
      else n.add(i)
      onGruposMarcados?.([...new Set([...n].map((j) => achados[j]?.grupo ?? '').filter(Boolean))])
      return n
    })
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
      // VAI SÓ O TEXTO DO CAMPO. Os achados marcados já estão nele, escritos
      // pela IA e lidos por quem confirma — `podeEnviar` não libera o botão de
      // outro jeito. Anexar a lista crua aqui era o que enchia o card de
      // "- [IMPEDITIVO] ..." em vez da mensagem.
      await onMover(acao.statusId, motivo.trim())
      onFechar()
    } catch (e) {
      setErro((e as Error)?.message ?? String(e))
    } finally {
      setEnviando(false)
    }
  }

  // ACHADO MARCADO SÓ CHEGA AO CARD PELA REDAÇÃO DA IA.
  //
  // Marcar é atalho de conteúdo, não de forma: o que se aponta com o dedo vira
  // frase no texto da IA, nunca a lista de rótulos entre colchetes. Quem não
  // quer a IA desmarca tudo e escreve à mão.
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
    (!motivoObrigatorio || motivo.trim().length >= 10) &&
    (marcados.size === 0 || revisado)

  return (
    <Modal
      open
      onClose={onFechar}
      size="lg"
      title={acao.label}
      dirty={motivo.trim().length > 0}
      footer={
        <div className="flex items-center gap-2">
          <Button variant={acao.variant} onClick={confirmar} disabled={!podeEnviar} loading={enviando}>
            {rotuloConfirmar ?? 'Confirmar'}
          </Button>
          <button
            type="button"
            onClick={onFechar}
            disabled={enviando || redigindo}
            className="text-xs text-slate-400 underline-offset-2 hover:text-slate-600 hover:underline disabled:opacity-50"
          >
            cancelar
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        {/* OS ACHADOS DA PRÓPRIA ANÁLISE, para marcar em vez de redigitar.
            Eles estão na tela de trás, já graduados e fundamentados; obrigar a
            pessoa a copiá-los à mão é pedir que reescreva o que a máquina
            acabou de escrever — e o que se reescreve à mão sai encurtado e sem
            a norma.

            NÃO É VINCULANTE: marcar é atalho, não formulário. Dá para confirmar
            sem marcar nada, escrevendo do zero, e dá para marcar três e
            escrever uma ressalva que contradiz uma delas. */}
        {achados.length > 0 && (
          <div>
            <p className="text-xs text-slate-500">Selecionar motivos</p>
            {/* AGRUPADOS COMO A TABELA, e pelo mesmo motivo: são dois créditos
                com donos diferentes. Marcar só os processos de um titular é
                dizer que a verba DELE cai — e é isso que deixa a outra seguir.
                Numa lista corrida essa distinção não existiria, e a recusa
                voltaria a ser do card inteiro. */}
            <div className="mt-1.5 max-h-64 space-y-3 overflow-y-auto pr-1">
              {grupos.map(([nome, indices]) => (
                <div key={nome}>
                  {nome && (
                    <p className="font-display text-[11px] font-bold uppercase tracking-wide text-slate-400">
                      {nome}
                    </p>
                  )}
                  <ul className="mt-1 space-y-1">
                    {indices.map((i) => (
                      <li key={i}>
                        <label className="flex cursor-pointer items-start gap-2 text-sm leading-relaxed text-slate-700">
                          <input
                            type="checkbox"
                            className="mt-1 h-3.5 w-3.5 shrink-0 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
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
          <label className="block text-xs text-slate-500" htmlFor="motivo-desfecho">
            Anotação no card
          </label>
          <textarea
            id="motivo-desfecho"
            className="mt-1.5 min-h-[140px] w-full resize-y rounded-xl border border-slate-200 px-3.5 py-2 text-sm placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
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
        </div>

        {/* A REDAÇÃO PELA IA, e num botão — não no confirmar.
            Quem escreve a razão é quem acabou de auditar, e escreve como quem
            auditou: "SELIC de 02/2024 sobre parcela com termo inicial em
            09/2024". Quem lê é o comercial, que vai falar com o cedente e não
            tem a análise à frente. A IA reescreve mantendo os termos técnicos e
            explicando a consequência ao lado de cada um.

            EXPLÍCITO, e não automático no confirmar: o texto vai para o card
            sob o nome de quem clicou, e ninguém deve assinar um parágrafo que
            não leu. */}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            icon={<Sparkles className="h-3.5 w-3.5" />}
            onClick={redigir}
            disabled={enviando || redigindo || (marcados.size === 0 && !motivo.trim())}
            loading={redigindo}
          >
            {revisado ? 'Redigir de novo' : 'Redigir com a IA'}
          </Button>
          {revisado ? (
            <span className="text-xs text-slate-400">
              Texto reescrito pela IA — confira e edite antes de confirmar.
            </span>
          ) : marcados.size > 0 ? (
            /* Dizer o que falta, e não apenas desligar o botão: um Confirmar
               apagado sem explicação é um beco. */
            <span className="text-xs text-amber-700">
              {marcados.size === 1 ? '1 achado marcado' : `${marcados.size} achados marcados`} — a IA
              precisa redigir antes de confirmar, porque é o texto dela que vai para o card.
            </span>
          ) : null}
        </div>

        {motivoObrigatorio && motivo.trim().length > 0 && motivo.trim().length < 10 && (
          <p className="text-xs text-amber-700">
            Escreva a razão por extenso — o comercial lê isso sem ter a análise à mão.
          </p>
        )}
        {erro && <p className="text-xs text-red-700">{erro}</p>}
      </div>
    </Modal>
  )
}

import { useId, useState, type ClipboardEvent } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Field'
import { Segmented } from '@/components/ui/Segmented'
import { onlyDigits } from '@/lib/format'
import {
  type Comissao,
  type Cotacao,
  type CotacaoLida,
  formatarReaisSemPrefixo,
  lerReais,
  NOME_DO_GRUPO_DAS_COTACOES,
  textoDaCotacao,
} from '../../supabase/functions/_shared/cotacaoDoFundo.ts'

/** Até R$ 1 trilhão: 15 dígitos de centavos. Além disso é tecla presa. */
const MAX_DIGITOS = 15

/**
 * O CAMPO EM REAIS da cotação: "R$" fixo à esquerda, números alinhados à direita.
 *
 * DIGITANDO, os dígitos entram pela direita como centavos — o mesmo campo de
 * dinheiro da casa (ver `CampoMoeda`, no cadastro de crédito): "85000000" vira
 * 850.000,00, e não há como montar um valor inválido.
 *
 * COLANDO, o texto é LIDO como valor (`lerReais`): "850000", "850.000,00" e
 * "R$ 850 mil" viram R$ 850.000,00. Pela regra de digitação, colar "850000"
 * daria R$ 8.500,00 — e é o que se cola de planilha e de WhatsApp. O que tem
 * duas leituras ("850.5") não entra: o campo diz que não entendeu.
 */
function CampoReais({
  valor,
  onMudar,
  onColagemRecusada,
  rotulo,
}: {
  valor: number | null
  onMudar: (centavos: number | null) => void
  onColagemRecusada: (texto: string) => void
  /** Para o leitor de tela, quando o rótulo visível não é deste campo. */
  rotulo?: string
}) {
  function colar(e: ClipboardEvent<HTMLInputElement>) {
    const texto = e.clipboardData.getData('text')
    e.preventDefault()
    const c = lerReais(texto)
    if (c !== null) onMudar(c)
    else onColagemRecusada(texto)
  }
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-s4 top-1/2 -translate-y-1/2 text-corpo text-texto-2">R$</span>
      <Input
        inputMode="numeric"
        autoComplete="off"
        placeholder="0,00"
        aria-label={rotulo}
        className="pl-[44px] text-right tabular-nums"
        value={valor === null ? '' : formatarReaisSemPrefixo(valor)}
        onPaste={colar}
        onChange={(e) => {
          const d = onlyDigits(e.target.value).replace(/^0+/, '')
          if (d.length > MAX_DIGITOS) return
          onMudar(d ? Number(d) : null)
        }}
      />
    </div>
  )
}

type Modalidade = Comissao['modalidade']

/**
 * A JANELA DA COTAÇÃO: ao marcar "Cotado ‹fundo›" na Em precificação, quanto o
 * fundo ofereceu e qual a comissão. Pedido do dono em 05/10/2026.
 *
 * ENVIAR grava o texto no campo do fundo (aba "Cotações/propostas" do card) e
 * põe a etiqueta, num pedido só (ver a `kommo-etiquetar`). CANCELAR não põe
 * nada. FALHANDO, a janela fica aberta com o erro e com o que foi digitado.
 *
 * PRÉ-PREENCHIDA com o que o campo já tem — o reenvio é "Cotado" de novo, e
 * Enviar sobrescreve.
 *
 * Quem abre MONTA a janela (e a desmonta ao fechar): cada abertura começa do
 * valor do card, sem resto da anterior.
 */
export function JanelaDeCotacao({
  fundo,
  etiqueta,
  atual,
  enviando,
  onEnviar,
  onFechar,
}: {
  fundo: string
  /** O nome da etiqueta que entra ("Cotado PX Ativos"). */
  etiqueta: string
  /** O que o campo do fundo já tem no card, lido de volta (ou null). */
  atual: CotacaoLida | null
  enviando: boolean
  /** Grava; LANÇA com a mensagem quando falha — a janela a mostra e fica aberta. */
  onEnviar: (c: Cotacao) => Promise<void>
  onFechar: () => void
}) {
  const formId = useId()
  const inicial = {
    proposta: atual?.proposta ?? null,
    modalidade: (atual?.comissao?.modalidade ?? 'limitada') as Modalidade,
    comissao: atual?.comissao?.modalidade === 'limitada' ? atual.comissao.centavos : null,
  }
  const [proposta, setProposta] = useState<number | null>(inicial.proposta)
  const [modalidade, setModalidade] = useState<Modalidade>(inicial.modalidade)
  const [comissao, setComissao] = useState<number | null>(inicial.comissao)
  const [tentou, setTentou] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [colagem, setColagem] = useState<{ campo: 'proposta' | 'comissao'; texto: string } | null>(null)

  const sujo =
    proposta !== inicial.proposta ||
    modalidade !== inicial.modalidade ||
    (modalidade === 'limitada' && comissao !== inicial.comissao)

  const faltaProposta = !proposta
  const faltaComissao = modalidade === 'limitada' && !comissao
  const cotacao: Cotacao | null =
    faltaProposta || faltaComissao
      ? null
      : {
          propostaCentavos: proposta!,
          comissao: modalidade === 'spread' ? { modalidade: 'spread' } : { modalidade: 'limitada', centavos: comissao! },
        }

  async function enviar() {
    setTentou(true)
    setErro(null)
    if (!cotacao || enviando) return
    try {
      await onEnviar(cotacao)
    } catch (e) {
      setErro((e as Error).message)
    }
  }

  const avisoDeColagem = (campo: 'proposta' | 'comissao') =>
    colagem?.campo === campo
      ? `Não reconheci "${colagem.texto.slice(0, 40)}" como valor em reais. Digite o número.`
      : null

  // O texto antigo de um campo escrito à mão, que não se leu como valor: fica à
  // vista, para a pessoa saber o que vai sobrescrever.
  const textoIlegivel = atual && atual.proposta === null ? atual.texto : null

  return (
    <Modal
      open
      onClose={onFechar}
      dirty={sujo && !enviando}
      size="md"
      title={etiqueta}
      description={
        <>
          O valor vai para o campo <strong className="font-semibold text-texto">{fundo}</strong> da aba “
          {NOME_DO_GRUPO_DAS_COTACOES}” do card, e a etiqueta entra junto.
        </>
      }
      footer={
        <>
          <Button variant="secondary" onClick={onFechar} disabled={enviando}>
            Cancelar
          </Button>
          <Button type="submit" form={formId} loading={enviando}>
            Enviar
          </Button>
        </>
      }
    >
      {/* ENTER ENVIA: o Enviar do rodapé é o submit deste form (`form=`), e um
          form com submit responde ao Enter em qualquer campo. */}
      <form
        id={formId}
        noValidate
        className="space-y-s5"
        onSubmit={(e) => {
          e.preventDefault()
          void enviar()
        }}
      >
        {textoIlegivel && (
          <p className="rounded-campo bg-superficie-2 px-s4 py-s3 text-sm text-texto-2">
            O campo tem hoje: <span className="font-semibold text-texto">“{textoIlegivel}”</span>. Enviar o substitui.
          </p>
        )}

        <Field
          label="Valor da proposta"
          required
          error={avisoDeColagem('proposta') ?? (tentou && faltaProposta ? 'Informe o valor da proposta.' : undefined)}
        >
          <CampoReais
            valor={proposta}
            onMudar={(c) => {
              setColagem(null)
              setProposta(c)
            }}
            onColagemRecusada={(texto) => setColagem({ campo: 'proposta', texto })}
          />
        </Field>

        <div className="space-y-s2">
          <p className="text-corpo font-semibold text-texto">
            Comissão
            {modalidade === 'limitada' && <span className="ml-s0.5 text-perigo">*</span>}
          </p>
          <Segmented
            ariaLabel="Modalidade da comissão"
            value={modalidade}
            onChange={(k) => {
              setColagem(null)
              setModalidade(k as Modalidade)
            }}
            items={[
              { key: 'limitada', label: 'Limitada' },
              { key: 'spread', label: 'Spread' },
            ]}
          />
          {modalidade === 'limitada' ? (
            <Field
              hint="A comissão que o fundo já disse que aceita, em reais."
              error={
                avisoDeColagem('comissao') ??
                (tentou && faltaComissao ? 'Com a comissão limitada, informe o valor.' : undefined)
              }
            >
              <CampoReais
                rotulo="Valor da comissão"
                valor={comissao}
                onMudar={(c) => {
                  setColagem(null)
                  setComissao(c)
                }}
                onColagemRecusada={(texto) => setColagem({ campo: 'comissao', texto })}
              />
            </Field>
          ) : (
            <p className="text-xs text-texto-3">
              A Credijuris desconta a comissão do valor da proposta; não há valor a informar.
            </p>
          )}
        </div>

        {/* COMO FICA NO KOMMO, letra por letra: é o que o comercial vai ler no card. */}
        <div className="flex flex-wrap items-baseline justify-between gap-x-s4 gap-y-s1 rounded-campo bg-superficie-2 px-s4 py-s3">
          <span className="text-xs font-bold uppercase tracking-[0.06em] text-texto-3">No campo {fundo}</span>
          <span className="whitespace-nowrap text-corpo font-semibold tabular-nums text-texto">
            {cotacao ? textoDaCotacao(cotacao) : '—'}
          </span>
        </div>

        {erro && (
          <p role="alert" className="rounded-campo border border-perigo-borda bg-perigo-fundo px-s4 py-s3 text-corpo text-perigo">
            {erro}
          </p>
        )}
      </form>
    </Modal>
  )
}

import { useId, useState, type ClipboardEvent, type KeyboardEvent } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Field'
import { Segmented } from '@/components/ui/Segmented'
import { CaixaDeAviso } from '@/components/analise/Pecas'
import { onlyDigits } from '@/lib/format'
import { perguntarDescarte } from '@/lib/descarte'
import {
  type Comissao,
  type Cotacao,
  type CotacaoLida,
  formatarPercentual,
  inicioDaCotacao,
  formatarReais,
  formatarReaisSemPrefixo,
  lerPercentual,
  lerReais,
  NOME_DO_GRUPO_DAS_COTACOES,
  resumoDoSpread,
  textoDaCotacao,
  validarCotacao,
} from '../../supabase/functions/_shared/cotacaoDoFundo.ts'
import { type LiquidoDaNota, origemDoLiquido } from '../../supabase/functions/_shared/liquidoDaOportunidade.ts'

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
  onEnter,
}: {
  valor: number | null
  onMudar: (centavos: number | null) => void
  onColagemRecusada: (texto: string) => void
  /** Para o leitor de tela, quando o rótulo visível não é deste campo. */
  rotulo?: string
  /** Enter envia, na janela que não é formulário (ver `teclaEnter`). */
  onEnter?: () => void
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
        onKeyDown={teclaEnter(onEnter)}
        onChange={(e) => {
          const d = onlyDigits(e.target.value).replace(/^0+/, '')
          if (d.length > MAX_DIGITOS) return
          onMudar(d ? Number(d) : null)
        }}
      />
    </div>
  )
}

/**
 * O CAMPO DO PERCENTUAL DO SPREAD: o número à direita e o "%" fixo dentro do
 * campo — o espelho do `CampoReais`, com a mesma altura (36px) e o mesmo
 * alinhamento dos números.
 *
 * DIGITANDO, só entram algarismos e UMA vírgula, com até duas casas depois
 * dela ("5", "5,5", "12,25"); o ponto vira vírgula e o "%" digitado é
 * ignorado (o sufixo já está ali). Até três algarismos inteiros, para que
 * "100" apareça e o campo diga que passou — em vez de a tecla sumir calada.
 *
 * COLANDO, o texto é lido (`lerPercentual`): "5,5%" e "5.5" entram como 5,5; o
 * que não se lê fica de fora, com o motivo.
 */
function CampoPercentual({
  valor,
  onMudar,
  onColagemRecusada,
  rotulo,
  onEnter,
}: {
  valor: string
  onMudar: (texto: string) => void
  onColagemRecusada: (texto: string, erro: string) => void
  rotulo: string
  onEnter?: () => void
}) {
  function colar(e: ClipboardEvent<HTMLInputElement>) {
    const texto = e.clipboardData.getData('text')
    e.preventDefault()
    const p = lerPercentual(texto)
    if (p.ok) onMudar(formatarPercentual(p.centesimos))
    else onColagemRecusada(texto, p.erro)
  }
  return (
    <div className="relative">
      <Input
        inputMode="decimal"
        autoComplete="off"
        placeholder="0"
        aria-label={rotulo}
        className="pr-[34px] text-right tabular-nums"
        value={valor}
        onPaste={colar}
        onKeyDown={teclaEnter(onEnter)}
        onChange={(e) => {
          const t = e.target.value.replace(/\./g, ',').replace(/[^\d,]/g, '')
          if (!/^\d{0,3}(,\d{0,2})?$/.test(t)) return
          onMudar(t)
        }}
      />
      <span className="pointer-events-none absolute right-s4 top-1/2 -translate-y-1/2 text-corpo text-texto-2">%</span>
    </div>
  )
}

/**
 * ENTER NUM CAMPO DA COTAÇÃO ENVIA, quando a janela não é um formulário (a do
 * envio ao BTG, que tem dois atos no rodapé: o Enter é o "Cotado"). Na janela
 * da cotação o `<form>` já faz isso, e `onEnter` não vem.
 */
const teclaEnter = (onEnter?: () => void) =>
  onEnter
    ? (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
          e.preventDefault()
          onEnter()
        }
      }
    : undefined

type Modalidade = Comissao['modalidade']

type CampoDaCotacao = 'proposta' | 'comissao' | 'percentual' | 'base'

/**
 * O ESTADO DOS CAMPOS DA COTAÇÃO — valor da proposta, modalidade, valor da
 * comissão (limitada) e percentual (spread) —, começando do que o campo do
 * fundo já tem no card.
 *
 * À PARTE DA JANELA porque são duas as janelas que pedem a cotação: esta (o
 * "Cotado ‹fundo›" da Em precificação) e a do envio ao BTG, na Remessa aos
 * fundos (05/10/2026), onde a plataforma do BTG devolve a cotação na hora. As
 * duas usam este estado e os `CamposDaCotacao`, e o texto que vai ao Kommo sai
 * de um lugar só (`textoDaCotacao`).
 *
 * O VALOR PRÉ-PREENCHIDO é o que a pessoa digitou da outra vez: no spread do
 * formato novo, a final mais a comissão (`valorDigitadoDaCotacao`), e o
 * percentual de volta no campo. O spread antigo (sem percentual) volta com o
 * percentual vazio — e obrigatório.
 *
 * A BASE DO SPREAD (06/10/2026) é o VALOR LÍQUIDO VALIDADO, que vem da nota de
 * oportunidade do card (`liquido`, de `liquidoValidadoDasNotas`): pré-preenchido
 * com o achado, editável, e obrigatório — sem nota, o campo começa vazio. O
 * texto do campo no Kommo não diz a base, então ao recotar ela volta da nota, e
 * não da cotação: é o mesmo valor que a pessoa conferiu da outra vez, salvo se
 * a casa revalidou o crédito (e aí vale o novo).
 *
 * A COTAÇÃO SÓ SAI PRONTA DEPOIS DA MESMA PORTA DO SERVIDOR (`validarCotacao`,
 * exigindo o percentual e a base no spread): a tela não monta o que a função
 * recusaria — nem a comissão que alcance a proposta.
 *
 * AS MODALIDADES SÃO DO FUNDO (`comissoesDoFundo`, 07/10/2026): no BTG, só a
 * limitada — a janela nem oferece o spread. Um BTG antigo gravado com spread
 * volta com a comissão VAZIA (e obrigatória) e o texto de hoje à vista: o
 * spread não se converte sozinho numa comissão em reais.
 */
export function useCotacaoEmEdicao(
  atual: CotacaoLida | null,
  liquido: LiquidoDaNota | null = null,
  fundo?: string,
) {
  const { modalidades, foraDoFundo, ...doCampo } = inicioDaCotacao(atual, fundo)
  const inicial = { ...doCampo, base: liquido?.centavos ?? null }
  const [proposta, setProposta] = useState<number | null>(inicial.proposta)
  const [modalidade, setModalidade] = useState<Modalidade>(inicial.modalidade)
  const [comissao, setComissao] = useState<number | null>(inicial.comissao)
  const [percentual, setPercentual] = useState<string>(inicial.percentual)
  const [base, setBase] = useState<number | null>(inicial.base)
  const [colagem, setColagem] = useState<{ campo: CampoDaCotacao; texto: string; erro?: string } | null>(null)

  const sujo =
    proposta !== inicial.proposta ||
    modalidade !== inicial.modalidade ||
    (modalidade === 'limitada' && comissao !== inicial.comissao) ||
    (modalidade === 'spread' && (percentual !== inicial.percentual || base !== inicial.base))

  const pct = lerPercentual(percentual)
  const faltaProposta = !proposta
  const faltaComissao = modalidade === 'limitada' && !comissao
  const faltaPercentual = modalidade === 'spread' && !pct.ok && pct.motivo === 'vazio'
  const faltaBase = modalidade === 'spread' && !base
  /** O percentual digitado e inválido (fora de 0–100, casas a mais), com o motivo. */
  const erroDoPercentual =
    modalidade === 'spread' && !pct.ok && pct.motivo !== 'vazio' ? { motivo: pct.motivo, erro: pct.erro } : null

  /** A cotação completa e conferida, ou null enquanto falta ou sobra algo. */
  let cotacao: Cotacao | null = null
  /** O que a porta do servidor recusou com tudo preenchido (valor pequeno demais para o percentual). */
  let erroDaConta: string | null = null
  if (!faltaProposta && !faltaComissao && !faltaPercentual && !faltaBase && !erroDoPercentual) {
    const v = validarCotacao(
      {
        propostaCentavos: proposta,
        comissao:
          modalidade === 'spread'
            ? {
                modalidade: 'spread',
                percentualCentesimos: pct.ok ? pct.centesimos : undefined,
                baseCentavos: base,
              }
            : { modalidade: 'limitada', centavos: comissao },
      },
      { exigirPercentualNoSpread: true, exigirBaseNoSpread: true, fundo },
    )
    if (v.ok) cotacao = v.cotacao
    else erroDaConta = v.erro
  }

  // O texto antigo de um campo escrito à mão, que não se leu como valor — ou
  // gravado numa modalidade que o fundo não aceita mais (o spread do BTG): fica
  // à vista, para a pessoa saber o que vai sobrescrever.
  const textoIlegivel = atual && (atual.proposta === null || foraDoFundo) ? atual.texto : null

  return {
    modalidades,
    proposta,
    setProposta,
    modalidade,
    setModalidade,
    comissao,
    setComissao,
    percentual,
    setPercentual,
    base,
    setBase,
    liquido,
    colagem,
    setColagem,
    sujo,
    faltaProposta,
    faltaComissao,
    faltaPercentual,
    faltaBase,
    erroDoPercentual,
    erroDaConta,
    cotacao,
    textoIlegivel,
  }
}

export type CotacaoEmEdicao = ReturnType<typeof useCotacaoEmEdicao>

/**
 * O TEXTO DO CAMPO NA PRÉVIA, quebrando só na barra: "R$ 807.500,00 /" e
 * "R$ 42.500,00 (Spread de 5%)" ficam inteiros cada um, e no celular o
 * segundo desce para a linha de baixo em vez de partir o "R$" do número. Os
 * espaços continuam os comuns: copiado da tela, é o texto exato do Kommo.
 */
function TextoQuebrandoNaBarra({ texto }: { texto: string }) {
  return (
    <>
      {texto.split(' / ').map((p, i) => (
        <span key={i}>
          {i > 0 && ' / '}
          <span className="whitespace-nowrap">{p}</span>
        </span>
      ))}
    </>
  )
}

/**
 * UM TEXTO QUE PODE QUEBRAR, MENOS NOS VALORES: "R$ 800.000,00" e "5%" ficam
 * inteiros, e a linha quebra nos espaços entre as palavras.
 */
function SemPartirValores({ texto }: { texto: string }) {
  return (
    <>
      {texto.split(/(R\$ [\d.]+,\d{2}|\d+(?:,\d+)?%)/).map((p, i) =>
        i % 2 === 1 ? (
          <span key={i} className="whitespace-nowrap">
            {p}
          </span>
        ) : (
          p
        ),
      )}
    </>
  )
}

/**
 * OS CAMPOS DA COTAÇÃO: o valor da proposta, a comissão (Limitada, em R$, ou
 * Spread, em %, sobre o valor líquido validado) e, embaixo, o texto exato que
 * vai para o campo do fundo no Kommo — no spread, com a conta à vista (a
 * comissão, sobre qual líquido, e a proposta final).
 *
 * `tentou` acende os avisos de obrigatório — depois do primeiro envio, e não
 * enquanto a pessoa ainda está preenchendo. `desligado` trava tudo enquanto a
 * gravação corre. `onEnter` faz o Enter dos campos enviar, na janela que não é
 * um formulário (ver `teclaEnter`).
 */
export function CamposDaCotacao({
  edicao,
  fundo,
  tentou,
  desligado = false,
  onEnter,
}: {
  edicao: CotacaoEmEdicao
  fundo: string
  tentou: boolean
  desligado?: boolean
  onEnter?: () => void
}) {
  const {
    modalidades,
    proposta,
    setProposta,
    modalidade,
    setModalidade,
    comissao,
    setComissao,
    percentual,
    setPercentual,
    base,
    setBase,
    liquido,
    colagem,
    setColagem,
    faltaProposta,
    faltaComissao,
    faltaPercentual,
    faltaBase,
    erroDoPercentual,
    erroDaConta,
    cotacao,
    textoIlegivel,
  } = edicao

  const avisoDeColagem = (campo: CampoDaCotacao) =>
    colagem?.campo === campo
      ? colagem.erro
        ? `Não colei "${colagem.texto.slice(0, 40)}": ${colagem.erro.charAt(0).toLowerCase()}${colagem.erro.slice(1)}`
        : `Não reconheci "${colagem.texto.slice(0, 40)}" como valor em reais. Digite o número.`
      : null

  // O PERCENTUAL FORA DA FAIXA aparece na hora em que passa de 99 ("100"); o
  // zero só depois do envio, porque "0" e "0," são o começo de "0,5".
  const avisoDoPercentual =
    avisoDeColagem('percentual') ??
    (erroDoPercentual && (tentou || erroDoPercentual.motivo === 'teto') ? erroDoPercentual.erro : null) ??
    (tentou && faltaPercentual ? 'Com a comissão em spread, informe o percentual.' : null)

  // A BASE DO SPREAD: de onde veio o valor que está no campo. Da nota, com a
  // data; trocado à mão, com o que a nota diz ao lado; sem nota, o aviso.
  const origemDaBase = !liquido ? (
    <span className="font-semibold text-aviso">
      Não achei o valor líquido validado na nota de oportunidade do card — digite.
    </span>
  ) : base === liquido.centavos ? (
    `${origemDoLiquido(liquido).replace(/^d/, 'D')}.`
  ) : (
    <>
      Alterado. A nota de oportunidade{liquido.data ? ` de ${liquido.data}` : ''} diz{' '}
      <span className="whitespace-nowrap tabular-nums">{formatarReais(liquido.centavos)}</span>.
    </>
  )
  const avisoDaBase =
    avisoDeColagem('base') ??
    // Sem a nota, o erro repete o aviso (o porquê do campo vazio), agora em vermelho.
    (tentou && faltaBase
      ? liquido
        ? 'Com a comissão em spread, informe o valor líquido validado.'
        : 'Não achei o valor líquido validado na nota de oportunidade do card — digite.'
      : null)

  const resumo = cotacao ? resumoDoSpread(cotacao) : null

  return (
    // O FIELDSET trava os campos de uma vez enquanto grava (o `disabled` dele
    // chega a todo controle de dentro), sem moldura nem margem próprias.
    <fieldset disabled={desligado} className="m-0 min-w-0 space-y-s5 border-0 p-0">
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
          onEnter={onEnter}
        />
      </Field>

      {modalidades.length === 1 ? (
        // SÓ A LIMITADA (o BTG, 07/10/2026): sem o seletor de modalidade — um
        // segmentado de uma opção só é ruído. O campo é a comissão em R$.
        <Field
          label="Comissão"
          required
          hint={`A comissão que o ${fundo} paga, em reais. O ${fundo} não trabalha com spread.`}
          error={
            avisoDeColagem('comissao') ?? (tentou && faltaComissao ? 'Informe o valor da comissão.' : undefined)
          }
        >
          <CampoReais
            valor={comissao}
            onMudar={(c) => {
              setColagem(null)
              setComissao(c)
            }}
            onColagemRecusada={(texto) => setColagem({ campo: 'comissao', texto })}
            onEnter={onEnter}
          />
        </Field>
      ) : (
        <div className="space-y-s2">
          <p className="text-corpo font-semibold text-texto">
            Comissão
            <span className="ml-s0.5 text-perigo">*</span>
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
                onEnter={onEnter}
              />
            </Field>
          ) : (
            // O PERCENTUAL E A BASE, lado a lado no computador (o percentual
            // estreito, a base com o espaço do valor) e um embaixo do outro no
            // celular. A explicação da conta vem uma vez só, embaixo dos dois.
            <div className="space-y-s2 pt-s2">
              <div className="grid gap-s4 sm:grid-cols-[136px_minmax(0,1fr)]">
                <Field label="Percentual" required error={avisoDoPercentual ?? undefined}>
                  <CampoPercentual
                    rotulo="Percentual do spread"
                    valor={percentual}
                    onMudar={(t) => {
                      setColagem(null)
                      setPercentual(t)
                    }}
                    onColagemRecusada={(texto, erro) => setColagem({ campo: 'percentual', texto, erro })}
                    onEnter={onEnter}
                  />
                </Field>
                <Field label="Valor líquido validado" required hint={origemDaBase} error={avisoDaBase ?? undefined}>
                  <CampoReais
                    valor={base}
                    onMudar={(c) => {
                      setColagem(null)
                      setBase(c)
                    }}
                    onColagemRecusada={(texto) => setColagem({ campo: 'base', texto })}
                    onEnter={onEnter}
                  />
                </Field>
              </div>
              <p className="text-xs text-texto-3">
                A comissão é o percentual sobre o valor líquido validado. A Credijuris a desconta do valor da proposta;
                o que sobra é a proposta final.
              </p>
            </div>
          )}
        </div>
      )}

      {/* COMO FICA NO KOMMO, letra por letra: é o que o comercial vai ler no
          card. No spread, a conta em cima — a comissão e a proposta final. */}
      <div className="space-y-s1 rounded-campo bg-superficie-2 px-s4 py-s3">
        {resumo && (
          // NUMA LINHA com o "·" no computador; no celular, uma em cima da
          // outra — o "·" pendurado no fim da linha não separa nada.
          // A COMISSÃO PODE QUEBRAR (com a base, ela não cabe numa linha do
          // celular), mas nunca no meio de um valor nem do percentual.
          <p className="text-sm tabular-nums text-texto-2">
            <span className="block sm:inline">
              <SemPartirValores texto={resumo.comissao} />
            </span>
            <span className="hidden sm:inline" aria-hidden>
              {' · '}
            </span>
            <span className="block whitespace-nowrap sm:inline">{resumo.final}</span>
          </p>
        )}
        {/* A CONTA QUE NÃO FECHA (a comissão alcança a proposta), com tudo
            preenchido: dita aqui, onde a conta apareceria. Em cinza enquanto a
            pessoa ainda digita — o valor entra pela direita, e R$ 8,50 é o
            começo de R$ 850.000,00 —, e em vermelho depois do Enviar. */}
        {!cotacao && erroDaConta && (
          <p
            role={tentou ? 'alert' : undefined}
            className={tentou ? 'text-sm font-semibold text-perigo' : 'text-sm text-texto-2'}
          >
            <SemPartirValores texto={erroDaConta} />
          </p>
        )}
        <div className="flex flex-wrap items-baseline justify-between gap-x-s4 gap-y-s1">
          <span className="text-xs font-bold uppercase tracking-[0.06em] text-texto-3">No campo {fundo}</span>
          <span className="min-w-0 text-right text-corpo font-semibold tabular-nums text-texto">
            {cotacao ? <TextoQuebrandoNaBarra texto={textoDaCotacao(cotacao)} /> : '—'}
          </span>
        </div>
      </div>
    </fieldset>
  )
}

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
  liquido = null,
  enviando,
  onEnviar,
  onFechar,
}: {
  fundo: string
  /** O nome da etiqueta que entra ("Cotado PX Ativos"). */
  etiqueta: string
  /** O que o campo do fundo já tem no card, lido de volta (ou null). */
  atual: CotacaoLida | null
  /** O valor líquido validado da nota de oportunidade do card — a base do spread (ou null). */
  liquido?: LiquidoDaNota | null
  enviando: boolean
  /** Grava; LANÇA com a mensagem quando falha — a janela a mostra e fica aberta. */
  onEnviar: (c: Cotacao) => Promise<void>
  onFechar: () => void
}) {
  const formId = useId()
  const edicao = useCotacaoEmEdicao(atual, liquido, fundo)
  const [tentou, setTentou] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const { cotacao } = edicao

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

  // O CANCELAR PERGUNTA COMO O X E O ESC (revisão visual 2): com valor digitado,
  // ele fechava calado — e a janela irmã, a do envio ao BTG, já perguntava.
  async function cancelar() {
    if (edicao.sujo && !enviando && !(await perguntarDescarte())) return
    onFechar()
  }

  return (
    <Modal
      open
      // DURANTE O ENVIO NÃO FECHA (o Cancelar já ficava desligado): fechada pelo X
      // ou pelo Esc no meio da gravação, a janela levava junto o erro que a
      // gravação desse — e a pessoa achava que a cotação tinha entrado.
      onClose={() => {
        if (!enviando) onFechar()
      }}
      dirty={edicao.sujo && !enviando}
      size="md"
      title={etiqueta}
      description={
        <>
          O valor vai para o campo <strong className="font-semibold text-texto">{fundo}</strong> da aba “
          {NOME_DO_GRUPO_DAS_COTACOES}” do card, e a etiqueta entra junto.
        </>
      }
      footer={
        // O CANCELAR EM FANTASMA, como no ConfirmDialog e na due diligence; e
        // [Cancelar][Enviar] JUNTOS, para no celular quebrarem como par.
        <div className="flex gap-s2">
          <Button variant="ghost" onClick={() => void cancelar()} disabled={enviando}>
            Cancelar
          </Button>
          <Button type="submit" form={formId} loading={enviando}>
            Enviar
          </Button>
        </div>
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
        <CamposDaCotacao edicao={edicao} fundo={fundo} tentou={tentou} />

        {/* A MESMA CAIXA DE ERRO DA JANELA DO ENVIO AO BTG: as duas pedem a
            cotação, e são da mesma família. */}
        {erro && (
          <CaixaDeAviso tom="perigo" role="alert">
            Não deu certo: {erro}
          </CaixaDeAviso>
        )}
      </form>
    </Modal>
  )
}

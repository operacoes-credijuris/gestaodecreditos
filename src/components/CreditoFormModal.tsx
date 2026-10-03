// A janela de cadastrar e editar um crédito.
//
// SAIU DE Processos.tsx (onda 2 do redesenho) para abrir também POR CIMA DA
// PETIÇÃO: na lista do que falta preencher antes de gerar, "Abrir o cadastro do
// crédito" (item "Novo" da amostra aprovada) abre esta mesma janela, e a petição
// se recalcula sozinha quando o cadastro grava. Uma janela só, com as mesmas
// regras — duas cópias do formulário divergiriam na primeira correção.
//
// O QUE NÃO MUDOU NA MUDANÇA: as regras do Salvar (lib/regrasDoCredito.ts, com
// teste), o rascunho separado por aba, o cadastro automático na ADVBOX só na
// criação e os avisos dele. O que mudou é só a apresentação, como na amostra:
// o formulário em SEÇÕES (Processo, Partes, Aquisição e liquidação, Valores),
// exemplos nos campos, a aba "Pela pasta do Drive" e o botão que diz o que faz
// ("Cadastrar crédito", "Salvar alterações").
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { PenLine, Sparkles } from 'lucide-react'
import { processosCrud, useInvestidorDados } from '@/lib/queries'
import { listarPessoas } from '@/lib/pessoas'
import { invokeFunction } from '@/lib/functions'
import {
  NovoCreditoDoDrive,
  type PreenchimentoDoDrive,
} from '@/components/NovoCreditoDoDrive'
import { SecaoDoFormulario } from '@/components/operacional/Pecas'
import type {
  Processo,
  StatusProcesso,
  Instrumento,
  TipoCredito,
  IndiceAtualizacao,
  EspecieRequisitorio,
} from '@/lib/types'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select } from '@/components/ui/Field'
import { ComboboxTexto } from '@/components/ui/Combobox'
import { Tabs } from '@/components/ui/Tabs'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import {
  STATUS_PROCESSO,
  INSTRUMENTO,
  TIPO_CREDITO,
  INDICE_ATUALIZACAO,
  ESPECIE_REQUISITORIO,
} from '@/lib/labels'
import { formatBRLInput, formatCNJ, onlyDigits, parseBRLInput } from '@/lib/format'
// As regras do Salvar (validação, campos escondidos zerados, o formulário de
// crédito novo) moram em lib/regrasDoCredito.ts, com teste.
import { emLiquidacao, errosDoCredito, payloadDoCredito } from '@/lib/regrasDoCredito'

/**
 * Abas da janela de crédito novo. Mesmo componente e mesmo formato das abas da
 * geração de petição — duas janelas que oferecem "faça à mão ou deixe a
 * plataforma preencher" não têm por que parecer coisas diferentes.
 *
 * "PELA PASTA DO DRIVE", e não "Automatizado" (a amostra): diz de onde vêm os
 * dados, que é o que a pessoa precisa saber para escolher a aba.
 */
const ABAS_NOVO_CREDITO = [
  { key: 'manual', label: 'Manual', icon: <PenLine className="h-4 w-4" /> },
  { key: 'auto', label: 'Pela pasta do Drive', icon: <Sparkles className="h-4 w-4" /> },
]

/**
 * Campo de dinheiro com "R$" fixo à esquerda. O valor vive como número no
 * estado; os dígitos digitados entram como centavos (ver parseBRLInput), então
 * o campo nunca aceita um formato inválido.
 */
function CampoMoeda({
  valor,
  onChange,
}: {
  valor: number | null | undefined
  onChange: (v: number | null) => void
}) {
  // OS DÍGITOS são a fonte da verdade durante a digitação, não o número.
  //
  // Com o número, o estado "nenhum dígito" era inalcançável: ao apagar tudo, o
  // valor chegava a 0, e formatBRLInput(0) devolve "0,00" — reintroduzindo
  // dígitos no campo. O apagar seguinte movia entre 0,00 e 0,00 e o campo ficava
  // preso em R$ 0,00, que NÃO é "não informado": a carteira lê zero como valor
  // declarado e um "Já recebido" de R$ 0,00 num crédito liquidado produz ganho
  // fictício de todo o capital. Guardando os dígitos, apagar tudo devolve string
  // vazia e o campo volta a null.
  const [digitos, setDigitos] = useState(() => onlyDigits(formatBRLInput(valor)))

  // Ressincroniza quando o valor vem de FORA (abrir outro crédito, resetar o
  // formulário). Compara pelo valor, não pelo texto, para não brigar com a
  // digitação em curso.
  useEffect(() => {
    if (parseBRLInput(digitos) !== (valor ?? null))
      setDigitos(onlyDigits(formatBRLInput(valor)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valor])

  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-texto-2">
        R$
      </span>
      <Input
        className="pl-9 text-right tabular-nums"
        inputMode="numeric"
        placeholder="0,00"
        value={digitos ? formatBRLInput(parseBRLInput(digitos)) : ''}
        onChange={(e) => {
          const d = onlyDigits(e.target.value)
          setDigitos(d)
          onChange(d ? parseBRLInput(d) : null)
        }}
      />
    </div>
  )
}

/**
 * A janela, aberta com o crédito a editar (tem `id`) ou com o formulário vazio
 * de um crédito novo. Quem abre MONTA a janela (e a desmonta ao fechar): cada
 * abertura começa limpa, sem resto da anterior.
 */
export function CreditoFormModal({
  inicial,
  onClose,
}: {
  inicial: Partial<Processo>
  onClose: () => void
}) {
  // A MESMA lista em cache da tabela: para os nomes já cadastrados e para a aba
  // da pasta saber quais créditos já existem.
  const { data } = processosCrud.useList()
  const create = processosCrud.useCreate()
  const update = processosCrud.useUpdate()
  const toast = useToast()

  // Nomes que já existem, para os campos Cessionário e Originador oferecerem
  // em lista. Vêm dos próprios créditos e das fichas da aba "Dados cadastrais"
  // — o comercial cadastra o investidor antes de haver crédito.
  //
  // Falha nesta consulta NÃO trava a janela nem aparece em erro: sem ela os dois
  // campos continuam aceitando texto livre, só sem a metade cadastrada da lista.
  const fichas = useInvestidorDados()
  const nomesCessionario = useMemo(
    () => listarPessoas('investidor', data, fichas.data).map((p) => p.nome),
    [data, fichas.data],
  )
  const nomesOriginador = useMemo(
    () => listarPessoas('originador', data, fichas.data).map((p) => p.nome),
    [data, fichas.data],
  )

  /**
   * Aba da janela de crédito novo. Na edição não aparece. Sempre começa na
   * Manual: quem clica em Editar quer o formulário, e quem cadastra um crédito
   * novo pode não ter pasta no Drive ainda.
   */
  const [abaForm, setAbaForm] = useState<'manual' | 'auto'>('manual')
  /** Uma pasta do Drive já preencheu os campos: libera a edição e o Salvar. */
  const [autoPreenchido, setAutoPreenchido] = useState(false)
  // Erros de validação por campo, exibidos inline nos <Field>.
  const [erros, setErros] = useState<Record<string, string>>({})
  // Snapshot do formulário ao abrir — base do cálculo de "dirty".
  const snapshotRef = useRef(JSON.stringify(inicial))

  /**
   * CADA ABA TEM O SEU RASCUNHO. Preencher no da pasta não aparece no Manual, e
   * vice-versa.
   *
   * Era um formulário só, e a mesma pasta escolhida no Automatizado aparecia
   * preenchida no Manual. Confunde: as duas abas são dois CAMINHOS para cadastrar,
   * e quem começou à mão não quer ver o trabalho misturado com o que veio da pasta
   * — nem correr o risco de salvar uma mistura dos dois sem perceber.
   *
   * `editing` e `setEditing` apontam para o rascunho da aba ATIVA: quem escreve
   * num campo escreve no rascunho de quem está na tela.
   */
  const [formManual, setFormManual] = useState<Partial<Processo>>(inicial)
  const [formAuto, setFormAuto] = useState<Partial<Processo>>(inicial)
  const naAuto = abaForm === 'auto'
  const editing = naAuto ? formAuto : formManual
  const setEditing = naAuto ? setFormAuto : setFormManual

  // Sujo se QUALQUER um dos dois rascunhos saiu do estado inicial: trocar de aba e
  // fechar não pode descartar em silêncio o que ficou na outra.
  const dirty =
    JSON.stringify(formManual) !== snapshotRef.current ||
    JSON.stringify(formAuto) !== snapshotRef.current

  /**
   * Preenchimento vindo da aba da pasta. Escreve SÓ no rascunho dela, soma ao que
   * já estava lá — campo que a pasta não informa fica como estava — e libera os
   * campos para edição, sem trocar de aba.
   */
  function preencherDoDrive(dados: PreenchimentoDoDrive, opts?: { avisar?: boolean }) {
    // MESCLA, não substitui: as ondas do preenchimento se completam, e trocar o
    // estado apagaria o que o caminho da pasta já trouxe.
    setFormAuto((atual) => ({ ...atual, ...dados }))
    setErros({})
    setAutoPreenchido(true)
    // Só a onda final avisa. Avisar na primeira era pedir conferência de um
    // formulário que ainda estava sendo preenchido.
    if (opts?.avisar) {
      toast.success('Campos preenchidos pela pasta. Confira antes de salvar.')
    }
  }

  // Fecha pelo botão "Cancelar" respeitando alterações pendentes (o Modal já
  // cobre X/overlay/Escape via prop dirty).
  function fecharForm() {
    if (dirty && !window.confirm('Descartar alterações não salvas?')) return
    onClose()
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const novosErros = errosDoCredito(editing)
    if (Object.keys(novosErros).length > 0) {
      setErros(novosErros)
      return
    }
    try {
      const { id, payload } = payloadDoCredito(editing)
      if (id) {
        await update.mutateAsync({ id, changes: payload })
        toast.success('Crédito atualizado.')
        // NÃO CADASTRE NA ADVBOX AQUI, e a regra vale para os TRÊS cadastros — este,
        // requerimento e apenso. É DECISÃO DE NEGÓCIO do dono, não esquecimento:
        // escrita em sistema externo acontece na CRIAÇÃO, nunca na edição.
        //
        // O que ela protege: editar um registro é rotina — corrigir um valor, ajustar
        // uma data —, e disparar o cadastro em cada salvamento criaria na ADVBOX
        // processo que alguém pode ter deliberadamente deixado de fora. A plataforma
        // passaria por cima de uma decisão humana, em silêncio.
        //
        // Os registros antigos que precisavam entrar já foram cadastrados à mão.
      } else {
        const criado = await create.mutateAsync(payload)
        toast.success('Crédito cadastrado.')
        // FORA do await do salvamento, de propósito: o cadastro na ADVBOX é
        // consequência, não condição. Se a ADVBOX estiver fora do ar, o crédito
        // continua salvo aqui — travar o cadastro da plataforma por causa de um
        // sistema externo seria trocar um problema pequeno por um grande.
        if (criado?.id) void cadastrarNaAdvbox(criado.id)
      }
      onClose()
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  /**
   * Cadastra o processo do crédito recém-criado na ADVBOX.
   *
   * A ADVBOX só traz movimentações de processo cadastrado nela, e o esquecimento
   * não aparece em lugar nenhum: a aba Movimentações simplesmente não mostra aquele
   * processo, o que é indistinguível de "não houve movimentação". Por isso é
   * automático — e por isso avisa quando NÃO consegue.
   *
   * O silêncio é escolhido caso a caso. Integração desligada não é notícia; falha
   * de verdade é, senão o esquecimento volta pela porta dos fundos.
   *
   * Roda DEPOIS de a janela fechar (ela já foi desmontada): só usa o toast, que é
   * da plataforma inteira e continua vivo.
   */
  async function cadastrarNaAdvbox(processoId: string) {
    try {
      const r = await invokeFunction<{
        ok?: boolean
        motivo?: string
        criado?: boolean
        ja_existia?: boolean
        detalhe?: string
        aviso?: string
      }>('advbox-processos', { action: 'criar', processo_id: processoId })

      if (r.ok && r.criado) toast.success('Processo cadastrado na ADVBOX.')
      // Já existia: nada a dizer. É o caso de quem cadastrou o processo lá antes,
      // e virou vínculo — informar aqui seria ruído sobre algo que deu certo.
      else if (r.motivo === 'incompleto')
        toast.error(
          'Cadastro automático na ADVBOX está ligado, mas falta escolher responsável, fase, tipo ou cliente em Configurações.',
        )
      else if (r.motivo === 'sem_cnj')
        toast.error(`Não cadastrei na ADVBOX: ${r.detalhe ?? 'número do processo inválido.'}`)
      else if (r.aviso) toast.error(r.aviso)
    } catch (err) {
      // O crédito JÁ está salvo. Isto é aviso, não falha de cadastro — daí a
      // mensagem dizer o que ficou pendente, e não parecer que nada funcionou.
      toast.error(`Crédito salvo, mas não cadastrei na ADVBOX: ${(err as Error).message}`)
    }
  }

  const editando = !!editing.id
  const liquidando = emLiquidacao(editing.status)

  return (
    <Modal
      open
      onClose={onClose}
      title={editando ? 'Editar crédito' : 'Novo crédito'}
      description={
        editando ? (
          <span className="tabular-nums">{formatCNJ(inicial.numero_cnj)}</span>
        ) : (
          'Preencha à mão ou escolha a pasta do Drive para a IA ler os documentos.'
        )
      }
      size="lg"
      dirty={dirty}
      footer={
        <>
          <Button variant="outline" onClick={fecharForm}>
            Cancelar
          </Button>
          {/* Na aba da pasta o Salvar só aparece depois de uma pasta preencher
              os campos: antes disso ele prometeria gravar um formulário vazio e
              travado. */}
          {(abaForm === 'manual' || editando || autoPreenchido) && (
            <Button
              type="submit"
              form="form-processo"
              loading={create.isPending || update.isPending}
            >
              {editando ? 'Salvar alterações' : 'Cadastrar crédito'}
            </Button>
          )}
        </>
      }
    >
      {/* Só no cadastro NOVO. Editar um crédito que já existe não tem por que
          passar pela descoberta de pastas — a pasta dele já é conhecida. */}
      {!editando && (
        <div className="mb-4">
          <Tabs
            items={ABAS_NOVO_CREDITO}
            value={abaForm}
            onChange={(k) => setAbaForm(k as typeof abaForm)}
          />
        </div>
      )}

      {/* Linha divisória: separa a ESCOLHA da pasta do PREENCHIMENTO do crédito.
          São dois momentos diferentes do trabalho, e sem a divisão o campo de
          busca parecia o primeiro campo do formulário. */}
      {abaForm === 'auto' && !editando && (
        <div className="mb-4 border-b border-borda pb-4">
          <NovoCreditoDoDrive processos={data} onPreencher={preencherDoDrive} />
        </div>
      )}

      <form id="form-processo" onSubmit={handleSubmit}>
        {/* Os campos aparecem NAS DUAS abas, e na da pasta nascem bloqueados: sem
            pasta escolhida não há o que editar, e um formulário em branco e
            mexível ao lado de um campo de busca convida a preencher à mão
            justamente onde a ideia era não precisar. Escolher a pasta preenche e
            libera.

            <fieldset disabled> em vez de `disabled` em cada campo: são dezenas, e
            um esquecido seria um campo editável no meio de campos travados. O
            navegador propaga para tudo o que está dentro. */}
        <fieldset
          disabled={abaForm === 'auto' && !editando && !autoPreenchido}
          className="m-0 min-w-0 space-y-6 border-0 p-0 disabled:opacity-50"
        >
          <SecaoDoFormulario titulo="Processo">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Número do processo"
                required
                error={erros.numero_cnj}
                hint="É a chave do crédito no ADVBOX e no Drive."
                className="sm:col-span-2"
              >
                <Input
                  className="tabular-nums"
                  value={editing.numero_cnj ?? ''}
                  onChange={(e) => {
                    setEditing({ ...editing, numero_cnj: e.target.value })
                    // Digitar no campo limpa o erro de validação dele.
                    if (erros.numero_cnj) setErros({})
                  }}
                  placeholder="0000000-00.0000.0.00.0000"
                />
              </Field>
              <Field label="Espécie do requisitório">
                <Select
                  value={editing.especie_requisitorio ?? ''}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      especie_requisitorio: (e.target.value || null) as EspecieRequisitorio | null,
                    })
                  }
                >
                  <option value="">Não informado</option>
                  {Object.entries(ESPECIE_REQUISITORIO).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v.label}
                    </option>
                  ))}
                </Select>
              </Field>
              {/* O SEGUNDO NÚMERO DO PRECATÓRIO. Precatório tramita em dois lugares:
                  o processo judicial, onde a dívida foi reconhecida, e um processo
                  administrativo no tribunal, por onde ele anda na fila de pagamento.
                  RPV não tem esse número, então o campo só existe em precatório — em
                  RPV seria um campo vazio permanente convidando a preencher errado.

                  A condição inclui "já tem valor" para o caso de a espécie ser
                  trocada depois: sem isso, mudar para RPV esconderia um número já
                  gravado, que continuaria no banco sem tela para editá-lo. */}
              {(editing.especie_requisitorio === 'precatorio' ||
                !!editing.numero_processo_administrativo) && (
                <Field label="Número do processo administrativo (precatório)">
                  <Input
                    className="tabular-nums"
                    placeholder="Número no tribunal"
                    value={editing.numero_processo_administrativo ?? ''}
                    onChange={(e) =>
                      setEditing({ ...editing, numero_processo_administrativo: e.target.value })
                    }
                  />
                </Field>
              )}
              <div className="grid gap-4 sm:col-span-2 sm:grid-cols-3">
                <Field label="Tribunal">
                  <Input
                    placeholder="Ex.: TRT-5, TJBA"
                    value={editing.tribunal ?? ''}
                    onChange={(e) => setEditing({ ...editing, tribunal: e.target.value })}
                  />
                </Field>
                <Field label="Comarca">
                  <Input
                    placeholder="Ex.: Salvador"
                    value={editing.comarca ?? ''}
                    onChange={(e) => setEditing({ ...editing, comarca: e.target.value })}
                  />
                </Field>
                <Field label="Vara">
                  <Input
                    placeholder="Ex.: 13ª Vara do Trabalho"
                    value={editing.vara ?? ''}
                    onChange={(e) => setEditing({ ...editing, vara: e.target.value })}
                  />
                </Field>
              </div>
            </div>
          </SecaoDoFormulario>

          <SecaoDoFormulario titulo="Partes">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Cedente">
                <Input
                  value={editing.cedente ?? ''}
                  onChange={(e) => setEditing({ ...editing, cedente: e.target.value })}
                />
              </Field>
              <Field label="Advogado do cedente">
                <Input
                  value={editing.cedente_advogado ?? ''}
                  onChange={(e) => setEditing({ ...editing, cedente_advogado: e.target.value })}
                />
              </Field>
              {/* Os dois campos abaixo aceitam texto livre E oferecem quem já
                  existe. A lista não é enfeite: é o nome digitado, normalizado,
                  que identifica a pessoa em "Dados cadastrais", e uma letra
                  trocada aqui cria uma segunda pessoa com ficha bancária própria
                  — sem erro na tela, porque as duas linhas parecem certas. */}
              <Field label="Cessionário">
                <ComboboxTexto
                  valor={editing.cessionario ?? ''}
                  onChange={(v) => setEditing({ ...editing, cessionario: v })}
                  opcoes={nomesCessionario}
                  placeholder="Escolha ou digite um nome novo"
                />
              </Field>
              <Field label="Originador">
                <ComboboxTexto
                  valor={editing.originador ?? ''}
                  onChange={(v) => setEditing({ ...editing, originador: v })}
                  opcoes={nomesOriginador}
                  placeholder="Escolha ou digite um nome novo"
                />
              </Field>
              <Field label="Entidade devedora" className="sm:col-span-2">
                <Input
                  placeholder="Ex.: União, Estado da Bahia, INSS"
                  value={editing.entidade_devedora ?? ''}
                  onChange={(e) => setEditing({ ...editing, entidade_devedora: e.target.value })}
                />
              </Field>
            </div>
          </SecaoDoFormulario>

          <SecaoDoFormulario titulo="Aquisição e liquidação">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Data de aquisição">
                <Input
                  type="date"
                  value={editing.data_aquisicao ?? ''}
                  onChange={(e) => setEditing({ ...editing, data_aquisicao: e.target.value })}
                />
              </Field>
              <Field label="Expectativa de liquidação" error={erros.expectativa_liquidacao}>
                <Input
                  type="date"
                  value={editing.expectativa_liquidacao ?? ''}
                  onChange={(e) => {
                    if (erros.expectativa_liquidacao)
                      setErros((v) => ({ ...v, expectativa_liquidacao: '' }))
                    setEditing({ ...editing, expectativa_liquidacao: e.target.value })
                  }}
                />
              </Field>
              <Field
                label="Instrumento"
                // Avisa que o campo condicional oculto será descartado no salvamento.
                hint={
                  editing.instrumento !== 'registro_publico' && editing.numero_rtdpj?.trim()
                    ? 'Ao salvar sem "Registro público", o nº RTDPJ será descartado.'
                    : undefined
                }
              >
                <Select
                  value={editing.instrumento ?? ''}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      instrumento: (e.target.value || null) as Instrumento | null,
                    })
                  }
                >
                  <option value="">Não informado</option>
                  {Object.entries(INSTRUMENTO).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v.label}
                    </option>
                  ))}
                </Select>
              </Field>
              {editing.instrumento === 'registro_publico' && (
                <Field label="Nº RTDPJ" hint="Opcional. Para mais de um, separe por vírgula.">
                  <Input
                    value={editing.numero_rtdpj ?? ''}
                    onChange={(e) => setEditing({ ...editing, numero_rtdpj: e.target.value })}
                    placeholder="Número do registro no RTDPJ"
                  />
                </Field>
              )}
              <Field
                label="Status"
                required
                // Avisa que os campos condicionais ocultos serão descartados.
                hint={
                  !liquidando &&
                  (editing.data_liquidacao ||
                    editing.ja_recebido != null ||
                    editing.valor_estimado_complementar != null)
                    ? 'Ao salvar como Ativo, a data de liquidação, o já recebido e o valor estimado complementar serão descartados.'
                    : undefined
                }
              >
                <Select
                  value={editing.status ?? 'ativo'}
                  onChange={(e) =>
                    setEditing({ ...editing, status: e.target.value as StatusProcesso })
                  }
                >
                  {Object.entries(STATUS_PROCESSO).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v.label}
                    </option>
                  ))}
                </Select>
              </Field>
              {liquidando && (
                <Field
                  label="Data de liquidação"
                  error={erros.data_liquidacao}
                  hint="Quando o pagamento caiu."
                >
                  <Input
                    type="date"
                    value={editing.data_liquidacao ?? ''}
                    onChange={(e) => {
                      if (erros.data_liquidacao) setErros((v) => ({ ...v, data_liquidacao: '' }))
                      setEditing({ ...editing, data_liquidacao: e.target.value })
                    }}
                  />
                </Field>
              )}
              <Field label="Tipo de crédito" className="sm:col-span-2">
                <div className="flex flex-wrap gap-x-5 gap-y-2 pt-1">
                  {Object.entries(TIPO_CREDITO).map(([k, v]) => (
                    <label
                      key={k}
                      className="flex min-h-[24px] cursor-pointer items-center gap-2 text-corpo text-texto"
                    >
                      <input
                        type="checkbox"
                        checked={(editing.tipo_credito ?? []).includes(k as TipoCredito)}
                        onChange={() => {
                          const atuais = editing.tipo_credito ?? []
                          setEditing({
                            ...editing,
                            tipo_credito: atuais.includes(k as TipoCredito)
                              ? atuais.filter((t) => t !== k)
                              : [...atuais, k as TipoCredito],
                          })
                        }}
                      />
                      {v.label}
                    </label>
                  ))}
                </div>
              </Field>
            </div>
          </SecaoDoFormulario>

          <SecaoDoFormulario titulo="Valores">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Capital investido">
                <CampoMoeda
                  valor={editing.capital_investido}
                  onChange={(v) => setEditing({ ...editing, capital_investido: v })}
                />
              </Field>
              <Field label="Valor de face">
                <CampoMoeda
                  valor={editing.valor_face}
                  onChange={(v) => setEditing({ ...editing, valor_face: v })}
                />
              </Field>
              {liquidando && (
                <>
                  <Field label="Já recebido">
                    <CampoMoeda
                      valor={editing.ja_recebido}
                      onChange={(v) => setEditing({ ...editing, ja_recebido: v })}
                    />
                  </Field>
                  <Field label="Valor estimado complementar">
                    <CampoMoeda
                      valor={editing.valor_estimado_complementar}
                      onChange={(v) => setEditing({ ...editing, valor_estimado_complementar: v })}
                    />
                  </Field>
                </>
              )}
              <Field label="Data de referência" hint="Data-base do valor de face.">
                <Input
                  type="date"
                  value={editing.data_referencia ?? ''}
                  onChange={(e) => setEditing({ ...editing, data_referencia: e.target.value })}
                />
              </Field>
              <Field label="Índice de atualização">
                <Select
                  value={editing.indice_atualizacao ?? ''}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      indice_atualizacao: (e.target.value || null) as IndiceAtualizacao | null,
                    })
                  }
                >
                  <option value="">Não informado</option>
                  {Object.entries(INDICE_ATUALIZACAO).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </SecaoDoFormulario>
        </fieldset>
      </form>
    </Modal>
  )
}

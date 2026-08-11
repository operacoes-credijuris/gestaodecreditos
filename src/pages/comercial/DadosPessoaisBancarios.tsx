// Dados pessoais e bancários de quem entra na operação, em duas visões:
// INVESTIDORES (os cessionários dos Créditos) e INTERMEDIADORES (quem intermediou
// a aquisição).
//
// A lista tem duas origens (ver lib/pessoas.ts): os nomes que aparecem nos
// Créditos e as pessoas cadastradas aqui. O cadastro existe porque o comercial vem
// ANTES do operacional — o investidor é cadastrado para se fazer o contrato, e o
// crédito só é lançado quando o negócio fecha. Quem foi cadastrado e ainda não
// tem crédito aparece marcado, para a lista dizer em que pé cada um está.
//
// A tela vivia como terceira aba das Carteiras. Saiu de lá porque não é carteira:
// não tem investidor selecionado, não tem mês de referência e não fala de
// projeção. Ficar junto obrigava a passar pela carteira de alguém para chegar a
// um cadastro.
import { useMemo, useRef, useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import {
  chavePessoa,
  processosCrud,
  useExcluirInvestidorDados,
  useInvestidorDados,
  useSalvarInvestidorDados,
  type TipoPessoa,
} from '@/lib/queries'
import { listarPessoas, type PessoaLista } from '@/lib/pessoas'
import {
  compilarEndereco,
  cpfCnpjValido,
  formatCepInput,
  formatCpfCnpjInput,
  limparNumeroConta,
  nomeParecido,
  normalizarNome,
  onlyDigits,
} from '@/lib/format'
import { PageHeader } from '@/components/ui/PageHeader'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Field, Input, Select } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { Segmented } from '@/components/ui/Segmented'
import { Combobox, type OpcaoCombo } from '@/components/ui/Combobox'
import { IconButton } from '@/components/ui/IconButton'
import {
  Table,
  THead,
  TH,
  TBody,
  TR,
  TD,
  Loading,
  ErrorState,
  EmptyState,
} from '@/components/ui/Table'
import { useToast } from '@/components/ui/Toast'

type CampoPessoa =
  | 'cpf'
  | 'rg'
  | 'banco'
  | 'agencia'
  | 'conta'
  | 'pix'
  | 'logradouro'
  | 'numero'
  | 'complemento'
  | 'bairro'
  | 'cidade'
  | 'uf'
  | 'cep'

/**
 * `mascara` normaliza o que se digita, a cada tecla. É onde o formato deixa de
 * ser recomendação e passa a ser garantia: o CPF vira CNPJ sozinho ao passar de
 * 11 dígitos, agência/conta descartam letra, número aceita só dígito e o CEP sai
 * sempre 00000-000.
 */
const CAMPOS_DOCUMENTO: {
  chave: CampoPessoa
  rotulo: string
  mascara?: (v: string) => string
  dica?: string
}[] = [
  {
    chave: 'cpf',
    rotulo: 'CPF / CNPJ',
    mascara: formatCpfCnpjInput,
    dica: '000.000.000-00',
  },
  { chave: 'rg', rotulo: 'RG' },
  { chave: 'banco', rotulo: 'Banco' },
  { chave: 'agencia', rotulo: 'Agência', mascara: limparNumeroConta },
  { chave: 'conta', rotulo: 'Conta', mascara: limparNumeroConta },
  { chave: 'pix', rotulo: 'Pix' },
]

// Colunas da tabela. Endereço é UMA coluna, em texto corrido compilado das
// partes — a quebra em campos existe só na janela de edição.
const COLUNAS_TABELA: { chave: CampoPessoa | 'endereco'; rotulo: string }[] = [
  { chave: 'cpf', rotulo: 'CPF / CNPJ' },
  { chave: 'rg', rotulo: 'RG' },
  { chave: 'banco', rotulo: 'Banco' },
  { chave: 'agencia', rotulo: 'Agência' },
  { chave: 'conta', rotulo: 'Conta' },
  { chave: 'pix', rotulo: 'Pix' },
  { chave: 'endereco', rotulo: 'Endereço' },
]

const VAZIO: Record<CampoPessoa, string> = {
  cpf: '',
  rg: '',
  banco: '',
  agencia: '',
  conta: '',
  pix: '',
  logradouro: '',
  numero: '',
  complemento: '',
  bairro: '',
  cidade: '',
  uf: '',
  cep: '',
}

/** O que muda entre as duas visões: só o rótulo e o texto de lista vazia. */
const VISOES: Record<TipoPessoa, { rotulo: string; vazio: string }> = {
  investidor: {
    rotulo: 'Investidor',
    vazio:
      'Cadastre um investidor aqui, ou lance um crédito com o campo Cessionário preenchido.',
  },
  intermediador: {
    rotulo: 'Intermediador',
    vazio:
      'Cadastre um intermediador aqui, ou lance um crédito com o campo Intermediador preenchido.',
  },
}

export default function DadosPessoaisBancarios() {
  const processos = processosCrud.useList()
  const dados = useInvestidorDados()
  const salvar = useSalvarInvestidorDados()
  const excluir = useExcluirInvestidorDados()
  const toast = useToast()

  const [tipo, setTipo] = useState<TipoPessoa>('investidor')
  const visao = VISOES[tipo]

  // Pessoa na janela: o nome e o formulário à parte. `novo` libera a edição do
  // nome — na ficha de quem já existe o nome é fixo.
  const [editando, setEditando] = useState<{
    /** Identifica ESTA abertura da janela. Ver preencherPorCep. */
    id: number
    chave: string
    nome: string
    novo: boolean
  } | null>(null)
  const seqJanela = useRef(0)
  const [form, setForm] = useState<Record<CampoPessoa, string>>(VAZIO)
  const [aExcluir, setAExcluir] = useState<PessoaLista | null>(null)

  // Os 5.571 municípios entram por import DINÂMICO, e só quando alguém abre a
  // edição: são ~86 kB que não fazem sentido no bundle de quem nunca edita.
  const [municipios, setMunicipios] = useState<Record<string, string[]> | null>(null)
  const [ufs, setUfs] = useState<string[]>([])
  // Estado da busca por CEP, só para dar retorno visual no campo.
  const [buscandoCep, setBuscandoCep] = useState(false)
  /** Id da última busca de CEP disparada — descarta resposta atrasada. */
  const reqCepRef = useRef(0)
  /** Quais campos do endereço foram preenchidos pela ÚLTIMA busca de CEP. Só
   *  esses podem ser substituídos por uma busca nova; o que foi digitado à mão
   *  fica. */
  const camposDoCep = useRef<Set<string>>(new Set())
  const [avisoCep, setAvisoCep] = useState<string | null>(null)

  // Pessoas da visão atual, das duas origens, em ordem alfabética.
  const pessoas = useMemo(
    () => listarPessoas(tipo, processos.data, dados.data),
    [tipo, processos.data, dados.data],
  )

  /**
   * Aviso do campo Nome, só no cadastro. Duas situações:
   *
   * • nome que já tem ficha — o Salvar barra, e avisar aqui poupa preencher o
   *   formulário inteiro para descobrir no fim;
   * • nome PARECIDO com alguém que já está na plataforma — não barra nada, porque
   *   podem ser pessoas diferentes. É só a pergunta, que é o que segura o
   *   "José Silva" cadastrado ao lado do "José da Silva" que já existia.
   */
  const avisoNome = useMemo(() => {
    if (!editando?.novo) return undefined
    const nome = editando.nome.trim()
    if (!nome) return undefined
    const chave = normalizarNome(nome)
    if (dados.data?.has(chavePessoa(tipo, chave)))
      return 'Já existe ficha com este nome. Cancele e edite pelo lápis na tabela.'
    const p = nomeParecido(
      nome,
      pessoas.map((x) => x.nome),
    )
    return p
      ? `Parecido com "${p}". Se for o mesmo, cancele e edite pelo lápis na tabela.`
      : undefined
  }, [editando, dados.data, pessoas, tipo])

  async function abrirJanela(chave: string, nome: string, novo: boolean) {
    const d = novo ? undefined : dados.data?.get(chavePessoa(tipo, chave))
    setForm({
      cpf: d?.cpf ?? '',
      rg: d?.rg ?? '',
      banco: d?.banco ?? '',
      agencia: d?.agencia ?? '',
      conta: d?.conta ?? '',
      pix: d?.pix ?? '',
      logradouro: d?.logradouro ?? '',
      numero: d?.numero ?? '',
      complemento: d?.complemento ?? '',
      bairro: d?.bairro ?? '',
      cidade: d?.cidade ?? '',
      uf: d?.uf ?? '',
      cep: d?.cep ?? '',
    })
    setEditando({ id: ++seqJanela.current, chave, nome, novo })
    setAvisoCep(null)
    camposDoCep.current = new Set()
    if (!municipios) {
      const m = await import('@/lib/municipios')
      setMunicipios(m.MUNICIPIOS_POR_UF)
      setUfs(m.UFS)
    }
  }

  /**
   * CEP completo (8 dígitos) busca o endereço e preenche logradouro, bairro,
   * cidade e UF.
   *
   * NÚMERO e COMPLEMENTO não vêm, e nunca devem vir: um CEP cobre a rua (ou um
   * trecho dela), não a casa. O "complemento" das bases de CEP é descritor de
   * faixa ("de 612 a 1510 - lado par") e sujaria o endereço do contrato.
   */
  async function preencherPorCep(cepMascarado: string) {
    if (onlyDigits(cepMascarado).length !== 8) {
      setAvisoCep(null)
      return
    }
    // GUARDA DE OBSOLESCÊNCIA: digitar rápido dispara mais de uma busca e a rede
    // não responde na ordem em que foi chamada. Só a última escreve, e só se a
    // janela aberta ainda for a mesma — senão o endereço de um cai na ficha do
    // outro. A comparação é pelo id da abertura, e não pela chave, porque o
    // cadastro novo não tem chave até ser salvo: duas aberturas seguidas
    // pareceriam a mesma ficha.
    const meuId = ++reqCepRef.current
    const janelaNaChamada = editando?.id
    setBuscandoCep(true)
    setAvisoCep(null)
    try {
      const { buscarCep } = await import('@/lib/cep')
      const e = await buscarCep(cepMascarado)
      if (meuId !== reqCepRef.current || janelaNaChamada !== editando?.id) return
      if (!e) {
        setAvisoCep('CEP não encontrado. Preencha à mão.')
        return
      }
      // A cidade tem de existir na lista do IBGE, senão o combobox não a
      // reconhece como selecionada e o campo pareceria vazio.
      const m = municipios ?? (await import('@/lib/municipios')).MUNICIPIOS_POR_UF
      const cidadeValida = e.uf && m[e.uf]?.includes(e.cidade)
      // O CEP novo SUBSTITUI o que veio do CEP anterior: CEP de cidade inteira
      // não tem logradouro, e manter a rua antiga montaria um endereço com cara
      // de completo e a rua errada. Só o digitado à mão é preservado.
      const veioDoCepAnterior = camposDoCep.current
      setForm((f) => ({
        ...f,
        logradouro:
          e.logradouro || (veioDoCepAnterior.has('logradouro') ? '' : f.logradouro),
        bairro: e.bairro || (veioDoCepAnterior.has('bairro') ? '' : f.bairro),
        uf: e.uf || f.uf,
        cidade: cidadeValida ? e.cidade : '',
      }))
      const preenchidos = new Set<string>()
      if (e.logradouro) preenchidos.add('logradouro')
      if (e.bairro) preenchidos.add('bairro')
      camposDoCep.current = preenchidos
      if (e.uf && !cidadeValida) {
        setAvisoCep(`"${e.cidade}" não está na lista do IBGE. Escolha a cidade à mão.`)
      } else if (!e.logradouro) {
        setAvisoCep('Este CEP não tem logradouro. Preencha a rua à mão.')
      }
    } finally {
      setBuscandoCep(false)
    }
  }

  // Cidades da UF escolhida. Sem UF a lista fica vazia de propósito: escolher
  // cidade antes do estado é o que produz "São Paulo" no Rio Grande do Sul.
  const cidadesDaUf = useMemo(
    () => (form.uf && municipios ? (municipios[form.uf] ?? []) : []),
    [form.uf, municipios],
  )
  const opcoesCidade = useMemo<OpcaoCombo[]>(
    () => cidadesDaUf.map((nome, i) => ({ id: i, titulo: nome })),
    [cidadesDaUf],
  )

  async function handleSalvar() {
    if (!editando) return
    const nome = editando.nome.trim()
    if (!nome) {
      toast.error(`Informe o nome do ${visao.rotulo.toLowerCase()}.`)
      return
    }
    // A chave sai do NOME, não do que estava na janela: no cadastro novo o nome é
    // digitado agora, e é ele que identifica a pessoa no banco.
    const chave = normalizarNome(nome)
    // Cadastro que cairia sobre uma ficha existente é barrado, não sobrescrito: o
    // Salvar é upsert da linha inteira, e "cadastrar" alguém que já tem ficha
    // apagaria CPF, conta e endereço de quem está lá.
    if (editando.novo && dados.data?.has(chavePessoa(tipo, chave))) {
      toast.error(
        `Já existe ficha de "${nome}". Abra pelo lápis na tabela para editar.`,
      )
      return
    }
    // O rótulo promete "CPF / CNPJ", e 12 ou 13 dígitos não são nem um nem outro.
    // Dígito trocado aqui é dado de pagamento errado, que só aparece quando a
    // transferência falha.
    if (!cpfCnpjValido(form.cpf)) {
      toast.error('CPF/CNPJ inválido. Confira os dígitos antes de salvar.')
      return
    }
    // Campo em branco vira null, não string vazia: no banco "não informado" é
    // ausência de valor, e "" faria a célula parecer preenchida com nada.
    const vazioNull = (s: string) => (s.trim() ? s.trim() : null)
    const compilado = vazioNull(compilarEndereco(form))
    try {
      await salvar.mutateAsync({
        tipo,
        nome_chave: chave,
        nome_exibicao: nome,
        cpf: vazioNull(form.cpf),
        rg: vazioNull(form.rg),
        banco: vazioNull(form.banco),
        agencia: vazioNull(form.agencia),
        conta: vazioNull(form.conta),
        pix: vazioNull(form.pix),
        logradouro: vazioNull(form.logradouro),
        numero: vazioNull(form.numero),
        complemento: vazioNull(form.complemento),
        bairro: vazioNull(form.bairro),
        cidade: vazioNull(form.cidade),
        uf: vazioNull(form.uf),
        cep: vazioNull(form.cep),
        // O texto corrido é derivado das partes e gravado junto, para quem lê a
        // tabela direto no banco ver o endereço pronto.
        //
        // Partes vazias NÃO apagam o texto legado: quem abre a ficha de alguém que
        // só tem o endereço antigo em texto corrido, mexe no Pix e salva, perderia
        // o endereço.
        endereco:
          compilado ?? dados.data?.get(chavePessoa(tipo, chave))?.endereco ?? null,
      })
      toast.success(editando.novo ? `${visao.rotulo} cadastrado.` : 'Dados salvos.')
      setEditando(null)
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  async function handleExcluir() {
    if (!aExcluir) return
    try {
      await excluir.mutateAsync({ tipo, nome_chave: aExcluir.chave })
      toast.success(`${aExcluir.nome} removido.`)
      setAExcluir(null)
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  // `dados` entra no portão junto com `processos`: esta tabela alimenta um
  // formulário cujo Salvar é upsert da LINHA INTEIRA. Com o mapa não carregado,
  // toda célula sairia "—" (igual a "nunca cadastrado") e o lápis abriria
  // formulário em branco sobre quem tem CPF, banco e conta gravados — o primeiro
  // Salvar apagaria os treze campos.
  if (processos.isLoading || dados.isLoading)
    return <Loading label="Carregando dados…" />
  if (processos.isError || dados.isError) {
    return (
      <Card>
        <ErrorState
          message={
            ((processos.error ?? dados.error) as Error)?.message ??
            'Não foi possível carregar os dados.'
          }
          onRetry={() => {
            void processos.refetch()
            void dados.refetch()
          }}
        />
      </Card>
    )
  }

  return (
    <div>
      <PageHeader
        title="Dados pessoais e bancários"
        actions={
          <Button
            icon={<Plus className="h-4 w-4" />}
            disabled={!dados.data}
            onClick={() => abrirJanela('', '', true)}
          >
            Cadastrar {visao.rotulo.toLowerCase()}
          </Button>
        }
      />

      <Card className="mb-4 p-4">
        <Segmented
          ariaLabel="Alternar entre investidores e intermediadores"
          items={[
            { key: 'investidor', label: 'Investidores' },
            { key: 'intermediador', label: 'Intermediadores' },
          ]}
          value={tipo}
          onChange={(k) => {
            setTipo(k as TipoPessoa)
            // Fecha a janela ao trocar de visão: a ficha aberta pertence ao papel
            // anterior, e salvar depois da troca gravaria no papel errado.
            setEditando(null)
            setAExcluir(null)
          }}
        />
      </Card>

      <div className="space-y-5">
        <Card>
          {pessoas.length === 0 ? (
            <EmptyState
              title={`Nenhum ${visao.rotulo.toLowerCase()}`}
              description={visao.vazio}
            />
          ) : (
            <Table className="[&_th]:whitespace-nowrap [&_th]:px-3 [&_td]:px-3 [&_td]:text-[13px]">
              <THead>
                <tr>
                  <TH>Nome do {visao.rotulo.toLowerCase()}</TH>
                  {COLUNAS_TABELA.map((c) => (
                    <TH key={c.chave}>{c.rotulo}</TH>
                  ))}
                  <TH className="w-[1%] whitespace-nowrap">Ações</TH>
                </tr>
              </THead>
              <TBody>
                {pessoas.map((i) => {
                  const d = dados.data?.get(chavePessoa(tipo, i.chave))
                  return (
                    <TR key={i.chave}>
                      <TD className="font-medium text-slate-800">
                        {i.nome}
                        {/* Cadastrado e ainda sem crédito. Não é pendência: é o
                            estado normal de quem o comercial acabou de cadastrar
                            para fazer o contrato. Marcar evita a leitura de que
                            faltou lançar algo. */}
                        {!i.emCredito && (
                          <Badge tone="gray" size="sm" className="ml-2 align-middle">
                            sem crédito
                          </Badge>
                        )}
                      </TD>
                      {COLUNAS_TABELA.map((c) => {
                        // Endereço em texto corrido, compilado das partes. Cai no
                        // texto legado enquanto um registro não tiver as partes.
                        const v =
                          c.chave === 'endereco'
                            ? d
                              ? compilarEndereco(d) || d.endereco
                              : null
                            : d?.[c.chave as CampoPessoa]
                        return (
                          <TD key={c.chave}>
                            {v || <span className="text-slate-300">—</span>}
                          </TD>
                        )
                      })}
                      <TD className="w-[1%] whitespace-nowrap text-right">
                        <div className="flex justify-end gap-1">
                          <IconButton
                            label={`Editar dados de ${i.nome}`}
                            icon={<Pencil className="h-4 w-4" />}
                            // Cinto extra além do portão acima: abrir o formulário
                            // sobre um mapa que não carregou é o que transforma erro
                            // de leitura em apagamento de dado.
                            disabled={!dados.data}
                            onClick={() => abrirJanela(i.chave, i.nome, false)}
                          />
                          {/* Remover existe só para quem NÃO está em crédito
                              nenhum, que é o caso do cadastro feito com o nome
                              errado. Quem está num crédito não sairia da lista —
                              o nome vem de lá —, então o botão só apagaria os
                              dados bancários dando a impressão de remover. */}
                          {!i.emCredito && (
                            <IconButton
                              label={`Remover ${i.nome}`}
                              icon={<Trash2 className="h-4 w-4" />}
                              variant="danger"
                              onClick={() => setAExcluir(i)}
                            />
                          )}
                        </div>
                      </TD>
                    </TR>
                  )
                })}
              </TBody>
            </Table>
          )}
        </Card>

        <Modal
          open={!!editando}
          onClose={() => setEditando(null)}
          title={
            editando?.novo
              ? `Cadastrar ${visao.rotulo.toLowerCase()}`
              : `Dados do ${visao.rotulo.toLowerCase()}`
          }
          size="lg"
          footer={
            <>
              <Button variant="outline" onClick={() => setEditando(null)}>
                Cancelar
              </Button>
              <Button loading={salvar.isPending} onClick={handleSalvar}>
                Salvar
              </Button>
            </>
          }
        >
          {editando && (
            <div className="space-y-4">
              {/* No cadastro o nome é digitado, e SEM lista de quem já existe:
                  cadastrar já pressupõe gente nova, e oferecer os que estão lá
                  seria oferecer justamente o que não se quer. O aviso abaixo do
                  campo cobre o caso raro em que a pessoa já está na plataforma
                  escrita de outro jeito.

                  Na ficha de quem já existe o nome é FIXO: ele é a chave da
                  linha, e editar aqui não renomearia — criaria outra pessoa e
                  deixaria a primeira com os dados. Renomear se faz onde o nome
                  nasce, no crédito. */}
              {editando.novo ? (
                <Field
                  label={`Nome do ${visao.rotulo.toLowerCase()}`}
                  hint="Como deve sair no contrato."
                  error={avisoNome}
                >
                  <Input
                    value={editando.nome}
                    autoComplete="off"
                    placeholder="Nome completo ou razão social"
                    onChange={(e) => setEditando({ ...editando, nome: e.target.value })}
                  />
                </Field>
              ) : (
                <Field label={`Nome do ${visao.rotulo.toLowerCase()}`}>
                  <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700">
                    {editando.nome}
                  </div>
                </Field>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                {CAMPOS_DOCUMENTO.map((c) => (
                  <Field
                    key={c.chave}
                    label={c.rotulo}
                    // Dígito verificador errado quase sempre é erro de digitação, e
                    // num campo desses o erro vira dinheiro no lugar errado.
                    error={
                      c.chave === 'cpf' && !cpfCnpjValido(form.cpf)
                        ? 'Dígito verificador não confere'
                        : undefined
                    }
                  >
                    <Input
                      placeholder={c.dica}
                      value={form[c.chave]}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          [c.chave]: c.mascara
                            ? c.mascara(e.target.value)
                            : e.target.value,
                        }))
                      }
                    />
                  </Field>
                ))}
              </div>

              {/* ---------- Endereço em partes ---------- */}
              <div>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Endereço
                </h4>
                <div className="grid gap-4 sm:grid-cols-6">
                  {/* CEP PRIMEIRO: é ele que preenche logradouro, bairro, cidade e
                      UF, então digitá-lo antes poupa quatro campos. */}
                  <div className="sm:col-span-2">
                    <Field
                      label="CEP"
                      hint={buscandoCep ? 'Buscando…' : undefined}
                      error={avisoCep ?? undefined}
                    >
                      <Input
                        inputMode="numeric"
                        placeholder="00000-000"
                        value={form.cep}
                        onChange={(e) => {
                          const cep = formatCepInput(e.target.value)
                          setForm((f) => ({ ...f, cep }))
                          void preencherPorCep(cep)
                        }}
                      />
                    </Field>
                  </div>
                  <div className="sm:col-span-4" />
                  <div className="sm:col-span-4">
                    <Field label="Logradouro">
                      <Input
                        value={form.logradouro}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, logradouro: e.target.value }))
                        }
                      />
                    </Field>
                  </div>
                  <div className="sm:col-span-2">
                    {/* Só dígito: "nº 223-A" tem de ir para o complemento. */}
                    <Field label="Número">
                      <Input
                        inputMode="numeric"
                        value={form.numero}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, numero: onlyDigits(e.target.value) }))
                        }
                      />
                    </Field>
                  </div>
                  <div className="sm:col-span-3">
                    <Field label="Complemento">
                      <Input
                        value={form.complemento}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, complemento: e.target.value }))
                        }
                      />
                    </Field>
                  </div>
                  <div className="sm:col-span-3">
                    <Field label="Bairro">
                      <Input
                        value={form.bairro}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, bairro: e.target.value }))
                        }
                      />
                    </Field>
                  </div>
                  <div className="sm:col-span-2">
                    {/* A UF vem PRIMEIRO porque é ela que define a lista de
                        cidades. Trocar de UF limpa a cidade: manter "Belo
                        Horizonte" depois de mudar para SP seria dado inválido. */}
                    <Field label="UF">
                      <Select
                        value={form.uf}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, uf: e.target.value, cidade: '' }))
                        }
                      >
                        <option value="">—</option>
                        {ufs.map((u) => (
                          <option key={u} value={u}>
                            {u}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  </div>
                  <div className="sm:col-span-4">
                    {/* Combobox e não Select: MG tem 853 municípios, e sem busca a
                        lista é inutilizável. */}
                    <Field label="Cidade">
                      <Combobox
                        opcoes={opcoesCidade}
                        valor={form.cidade ? cidadesDaUf.indexOf(form.cidade) : null}
                        onChange={(id) =>
                          setForm((f) => ({
                            ...f,
                            cidade: id === null ? '' : (cidadesDaUf[id as number] ?? ''),
                          }))
                        }
                        placeholder={form.uf ? 'Digite a cidade…' : 'Escolha a UF antes'}
                        vazio="Nenhuma cidade encontrada nesta UF."
                      />
                    </Field>
                  </div>
                </div>
                {/* Prévia do texto corrido: é exatamente o que vai para a tabela e
                    para o contrato, então quem edita confere antes de salvar. */}
                <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
                  {compilarEndereco(form) || 'Endereço em branco'}
                </div>
              </div>
            </div>
          )}
        </Modal>

        <ConfirmDialog
          open={!!aExcluir}
          title={`Remover ${visao.rotulo.toLowerCase()}`}
          message={
            <>
              Remover <strong>{aExcluir?.nome}</strong> e os dados pessoais e
              bancários dele? Como não há crédito com este nome, nada mais fica
              apontando para ele.
            </>
          }
          confirmLabel="Remover"
          danger
          loading={excluir.isPending}
          onConfirm={handleExcluir}
          onClose={() => setAExcluir(null)}
        />
      </div>
    </div>
  )
}

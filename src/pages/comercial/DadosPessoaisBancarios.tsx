// Dados pessoais e bancários de quem entra na operação, em duas visões:
// INVESTIDORES (os cessionários dos Créditos) e ORIGINADORES (quem originou a
// aquisição).
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
//
// ONDA 2 DO REDESENHO (02/10/2026): a cara da amostra aprovada (paginas1.js ›
// renderCadastros e formPessoa). Entraram a busca por nome ou documento, a linha
// inteira abrindo a ficha, a seção "Para o contrato" (gênero e complemento da
// qualificação) na ficha do investidor, o endereço antigo à vista com o aviso e
// o "Descartar alterações?" ao fechar a ficha com algo digitado. O que o Salvar
// grava continua em lib/fichaPessoa.ts, com teste.
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, Copy, Info, Pencil, Plus, Search, Trash2 } from 'lucide-react'
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
  chaveDaFicha,
  enderecoDaFicha,
  montarFichaPessoa,
  type CampoPessoa,
  type CamposParaContrato,
} from '@/lib/fichaPessoa'
import { casaBuscaDaFicha, iniciaisDoNome, textoDaFicha } from '@/lib/dadosCadastrais'
import {
  compilarEndereco,
  cpfCnpjValido,
  ehCnpj,
  formatCepInput,
  formatCpfCnpjInput,
  limparNumeroConta,
  nomeParecido,
  normalizarNome,
  onlyDigits,
  rotuloDocumento,
} from '@/lib/format'
import { PageHeader } from '@/components/ui/PageHeader'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Field, Input, Select } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { Tabs, idDaAba } from '@/components/ui/Tabs'
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
import { perguntarDescarte } from '@/lib/descarte'
import { avisoDoDigito } from '@/lib/digitoDoDocumento'
import { LEMBRAR, useEscolhaLembrada } from '@/lib/lembrarNaTela'
import { useCopiarTexto } from '@/components/BotaoCopiar'

/**
 * Célula agrupada: pares "rótulo → valor" empilhados (o `.kv` da amostra). A
 * tabela tinha uma coluna por campo (9 colunas!) e cada célula quebrava em duas
 * ou três linhas de meia palavra; agrupar em Identificação / Dados bancários dá
 * largura de sobra para cada valor sair inteiro — e o mini-rótulo diz o que é
 * cada linha.
 *
 * GRID, e não flex com largura fixa no rótulo: `max-content` mede o rótulo mais
 * largo da célula e reserva exatamente isso, então "Banco" e "Ag/CC" nunca
 * transbordam por cima do valor (era o que colava "BANCOBanco do Brasil"), e as
 * duas colunas ficam alinhadas entre as linhas sem número mágico nenhum.
 *
 * Campo vazio NÃO vira linha: uma coluna de traços é só espaço em branco com
 * moldura. Grupo inteiro vazio mostra um único "—" — a ausência continua
 * visível, sem ocupar três linhas.
 */
function GrupoDados({
  linhas,
}: {
  linhas: { rotulo: string; valor?: string | null; numero?: boolean }[]
}) {
  const preenchidas = linhas.filter((l) => l.valor)
  if (preenchidas.length === 0) return <span className="text-texto-3">—</span>
  return (
    <dl className="m-0 grid grid-cols-[max-content_1fr] items-baseline gap-x-3 gap-y-0.5">
      {preenchidas.map((l) => (
        <Fragment key={l.rotulo}>
          <dt className="whitespace-nowrap text-texto-3">{l.rotulo}</dt>
          {/* break-words: chave Pix de e-mail não tem espaço e, com a tabela de
              colunas fixas, vazaria por cima da coluna vizinha. */}
          <dd className={`m-0 min-w-0 break-words text-texto ${l.numero ? 'whitespace-nowrap tabular-nums' : ''}`}>
            {l.valor}
          </dd>
        </Fragment>
      ))}
    </dl>
  )
}

/** As iniciais na placa azul-clara, como na amostra. Só enfeite: o nome está ao lado. */
function Avatar({ nome }: { nome: string }) {
  return (
    <span
      aria-hidden
      className="grid h-[32px] w-[32px] flex-none place-items-center rounded-full bg-marca-suave font-display text-xs font-bold text-marca-texto"
    >
      {iniciaisDoNome(nome)}
    </span>
  )
}

/** Título de seção da ficha (o `.fs-h` da amostra). */
function SecaoFicha({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-3 font-display text-xs font-bold uppercase tracking-wider text-texto-3">
        {titulo}
      </h3>
      {children}
    </section>
  )
}

/** Aviso âmbar com ícone (o `.hint-warn` da amostra). */
function AvisoAmbar({ children, icone = 'alerta' }: { children: ReactNode; icone?: 'alerta' | 'info' }) {
  const Icone = icone === 'info' ? Info : AlertTriangle
  return (
    <p role="status" className="mt-2 flex items-start gap-1.5 text-sm text-aviso">
      <Icone className="mt-0.5 h-4 w-4 flex-none" aria-hidden />
      <span>{children}</span>
    </p>
  )
}

const VAZIO: Record<CampoPessoa, string> = {
  cpf: '',
  rg: '',
  representante: '',
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

const CONTRATO_VAZIO: CamposParaContrato = { genero: '', qualificacao_complemento: '' }

/** O que muda entre as duas visões: só o rótulo e o texto de lista vazia. */
const VISOES: Record<TipoPessoa, { rotulo: string; vazio: string }> = {
  investidor: {
    rotulo: 'Investidor',
    vazio:
      'Cadastre um investidor aqui, ou lance um crédito com o campo Cessionário preenchido.',
  },
  originador: {
    rotulo: 'Originador',
    vazio:
      'Cadastre um originador aqui, ou lance um crédito com o campo Originador preenchido.',
  },
}

/**
 * As dicas dos dois campos do contrato, que mudam quando o documento vira CNPJ —
 * é o que a função gerar-contrato faz com eles (montarQualificacaoInvestidor):
 * empresa sai sempre no feminino, e o complemento dela é o representante.
 */
const dicasDoContrato = (pj: boolean) =>
  pj
    ? {
        genero: 'Empresa sai sempre no feminino no contrato ("a cessionária").',
        qualificacao:
          'O representante por extenso. Ex.: "neste ato representada por Fulano de Tal, sócio-administrador".',
      }
    : {
        genero:
          'Concordância do contrato ("o cessionário" ou "a cessionária"). Sem gênero, sai no masculino.',
        qualificacao: 'Estado civil e profissão. Ex.: "casada, empresária".',
      }

/** As visões que a tela lembra (lib/lembrarNaTela.ts confere o valor guardado). */
const VISOES_DA_TELA: readonly TipoPessoa[] = ['investidor', 'originador']

/** O id do painel das abas: as abas apontam para ele (aria-controls). */
const PAINEL = 'painel-dados-cadastrais'

export default function DadosPessoaisBancarios() {
  const processos = processosCrud.useList()
  const dados = useInvestidorDados()
  const salvar = useSalvarInvestidorDados()
  const excluir = useExcluirInvestidorDados()
  const toast = useToast()
  const copiarTexto = useCopiarTexto()

  // A visão escolhida fica lembrada entre visitas (lib/lembrarNaTela.ts): quem
  // cuida dos originadores não volta sempre para os investidores.
  const [tipo, setTipo] = useEscolhaLembrada<TipoPessoa>(LEMBRAR.cadastrosVisao, VISOES_DA_TELA, 'investidor')
  const visao = VISOES[tipo]
  const rotuloMin = visao.rotulo.toLowerCase()
  const [busca, setBusca] = useState('')

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
  /**
   * O id da janela ABERTA AGORA (null = fechada), lido pelas buscas de CEP e de
   * CNPJ DEPOIS do await.
   *
   * REF, E NÃO O `editando` DO RENDER: a busca compara a janela da chamada com a
   * da resposta, e as duas saíam da MESMA closure — o `editando` capturado no
   * render em que a busca começou. A comparação dava sempre igual, e a resposta
   * atrasada de uma ficha caía no formulário da ficha aberta depois dela (fechar
   * a de A e abrir a de B com a busca no ar levava a rua e a cidade de A para B).
   */
  const janelaAberta = useRef<number | null>(null)
  useEffect(() => {
    janelaAberta.current = editando?.id ?? null
  }, [editando?.id])
  const [form, setForm] = useState<Record<CampoPessoa, string>>(VAZIO)
  // Gênero e complemento da qualificação: só a ficha do INVESTIDOR tem os
  // campos (é dele a qualificação no contrato). Ficam fora de `form` porque o
  // Salvar os trata à parte — ver `paraContrato` em lib/fichaPessoa.ts.
  const [paraContrato, setParaContrato] = useState<CamposParaContrato>(CONTRATO_VAZIO)
  /** A ficha como abriu, para saber se algo foi digitado ("Descartar alterações?"). */
  const inicialRef = useRef('')
  const [aExcluir, setAExcluir] = useState<PessoaLista | null>(null)

  // Os 5.571 municípios entram por import DINÂMICO, e só quando alguém abre a
  // edição: são ~86 kB que não fazem sentido no bundle de quem nunca edita.
  const [municipios, setMunicipios] = useState<Record<string, string[]> | null>(null)
  const [ufs, setUfs] = useState<string[]>([])
  // Estado da busca por CEP, só para dar retorno visual no campo.
  const [buscandoCep, setBuscandoCep] = useState(false)
  /** Id da última busca de CEP disparada — descarta resposta atrasada. */
  const reqCepRef = useRef(0)
  // Mesmo par para a busca por CNPJ.
  const [buscandoCnpj, setBuscandoCnpj] = useState(false)
  const reqCnpjRef = useRef(0)
  /** O que a última busca por CNPJ deu, dito sob o campo. */
  const [retornoCnpj, setRetornoCnpj] = useState<string | null>(null)
  /** Quais campos do endereço foram preenchidos pela ÚLTIMA busca de CEP. Só
   *  esses podem ser substituídos por uma busca nova; o que foi digitado à mão
   *  fica. */
  const camposDoCep = useRef<Set<string>>(new Set())
  const [avisoCep, setAvisoCep] = useState<string | null>(null)

  // As duas visões são calculadas juntas: a da aba aberta vira a tabela, e as
  // duas dão a contagem ao lado do nome de cada aba.
  const porTipo = useMemo(
    () => ({
      investidor: listarPessoas('investidor', processos.data, dados.data),
      originador: listarPessoas('originador', processos.data, dados.data),
    }),
    [processos.data, dados.data],
  )
  const pessoas = porTipo[tipo]

  // A busca olha o nome, o documento e o representante — por texto sem acento,
  // ou pelos dígitos do documento (ver lib/dadosCadastrais.ts, com teste).
  const visiveis = useMemo(
    () =>
      pessoas.filter((p) => {
        const d = dados.data?.get(chavePessoa(tipo, p.chave))
        return casaBuscaDaFicha([p.nome, d?.cpf, d?.representante], busca)
      }),
    [pessoas, dados.data, tipo, busca],
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

  /**
   * Algo foi digitado na ficha? Então fechar pergunta antes (o `dirty` do Modal,
   * e o Cancelar abaixo). Conta o nome do cadastro novo e qualquer campo
   * diferente de como a ficha abriu — inclusive o que o CEP ou o CNPJ
   * preencheram, que também se perderia.
   */
  const fichaSuja =
    !!editando &&
    ((editando.novo && editando.nome.trim() !== '') ||
      JSON.stringify({ form, paraContrato }) !== inicialRef.current)

  async function abrirJanela(chave: string, nome: string, novo: boolean) {
    const d = novo ? undefined : dados.data?.get(chavePessoa(tipo, chave))
    const inicial: Record<CampoPessoa, string> = {
      cpf: d?.cpf ?? '',
      rg: d?.rg ?? '',
      representante: d?.representante ?? '',
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
    }
    // O banco só aceita M, F ou vazio; o que não for M nem F abre como "Não
    // informado" — nunca como masculino.
    const g = (d?.genero ?? '').trim().toUpperCase()
    const contrato: CamposParaContrato = {
      genero: g === 'M' || g === 'F' ? g : '',
      qualificacao_complemento: d?.qualificacao_complemento ?? '',
    }
    setForm(inicial)
    setParaContrato(contrato)
    inicialRef.current = JSON.stringify({ form: inicial, paraContrato: contrato })
    const id = ++seqJanela.current
    janelaAberta.current = id
    setEditando({ id, chave, nome, novo })
    setAvisoCep(null)
    camposDoCep.current = new Set()
    // As buscas da ficha anterior que ainda estejam no ar deixam de valer, e o
    // "Buscando…" (que trava o campo do documento) não passa para esta.
    reqCepRef.current++
    reqCnpjRef.current++
    setBuscandoCep(false)
    setBuscandoCnpj(false)
    setRetornoCnpj(null)
    if (!municipios) {
      const m = await import('@/lib/municipios')
      setMunicipios(m.MUNICIPIOS_POR_UF)
      setUfs(m.UFS)
    }
  }

  /** O Cancelar pergunta como o X, o Esc e o clique fora (que passam pelo Modal). */
  async function cancelarFicha() {
    if (fichaSuja && !(await perguntarDescarte())) return
    setEditando(null)
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
      // CEP APAGADO OU INCOMPLETO INVALIDA A BUSCA EM VOO: sem isto, quem digitou
      // o CEP inteiro e apagou um dígito recebia o endereço do CEP anterior por
      // cima do que estava corrigindo.
      reqCepRef.current++
      setBuscandoCep(false)
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
    const janelaNaChamada = janelaAberta.current
    const valendo = () => meuId === reqCepRef.current && janelaNaChamada === janelaAberta.current
    setBuscandoCep(true)
    setAvisoCep(null)
    try {
      const { buscarCep } = await import('@/lib/cep')
      const e = await buscarCep(cepMascarado)
      if (!valendo()) return
      if (!e) {
        setAvisoCep('CEP não encontrado. Preencha à mão.')
        return
      }
      // A cidade tem de existir na lista do IBGE, senão o combobox não a
      // reconhece como selecionada e o campo pareceria vazio.
      const m = municipios ?? (await import('@/lib/municipios')).MUNICIPIOS_POR_UF
      // De novo: o import acima também espera, e a janela pode ter trocado nele.
      if (!valendo()) return
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
      // Só a busca que vale desliga o "Buscando…": a atrasada desligaria o da nova.
      if (meuId === reqCepRef.current) setBuscandoCep(false)
    }
  }

  /**
   * CNPJ completo (14 dígitos) traz o endereço da empresa do cadastro da Receita.
   *
   * PREENCHE SÓ O QUE ESTÁ EM BRANCO, ao contrário da busca por CEP. Aqui não há um
   * "endereço deste CNPJ" que substitua o anterior: o cadastro da Receita pode estar
   * desatualizado, e a ficha pode ter o endereço que a pessoa confirmou por contrato.
   * Sobrescrever silenciosamente trocaria o dado conferido pelo dado presumido.
   *
   * Não existe equivalente para CPF — nome ligado a CPF é dado pessoal protegido e as
   * bases oficiais são pagas (ver lib/cnpj.ts).
   */
  async function preencherPorCnpj(docMascarado: string) {
    if (onlyDigits(docMascarado).length !== 14) return
    // Mesma guarda de obsolescência da busca por CEP: só a última resposta escreve,
    // e só se a janela aberta ainda for a mesma.
    const meuId = ++reqCnpjRef.current
    const janelaNaChamada = janelaAberta.current
    const valendo = () => meuId === reqCnpjRef.current && janelaNaChamada === janelaAberta.current
    setBuscandoCnpj(true)
    try {
      const { buscarCnpj, ufCidadeDoCnpj } = await import('@/lib/cnpj')
      const e = await buscarCnpj(docMascarado)
      if (!valendo()) return
      // O RETORNO À VISTA (qualidade de vida): a busca travava o campo e o
      // soltava em silêncio, e o endereço preenchido fica lá embaixo na ficha —
      // quem digitou não sabia se a Receita respondeu, nem se algo mudou.
      if (!e) {
        setRetornoCnpj('Não achei este CNPJ na Receita. Preencha o endereço à mão.')
        return
      }
      const m = municipios ?? (await import('@/lib/municipios')).MUNICIPIOS_POR_UF
      if (!valendo()) return
      const completou = (
        ['logradouro', 'numero', 'complemento', 'bairro', 'cep'] as const
      ).some((k) => !form[k].trim() && !!e[k]) || (!form.cidade && !!e.cidade)
      setRetornoCnpj(
        completou
          ? 'Endereço completado pela Receita. Confira antes de salvar.'
          : 'A ficha já tinha o endereço: a Receita não mudou nada.',
      )
      setForm((f) => {
        // UF e cidade saem juntas (ver ufCidadeDoCnpj): nunca cidade de uma UF com outra.
        const { uf, cidade } = ufCidadeDoCnpj(f, e, m)
        return {
          ...f,
          logradouro: f.logradouro || e.logradouro,
          numero: f.numero || e.numero,
          complemento: f.complemento || e.complemento,
          bairro: f.bairro || e.bairro,
          uf,
          cidade,
          cep: f.cep || (e.cep ? formatCepInput(e.cep) : ''),
        }
      })
      // O aviso sai do formulário da hora da digitação, e não de dentro do setForm:
      // a função de atualização não pode ter efeito (o StrictMode a roda duas vezes).
      const { aviso } = ufCidadeDoCnpj(form, e, m)
      if (aviso) toast.info(aviso)
    } finally {
      if (meuId === reqCnpjRef.current) setBuscandoCnpj(false)
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
      toast.error(`Informe o nome do ${rotuloMin}.`)
      return
    }
    // Cadastro novo: do nome digitado. Ficha existente: a da linha aberta — ver
    // chaveDaFicha (lib/fichaPessoa.ts), com teste.
    const chave = chaveDaFicha({ novo: editando.novo, chave: editando.chave, nome })
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
    // A montagem da linha (vazio vira null, representante só em CNPJ, o que a
    // tela não edita preservado da ficha) mora em lib/fichaPessoa.ts, com teste.
    // `paraContrato` SÓ NO INVESTIDOR: é a ficha que tem os campos; na do
    // originador, gênero e qualificação são preservados da ficha anterior.
    const ficha = montarFichaPessoa({
      tipo,
      chave,
      nome,
      form,
      anterior: dados.data?.get(chavePessoa(tipo, chave)),
      paraContrato: tipo === 'investidor' ? paraContrato : undefined,
    })
    try {
      await salvar.mutateAsync(ficha)
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

  const carregando = processos.isLoading || dados.isLoading
  const comErro = processos.isError || dados.isError

  const cabecalho = (
    <PageHeader
      title="Dados cadastrais"
      description="Investidores e originadores: identificação, dados bancários e endereço que entram nos contratos."
      actions={
        <Button
          size="lg"
          icon={<Plus className="h-[16px] w-[16px]" />}
          disabled={!dados.data}
          title={dados.data ? undefined : 'Espere as fichas carregarem'}
          onClick={() => abrirJanela('', '', true)}
        >
          Cadastrar {rotuloMin}
        </Button>
      }
    />
  )

  // `dados` entra no portão junto com `processos`: esta tabela alimenta um
  // formulário cujo Salvar é upsert da LINHA INTEIRA. Com o mapa não carregado,
  // toda célula sairia "—" (igual a "nunca cadastrado") e o lápis abriria
  // formulário em branco sobre quem tem CPF, banco e conta gravados — o primeiro
  // Salvar apagaria os treze campos. Por isso a tela inteira é o estado, com o
  // "Cadastrar" travado.
  if (carregando || comErro) {
    return (
      <div>
        {cabecalho}
        <Card className="px-5">
          {carregando ? (
            <Loading label="Carregando dados…" />
          ) : (
            <ErrorState
              message={
                ((processos.error ?? dados.error) as Error)?.message ??
                'Não foi possível carregar os dados.'
              }
              onRetry={() => Promise.all([processos.refetch(), dados.refetch()])}
            />
          )}
        </Card>
      </div>
    )
  }

  const pj = ehCnpj(form.cpf)
  const dicas = dicasDoContrato(pj)

  // "COPIAR DADOS" (qualidade de vida): o que está na ficha, rotulado, para colar
  // numa mensagem ou numa transferência — ver textoDaFicha, com teste. O endereço
  // é o da prévia, pela mesma regra do Salvar.
  const textoParaCopiar = editando
    ? textoDaFicha({
        nome: editando.nome,
        ...form,
        endereco: enderecoDaFicha(
          form,
          editando.novo ? undefined : dados.data?.get(chavePessoa(tipo, editando.chave))?.endereco,
        ).texto,
      })
    : ''

  return (
    <div>
      {cabecalho}

      {/* Tabs, e não Segmented dentro de Card: Investidores/Originadores são DUAS
          VISÕES da aba — o mesmo papel de Relatórios individuais/Visão global nas
          Carteiras — e visões irmãs têm a mesma cara em toda a plataforma. A
          contagem ao lado diz quantos a outra visão tem. */}
      <div className="mb-5">
        <Tabs
          rotulo="Visões de Dados cadastrais"
          idDoPainel={PAINEL}
          items={[
            { key: 'investidor', label: 'Investidores', count: porTipo.investidor.length },
            { key: 'originador', label: 'Originadores', count: porTipo.originador.length },
          ]}
          value={tipo}
          onChange={(k) => {
            setTipo(k as TipoPessoa)
            // A busca é da visão: o nome procurado entre investidores raramente
            // é o mesmo entre originadores.
            setBusca('')
            // Fecha a janela ao trocar de visão: a ficha aberta pertence ao papel
            // anterior, e salvar depois da troca gravaria no papel errado.
            setEditando(null)
            setAExcluir(null)
          }}
        />
      </div>

      <Card>
        <div
          id={PAINEL}
          role="tabpanel"
          aria-labelledby={idDaAba(PAINEL, tipo === 'investidor' ? 0 : 1)}
        >
          {/* A BUSCA (item "Novo" da amostra): achar uma pessoa era rolar a
              lista inteira. Por nome ou documento, sem acento, e pelos dígitos
              do documento colado cru. */}
          <div className="border-b border-borda px-5 py-4">
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-[16px] w-[16px] -translate-y-1/2 text-texto-3"
                aria-hidden
              />
              <Input
                type="search"
                className="pl-10"
                aria-label="Buscar por nome ou documento"
                // O "/" do teclado leva a este campo (layout/Consultas.tsx).
                data-filtro-tela=""
                placeholder="Buscar por nome ou documento…  ( / )"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
              />
            </div>
          </div>

          {pessoas.length === 0 ? (
            <EmptyState title={`Nenhum ${rotuloMin}`} description={visao.vazio} />
          ) : visiveis.length === 0 ? (
            <EmptyState
              title="Nada encontrado"
              description={`Nenhum ${rotuloMin} corresponde a "${busca.trim()}".`}
              action={
                <Button variant="outline" onClick={() => setBusca('')}>
                  Limpar busca
                </Button>
              }
            />
          ) : (
            // Larguras fixadas por coluna: sem elas o navegador distribui a
            // sobra por igual e cada coluna curta vira um vão em branco. A
            // LARGURA MÍNIMA faz a tabela rolar de lado no celular (o Table já
            // rola), em vez de espremer cada coluna em uma letra por linha.
            <Table className="min-w-[860px] table-fixed [&_th]:whitespace-nowrap [&_th]:px-4 [&_td]:px-4">
              <THead>
                <tr>
                  <TH className="w-[24%]">Nome do {rotuloMin}</TH>
                  <TH className="w-[19%]">Identificação</TH>
                  <TH className="w-[21%]">Dados bancários</TH>
                  <TH>Endereço</TH>
                  {/* Dois botões de ícone + a palavra "Ações" no cabeçalho. */}
                  <TH className="w-28 text-right">Ações</TH>
                </tr>
              </THead>
              <TBody>
                {visiveis.map((i) => {
                  const d = dados.data?.get(chavePessoa(tipo, i.chave))
                  // Endereço em texto corrido, compilado das partes. Cai no
                  // texto legado enquanto um registro não tiver as partes.
                  const endereco = d ? compilarEndereco(d) || d.endereco : null
                  return (
                    <TR
                      key={i.chave}
                      // A LINHA INTEIRA ABRE A FICHA (item "Novo" da amostra),
                      // como em Créditos. O lápis continua lá: é o caminho do
                      // teclado e de quem não sabe que a linha é clicável. Com o
                      // mapa não carregado, nem a linha nem o lápis abrem — ver
                      // o portão acima.
                      onClick={dados.data ? () => abrirJanela(i.chave, i.nome, false) : undefined}
                    >
                      <TD>
                        <div className="flex items-center gap-3">
                          <Avatar nome={i.nome} />
                          <div className="min-w-0">
                            <span className="font-semibold text-texto">{i.nome}</span>
                            {/* Representante legal sob a razão social. O prefixo
                                "Rep." diz o que é o nome: sem ele, dois nomes
                                empilhados parecem duas pessoas cadastradas. */}
                            {d?.representante && (
                              <span className="mt-0.5 block text-xs text-texto-3">
                                Rep. {d.representante}
                              </span>
                            )}
                            {/* Cadastrado e ainda sem crédito. Não é pendência: é
                                o estado normal de quem o comercial acabou de
                                cadastrar para fazer o contrato. Marcar evita a
                                leitura de que faltou lançar algo. */}
                            {!i.emCredito && (
                              <div className="mt-1">
                                <Badge tone="gray" size="sm">
                                  sem crédito
                                </Badge>
                              </div>
                            )}
                          </div>
                        </div>
                      </TD>
                      <TD>
                        <GrupoDados
                          linhas={[
                            // CNPJ quando é empresa: o mesmo dígito que troca a
                            // máscara troca o rótulo aqui.
                            { rotulo: rotuloDocumento(d?.cpf), valor: d?.cpf, numero: true },
                            { rotulo: 'RG', valor: d?.rg, numero: true },
                          ]}
                        />
                      </TD>
                      <TD>
                        <GrupoDados
                          linhas={[
                            { rotulo: 'Banco', valor: d?.banco },
                            {
                              // Agência e conta na mesma linha, como se escreve
                              // dado bancário — são curtos e andam juntos.
                              rotulo: 'Ag/CC',
                              valor:
                                d?.agencia && d?.conta
                                  ? `${d.agencia} · ${d.conta}`
                                  : d?.agencia || d?.conta,
                              numero: true,
                            },
                            { rotulo: 'Pix', valor: d?.pix },
                          ]}
                        />
                      </TD>
                      <TD className="text-texto-2">{endereco || <span className="text-texto-3">—</span>}</TD>
                      <TD className="whitespace-nowrap text-right">
                        {/* O clique nos botões não chega à linha: Remover não pode
                            abrir a ficha por baixo da confirmação. */}
                        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                          <IconButton
                            label={`Editar dados de ${i.nome}`}
                            icon={<Pencil className="h-[16px] w-[16px]" />}
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
                              icon={<Trash2 className="h-[16px] w-[16px]" />}
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
        </div>
      </Card>

      <Modal
        open={!!editando}
        onClose={() => setEditando(null)}
        // "Descartar alterações?" ao fechar com algo digitado: o X, o Esc e o
        // clique fora passam pelo Modal; o Cancelar pergunta igual.
        dirty={fichaSuja}
        title={editando?.novo ? `Cadastrar ${rotuloMin}` : `Dados do ${rotuloMin}`}
        description={
          editando?.novo
            ? 'Só o nome é obrigatório. O endereço se completa pelo CEP (ou pelo CNPJ, quando é empresa).'
            : 'O nome não muda aqui — ele é a chave dos créditos.'
        }
        size="lg"
        footer={
          <>
            <Button variant="ghost" className="mr-auto" onClick={cancelarFicha}>
              Cancelar
            </Button>
            {/* Só na ficha de quem já existe e com algo além do nome: no cadastro
                novo, quem digitou acabou de ter os dados na mão. */}
            {!editando?.novo && textoParaCopiar && (
              <Button
                variant="outline"
                icon={<Copy className="h-[16px] w-[16px]" />}
                onClick={() => void copiarTexto(textoParaCopiar, 'Dados copiados.')}
                title="Copia nome, documento, dados bancários, Pix e endereço, um por linha"
              >
                Copiar dados
              </Button>
            )}
            {/* "SALVANDO…" ENQUANTO GRAVA (amostra): o giro sozinho não diz o
                que está acontecendo, e a ficha leva um instante para voltar. */}
            <Button loading={salvar.isPending} onClick={handleSalvar}>
              {salvar.isPending ? 'Salvando…' : 'Salvar'}
            </Button>
          </>
        }
      >
        {editando && (
          <div className="space-y-6">
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
              <Field label={`Nome do ${rotuloMin}`} required>
                <Input
                  value={editando.nome}
                  autoComplete="off"
                  placeholder="Nome completo ou razão social"
                  onChange={(e) => setEditando({ ...editando, nome: e.target.value })}
                />
                {avisoNome && <AvisoAmbar>{avisoNome}</AvisoAmbar>}
              </Field>
            ) : (
              <Field label={`Nome do ${rotuloMin}`}>
                <div className="rounded-campo bg-superficie-3 px-4 py-2 text-corpo text-texto-2">
                  {editando.nome}
                </div>
              </Field>
            )}

            <SecaoFicha titulo="Identificação">
              <div className="grid gap-4 sm:grid-cols-2">
                {/* Rótulo, dica e máscara acompanham o documento: chamar de "CPF"
                    o documento de uma empresa está errado, e a máscara já troca
                    sozinha no 12º dígito. */}
                <Field
                  label={pj ? 'CNPJ' : 'CPF / CNPJ'}
                  hint={buscandoCnpj ? 'Buscando na Receita…' : (retornoCnpj ?? undefined)}
                  // Dígito verificador errado quase sempre é erro de digitação,
                  // e num campo desses o erro vira dinheiro no lugar errado.
                  // SÓ COM O DOCUMENTO COMPLETO (11 ou 14 dígitos), como na
                  // amostra: no meio da digitação o aviso acusava erro em quem
                  // ainda não terminou. O Salvar continua barrando o incompleto.
                  error={avisoDoDigito(form.cpf)}
                >
                  <Input
                    className="tabular-nums"
                    placeholder={pj ? '00.000.000/0000-00' : '000.000.000-00'}
                    value={form.cpf}
                    // readOnly, e não disabled: o campo desabilitado PERDIA O FOCO
                    // no meio da digitação, e quem ia de Tab para o próximo campo
                    // recomeçava do topo da janela. Trava a edição do mesmo jeito.
                    readOnly={buscandoCnpj}
                    aria-busy={buscandoCnpj}
                    onChange={(e) => {
                      const valor = formatCpfCnpjInput(e.target.value)
                      setForm((f) => ({ ...f, cpf: valor }))
                      // O retorno era do documento de antes.
                      setRetornoCnpj(null)
                      // CNPJ completo traz o endereço da empresa. Só com 14
                      // dígitos: CPF não tem equivalente público (ver lib/cnpj.ts).
                      if (onlyDigits(valor).length === 14) void preencherPorCnpj(valor)
                    }}
                  />
                </Field>
                {/* ORDEM DELIBERADA: representante ANTES do RG. Em pessoa jurídica
                    os campos saem "CNPJ | Representante legal" na primeira linha e
                    o RG na segunda — porque aí o RG é o DO REPRESENTANTE (empresa
                    não tem RG), e ele vem depois de quem ele identifica. O
                    representante aparece no 12º dígito do documento, junto com a
                    troca do rótulo para CNPJ. */}
                {pj && (
                  <Field label="Representante legal">
                    <Input
                      placeholder="Quem assina pela empresa"
                      value={form.representante}
                      onChange={(e) => setForm((f) => ({ ...f, representante: e.target.value }))}
                    />
                  </Field>
                )}
                <Field label={pj ? 'RG do representante' : 'RG'}>
                  <Input
                    className="tabular-nums"
                    value={form.rg}
                    onChange={(e) => setForm((f) => ({ ...f, rg: e.target.value }))}
                  />
                </Field>
              </div>
            </SecaoFicha>

            {/* PARA O CONTRATO (item "Novo" da amostra): as colunas existiam no
                banco (migração 0047) e o Salvar as preservava, mas eram
                preenchidas direto no banco. Só no INVESTIDOR, porque é dele a
                qualificação que o gerar-contrato monta. */}
            {tipo === 'investidor' && (
              <SecaoFicha titulo="Para o contrato">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Gênero" hint={dicas.genero}>
                    <Select
                      value={paraContrato.genero}
                      onChange={(e) => setParaContrato((c) => ({ ...c, genero: e.target.value }))}
                    >
                      <option value="">Não informado</option>
                      <option value="M">Masculino</option>
                      <option value="F">Feminino</option>
                    </Select>
                  </Field>
                  <Field label="Complemento da qualificação" hint={dicas.qualificacao}>
                    <Input
                      value={paraContrato.qualificacao_complemento}
                      onChange={(e) =>
                        setParaContrato((c) => ({ ...c, qualificacao_complemento: e.target.value }))
                      }
                    />
                  </Field>
                </div>
              </SecaoFicha>
            )}

            <SecaoFicha titulo="Dados bancários">
              <div className="grid gap-4 sm:grid-cols-4">
                <Field label="Banco">
                  <Input
                    value={form.banco}
                    onChange={(e) => setForm((f) => ({ ...f, banco: e.target.value }))}
                  />
                </Field>
                {/* Agência e conta descartam letra a cada tecla, e aceitam o
                    hífen, o ponto e a barra do dígito (limparNumeroConta). */}
                <Field label="Agência">
                  <Input
                    className="tabular-nums"
                    value={form.agencia}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, agencia: limparNumeroConta(e.target.value) }))
                    }
                  />
                </Field>
                <Field label="Conta">
                  <Input
                    className="tabular-nums"
                    value={form.conta}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, conta: limparNumeroConta(e.target.value) }))
                    }
                  />
                </Field>
                <Field label="Pix">
                  <Input
                    value={form.pix}
                    onChange={(e) => setForm((f) => ({ ...f, pix: e.target.value }))}
                  />
                </Field>
              </div>
            </SecaoFicha>

            {/* ---------- Endereço em partes ---------- */}
            <SecaoFicha titulo="Endereço">
              <div className="grid gap-4 sm:grid-cols-4">
                {/* CEP PRIMEIRO: é ele que preenche logradouro, bairro, cidade e
                    UF, então digitá-lo antes poupa quatro campos. */}
                <Field
                  label="CEP"
                  hint={buscandoCep && !avisoCep ? 'Buscando…' : undefined}
                >
                  <Input
                    className="tabular-nums"
                    inputMode="numeric"
                    placeholder="00000-000"
                    value={form.cep}
                    onChange={(e) => {
                      const cep = formatCepInput(e.target.value)
                      setForm((f) => ({ ...f, cep }))
                      void preencherPorCep(cep)
                    }}
                  />
                  {/* AVISO, NÃO ERRO (amostra: `.hint.warn`): CEP não achado ou
                      sem rua não impede salvar — pede para preencher à mão. Em
                      vermelho, parecia que a ficha estava errada. O `error` do
                      Field pintaria o campo de inválido, então o aviso vem aqui. */}
                  {avisoCep && (
                    <p role="status" className="text-xs font-semibold text-aviso">
                      {avisoCep}
                    </p>
                  )}
                </Field>
                <Field label="Logradouro" className="sm:col-span-3">
                  <Input
                    value={form.logradouro}
                    onChange={(e) => setForm((f) => ({ ...f, logradouro: e.target.value }))}
                  />
                </Field>
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
                <Field label="Complemento">
                  <Input
                    value={form.complemento}
                    onChange={(e) => setForm((f) => ({ ...f, complemento: e.target.value }))}
                  />
                </Field>
                <Field label="Bairro" className="sm:col-span-2">
                  <Input
                    value={form.bairro}
                    onChange={(e) => setForm((f) => ({ ...f, bairro: e.target.value }))}
                  />
                </Field>
                {/* A UF vem PRIMEIRO porque é ela que define a lista de cidades.
                    Trocar de UF limpa a cidade: manter "Belo Horizonte" depois de
                    mudar para SP seria dado inválido. */}
                <Field label="UF">
                  <Select
                    value={form.uf}
                    onChange={(e) => setForm((f) => ({ ...f, uf: e.target.value, cidade: '' }))}
                  >
                    <option value="">—</option>
                    {ufs.map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </Select>
                </Field>
                {/* Combobox e não Select: MG tem 853 municípios, e sem busca a
                    lista é inutilizável. E só da lista do IBGE: o texto digitado
                    é busca, não valor. */}
                <Field label="Cidade" className="sm:col-span-3">
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
              {/* A prévia diz o que vai para a tabela e para o contrato, pela MESMA
                  regra do Salvar (enderecoDaFicha): o texto antigo continua até o
                  endereço novo ter rua e cidade.

                  O ENDEREÇO ANTIGO À VISTA (item "Novo" da amostra): a ficha que
                  só tem o endereço em texto corrido mostrava as partes em branco,
                  e parecia não ter endereço nenhum — quem preenchia "do zero"
                  achava que estava completando, não substituindo. */}
              {(() => {
                const antigo = editando.novo
                  ? undefined
                  : dados.data?.get(chavePessoa(tipo, editando.chave))?.endereco
                const end = enderecoDaFicha(form, antigo)
                const compilado = compilarEndereco(form)
                // A PRÉVIA E O AVISO, OS DOIS À VISTA (amostra): a prévia é das
                // partes que se está preenchendo; o aviso, logo abaixo, diz que o
                // texto antigo é o que vale até elas terem rua e cidade. Antes o
                // aviso tomava o lugar da prévia, e quem digitava não via o que
                // as partes formavam.
                const legado = end.mantemAntigo && end.texto
                return (
                  <>
                    <p className="mt-3 rounded-controle bg-superficie-2 px-4 py-2 text-corpo text-texto-3">
                      {(legado ? compilado : end.texto) || 'Endereço em branco'}
                    </p>
                    {legado && (
                      <AvisoAmbar icone="info">
                        Esta ficha tem o endereço no formato antigo, em texto corrido:{' '}
                        <strong className="font-semibold text-texto">{end.texto}</strong>. Ele
                        continua valendo até a rua e a cidade serem preenchidas — salvar sem
                        elas não o apaga.
                        {compilado && <> O que já foi preenchido acima é guardado nas partes.</>}
                      </AvisoAmbar>
                    )}
                  </>
                )
              })()}
            </SecaoFicha>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={!!aExcluir}
        title={`Remover ${rotuloMin}`}
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
  )
}

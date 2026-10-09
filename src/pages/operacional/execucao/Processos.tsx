import { Fragment, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { lerPedidoDaBusca } from '@/lib/buscaGeral'
import { useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  CalendarClock,
  Folder,
  Pencil,
  Plus,
  Trash2,
  Wallet,
} from 'lucide-react'
import { processosCrud, useUltimaMovimentacao } from '@/lib/queries'
import { cn } from '@/lib/cn'
import { useApensosManager } from '@/components/Apensos'
import { NumeroProcessoDrive } from '@/components/NumeroProcessoDrive'
import { CreditoFormModal } from '@/components/CreditoFormModal'
import {
  CampoDeBusca,
  CartaoNoCelular,
  FerramentasDoPainel,
  ListaNoCelular,
  Partes,
  SeloExpectativa,
} from '@/components/operacional/Pecas'
import type { Processo } from '@/lib/types'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Segmented } from '@/components/ui/Segmented'
import { GradeDeIndicadores, StatCard } from '@/components/ui/StatCard'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
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
  SemResultado,
} from '@/components/ui/Table'
import { AcoesDaLinha, type AcaoDoMenu } from '@/components/ui/MenuDeAcoes'
import { SortableTH } from '@/components/ui/SortableTH'
import { CreditoDrawer } from '@/components/CreditoDrawer'
import { useToast } from '@/components/ui/Toast'
import {
  getLabel,
  STATUS_PROCESSO,
  INSTRUMENTO,
  ESPECIE_REQUISITORIO,
} from '@/lib/labels'
import { formatCNJ, formatDate, mesesDepois, onlyDigits } from '@/lib/format'
import { useHojeQueAnda } from '@/lib/hojeQueAnda'
import { casaBusca } from '@/lib/buscaDaTela'
import { LEMBRAR, useEscolhaLembrada } from '@/lib/lembrarNaTela'
import {
  brlCurto,
  MESES_ALERTA_EXPECTATIVA,
  numerosDaSelecao,
} from '@/lib/numerosDosCreditos'
// As regras do Salvar (validação, campos escondidos zerados, o formulário de
// crédito novo) moram em lib/regrasDoCredito.ts, com teste; a janela, em
// components/CreditoFormModal.tsx.
import { CREDITO_VAZIO } from '@/lib/regrasDoCredito'

// Separa múltiplos nº RTDPJ (digitados com "e", vírgula, ";" ou quebra) para
// exibir um por linha.
//
// A BARRA SAIU da lista de separadores: ela faz parte do próprio número quando
// vem com o ano ("123456/2025"), e um registro único era exibido quebrado em dois
// — "123456" e "2025" —, dando a entender que havia dois registros.
function splitRtdpj(v: string): string[] {
  return v
    .split(/\s*(?:\be\b|,|;|\n)\s*/i)
    .map((s) => s.trim())
    .filter(Boolean)
}

// Nº de colunas da tabela de créditos — usado no colSpan da linha de apensos.
// Atualizar ao adicionar/remover colunas para a linha continuar ocupando a largura toda.
// A tabela mostra só o essencial para escanear; a ficha completa (advogado,
// tribunal, datas de liquidação etc.) abre no Drawer ao clicar na linha.
const N_COLUNAS = 7

// Bolinha de status ao lado do nº do processo — o status por extenso é
// redundante com o filtro de pílulas acima da tabela; a cor basta.
// Só os tones que STATUS_PROCESSO produz; tone novo cai no fallback cinza.
const DOT_STATUS: Record<string, string> = {
  green: 'bg-sucesso-cheio',
  yellow: 'bg-aviso-cheio',
  gray: 'bg-texto-3',
}

// As escolhas que a tela lembra (lib/lembrarNaTela.ts confere o valor guardado
// contra estas listas: filtro que deixou de existir volta ao padrão).
const FILTROS_STATUS = [...Object.keys(STATUS_PROCESSO), 'todos']
const ORDENS = ['data_aquisicao', 'expectativa_liquidacao', 'ultima_movimentacao'] as const
const SENTIDOS = ['asc', 'desc'] as const

export default function Processos() {
  const { useList, useRemove } = processosCrud
  const { data, isLoading, isError, error, refetch } = useList()
  const remove = useRemove()
  const toast = useToast()
  const qc = useQueryClient()
  const apensos = useApensosManager('processo_id')
  const ultimaMov = useUltimaMovimentacao()

  // Referências do semáforo da coluna Expectativa. Data local (sv-SE dá o
  // formato ISO), que ANDA COM O DIA (lib/hojeQueAnda.ts) — o useMemo de antes
  // congelava a régua na montagem, ao contrário do que este comentário dizia.
  const hoje = useHojeQueAnda()
  const limiteAlerta = useMemo(() => mesesDepois(hoje, MESES_ALERTA_EXPECTATIVA), [hoje])

  const [busca, setBusca] = useState('')
  // Padrão ao abrir a página: mostra apenas processos ativos. O FILTRO E A
  // ORDENAÇÃO ESCOLHIDOS FICAM LEMBRADOS entre visitas (lib/lembrarNaTela.ts):
  // quem trabalha nos Encerrados não refaz o clique a cada vez. A busca não.
  const [filtroStatus, setFiltroStatus] = useEscolhaLembrada(
    LEMBRAR.creditosStatus,
    FILTROS_STATUS,
    'ativo',
  )
  // Ordenação padrão: data de aquisição, do mais antigo para o mais novo.
  // ultima_movimentacao não é campo do processo — vem do cache do ADVBOX, e o
  // comparador resolve pelo mapa (ver `lista`).
  const [sortBy, setSortBy] = useEscolhaLembrada(LEMBRAR.creditosOrdem, ORDENS, 'data_aquisicao')
  const [sortDir, setSortDir] = useEscolhaLembrada(LEMBRAR.creditosSentido, SENTIDOS, 'asc')
  /** O crédito na janela de cadastro: o vazio (novo) ou o que se edita. */
  const [formCredito, setFormCredito] = useState<Partial<Processo> | null>(null)
  const [toDelete, setToDelete] = useState<Processo | null>(null)
  // Crédito com a ficha aberta no painel lateral (clique na linha).
  const [detalhe, setDetalhe] = useState<Processo | null>(null)

  // VEIO DA BUSCA GERAL (Ctrl+K) com um crédito escolhido: abre a ficha dele,
  // como o clique na linha, assim que a lista chega. O pedido é apagado do
  // histórico logo depois — senão Voltar até aqui reabriria a ficha.
  const location = useLocation()
  const navigate = useNavigate()
  const { abrirCredito } = lerPedidoDaBusca(location.state)
  useEffect(() => {
    if (!abrirCredito || !data) return
    const p = data.find((x) => x.id === abrirCredito)
    if (p) setDetalhe(p)
    navigate(location.pathname, { replace: true, state: null })
  }, [abrirCredito, data, navigate, location.pathname])

  function toggleSort(col: (typeof ORDENS)[number]) {
    if (sortBy === col) setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    else {
      setSortBy(col)
      setSortDir('asc')
    }
  }

  // Busca textual (sem o filtro de status) — reaproveitada na lista e nas
  // contagens exibidas no seletor de status.
  const baseBusca = useMemo(() => {
    const l = data ?? []
    if (!busca.trim()) return l
    // Sem acento, e número também por dígito (lib/buscaDaTela.ts). O número vale
    // em qualquer campo — antes, só no CNJ, no RTDPJ e no administrativo.
    return l.filter((p) =>
      casaBusca(
        [
          p.numero_cnj,
          // Entra na busca porque NÃO está na tabela: é o único número do crédito
          // que não se acha varrendo a lista com os olhos.
          p.numero_processo_administrativo,
          p.cedente,
          p.cedente_advogado,
          p.cessionario,
          p.entidade_devedora,
          p.comarca,
          p.tribunal,
          p.numero_rtdpj,
          p.instrumento ? getLabel(INSTRUMENTO, p.instrumento).label : null,
        ],
        busca,
      ),
    )
  }, [data, busca])

  const contagemStatus = useMemo(() => {
    const c: Record<string, number> = { todos: baseBusca.length }
    for (const k of Object.keys(STATUS_PROCESSO))
      c[k] = baseBusca.filter((p) => p.status === k).length
    return c
  }, [baseBusca])

  const lista = useMemo(() => {
    let l = baseBusca
    if (filtroStatus !== 'todos') l = l.filter((p) => p.status === filtroStatus)
    const dir = sortDir === 'asc' ? 1 : -1
    // A última movimentação não está no registro: resolve pelo mapa do ADVBOX.
    // Ambos os formatos são ISO (YYYY-MM-DD...), então localeCompare ordena
    // cronologicamente como texto.
    const valor = (p: Processo) =>
      sortBy === 'ultima_movimentacao'
        ? (ultimaMov.data?.get(onlyDigits(p.numero_cnj)) ?? '')
        : (p[sortBy] || '')
    return [...l].sort((a, b) => {
      const av = valor(a)
      const bv = valor(b)
      if (!av && !bv) return 0
      if (!av) return 1 // datas vazias sempre por último
      if (!bv) return -1
      return av.localeCompare(bv) * dir
    })
  }, [baseBusca, filtroStatus, sortBy, sortDir, ultimaMov.data])

  // OS CARTÕES SEGUEM A LISTA (item "Novo" da amostra): filtro de status e busca
  // valem para eles também — o número é sempre "da seleção".
  const numeros = useMemo(() => numerosDaSelecao(lista, hoje), [lista, hoje])

  async function confirmDelete() {
    if (!toDelete) return
    try {
      await remove.mutateAsync(toDelete.id)
      // A exclusão do crédito cascateia no banco para apensos e resumos, e o
      // makeCrud só invalida a própria tabela. Sem isto, os apensos do crédito
      // apagado continuavam listados na tela até recarregar a página.
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['apensos'] }),
        qc.invalidateQueries({ queryKey: ['carteira_resumos'] }),
      ])
      toast.success('Crédito excluído.')
      setToDelete(null)
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const nApensosAExcluir = toDelete ? apensos.contagem(toDelete.id) : 0

  // A FICHA LÊ A VERSÃO MAIS NOVA DA LISTA, e não a cópia do clique: o primeiro
  // "Pasta no Drive" grava o id da pasta no crédito, e com a cópia velha cada
  // clique seguinte refazia as três chamadas ao Drive em vez de abrir na hora.
  const detalheVivo = detalhe ? (data?.find((p) => p.id === detalhe.id) ?? detalhe) : null

  /**
   * AS AÇÕES DA LINHA NO MENU "⋯" (auditoria visual, C4): eram 4 ícones de 12px
   * (+ ✎ 🗑 ›), de cor fraca, com o Excluir colado no Editar. Agora o "›" abre a
   * ficha, e o menu traz as outras por extenso, com o Excluir em vermelho, por
   * último. As mesmas na tabela e no cartão do celular.
   */
  const acoesDoCredito = (p: Processo): AcaoDoMenu[] => [
    apensos.acaoAdicionar(p.id),
    { rotulo: 'Editar', icone: <Pencil aria-hidden="true" />, onSelecionar: () => setFormCredito(p) },
    { rotulo: 'Excluir', icone: <Trash2 aria-hidden="true" />, perigo: true, onSelecionar: () => setToDelete(p) },
  ]

  return (
    <div>
      <PageHeader
        title="Créditos"
        description="A carteira: cada crédito adquirido, de quem, contra quem e quando deve pagar."
        actions={
          // NO CELULAR, O PRIMÁRIO OCUPA A LARGURA (auditoria visual, K2): solto à
          // esquerda, ele deixava uma faixa meio vazia acima dos indicadores.
          <Button
            icon={<Plus className="h-[16px] w-[16px]" />}
            onClick={() => setFormCredito({ ...CREDITO_VAZIO })}
            className="w-full sm:w-auto"
          >
            Novo crédito
          </Button>
        }
      />

      {/* Só com a lista carregada: durante a leitura (ou com erro) os cartões
          diriam "0 créditos", que é afirmar sem ter olhado. A GRADE COMUM DOS
          INDICADORES (C12): quantos couberem, de 200px no mínimo. */}
      {!isLoading && !isError && (
        // No celular, dois por linha: com o mínimo de 200px da grade comum,
        // os quatro empilhavam e empurravam a lista para baixo da dobra.
        <GradeDeIndicadores className="mb-s4 max-sm:grid-cols-2 max-sm:gap-s3">
          <StatCard
            label="Créditos na seleção"
            value={numeros.quantidade}
            icon={<Folder className="h-[16px] w-[16px]" />}
          />
          <StatCard
            label="Capital investido"
            value={brlCurto(numeros.capital)}
            icon={<Wallet className="h-[16px] w-[16px]" />}
          />
          <StatCard
            label="Expectativa vencida"
            value={numeros.vencidas}
            hint={
              numeros.vencidas
                ? 'Créditos ativos com a expectativa de liquidação já passada: pedem acompanhamento.'
                : 'Nenhum crédito ativo com a expectativa vencida.'
            }
            icon={<AlertTriangle className="h-[16px] w-[16px]" />}
          />
          <StatCard
            label="Liquidam em 90 dias"
            value={numeros.liquidamEm90}
            hint="Créditos ainda a receber com a expectativa de liquidação nos próximos 90 dias."
            icon={<CalendarClock className="h-[16px] w-[16px]" />}
          />
        </GradeDeIndicadores>
      )}

      {/* A BUSCA MORA NO CARTÃO DA LISTA (a amostra): é dela, e não da página. */}
      <Card>
        <FerramentasDoPainel>
          <CampoDeBusca
            valor={busca}
            onChange={setBusca}
            placeholder="Buscar por número, cedente ou devedora"
            title="Busca em: número, nº administrativo, cedente, advogado, cessionário, devedora, comarca, tribunal, instrumento e RTDPJ"
            className="min-w-[16rem]"
          />
          <Segmented
            ariaLabel="Filtrar créditos por status"
            items={[
              ...Object.entries(STATUS_PROCESSO).map(([k, v]) => ({
                key: k,
                label: v.label,
                count: contagemStatus[k] ?? 0,
              })),
              { key: 'todos', label: 'Todos', count: contagemStatus.todos },
            ]}
            value={filtroStatus}
            onChange={setFiltroStatus}
          />
        </FerramentasDoPainel>

        {isLoading ? (
          <Loading label="Carregando créditos…" />
        ) : isError ? (
          <ErrorState message={(error as Error)?.message} onRetry={() => refetch()} />
        ) : lista.length === 0 ? (
          // Vazio POR RECORTE é outra coisa: com 95 créditos cadastrados e um
          // filtro de status ativo, "Cadastre o primeiro crédito" afirma que a
          // base está vazia e esconde que há dado atrás do recorte. A saída
          // oferecida tem de ser limpar o recorte, não cadastrar de novo.
          // SEM RESULTADO É UMA LINHA SIMPLES (auditoria visual, §0.10): a
          // moldura tracejada fica para o vazio de verdade ("ainda não há").
          (data ?? []).length > 0 ? (
            <SemResultado
              texto={
                busca.trim()
                  ? `Nenhum crédito corresponde a "${busca.trim()}"${
                      filtroStatus !== 'todos'
                        ? ` no status ${getLabel(STATUS_PROCESSO, filtroStatus).label}`
                        : ''
                    }.`
                  : `Nenhum crédito no status ${
                      getLabel(STATUS_PROCESSO, filtroStatus).label
                    }.`
              }
              rotuloLimpar="Limpar busca e filtro"
              onLimpar={() => {
                setBusca('')
                setFiltroStatus('todos')
              }}
            />
          ) : (
            <EmptyState
              title="Nenhum crédito"
              description="Cadastre o primeiro crédito."
              action={
                <Button
                  icon={<Plus className="h-[16px] w-[16px]" />}
                  onClick={() => setFormCredito({ ...CREDITO_VAZIO })}
                >
                  Novo crédito
                </Button>
              }
            />
          )
        ) : (
          <>
          {/* NO CELULAR, CARTÕES (K1): o número com a espécie, as partes e a
              devedora com a expectativa — e as mesmas ações da linha. */}
          <ListaNoCelular rotulo="Créditos">
            {lista.map((p) => {
              const esp = p.especie_requisitorio ? ESPECIE_REQUISITORIO[p.especie_requisitorio] : null
              return (
                <CartaoNoCelular
                  key={p.id}
                  titulo={
                    <span className="inline-flex flex-wrap items-center gap-s1.5">
                      <span className="whitespace-nowrap tabular-nums">{formatCNJ(p.numero_cnj)}</span>
                      {p.especie_requisitorio && (
                        <Badge size="sm" tone={esp?.tone ?? 'gray'}>
                          {esp?.label ?? p.especie_requisitorio}
                        </Badge>
                      )}
                    </span>
                  }
                  linhas={[
                    <Partes a={p.cedente} b={p.cessionario} />,
                    <span>
                      {p.entidade_devedora || '—'}
                      {p.expectativa_liquidacao && (
                        <span className="tabular-nums"> · expectativa {formatDate(p.expectativa_liquidacao)}</span>
                      )}
                    </span>,
                  ]}
                  onAbrir={() => setDetalhe(p)}
                  rotuloAbrir={`Abrir ficha de ${p.numero_cnj ?? 'crédito'}`}
                  rotuloDasAcoes={`Ações do crédito ${formatCNJ(p.numero_cnj)}`}
                  acoes={acoesDoCredito(p)}
                />
              )
            })}
          </ListaNoCelular>
          <div className="hidden md:block">
          <Table dense>
            <THead>
              <tr>
                <TH>Processo</TH>
                <TH>Entidade devedora</TH>
                <SortableTH
                  label="Aquisição"
                  active={sortBy === 'data_aquisicao'}
                  dir={sortDir}
                  onToggle={() => toggleSort('data_aquisicao')}
                />
                <SortableTH
                  label="Expectativa"
                  active={sortBy === 'expectativa_liquidacao'}
                  dir={sortDir}
                  onToggle={() => toggleSort('expectativa_liquidacao')}
                />
                <SortableTH
                  // "Últ. mov." e não "Últ. movimentação": o rótulo longo é mais
                  // largo que qualquer data da coluna, então era ELE que definia a
                  // largura — espaço tirado das colunas de texto. Igual em
                  // Requerimentos: a mesma coluna tem o mesmo nome nas duas telas.
                  label="Últ. mov."
                  active={sortBy === 'ultima_movimentacao'}
                  dir={sortDir}
                  onToggle={() => toggleSort('ultima_movimentacao')}
                  className="w-[1%] whitespace-nowrap"
                />
                <TH>Instrumento</TH>
                {/* A COLUNA DAS AÇÕES TEM LARGURA FIXA (C4): o "⋯" e o "›". */}
                <TH className="w-[72px] whitespace-nowrap text-right">Ações</TH>
              </tr>
            </THead>
            <TBody>
              {lista.map((p) => {
                const st = getLabel(STATUS_PROCESSO, p.status)
                const inst = getLabel(INSTRUMENTO, p.instrumento)
                return (
                  <Fragment key={p.id}>
                    <TR onClick={() => setDetalhe(p)}>
                      <TD className="font-medium text-texto">
                        <div className="flex items-start gap-s2">
                          {/* A BOLINHA NÃO FALA SÓ POR COR (CR2): a dica para o
                              mouse e o nome do status para o leitor de tela. */}
                          <span
                            title={st.label}
                            className={cn(
                              'mt-[7px] h-[9px] w-[9px] shrink-0 rounded-full',
                              DOT_STATUS[st.tone] ?? 'bg-texto-3',
                            )}
                          >
                            <span className="sr-only">{st.label}</span>
                          </span>
                          <div className="min-w-0">
                            {/* SEM QUEBRA ENTRE O NÚMERO E O SELO (C4): a 1280px a
                                espécie caía para baixo do número. */}
                            <span className="inline-flex items-center gap-s1.5 whitespace-nowrap">
                              {/* O SELO ALINHA ENTRE AS LINHAS sem precisar de coluna,
                                  e são duas coisas que fazem isso:
                                    - tabular-nums, porque a fonte do app tem dígitos
                                      de largura VARIÁVEL e dois números CNJ de mesmo
                                      comprimento mediam diferente;
                                    - reservarIcone, porque o ícone da pasta do Drive
                                      só existe em crédito com pasta e a sua ausência
                                      puxava tudo 14px para a esquerda.
                                  Com os dois, o número ocupa sempre a mesma largura e
                                  o que vem depois começa sempre no mesmo ponto. */}
                              <NumeroProcessoDrive
                                processo={p}
                                numero={p.numero_cnj}
                                className="whitespace-nowrap font-semibold tabular-nums"
                                reservarIcone
                              />
                              {/* Espécie colada no número: é natureza do requisitório,
                                  como o número — não é situação do crédito (isso é o
                                  status) nem valor. */}
                              {p.especie_requisitorio && (
                                <Badge
                                  size="sm"
                                  tone={
                                    ESPECIE_REQUISITORIO[p.especie_requisitorio]?.tone ??
                                    'gray'
                                  }
                                >
                                  {ESPECIE_REQUISITORIO[p.especie_requisitorio]?.label ??
                                    p.especie_requisitorio}
                                </Badge>
                              )}
                              {/* Apensos à direita da espécie: número e espécie
                                  identificam o requisitório, e o contador é ação
                                  sobre ele. */}
                              {apensos.contador(p.id)}
                            </span>
                            {/* Nomes completos: quebram em linhas em vez de truncar. */}
                            <div className="mt-s0.5 text-xs font-normal text-texto-2">
                              <Partes a={p.cedente} b={p.cessionario} />
                            </div>
                          </div>
                        </div>
                      </TD>
                      <TD>
                        {/* Devedora e comarca/vara em linhas próprias, texto completo. */}
                        <div>{p.entidade_devedora || '—'}</div>
                        <div className="text-xs text-texto-2">
                          {[p.comarca, p.vara].filter(Boolean).join(' · ') || '—'}
                        </div>
                      </TD>
                      <TD curto className="tabular-nums text-texto-2">
                        {formatDate(p.data_aquisicao)}
                      </TD>
                      {/* SELO, e não só a data colorida (item "Novo" da amostra):
                          vencida, vence em até 3 meses, com folga — com ícone, e a
                          dica dizendo o que a cor quer dizer. */}
                      <TD curto>
                        <SeloExpectativa
                          data={p.expectativa_liquidacao}
                          hoje={hoje}
                          limiteAlerta={limiteAlerta}
                        />
                      </TD>
                      {/* Puxada do cache do ADVBOX, não digitada. Enquanto o mapa
                          carrega mostra vazio em vez de "—", que seria mentira. */}
                      <TD curto className="tabular-nums text-texto-2">
                        {ultimaMov.isLoading
                          ? ''
                          : formatDate(ultimaMov.data?.get(onlyDigits(p.numero_cnj)) ?? null)}
                      </TD>
                      {/* O INSTRUMENTO EM TEXTO SIMPLES (auditoria visual, C4 e
                          E2): é dado de consulta, não estado — a pílula colorida
                          com anel repetia uma mancha por linha (e virava bloco
                          saturado no escuro). Sem nowrap: nº RTDPJ longo quebra
                          em vez de alargar a tabela. */}
                      <TD className="text-texto-2">
                        <span className="whitespace-nowrap">{p.instrumento ? inst.label : '—'}</span>
                        {p.instrumento === 'registro_publico' && p.numero_rtdpj && (
                          <div className="mt-s0.5 text-xs tabular-nums text-texto-3">
                            {splitRtdpj(p.numero_rtdpj).map((n, i) => (
                              <div key={i}>{n}</div>
                            ))}
                          </div>
                        )}
                      </TD>
                      {/* O "›" é botão de verdade, e não seta decorativa: abrir a
                          ficha era possível SÓ com o mouse, clicando na linha — e
                          é na ficha que estão partes, valores, apensos e histórico.
                          Os botões não deixam o clique chegar à linha. */}
                      <TD className="w-[72px]">
                        {/* -3px: o centro dos botões de 28px na altura da primeira
                            linha de texto, e não abaixo dela. */}
                        <div className="-my-[3px]">
                        <AcoesDaLinha
                          onAbrir={() => setDetalhe(p)}
                          rotuloAbrir={`Abrir ficha de ${p.numero_cnj ?? 'crédito'}`}
                          rotuloDasAcoes={`Ações do crédito ${formatCNJ(p.numero_cnj)}`}
                          acoes={acoesDoCredito(p)}
                        />
                        </div>
                      </TD>
                    </TR>
                    {apensos.detailRow(p.id, N_COLUNAS)}
                  </Fragment>
                )
              })}
            </TBody>
          </Table>
          </div>
          </>
        )}
      </Card>

      {/* Montada a cada abertura (e desmontada ao fechar): cada abertura começa
          limpa, sem resto da anterior. */}
      {formCredito && (
        <CreditoFormModal inicial={formCredito} onClose={() => setFormCredito(null)} />
      )}

      {/* Ficha completa do crédito — abre ao clicar na linha da tabela. */}
      <CreditoDrawer processo={detalheVivo} onClose={() => setDetalhe(null)} />

      <ConfirmDialog
        open={!!toDelete}
        danger
        loading={remove.isPending}
        title="Excluir crédito"
        // A cascata precisa estar na pergunta: o banco apaga os apensos junto, e
        // eles são cadastro manual (número, classe, tribunal, comarca, vara,
        // polos). Quem excluía um crédito para recadastrá-lo com o número certo
        // perdia os apensos sem nunca ter sido avisado. Sem apenso, a pergunta diz
        // o que mais muda (a amostra): o crédito sai da carteira e do Quadro.
        message={`Excluir o crédito ${formatCNJ(toDelete?.numero_cnj)}? ${
          nApensosAExcluir === 1
            ? 'O apenso vinculado será excluído também.'
            : nApensosAExcluir > 1
              ? `Os ${nApensosAExcluir} apensos vinculados serão excluídos também.`
              : 'O crédito sai da carteira e das telas do Quadro econômico.'
        }`}
        confirmLabel="Excluir"
        onConfirm={confirmDelete}
        onClose={() => setToDelete(null)}
      />

      {apensos.modals()}
    </div>
  )
}

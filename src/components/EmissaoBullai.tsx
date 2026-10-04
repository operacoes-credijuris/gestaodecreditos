// A EMISSÃO DAS CERTIDÕES PELA BULLAI — dentro da aba Certidões da due diligence.
//
// O QUE ESTA SEÇÃO FAZ. O checklist acima diz o que a casa exige — pelas regras
// que saíram da planilha modelo, de cada pessoa do crédito, em cada estado e
// município onde ela morou. Aqui cada item vira as certidões da BullAI que o
// atendem, JÁ MARCADAS (ver `mapaBullai`); quem opera confere, pode acrescentar
// outras do catálogo, e clica em "Extrair". Cada portal gasta uma consulta do
// plano, e por isso nada sai sem esse clique.
//
// DEPOIS DO CLIQUE ELA SÓ OBSERVA. A BullAI trabalha no tempo dela — algumas
// certidões chegam por e-mail horas depois —, e esta seção pergunta pelo
// andamento ao abrir e a cada minuto enquanto houver item em emissão. Os PDFs vão
// para a pasta da ANÁLISE do card no Drive, na subpasta Certidões (desde
// 03/10/2026; ver _shared/pastaDaAnalise.ts), e o checklist recebe o estado e o
// RESULTADO de cada certidão.
//
// O VISUAL É O DA AMOSTRA (`.bull`, `.bull-h`, `.bull-p`, `.bull-row`, `.cat-res`):
// caixa contornada, um bloco por pessoa e uma linha por certidão. Só mudou a
// apresentação — marcação, contagem de portais, trava de nascimento e
// confirmação são as mesmas.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Clock,
  Download,
  ExternalLink,
  Folder,
  RefreshCw,
  X,
} from 'lucide-react'
import { invokeFunction } from '@/lib/functions'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Field'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { useToast } from '@/components/ui/Toast'
import { CaixaSuave, DicaDeAviso, Selo, icSelo, type TomDaPeca } from '@/components/analise/Pecas'
import { traduzirParaBullai } from '../../supabase/functions/_shared/mapaBullai.ts'
import type { PastaNaTela } from '@/lib/checklistDeCertidoes'

interface PortalBullai {
  chave: string
  rotulo: string
  criterio: string
  documento: 'CPF' | 'CNPJ'
  presencial: boolean
}

export interface SujeitoDaEmissao {
  id: string
  papel: string
  tipo_pessoa: 'PF' | 'PJ'
  nome: string
  data_nascimento: string | null
  uf_atual: string | null
  ufs_anteriores: string[]
}

export interface ItemDaEmissao {
  id: string
  sujeito_id: string
  certidao_codigo: string
  parametros: Record<string, unknown>
  status: string
  erro_classe: string | null
  resultado?: string | null
  arquivos?: { portal: string; drive_link: string | null; nome: string; pasta_id?: string | null }[] | null
  erro_detalhe: string | null
  certidao_catalogo: { nome_curto: string } | null
}

/**
 * O que ainda se pode pedir. PENDENTE_MANUAL entra: o "manual" foi dado antes da
 * BullAI, quando a certidão exigia CAPTCHA ou não tinha emissão automática — e
 * boa parte delas a BullAI emite. Sai só o que a PRÓPRIA BullAI já disse que é
 * presencial: pedir de novo gastaria a consulta para ouvir a mesma resposta.
 */
function pedivel(i: ItemDaEmissao) {
  if (i.status === 'PENDENTE' || i.status === 'FALHA') return true
  return i.status === 'PENDENTE_MANUAL' && i.erro_classe !== 'presencial'
}

/**
 * O resultado da certidão no tom que a tela inteira usa: verde passa, vermelho
 * pesa. SEMPRE COM ÍCONE, como os selos da amostra: a cor nunca vai sozinha.
 * EXPORTADO desde 03/10/2026: a linha do checklist mostra o resultado também.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function seloDoResultado(r: string | null | undefined) {
  if (!r) return null
  const tom: Record<string, TomDaPeca> = {
    negativa: 'sucesso',
    nada_consta: 'sucesso',
    positiva: 'perigo',
    indeterminada: 'aviso',
    emitida: 'neutro',
  }
  const icone: Record<string, ReactNode> = {
    negativa: <Check className={icSelo} aria-hidden />,
    nada_consta: <Check className={icSelo} aria-hidden />,
    positiva: <X className={icSelo} aria-hidden />,
    indeterminada: <AlertTriangle className={icSelo} aria-hidden />,
  }
  const rotulo: Record<string, string> = {
    negativa: 'negativa',
    nada_consta: 'nada consta',
    positiva: 'POSITIVA',
    indeterminada: 'indeterminada',
    emitida: 'emitida',
  }
  return (
    <Selo tom={tom[r] ?? 'neutro'} icone={icone[r]}>
      {rotulo[r] ?? r}
    </Selo>
  )
}

/** O `.link-btn` da amostra: link na cor da marca, com área de clique de 24 px. */
const LINK_BTN =
  'inline-flex min-h-8 items-center gap-1 rounded-controle px-1.5 text-sm font-semibold text-marca-texto hover:bg-marca-leve'

export function EmissaoBullai({
  leadId,
  sujeitos,
  itens,
  ativo,
  onMudou,
  pasta,
  onPasta,
}: {
  leadId: number
  sujeitos: SujeitoDaEmissao[]
  itens: ItemDaEmissao[]
  ativo: boolean
  /** O checklist mudou do lado do servidor: recarregue (a promessa, se houver, é esperada). */
  onMudou: () => void | Promise<void>
  /** A pasta do Drive para onde os PDFs vão — o link depois de pedir. */
  pasta?: PastaNaTela | null
  /** A atualização disse em que pasta pôs os PDFs (a subpasta Certidões). */
  onPasta?: (url: string) => void
}) {
  const toast = useToast()
  const catalogo = useQuery({
    queryKey: ['bullai', 'catalogo'],
    enabled: ativo,
    // O catálogo muda pouco; o saldo, a cada pedido — por isso ele é
    // reconsultado depois de cada "Extrair".
    staleTime: 10 * 60 * 1000,
    retry: false,
    queryFn: () =>
      invokeFunction<{ creditos: { restantes: number | null }; portais: PortalBullai[] }>('bullai-catalogo', {}),
  })
  const portais = catalogo.data?.portais ?? []
  const porChave = useMemo(() => new Map(portais.map((p) => [p.chave, p])), [portais])
  const chaves = useMemo(() => new Set(portais.map((p) => p.chave)), [portais])

  // A TRADUÇÃO DE CADA ITEM, pelas regras da planilha — é ela que marca.
  const traducoes = useMemo(() => {
    const m = new Map<string, { chaves: string[]; semBullai: string | null }>()
    if (chaves.size === 0) return m
    for (const i of itens) {
      const s = sujeitos.find((x) => x.id === i.sujeito_id)
      if (!s) continue
      m.set(
        i.id,
        traduzirParaBullai(
          {
            codigo: i.certidao_codigo,
            parametros: i.parametros ?? {},
            tipoPessoa: s.tipo_pessoa,
            ufsDoSujeito: [s.uf_atual, ...(s.ufs_anteriores ?? [])].filter((u): u is string => Boolean(u)),
          },
          chaves,
        ),
      )
    }
    return m
  }, [itens, sujeitos, chaves])

  // A MARCAÇÃO: por padrão, todo item pedível que a BullAI atende. Desmarcar é
  // decisão de quem opera; o padrão é a planilha.
  const [desmarcados, setDesmarcados] = useState<Set<string>>(new Set())
  const [extras, setExtras] = useState<Record<string, string[]>>({})
  const [busca, setBusca] = useState<Record<string, string>>({})
  const [confirmando, setConfirmando] = useState(false)
  const [pedindo, setPedindo] = useState(false)
  const [atualizando, setAtualizando] = useState(false)
  /** A seleção por certidão, recolhida por padrão (ver o render). */
  const [listaAberta, setListaAberta] = useState(false)
  /** A pasta onde a última atualização pôs PDFs — o "Abrir pasta no Drive". */
  const [pastaSalva, setPastaSalva] = useState<string | null>(null)
  /** Já houve pedido nesta janela: o aviso de para onde os PDFs vão aparece. */
  const [pedidoFeito, setPedidoFeito] = useState(false)

  /**
   * OS ITENS JÁ PEDIDOS NESTA JANELA, até a lista nova chegar.
   *
   * O pedido volta e o botão destrava, mas os itens só deixam de ser pedíveis
   * quando o checklist é relido — e, se a releitura demora ou falha, eles
   * continuavam PENDENTE na tela, com "Extrair N" valendo de novo sobre o que
   * acabou de ser pago. Saem daqui assim que `itens` muda (a lista nova diz o
   * estado de verdade de cada um).
   */
  const [jaPedidos, setJaPedidos] = useState<ReadonlySet<string>>(new Set())
  useEffect(() => setJaPedidos(new Set()), [itens])
  const podePedir = (i: ItemDaEmissao) => pedivel(i) && !jaPedidos.has(i.id)

  const marcado = (i: ItemDaEmissao) =>
    podePedir(i) && (traducoes.get(i.id)?.chaves.length ?? 0) > 0 && !desmarcados.has(i.id)

  const pedidos = sujeitos
    .map((s) => {
      const doSujeito = itens.filter((i) => i.sujeito_id === s.id && marcado(i))
      return {
        sujeito: s,
        itens: doSujeito.map((i) => ({ certidao_id: i.id, portais: traducoes.get(i.id)?.chaves ?? [] })),
        extras: extras[s.id] ?? [],
      }
    })
    .filter((p) => p.itens.length > 0 || p.extras.length > 0)
  const consultas = pedidos.reduce(
    (n, p) => n + new Set([...p.itens.flatMap((i) => i.portais), ...p.extras]).size,
    0,
  )
  const semNascimento = pedidos.filter((p) => p.sujeito.tipo_pessoa === 'PF' && !p.sujeito.data_nascimento)

  // O ANDAMENTO: ao abrir, e a cada minuto enquanto houver item em emissão.
  const emEmissao = itens.some((i) => i.status === 'EM_EMISSAO')
  const ultimaAtualizacao = useRef(0)
  // Resposta que chega depois de a seção sair da tela (alguém clicou em
  // "Corrigir dados") não recarrega nada.
  const montado = useRef(true)
  useEffect(() => {
    montado.current = true
    return () => {
      montado.current = false
    }
  }, [])
  /**
   * UMA CONSULTA DE ANDAMENTO POR VEZ. O relógio de um minuto e o botão
   * "Atualizar" podiam sobrepor duas: as duas liam a mesma lista de PDFs
   * prontos e subiam o mesmo arquivo duas vezes ao Drive.
   */
  const atualizandoAgora = useRef(false)
  async function atualizar(silencioso = true) {
    if (atualizandoAgora.current) return
    atualizandoAgora.current = true
    setAtualizando(true)
    try {
      const r = await invokeFunction<{ atualizados: number; falhas?: string[]; pasta_certidoes_url?: string }>(
        'bullai-certidoes',
        { acao: 'atualizar', kommo_lead_id: leadId },
      )
      ultimaAtualizacao.current = Date.now()
      // A PASTA SÓ VEM quando a atualização subiu PDF (campo novo de 03/10/2026).
      if (r.pasta_certidoes_url && montado.current) {
        setPastaSalva(r.pasta_certidoes_url)
        onPasta?.(r.pasta_certidoes_url)
      }
      if (r.atualizados > 0 && montado.current) onMudou()
      if (!silencioso && r.falhas?.length) toast.error(r.falhas.slice(0, 3).join(' · '))
    } catch (e) {
      if (!silencioso) toast.error((e as Error).message)
    } finally {
      atualizandoAgora.current = false
      setAtualizando(false)
    }
  }
  useEffect(() => {
    if (!ativo || !emEmissao || !catalogo.data) return
    if (Date.now() - ultimaAtualizacao.current > 30_000) void atualizar()
    const t = window.setInterval(() => void atualizar(), 60_000)
    return () => window.clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ativo, emEmissao, catalogo.data])

  async function extrair() {
    setPedindo(true)
    try {
      const r = await invokeFunction<{
        criados: { sujeito: string; portais: number }[]
        recusados: string[]
      }>('bullai-certidoes', {
        acao: 'pedir',
        kommo_lead_id: leadId,
        pedidos: pedidos.map((p) => ({ sujeito_id: p.sujeito.id, itens: p.itens, extras: p.extras })),
      })
      setConfirmando(false)
      setExtras({})
      setPedidoFeito(true)
      setJaPedidos((antes) => new Set([...antes, ...pedidos.flatMap((p) => p.itens.map((i) => i.certidao_id))]))
      // O BOTÃO SÓ DESTRAVA COM A LISTA NOVA NA TELA (ou com a releitura falhando,
      // e aí a marca acima segura): é ela que diz o que já foi pedido.
      await Promise.resolve(onMudou()).catch(() => undefined)
      void catalogo.refetch()
      if (r.criados.length) {
        toast.success(
          `Pedido enviado à BullAI: ${r.criados.map((c) => `${c.sujeito} (${c.portais})`).join(', ')}. ` +
            'As certidões chegam aos poucos — a tela acompanha.',
        )
      }
      if (r.recusados.length) toast.error(r.recusados.join(' · '))
    } catch (e) {
      toast.error((e as Error).message)
      // O ERRO PODE TER VINDO DEPOIS DE PARTE DOS PEDIDOS JÁ CRIADA (e paga): a
      // lista é relida para o que já saiu aparecer "em emissão", e não pedível.
      await Promise.resolve(onMudou()).catch(() => undefined)
    } finally {
      setPedindo(false)
    }
  }

  if (!ativo) return null
  // A MOLDURA É A MESMA NOS TRÊS ESTADOS (carregando, fora do ar, a lista), como
  // na amostra: a seção não pula de lugar quando o catálogo chega.
  const moldura = 'my-4 rounded-cartao border border-borda px-4 py-3'
  if (catalogo.isLoading) {
    return (
      <div className={moldura}>
        <p className="flex items-center gap-2 text-corpo text-texto-3">
          <RefreshCw className="h-[16px] w-[16px] animate-spin" aria-hidden />
          Carregando o catálogo da BullAI…
        </p>
      </div>
    )
  }
  if (catalogo.error) {
    return (
      <div className={moldura}>
        <CaixaSuave>
          Emissão pela BullAI indisponível: {(catalogo.error as Error).message}
        </CaixaSuave>
      </div>
    )
  }

  const restantes = catalogo.data?.creditos?.restantes
  const nMarcadas = pedidos.reduce((n, p) => n + p.itens.length + p.extras.length, 0)

  // A SELEÇÃO RECOLHIDA (03/10/2026, pedido do dono de "condensar"): o checklist
  // logo acima já mostra cada certidão, o estado, o resultado e o PDF. Aqui fica
  // à vista o que decide — quantas estão marcadas, quanto custa, e o botão —, e
  // a lista para conferir ou mudar a marcação abre a um clique. A marcação, a
  // contagem de portais, a trava de nascimento e a confirmação são as mesmas.
  return (
    <div className={moldura}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <div className="min-w-0 flex-1">
          <b className="text-corpo font-bold text-texto">Emitir pela BullAI</b>
          <span className="ml-2 text-xs text-texto-3">
            {nMarcadas} marcada{nMarcadas === 1 ? '' : 's'} pelas regras da planilha ({consultas} consulta{consultas === 1 ? '' : 's'}) ·{' '}
            {restantes == null ? 'plano ilimitado' : `${restantes} consulta(s) no plano`}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {emEmissao && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void atualizar(false)}
              disabled={atualizando}
              icon={<RefreshCw className={cn('h-[16px] w-[16px]', atualizando && 'animate-spin')} aria-hidden />}
              title="A tela confere o andamento sozinha ao abrir e a cada 60 s."
            >
              Atualizar andamento
            </Button>
          )}
          <button
            type="button"
            className={LINK_BTN}
            aria-expanded={listaAberta}
            onClick={() => setListaAberta((v) => !v)}
          >
            {listaAberta ? 'Ocultar a seleção' : 'Escolher certidões'}
            <ChevronDown className={cn('h-[16px] w-[16px] transition-transform', listaAberta && 'rotate-180')} aria-hidden />
          </button>
          <Button
            size="sm"
            onClick={() => setConfirmando(true)}
            disabled={consultas === 0 || semNascimento.length > 0 || pedindo}
            loading={pedindo}
            icon={<Download className="h-[16px] w-[16px]" aria-hidden />}
          >
            Extrair {consultas} certidão(ões)
          </Button>
        </div>
      </div>

      {/* DEPOIS DE BAIXAR, O LINK: o navegador bloqueia janela aberta depois de
          uma chamada assíncrona, então a pasta não abre sozinha — fica à mão. */}
      {pastaSalva ? (
        <p role="status" className="mt-2 flex flex-wrap items-center gap-x-2 text-sm text-sucesso">
          <Check className="h-[16px] w-[16px] flex-none" aria-hidden />
          PDFs salvos na pasta da análise, em Certidões.
          <a href={pastaSalva} target="_blank" rel="noreferrer" className={LINK_BTN}>
            <Folder className="h-[16px] w-[16px]" aria-hidden /> Abrir pasta no Drive
          </a>
        </p>
      ) : (
        (emEmissao || pedidoFeito) &&
        pasta && (
          <p className="mt-2 flex flex-wrap items-center gap-x-2 text-sm text-texto-2">
            Os PDFs chegam aos poucos e vão para a pasta da análise, em Certidões.
            <a href={pasta.url} target="_blank" rel="noreferrer" className={LINK_BTN}>
              <Folder className="h-[16px] w-[16px]" aria-hidden /> Abrir pasta no Drive
            </a>
          </p>
        )
      )}

      {semNascimento.length > 0 && (
        <DicaDeAviso>
          Falta a data de nascimento de {semNascimento.map((p) => p.sujeito.nome).join(', ')} — corrija os dados antes.
        </DicaDeAviso>
      )}

      {listaAberta && (
        <div className="mt-2">
          {sujeitos.map((s) => {
            const doSujeito = itens.filter((i) => i.sujeito_id === s.id)
            if (doSujeito.length === 0) return null
            const documento = s.tipo_pessoa === 'PJ' ? 'CNPJ' : 'CPF'
            const termo = (busca[s.id] ?? '').trim().toLowerCase()
            const achados = termo.length >= 3
              ? portais
                  .filter((p) => p.documento === documento && !p.presencial && p.rotulo.toLowerCase().includes(termo))
                  .slice(0, 12)
              : []
            return (
              <div key={s.id} className="border-t border-borda pb-1 pt-2">
                <div className="mb-1 flex flex-wrap items-center gap-2 text-corpo">
                  <Selo tom="info">{s.papel}</Selo>
                  <b className="font-bold text-texto">{s.nome}</b>
                  {s.tipo_pessoa === 'PF' && !s.data_nascimento && (
                    <Selo tom="perigo" icone={<X className={icSelo} aria-hidden />}>
                      falta a data de nascimento — a BullAI exige
                    </Selo>
                  )}
                </div>
                <ul>
                  {doSujeito.map((i) => {
                    const t = traducoes.get(i.id)
                    const podeMarcar = podePedir(i) && (t?.chaves.length ?? 0) > 0
                    const pdfs = (i.arquivos ?? []).filter((a) => a.drive_link)
                    return (
                      <li key={i.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 py-0.5 text-corpo">
                        {/* A CAIXA APARECE SEMPRE, desabilitada no que não se pode
                            pedir: a coluna fica alinhada e o "não dá" se vê. */}
                        <label
                          className={cn(
                            'inline-flex min-h-8 items-center gap-2',
                            podeMarcar ? 'cursor-pointer' : 'cursor-default',
                          )}
                        >
                          <input
                            type="checkbox"
                            className="h-[16px] w-[16px] flex-none accent-marca"
                            checked={marcado(i)}
                            disabled={!podeMarcar}
                            onChange={() =>
                              setDesmarcados((antes) => {
                                const n = new Set(antes)
                                if (n.has(i.id)) n.delete(i.id)
                                else n.add(i.id)
                                return n
                              })
                            }
                          />
                          <span className="text-texto">
                            {i.certidao_catalogo?.nome_curto ?? i.certidao_codigo}
                            {Object.values(i.parametros ?? {}).length > 0 && (
                              <span className="text-texto-3"> ({Object.values(i.parametros).join(', ')})</span>
                            )}
                          </span>
                        </label>
                        {t && t.chaves.length > 0 && (
                          <span className="text-xs text-texto-3">
                            portais: {t.chaves.map((k) => porChave.get(k)?.rotulo ?? k).join(' · ')}
                          </span>
                        )}
                        {t?.semBullai && i.status !== 'OBTIDA' && (
                          <span className="text-xs text-aviso">Manual: {t.semBullai}</span>
                        )}
                        {i.status === 'OBTIDA' && seloDoResultado(i.resultado)}
                        {i.status === 'EM_EMISSAO' && (
                          <Selo tom="aviso" icone={<Clock className={icSelo} aria-hidden />}>
                            em emissão
                          </Selo>
                        )}
                        {i.status === 'FALHA' && (
                          <Selo tom="perigo" icone={<X className={icSelo} aria-hidden />}>
                            falhou
                          </Selo>
                        )}
                        {i.erro_detalhe && i.status !== 'OBTIDA' && (
                          <span className="text-xs text-texto-3">{i.erro_detalhe}</span>
                        )}
                        {pdfs.map((a) => (
                          <a
                            key={a.drive_link!}
                            href={a.drive_link!}
                            target="_blank"
                            rel="noreferrer"
                            className={LINK_BTN}
                          >
                            {porChave.get(a.portal)?.rotulo ?? a.nome}
                            <ExternalLink className="h-[16px] w-[16px]" aria-hidden />
                          </a>
                        ))}
                      </li>
                    )
                  })}
                  {(extras[s.id] ?? []).map((k) => (
                    <li key={k} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 py-0.5 text-corpo">
                      <label className="inline-flex min-h-8 cursor-pointer items-center gap-2">
                        <input
                          type="checkbox"
                          className="h-[16px] w-[16px] flex-none accent-marca"
                          checked
                          onChange={() =>
                            setExtras((antes) => ({ ...antes, [s.id]: (antes[s.id] ?? []).filter((x) => x !== k) }))
                          }
                        />
                        <span className="text-texto">{porChave.get(k)?.rotulo ?? k}</span>
                      </label>
                      <span className="text-xs text-texto-3">acrescentada · fora da planilha</span>
                    </li>
                  ))}
                </ul>

                {/* O CATÁLOGO INTEIRO, a um campo de distância. A LISTA FICA NO
                    FLUXO, e não flutuando: dentro da janela que rola, uma lista
                    flutuante era cortada pela borda do corpo. */}
                <div className="mt-1.5">
                  <Input
                    value={busca[s.id] ?? ''}
                    onChange={(e) => setBusca((antes) => ({ ...antes, [s.id]: e.target.value }))}
                    placeholder={`Acrescentar outra certidão do catálogo (${portais.filter((p) => p.documento === documento).length} para ${documento})…`}
                    aria-label={`Acrescentar certidão do catálogo para ${s.nome}`}
                  />
                  {achados.length > 0 && (
                    <ul className="mt-1 max-h-[240px] overflow-auto rounded-campo border border-borda bg-superficie p-1 shadow-nivel-2">
                      {achados.map((p) => (
                        <li key={p.chave}>
                          <button
                            type="button"
                            onClick={() => {
                              setExtras((antes) => ({
                                ...antes,
                                [s.id]: [...new Set([...(antes[s.id] ?? []), p.chave])],
                              }))
                              setBusca((antes) => ({ ...antes, [s.id]: '' }))
                            }}
                            className="flex min-h-11 w-full items-center rounded-controle px-2.5 text-left text-corpo text-texto hover:bg-superficie-3 focus-visible:bg-superficie-3"
                            title={p.criterio}
                          >
                            {p.rotulo}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <ConfirmDialog
        open={confirmando}
        title="Extrair pela BullAI"
        message={
          <>
            Vou pedir <strong>{consultas}</strong> certidão(ões) à BullAI, em nome de{' '}
            {pedidos.map((p) => p.sujeito.nome).join(', ')}. Cada uma gasta uma consulta do plano
            {restantes == null ? '' : ` (restam ${restantes})`}. As certidões chegam aos poucos, e os PDFs vão para a
            pasta da análise no Drive, em Certidões.
          </>
        }
        confirmLabel={`Extrair ${consultas}`}
        loading={pedindo}
        onConfirm={() => void extrair()}
        onClose={() => setConfirmando(false)}
      />
    </div>
  )
}

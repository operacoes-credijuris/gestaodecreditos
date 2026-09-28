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
// para a pasta do cedente no Drive, e o checklist recebe o estado e o RESULTADO
// de cada certidão.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ExternalLink, FileSearch, Plus, RefreshCw } from 'lucide-react'
import { invokeFunction } from '@/lib/functions'
import { cn } from '@/lib/cn'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { useToast } from '@/components/ui/Toast'
import { traduzirParaBullai } from '../../supabase/functions/_shared/mapaBullai.ts'

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
  arquivos?: { portal: string; drive_link: string | null; nome: string }[] | null
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

/** O resultado da certidão no tom que a tela inteira usa: verde passa, vermelho pesa. */
function seloDoResultado(r: string | null | undefined) {
  if (!r) return null
  const tom: Record<string, 'green' | 'red' | 'yellow' | 'gray'> = {
    negativa: 'green',
    nada_consta: 'green',
    positiva: 'red',
    indeterminada: 'yellow',
    emitida: 'gray',
  }
  const rotulo: Record<string, string> = {
    negativa: 'negativa',
    nada_consta: 'nada consta',
    positiva: 'POSITIVA',
    indeterminada: 'indeterminada',
    emitida: 'emitida',
  }
  return (
    <Badge size="sm" tone={tom[r] ?? 'gray'}>
      {rotulo[r] ?? r}
    </Badge>
  )
}

export function EmissaoBullai({
  leadId,
  sujeitos,
  itens,
  ativo,
  onMudou,
}: {
  leadId: number
  sujeitos: SujeitoDaEmissao[]
  itens: ItemDaEmissao[]
  ativo: boolean
  /** O checklist mudou do lado do servidor: recarregue. */
  onMudou: () => void
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

  const marcado = (i: ItemDaEmissao) =>
    pedivel(i) && (traducoes.get(i.id)?.chaves.length ?? 0) > 0 && !desmarcados.has(i.id)

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
  async function atualizar(silencioso = true) {
    setAtualizando(true)
    try {
      const r = await invokeFunction<{ atualizados: number; falhas?: string[] }>('bullai-certidoes', {
        acao: 'atualizar',
        kommo_lead_id: leadId,
      })
      ultimaAtualizacao.current = Date.now()
      if (r.atualizados > 0 && montado.current) onMudou()
      if (!silencioso && r.falhas?.length) toast.error(r.falhas.slice(0, 3).join(' · '))
    } catch (e) {
      if (!silencioso) toast.error((e as Error).message)
    } finally {
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
      onMudou()
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
    } finally {
      setPedindo(false)
    }
  }

  if (!ativo) return null
  if (catalogo.isLoading) {
    return <div className="mt-6 text-xs text-slate-500">Carregando o catálogo da BullAI…</div>
  }
  if (catalogo.error) {
    return (
      <div className="mt-6 rounded-lg bg-slate-50 p-3 text-xs text-slate-600 ring-1 ring-inset ring-slate-200">
        Emissão pela BullAI indisponível: {(catalogo.error as Error).message}
      </div>
    )
  }

  const restantes = catalogo.data?.creditos?.restantes

  return (
    <div className="mt-6 rounded-xl ring-1 ring-inset ring-brand-200">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-brand-100 bg-brand-50/60 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <FileSearch className="h-4 w-4 text-brand-700" />
          <span className="text-sm font-medium text-slate-800">Emitir pela BullAI</span>
          <span className="text-xs text-slate-500">
            marcadas pelas regras da planilha · {restantes == null ? 'plano ilimitado' : `${restantes} consulta(s) no plano`}
          </span>
        </div>
        {emEmissao && (
          <button
            type="button"
            onClick={() => void atualizar(false)}
            disabled={atualizando}
            className="inline-flex items-center gap-1 text-xs text-brand-700 hover:text-brand-800"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', atualizando && 'animate-spin')} />
            Atualizar andamento
          </button>
        )}
      </div>

      <div className="space-y-4 p-4">
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
            <div key={s.id}>
              <div className="mb-1.5 flex flex-wrap items-center gap-2 text-sm">
                <Badge size="sm" tone="blue">{s.papel}</Badge>
                <span className="font-medium text-slate-800">{s.nome}</span>
                {s.tipo_pessoa === 'PF' && !s.data_nascimento && (
                  <Badge size="sm" tone="red">falta a data de nascimento — a BullAI exige</Badge>
                )}
              </div>
              <ul className="divide-y divide-slate-100 rounded-lg ring-1 ring-inset ring-slate-200">
                {doSujeito.map((i) => {
                  const t = traducoes.get(i.id)
                  const podePedir = pedivel(i) && (t?.chaves.length ?? 0) > 0
                  return (
                    <li key={i.id} className="flex flex-wrap items-start gap-2 px-3 py-2 text-xs">
                      {podePedir ? (
                        <input
                          type="checkbox"
                          className="mt-0.5"
                          checked={marcado(i)}
                          onChange={() =>
                            setDesmarcados((antes) => {
                              const n = new Set(antes)
                              if (n.has(i.id)) n.delete(i.id)
                              else n.add(i.id)
                              return n
                            })
                          }
                        />
                      ) : (
                        <span className="w-3.5" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-medium text-slate-700">
                            {i.certidao_catalogo?.nome_curto ?? i.certidao_codigo}
                          </span>
                          {Object.values(i.parametros ?? {}).length > 0 && (
                            <span className="text-slate-500">({Object.values(i.parametros).join(', ')})</span>
                          )}
                          {i.status === 'OBTIDA' && seloDoResultado(i.resultado)}
                          {i.status === 'EM_EMISSAO' && <Badge size="sm" tone="yellow">em emissão</Badge>}
                          {i.status === 'FALHA' && <Badge size="sm" tone="red">falhou</Badge>}
                        </div>
                        {t && t.chaves.length > 0 && (
                          <div className="mt-0.5 text-slate-500">
                            {t.chaves.map((k) => porChave.get(k)?.rotulo ?? k).join(' · ')}
                          </div>
                        )}
                        {t?.semBullai && i.status !== 'OBTIDA' && (
                          <div className="mt-0.5 text-amber-700">Manual: {t.semBullai}</div>
                        )}
                        {i.erro_detalhe && i.status !== 'OBTIDA' && (
                          <div className="mt-0.5 text-slate-500">{i.erro_detalhe}</div>
                        )}
                        {(i.arquivos ?? []).filter((a) => a.drive_link).length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-2">
                            {(i.arquivos ?? []).filter((a) => a.drive_link).map((a) => (
                              <a
                                key={a.drive_link!}
                                href={a.drive_link!}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-brand-700 hover:underline"
                              >
                                <ExternalLink className="h-3 w-3" />
                                {porChave.get(a.portal)?.rotulo ?? a.nome}
                              </a>
                            ))}
                          </div>
                        )}
                      </div>
                    </li>
                  )
                })}
                {(extras[s.id] ?? []).map((k) => (
                  <li key={k} className="flex items-center gap-2 px-3 py-2 text-xs">
                    <input
                      type="checkbox"
                      checked
                      onChange={() =>
                        setExtras((antes) => ({ ...antes, [s.id]: (antes[s.id] ?? []).filter((x) => x !== k) }))
                      }
                    />
                    <span className="text-slate-700">{porChave.get(k)?.rotulo ?? k}</span>
                    <span className="text-slate-400">acrescentada · fora da planilha</span>
                  </li>
                ))}
              </ul>

              {/* O CATÁLOGO INTEIRO, a um campo de distância: as marcadas são o
                  que a planilha pede; qualquer outra das que a BullAI emite para
                  este tipo de documento pode ser acrescentada aqui. */}
              <div className="relative mt-1.5">
                <div className="flex items-center gap-1.5">
                  <Plus className="h-3.5 w-3.5 text-slate-400" />
                  <input
                    value={busca[s.id] ?? ''}
                    onChange={(e) => setBusca((antes) => ({ ...antes, [s.id]: e.target.value }))}
                    placeholder={`Acrescentar outra certidão do catálogo (${portais.filter((p) => p.documento === documento).length} para ${documento})…`}
                    className="w-full rounded-md border-0 bg-transparent py-1 text-xs text-slate-700 placeholder:text-slate-400 focus:outline-none"
                  />
                </div>
                {achados.length > 0 && (
                  <div className="absolute z-20 mt-1 w-full rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
                    {achados.map((p) => (
                      <button
                        key={p.chave}
                        type="button"
                        onClick={() => {
                          setExtras((antes) => ({
                            ...antes,
                            [s.id]: [...new Set([...(antes[s.id] ?? []), p.chave])],
                          }))
                          setBusca((antes) => ({ ...antes, [s.id]: '' }))
                        }}
                        className="block w-full rounded px-2 py-1 text-left text-xs text-slate-700 hover:bg-slate-50"
                        title={p.criterio}
                      >
                        {p.rotulo}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )
        })}

        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-100 pt-3">
          {semNascimento.length > 0 && (
            <span className="text-xs text-red-700">
              Falta a data de nascimento de {semNascimento.map((p) => p.sujeito.nome).join(', ')} — corrija os dados antes.
            </span>
          )}
          <Button
            onClick={() => setConfirmando(true)}
            disabled={consultas === 0 || semNascimento.length > 0 || pedindo}
            loading={pedindo}
          >
            Extrair {consultas} certidão(ões)
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmando}
        title="Extrair pela BullAI"
        message={
          <>
            Vou pedir <strong>{consultas}</strong> certidão(ões) à BullAI, em nome de{' '}
            {pedidos.map((p) => p.sujeito.nome).join(', ')}. Cada uma gasta uma consulta do plano
            {restantes == null ? '' : ` (restam ${restantes})`}. As certidões chegam aos poucos, e os PDFs vão para a
            pasta do cedente no Drive.
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

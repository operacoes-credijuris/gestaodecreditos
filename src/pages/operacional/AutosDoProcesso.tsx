// Autos do processo — dá um número CNJ, pede os autos ao Escavador, recebe os
// PDFs.
//
// O QUE ESTA TELA NÃO FAZ, e é o desenho todo: ela não ESPERA. Baixar autos é o
// robô do Escavador entrando no tribunal com o certificado digital — leva
// minutos ou horas, e perguntar "já foi?" de tempos em tempos enche o log da
// conta sem acelerar nada (foi o que aconteceu no primeiro teste, em 22/09/2026).
// Quem avisa é o Escavador, num POST para a `escavador-callback`, que baixa os
// documentos. Aqui a pessoa pede, fecha a tela, e volta quando quiser.
//
// A ATUALIZAÇÃO AUTOMÁTICA DA TELA é de um minuto, e só enquanto há pedido em
// aberto: é leitura das nossas tabelas, com uma confirmação de estado na API que
// não custa crédito.
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FileSearch, Download, Loader2 } from 'lucide-react'
import { invokeFunction } from '@/lib/functions'
import { digitosDoCnj, mascaraCnj } from '../../../supabase/functions/_shared/nucleo/cnj.ts'
import { formatBRL, formatDateTime } from '@/lib/format'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { Card, CardBody } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Field, Input } from '@/components/ui/Field'
import {
  Table,
  THead,
  TH,
  TBody,
  TR,
  TD,
  EmptyState,
  Loading,
} from '@/components/ui/Table'
import { useToast } from '@/components/ui/Toast'

interface PedidoEscavador {
  id: number
  numero_cnj: string
  tipo: string
  status: string
  motivo_erro: string | null
  centavos: number
  criado_em: string
  concluido_em: string | null
}

interface DocumentoEscavador {
  id: string
  numero_cnj: string
  chave: string
  nome: string
  tipo: string | null
  caminho: string | null
  bytes: number | null
  erro: string | null
  baixado_em: string | null
}

interface Consulta {
  numero_cnj: string
  pedidos: PedidoEscavador[]
  documentos: DocumentoEscavador[]
  aviso: string | null
}

/** O tom do selo de estado, no vocabulário que o resto da plataforma usa. */
function tomDoEstado(status: string): 'yellow' | 'green' | 'red' | 'gray' {
  const s = status.toUpperCase()
  if (s === 'PENDENTE') return 'yellow'
  if (s === 'SUCESSO') return 'green'
  if (s === 'ERRO' || s === 'NAO_ENCONTRADO') return 'red'
  return 'gray'
}

/** O que cada estado significa para quem está olhando — não para quem programou. */
const EXPLICACAO: Record<string, string> = {
  PENDENTE: 'Na fila do Escavador, esperando o robô entrar no tribunal.',
  SUCESSO: 'O robô leu o processo no tribunal.',
  NAO_ENCONTRADO: 'O robô não achou o processo no sistema do tribunal — pode ser físico, sigiloso ou arquivado.',
  ERRO: 'O robô não conseguiu concluir a leitura no tribunal.',
}

function tamanho(bytes: number | null): string {
  if (!bytes) return '—'
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function AutosDoProcesso() {
  const qc = useQueryClient()
  const toast = useToast()
  const [digitado, setDigitado] = useState('')
  const [consultado, setConsultado] = useState('')
  const [abrindo, setAbrindo] = useState<string | null>(null)

  const digitos = digitosDoCnj(digitado)
  const valido = digitos.length === 20

  const consulta = useQuery({
    queryKey: ['escavador_autos', consultado],
    enabled: Boolean(consultado),
    queryFn: () =>
      invokeFunction<Consulta>('escavador-autos', {
        acao: 'consultar',
        numero_cnj: consultado,
      }),
    // UM MINUTO, e só com pedido em aberto. Ver o cabeçalho: a tela não é o
    // mecanismo de espera, é a janela para olhar o que já chegou.
    refetchInterval: (q) =>
      (q.state.data?.pedidos ?? []).some((p) => p.status === 'PENDENTE') ? 60_000 : false,
  })

  const pedir = useMutation({
    mutationFn: (tipo: 'autos' | 'documentos_publicos') =>
      invokeFunction<{ mensagem: string; repetido?: boolean; centavos?: number }>(
        'escavador-autos',
        { acao: 'pedir', numero_cnj: mascaraCnj(digitos), tipo },
      ),
    onSuccess: (r) => {
      setConsultado(mascaraCnj(digitos))
      qc.invalidateQueries({ queryKey: ['escavador_autos'] })
      if (r?.repetido) toast.error(r.mensagem)
      else {
        toast.success(
          r?.mensagem +
            (r?.centavos ? ` Custou ${formatBRL(r.centavos / 100)}.` : ''),
        )
      }
    },
    onError: (e) => toast.error((e as Error).message),
  })

  async function abrir(doc: DocumentoEscavador) {
    if (!doc.caminho) return
    setAbrindo(doc.id)
    // A JANELA ABRE ANTES DA CONSULTA, e isso não é detalhe: aberta dentro do
    // `then`, o navegador a trata como pop-up e bloqueia. Mesmo motivo e mesma
    // solução dos anexos do Kommo.
    const janela = window.open('', '_blank')
    if (janela) janela.opener = null
    try {
      const r = await invokeFunction<{ url: string }>('escavador-autos', {
        acao: 'link',
        caminho: doc.caminho,
      })
      if (janela) janela.location.href = r.url
      else toast.error('O navegador bloqueou a abertura. Permita pop-ups deste site.')
    } catch (e) {
      janela?.close()
      toast.error((e as Error).message)
    } finally {
      setAbrindo(null)
    }
  }

  const pedidos = consulta.data?.pedidos ?? []
  const documentos = consulta.data?.documentos ?? []
  const ultimo = pedidos[0]
  const baixados = useMemo(() => documentos.filter((d) => d.caminho), [documentos])

  return (
    <div>
      <PageHeader
        title="Autos do processo"
        description="Peça os autos ao Escavador pelo número do processo. O robô entra no tribunal com o certificado digital, e os documentos aparecem aqui quando ele terminar."
      />

      <Card className="mb-4">
        <CardBody>
          <div className="grid gap-4 sm:grid-cols-[1fr_auto_auto] sm:items-end">
            <Field
              label="Número do processo (CNJ)"
              hint={
                digitado && !valido
                  ? `${digitos.length} de 20 dígitos`
                  : 'Pode colar com ou sem pontuação.'
              }
            >
              <Input
                value={digitado}
                onChange={(e) => setDigitado(e.target.value)}
                placeholder="8015250-24.2020.8.05.0000"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && valido && !pedir.isPending) {
                    setConsultado(mascaraCnj(digitos))
                  }
                }}
              />
            </Field>
            {/* OS AUTOS PRIMEIRO, que é o que se quer; os públicos ao lado,
                porque são o que sempre funciona — processo sem segredo entrega
                os públicos a qualquer um, enquanto os restritos dependem de o
                certificado ter acesso àquele processo. */}
            <Button
              disabled={!valido}
              loading={pedir.isPending && pedir.variables === 'autos'}
              onClick={() => pedir.mutate('autos')}
              icon={<FileSearch className="h-4 w-4" />}
            >
              Pedir os autos
            </Button>
            <Button
              variant="outline"
              disabled={!valido}
              loading={pedir.isPending && pedir.variables === 'documentos_publicos'}
              onClick={() => pedir.mutate('documentos_publicos')}
            >
              Só os públicos
            </Button>
          </div>
          {valido && !consultado && (
            <button
              type="button"
              className="mt-3 text-sm text-brand-700 underline underline-offset-2"
              onClick={() => setConsultado(mascaraCnj(digitos))}
            >
              Ver o que já existe deste processo, sem pedir nada
            </button>
          )}
        </CardBody>
      </Card>

      {consultado && (
        <>
          {consulta.isLoading ? (
            <Card>
              <Loading />
            </Card>
          ) : (
            <>
              {consulta.data?.aviso && (
                <div className="mb-4 rounded-lg bg-amber-50 p-3 text-xs text-amber-900 ring-1 ring-inset ring-amber-200">
                  {consulta.data.aviso}
                </div>
              )}

              <Card className="mb-4">
                <CardBody>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-slate-800">{consultado}</p>
                      {ultimo ? (
                        <p className="mt-0.5 text-sm text-slate-600">
                          {EXPLICACAO[ultimo.status.toUpperCase()] ?? ultimo.status}
                          {ultimo.motivo_erro ? ` — ${ultimo.motivo_erro}` : ''}
                        </p>
                      ) : (
                        <p className="mt-0.5 text-sm text-slate-600">
                          Nenhum pedido feito por aqui para este processo.
                        </p>
                      )}
                    </div>
                    {ultimo && (
                      <div className="flex flex-none items-center gap-3">
                        <span className="text-xs text-slate-500">
                          pedido {ultimo.id} · {formatDateTime(ultimo.criado_em)}
                          {ultimo.centavos ? ` · ${formatBRL(ultimo.centavos / 100)}` : ''}
                        </span>
                        <Badge tone={tomDoEstado(ultimo.status)}>{ultimo.status}</Badge>
                      </div>
                    )}
                  </div>
                </CardBody>
              </Card>

              <Card>
                {documentos.length === 0 ? (
                  <EmptyState
                    title="Nenhum documento ainda"
                    description={
                      ultimo?.status === 'PENDENTE'
                        ? 'O pedido está na fila do Escavador. Esta tela se atualiza sozinha a cada minuto, e você pode fechá-la: os documentos chegam do mesmo jeito.'
                        : 'Peça os autos acima. Quando o Escavador concluir, os PDFs aparecem nesta lista.'
                    }
                  />
                ) : (
                  <Table>
                    <THead>
                      <TR>
                        <TH>Documento</TH>
                        <TH>Tipo</TH>
                        <TH>Tamanho</TH>
                        <TH>Chegou</TH>
                        <TH> </TH>
                      </TR>
                    </THead>
                    <TBody>
                      {documentos.map((d) => (
                        <TR key={d.id}>
                          <TD>
                            <span className="font-medium text-slate-800">{d.nome}</span>
                            {d.erro && (
                              <span className="block text-xs text-red-700">{d.erro}</span>
                            )}
                          </TD>
                          <TD>{d.tipo ?? '—'}</TD>
                          <TD>{tamanho(d.bytes)}</TD>
                          <TD>{d.baixado_em ? formatDateTime(d.baixado_em) : '—'}</TD>
                          <TD>
                            {d.caminho ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => abrir(d)}
                                loading={abrindo === d.id}
                                icon={<Download className="h-3.5 w-3.5" />}
                              >
                                Abrir
                              </Button>
                            ) : (
                              <span className="text-xs text-slate-400">não baixado</span>
                            )}
                          </TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                )}
              </Card>

              {baixados.length > 0 && (
                <p className="mt-3 text-xs text-slate-500">
                  {baixados.length} de {documentos.length} documento(s) já estão guardados aqui.
                </p>
              )}

              {ultimo?.status === 'PENDENTE' && (
                <p className="mt-3 flex items-center gap-1.5 text-xs text-slate-500">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Conferindo a cada minuto enquanto o pedido estiver em aberto.
                </p>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}

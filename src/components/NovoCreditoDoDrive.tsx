// Aba "Automatizado" da janela de novo crédito.
//
// Dois passos, e a diferença entre eles é a diferença entre certeza e leitura:
//
//   1. O CAMINHO DA PASTA dá espécie, originador, número do processo e cedente. A
//      pasta está dentro de "Precatórios", logo a espécie é precatório. Não há
//      interpretação, então não há como estar errado de um jeito que ninguém veja.
//   2. OS DOCUMENTOS dão o resto — tribunal, comarca, vara, entidade devedora,
//      valor de face, tipo de crédito, expectativa de liquidação, cessionário,
//      data de aquisição e capital investido. Aí é leitura interpretada, e cada
//      campo volta com o ARQUIVO de onde saiu, para conferência.
//
// Ficam de fora, por decisão do dono: instrumento e nº RTDPJ (não constam dos
// documentos) e índice de atualização (escolha de negócio).
//
// E ELA NUNCA SALVA. Preenche o formulário ao lado e espera a pessoa conferir.
import { useEffect, useMemo, useRef, useState } from 'react'
import { RefreshCw, FileText, TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/cn'
import { driveConfigurado } from '@/lib/drive'
import {
  candidatasACadastro,
  lerDocumentosDoCredito,
  listarPastasDeCredito,
  type PastaCredito,
} from '@/lib/creditoDoDrive'
import { formatCNJ } from '@/lib/format'
import { invokeFunction } from '@/lib/functions'
import type { Processo } from '@/lib/types'
import { Combobox, type OpcaoCombo } from '@/components/ui/Combobox'
import { IconButton } from '@/components/ui/IconButton'
import { EmptyState, ErrorState, Loading } from '@/components/ui/Table'

/** O que a extração devolve para o formulário. */
export type PreenchimentoDoDrive = Partial<Processo>

interface RespostaExtracao {
  campos?: Record<string, unknown>
  /** campo -> nome do arquivo de onde o valor saiu. */
  procedencia?: Record<string, string>
  observacoes?: string[]
  lidos?: string[]
}

/** Rótulo de cada campo, para a lista de procedência ficar legível. */
const ROTULO: Record<string, string> = {
  tribunal: 'Tribunal',
  comarca: 'Comarca',
  vara: 'Vara',
  cedente: 'Cedente',
  cedente_advogado: 'Advogado do cedente',
  entidade_devedora: 'Entidade devedora',
  valor_face: 'Valor de face',
  data_referencia: 'Data de referência',
  expectativa_liquidacao: 'Expectativa de liquidação',
  cessionario: 'Cessionário',
  data_aquisicao: 'Data de aquisição',
  capital_investido: 'Capital investido',
  tipo_credito: 'Tipo de crédito',
}

/**
 * Converte o que a IA devolveu em campos do cadastro.
 *
 * Descarta null e lista vazia em vez de gravá-los: campo que a IA não achou tem de
 * ficar como estava no formulário, não ser zerado por cima.
 */
function camposParaProcesso(campos: Record<string, unknown>): Partial<Processo> {
  const saida: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(campos)) {
    if (v === null || v === undefined || v === '') continue
    if (Array.isArray(v) && v.length === 0) continue
    if (!(k in ROTULO)) continue // só os campos previstos entram
    saida[k] = v
  }
  return saida as Partial<Processo>
}

export function NovoCreditoDoDrive({
  processos,
  onPreencher,
}: {
  processos: Pick<Processo, 'numero_cnj' | 'cedente'>[] | undefined
  onPreencher: (dados: PreenchimentoDoDrive) => void
}) {
  const [buscando, setBuscando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  /** null = ainda não procurou. Lista vazia = procurou e não achou nada. */
  const [candidatas, setCandidatas] = useState<PastaCredito[] | null>(null)
  const [escolhida, setEscolhida] = useState<number | null>(null)

  /** Passo da leitura, para a tela não ficar parada sem dizer nada. */
  const [passo, setPasso] = useState<string | null>(null)
  const [extracao, setExtracao] = useState<
    | (RespostaExtracao & { ignorados: { nome: string; motivo: string }[] })
    | null
  >(null)

  async function procurar() {
    setBuscando(true)
    setErro(null)
    try {
      const todas = await listarPastasDeCredito()
      setCandidatas(candidatasACadastro(todas, processos))
    } catch (e) {
      setErro((e as Error).message)
    } finally {
      setBuscando(false)
    }
  }

  // Procura só de ENTRADA na aba, uma vez. Quem escolheu "Automatizado" já disse
  // o que quer; reprocurar é decisão explícita, no botão ao lado.
  const jaProcurou = useRef(false)
  useEffect(() => {
    if (jaProcurou.current || !driveConfigurado) return
    jaProcurou.current = true
    void procurar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /**
   * Escolher a pasta preenche em DUAS ondas.
   *
   * O que o caminho garante entra na hora, para a pessoa já ver o formulário
   * respondendo. Só então começa a leitura dos documentos, que leva segundos —
   * esperar tudo para mostrar qualquer coisa faria a escolha parecer sem efeito.
   */
  async function usarPasta(c: PastaCredito) {
    const contexto: Partial<Processo> = {
      numero_cnj: c.cnj ? formatCNJ(c.cnj) : '',
      cedente: c.cedente,
      originador: c.originador,
      especie_requisitorio: c.especie,
    }
    onPreencher(contexto)

    setExtracao(null)
    setErro(null)
    setPasso('Abrindo a pasta no Drive…')
    try {
      const leitura = await lerDocumentosDoCredito(c.id, setPasso)
      if (leitura.documentos.length === 0) {
        setExtracao({ ignorados: leitura.ignorados, observacoes: [], lidos: [] })
        return
      }
      setPasso(`Lendo ${leitura.documentos.length} documento(s) com a IA…`)
      const r = await invokeFunction<RespostaExtracao>('extrair-credito', {
        documentos: leitura.documentos,
        contexto,
      })
      onPreencher(camposParaProcesso(r.campos ?? {}))
      setExtracao({ ...r, ignorados: leitura.ignorados })
    } catch (e) {
      setErro((e as Error).message)
    } finally {
      setPasso(null)
    }
  }

  const opcoes = useMemo<OpcaoCombo[]>(
    () =>
      (candidatas ?? []).map((c, i) => ({
        id: i,
        titulo: c.cnj ? formatCNJ(c.cnj) : (c.cedente ?? c.nome),
        subtitulo:
          [...c.caminho, c.cnj && c.cedente ? c.cedente : null]
            .filter(Boolean)
            .join(' › ') + (c.cnj ? '' : '  ·  sem número na pasta'),
      })),
    [candidatas],
  )

  if (!driveConfigurado) {
    return (
      <EmptyState
        title="Drive não configurado neste build"
        description="Sem o acesso ao Drive não há como procurar as pastas dos créditos. Use a aba Manual."
      />
    )
  }

  const procedencia = Object.entries(extracao?.procedencia ?? {}).filter(
    ([campo]) => campo in ROTULO,
  )

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <Combobox
            opcoes={opcoes}
            valor={escolhida}
            onChange={(id) => {
              setEscolhida(id)
              const c = id === null ? null : candidatas?.[id]
              if (c) void usarPasta(c)
            }}
            placeholder={
              buscando
                ? 'Procurando no Drive…'
                : candidatas?.length
                  ? 'Escolha a pasta do crédito'
                  : 'Nenhuma pasta sem cadastro'
            }
            vazio="Nenhuma pasta sem cadastro no Drive."
          />
        </div>
        <IconButton
          label="Procurar novamente no Drive"
          icon={<RefreshCw className={cn('h-4 w-4', buscando && 'animate-spin')} />}
          disabled={buscando || !!passo}
          onClick={procurar}
          className="flex h-10 w-10 shrink-0 items-center justify-center p-0"
        />
      </div>

      {passo && <Loading label={passo} />}

      {erro && <ErrorState message={erro} />}

      {/* PROCEDÊNCIA. Sem ela, o formulário aparece preenchido e ninguém sabe se
          aquele valor de face saiu da análise, do contrato ou do nada. */}
      {!!procedencia.length && (
        <div className="rounded-lg bg-slate-50 p-3">
          <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-600">
            <FileText className="h-3.5 w-3.5" />
            Preenchido a partir de
          </p>
          <ul className="grid gap-x-4 gap-y-0.5 text-xs text-slate-600 sm:grid-cols-2">
            {procedencia.map(([campo, arquivo]) => (
              <li key={campo} className="truncate">
                <span className="font-medium text-slate-700">{ROTULO[campo]}</span>{' '}
                <span className="text-slate-500">· {arquivo}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* O que a IA quer que a pessoa saiba antes de salvar. */}
      {!!extracao?.observacoes?.length && (
        <ul className="space-y-1 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
          {extracao.observacoes.map((o, i) => (
            <li key={i} className="flex gap-1.5">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {o}
            </li>
          ))}
        </ul>
      )}

      {/* Arquivo que não deu para ler NÃO desaparece: PDF escaneado e formato sem
          texto são o caso em que falta campo, e é aqui que se descobre por quê. */}
      {!!extracao?.ignorados?.length && (
        <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
          <p className="mb-1 font-semibold uppercase tracking-wide">Não foi possível ler</p>
          <ul className="space-y-0.5">
            {extracao.ignorados.map((ig, i) => (
              <li key={i} className="truncate">
                {ig.nome} <span className="text-slate-500">· {ig.motivo}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

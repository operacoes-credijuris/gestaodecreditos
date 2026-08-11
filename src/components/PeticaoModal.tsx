// Janela de geração de petição, aberta pelo botão de cada tarefa.
//
// Duas abas: a partir de um MODELO (esta, pronta) e DO ZERO (a próxima). A partir
// do modelo, a janela sugere qual usar lendo a descrição da tarefa, mostra a peça
// já preenchida com os dados do crédito e entrega o .docx.
//
// A sugestão NUNCA decide sozinha: os dez modelos ficam sempre na lista, porque
// três pares deles colidem na mesma palavra ("sequestro", "registro público",
// "RPV") e porque a descrição da tarefa é texto livre digitado por gente. Pedir
// sequestro não é juntar planilha para fins de sequestro, e protocolar a peça
// errada custa mais que um clique a mais.
import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Download, FileText, Sparkles } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Tabs } from '@/components/ui/Tabs'
import { Select } from '@/components/ui/Field'
import { useToast } from '@/components/ui/Toast'
import { Loading } from '@/components/ui/Table'
import {
  aplicarModelo,
  baixarModelo,
  baixarTimbradoBytes,
  NOME_VARIAVEL,
  resolverVariaveis,
  rotulosDesconhecidos,
  sugerirModelos,
  variaveisUsadas,
} from '@/lib/peticao'
import { peticaoTemplatesCrud, useInvestidorDados } from '@/lib/queries'
import { formatCNJ } from '@/lib/format'
import type { Processo } from '@/lib/types'

const ABAS = [
  { key: 'modelo', label: 'Modelo', icon: <FileText className="h-4 w-4" /> },
  { key: 'zero', label: 'Geração por IA', icon: <Sparkles className="h-4 w-4" /> },
]

export function PeticaoModal({
  open,
  onClose,
  descricao,
  processo,
  numeroTarefa,
}: {
  open: boolean
  onClose: () => void
  /** Descrição da tarefa no ADVBOX — é dela que sai a sugestão do modelo. */
  descricao: string | null
  /** O crédito da tarefa. Nulo quando a tarefa não casou com nenhum cadastrado. */
  processo: Processo | null
  numeroTarefa: string
}) {
  const toast = useToast()
  const [aba, setAba] = useState('modelo')
  const [idEscolhido, setIdEscolhido] = useState<string | null>(null)
  const [md, setMd] = useState<string | null>(null)
  const [carregandoMd, setCarregandoMd] = useState(false)
  const [erroMd, setErroMd] = useState<string | null>(null)
  const [gerando, setGerando] = useState(false)

  const templates = peticaoTemplatesCrud.useList()
  const fichas = useInvestidorDados()

  const ativos = useMemo(
    () => (templates.data ?? []).filter((t) => t.ativo && t.arquivo),
    [templates.data],
  )

  const sugeridos = useMemo(
    () => sugerirModelos(descricao, ativos),
    [descricao, ativos],
  )

  // A sugestão entra como valor INICIAL, não como trava: assim que a lista chega,
  // o primeiro sugerido fica escolhido, e a pessoa troca à vontade depois.
  useEffect(() => {
    if (!open) return
    setIdEscolhido((atual) => atual ?? sugeridos[0]?.id ?? ativos[0]?.id ?? null)
  }, [open, sugeridos, ativos])

  // Ao fechar, esquece a escolha e o texto: reabrir noutra tarefa tem de partir da
  // sugestão daquela tarefa, não da anterior.
  useEffect(() => {
    if (open) return
    setIdEscolhido(null)
    setMd(null)
    setErroMd(null)
    setAba('modelo')
  }, [open])

  const escolhido = ativos.find((t) => t.id === idEscolhido) ?? null

  /**
   * O que está escolhido é um dos sugeridos?
   *
   * Serve para engrossar o PRÓPRIO campo, e não só a opção na lista: o select
   * nativo desenha o valor fechado com o estilo dele mesmo, ignorando o da opção
   * selecionada. Sem isto, o negrito aparecia ao abrir a lista e desaparecia ao
   * escolher — justamente quando a informação importa.
   *
   * De quebra, o campo desengrossa ao trocar para um modelo fora da sugestão, o
   * que avisa que a escolha saiu do que a ferramenta indicou.
   */
  const escolhidoEhSugerido = !!idEscolhido && sugeridos.some((s) => s.id === idEscolhido)

  // Baixa o .md do bucket quando o modelo muda.
  useEffect(() => {
    if (!open || !escolhido?.arquivo) return
    let cancelado = false
    setCarregandoMd(true)
    setErroMd(null)
    baixarModelo(escolhido.arquivo)
      .then((texto) => {
        if (!cancelado) setMd(texto)
      })
      .catch((err: Error) => {
        if (!cancelado) {
          setMd(null)
          setErroMd(err.message)
        }
      })
      .finally(() => {
        if (!cancelado) setCarregandoMd(false)
      })
    return () => {
      cancelado = true
    }
  }, [open, escolhido?.arquivo])

  const preenchimento = useMemo(
    () => (processo ? resolverVariaveis(processo, fichas.data) : null),
    [processo, fichas.data],
  )

  /**
   * Só as pendências que ESTE modelo usa. A petição de concordância com os
   * cálculos não menciona dados bancários; exigir conta bancária para gerá-la
   * seria bloqueio falso.
   */
  const pendencias = useMemo(() => {
    if (!md || !preenchimento) return []
    const usadas = new Set(variaveisUsadas(md))
    return preenchimento.pendencias.filter((p) => usadas.has(p.variavel))
  }, [md, preenchimento])

  /**
   * Rótulo entre colchetes que o código não conhece: erro de digitação no arquivo
   * do bucket, ou arquivo trocado. Já aconteceu — um modelo foi substituído por
   * um OCR do papel timbrado, e sem esta checagem a petição sairia em branco.
   */
  const desconhecidos = useMemo(() => (md ? rotulosDesconhecidos(md) : []), [md])
  const semRotuloNenhum = !!md && variaveisUsadas(md).length === 0

  const textoFinal = useMemo(
    () => (md && preenchimento ? aplicarModelo(md, preenchimento.valores) : null),
    [md, preenchimento],
  )

  const impedido =
    !processo ||
    !md ||
    !!erroMd ||
    pendencias.length > 0 ||
    desconhecidos.length > 0 ||
    semRotuloNenhum

  async function gerar() {
    if (!textoFinal || !escolhido) return
    setGerando(true)
    try {
      // Sob demanda: a biblioteca de .docx só desce para quem realmente gera uma
      // petição, não para quem abre a lista de tarefas.
      const { gerarDocxPeticao } = await import('@/lib/peticaoDocx')
      const timbrado = await baixarTimbradoBytes()
      const blob = await gerarDocxPeticao(textoFinal, timbrado)
      const cnj = processo?.numero_cnj ? formatCNJ(processo.numero_cnj) : numeroTarefa
      const nome = `${escolhido.nome} - ${cnj}.docx`.replace(/[/\\?%*:|"<>]/g, '-')
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = nome
      a.click()
      URL.revokeObjectURL(url)
      toast.success('Petição gerada.')
    } catch (err) {
      const msg = (err as Error).message ?? ''
      // Chunk que não baixa quase nunca é falha de rede: é DEPLOY NOVO com a aba
      // aberta. O index.js em memória aponta para um nome de arquivo que o build
      // seguinte substituiu, e o antigo deixa de existir no servidor. Acontece
      // justamente aqui porque a biblioteca de .docx é carregada sob demanda — quem abriu a
      // plataforma antes do deploy e só depois clicou em gerar cai nisto.
      // "Failed to fetch" seco não diz nada a quem está tentando protocolar.
      const versaoVelha =
        /dynamically imported module|Importing a module script failed|Failed to fetch/i.test(
          msg,
        )
      if (versaoVelha) {
        toast.error(
          'A plataforma foi atualizada enquanto esta aba estava aberta. ' +
            'Recarregue a página e gere novamente.',
        )
      } else {
        toast.error(msg)
      }
    } finally {
      setGerando(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title="Gerar petição"
      // "Cedente v. Cessionário", a mesma forma que a lista de tarefas usa sob o
      // número do processo — quem abre a janela vê a mesma identificação que viu
      // no card, sem ter de reconciliar duas descrições do mesmo crédito.
      description={
        processo
          ? `${formatCNJ(processo.numero_cnj)} · ${processo.cedente || '—'} v. ${
              processo.cessionario || '—'
            }`
          : 'A tarefa não está vinculada a um crédito cadastrado.'
      }
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Fechar
          </Button>
          <Button
            onClick={gerar}
            disabled={impedido || gerando}
            icon={<Download className="h-4 w-4" />}
          >
            {gerando ? 'Gerando…' : 'Gerar petição'}
          </Button>
        </>
      }
    >
      <div className="mb-4">
        <Tabs items={ABAS} value={aba} onChange={setAba} />
      </div>

      {aba === 'zero' ? (
        <p className="py-8 text-center text-sm text-slate-600">
          A redação livre entra depois. Por ora, a geração é a partir dos modelos.
        </p>
      ) : (
        <div className="space-y-4">
          {/* Sem crédito não há de onde tirar juízo, processo, cessionário nem
              dados bancários — a tarefa precisa estar vinculada. */}
          {!processo && (
            <Aviso tom="erro">
              Esta tarefa não casou com nenhum crédito cadastrado. Sem crédito não
              há dados para preencher a petição. Confira se o número do processo da
              tarefa no ADVBOX está cadastrado em Créditos.
            </Aviso>
          )}

          {templates.isLoading ? (
            <Loading />
          ) : ativos.length === 0 ? (
            <Aviso tom="erro">
              Nenhum modelo cadastrado. Rode a carga de modelos no Supabase.
            </Aviso>
          ) : (
            // Sem rótulo visível, por pedido — daí o aria-label, para quem usa
            // leitor de tela continuar sabendo o que o campo é.
            <Select
              aria-label="Modelo de petição"
              className={escolhidoEhSugerido ? 'font-semibold' : undefined}
              value={idEscolhido ?? ''}
              onChange={(e) => setIdEscolhido(e.target.value || null)}
            >
              {/* Os sugeridos vêm PRIMEIRO e em negrito. A ordem carrega o mesmo
                  recado do negrito e não depende do navegador: estilo em <option>
                  é respeitado no Chrome e no Firefox do desktop, mas alguns
                  ignoram. Com as duas coisas, o sinal não se perde. */}
              {sugeridos.map((t) => (
                <option key={t.id} value={t.id} style={{ fontWeight: 700 }}>
                  {t.nome}
                </option>
              ))}
              {ativos
                .filter((t) => !sugeridos.some((s) => s.id === t.id))
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nome}
                  </option>
                ))}
            </Select>
          )}

          {erroMd && <Aviso tom="erro">{erroMd}</Aviso>}

          {semRotuloNenhum && (
            <Aviso tom="erro">
              O arquivo <strong>{escolhido?.arquivo}</strong> não tem nenhum campo
              para preencher. Provavelmente foi substituído pelo arquivo errado no
              bucket.
            </Aviso>
          )}

          {desconhecidos.length > 0 && (
            <Aviso tom="erro">
              O modelo tem {desconhecidos.length === 1 ? 'um campo' : 'campos'} que a
              plataforma não reconhece:{' '}
              <strong>{desconhecidos.map((d) => `[${d}]`).join(', ')}</strong>.
              Confira a grafia no arquivo do bucket.
            </Aviso>
          )}

          {pendencias.length > 0 && (
            <Aviso tom="atencao">
              <p className="font-medium">
                Falta preencher no cadastro antes de gerar:
              </p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {pendencias.map((p) => (
                  <li key={p.variavel}>
                    <span className="font-medium">{NOME_VARIAVEL[p.variavel]}</span>{' '}
                    — {p.motivo}
                  </li>
                ))}
              </ul>
            </Aviso>
          )}

          {carregandoMd ? (
            <Loading />
          ) : (
            textoFinal && (
              // Pré-visualização em texto, e não formatada: o que importa conferir
              // aqui é o CONTEÚDO preenchido. A forma final está no arquivo, e uma
              // prévia parecida-mas-não-igual daria falsa segurança.
              <pre className="max-h-80 overflow-y-auto whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-3 font-sans text-xs leading-relaxed text-slate-700 scrollbar-thin">
                {textoFinal}
              </pre>
            )
          )}
        </div>
      )}
    </Modal>
  )
}

/** Caixa de aviso. Âmbar pede providência; vermelho impede a geração. */
function Aviso({
  tom,
  children,
}: {
  tom: 'atencao' | 'erro'
  children: React.ReactNode
}) {
  const cores =
    tom === 'erro'
      ? 'border-red-200 bg-red-50 text-red-800'
      : 'border-amber-200 bg-amber-50 text-amber-900'
  const Icone = tom === 'erro' ? AlertTriangle : FileText
  return (
    <div className={`flex gap-2 rounded-lg border p-3 text-sm ${cores}`}>
      <Icone className="mt-0.5 h-4 w-4 flex-none" />
      <div className="min-w-0">{children}</div>
    </div>
  )
}

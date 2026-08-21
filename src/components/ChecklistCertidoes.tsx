// Checklist de certidões do crédito: cadastro dos sujeitos e o placar de
// completude, no card do Kommo.
//
// A REGRA QUE ESTA TELA SERVE, e que é a razão de o sistema existir: "não
// consegui emitir" não é "não precisa emitir". O checklist é montado ANTES de
// qualquer emissão, congelado no banco, e a etapa documental só fecha quando
// todas as obrigatórias existem em arquivo (migração 0042, dd_concluir_documental).
// Esta tela é a porta de entrada disso: sem sujeito cadastrado não há checklist,
// e sem checklist ninguém sabe o que está faltando.
//
// TRÊS COISAS ELA NÃO FAZ, e não é falta de implementação:
//
// 1. NÃO ADIVINHA O CPF. Os candidatos vindos do PDF são sugestão com o trecho
//    do documento ao lado; quem confere escolhe. Ver src/lib/cpfNoTexto.ts.
// 2. NÃO ESCONDE LACUNA. Cônjuge não informado, sócio PJ não informado,
//    histórico de residência não levantado e certidão dispensada aparecem como
//    aviso mesmo com o placar cheio.
// 3. NÃO DIZ "COMPLETO" SOZINHA. O placar vem de v_dd_completude, e as dispensas
//    aparecem ao lado dele — porque dispensar encolhe o denominador, e "14 de 14
//    com 8 dispensadas" lido como "14 de 14" é a forma mais fácil de fechar um
//    dossiê furado.
//
// Os avisos são DERIVADOS do banco em cada abertura, não guardados da resposta
// da função. A versão anterior só os mostrava nos segundos seguintes ao clique
// em "Montar checklist": reabrir o card fazia o aviso "nenhum cônjuge informado"
// desaparecer, e nada mais na tela dizia que o bloco do cônjuge nunca foi
// considerado.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, FileText, Pencil, Plus, Sparkles } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { invokeFunction } from '@/lib/functions'
import { cpfValido, formatCpfCnpjInput, onlyDigits } from '@/lib/format'
import { acharCpfs, type CpfEncontrado } from '@/lib/cpfNoTexto'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Field, Input, Select } from '@/components/ui/Field'
import { useToast } from '@/components/ui/Toast'

// ------------------------------------------------------------------ tipos

interface Sujeito {
  id: string
  papel: 'CEDENTE' | 'CONJUGE' | 'PJ' | 'ADVOGADO'
  tipo_pessoa: 'PF' | 'PJ'
  nome: string
  documento: string
  data_nascimento: string | null
  uf_atual: string | null
  municipio_atual: string | null
  ufs_anteriores: string[]
  municipios_anteriores: string[]
  residencia_levantada: boolean
}

interface Completude {
  necessarias: number
  obtidas_validas: number
  pendentes: number
  vencidas: number
  dispensadas: number
}

interface ItemChecklist {
  id: string
  sujeito_id: string
  certidao_codigo: string
  parametros: Record<string, unknown>
  obrigatoria: boolean
  status: string
  erro_classe: string | null
  erro_detalhe: string | null
  dispensa_motivo: string | null
  certidao_catalogo: {
    nome_curto: string
    orgao_emissor: string
    metodo: string
    captcha: string
    login: string
    url_oficial: string | null
  } | null
}

interface RespostaGeracao {
  ok?: boolean
  total?: number
  obrigatorias?: number
  pendencia_imediata?: number
  completude?: Completude | null
  avisos?: string[]
  erro?: string
}

interface FormPessoa {
  nome: string
  cpf: string
  uf: string
  municipio: string
  nascimento: string
}

const VAZIO: FormPessoa = { nome: '', cpf: '', uf: '', municipio: '', nascimento: '' }

// ------------------------------------------------------------------ rótulos

/** Por que a certidão não sai sozinha. É a informação que decide o que fazer. */
const MOTIVO_MANUAL: Record<string, string> = {
  DADO_FALTANTE: 'falta dado no cadastro',
  BLOQUEIO: 'exige login ou CAPTCHA',
  SEM_ADAPTER: 'sem emissão automática ainda',
  ESCOPO_INDEFINIDO: 'escopo indefinido',
}

// NAO_APLICAVEL em azul, não em cinza. Em cinza ficava idêntico a PENDENTE, e as
// duas coisas são opostas: uma está por fazer, a outra saiu da conta de vez.
const TOM_STATUS: Record<string, 'gray' | 'green' | 'yellow' | 'red' | 'blue'> = {
  OBTIDA: 'green',
  PENDENTE: 'gray',
  EM_EMISSAO: 'blue',
  PENDENTE_MANUAL: 'yellow',
  FALHA: 'red',
  NAO_APLICAVEL: 'blue',
}

function rotuloParametros(p: Record<string, unknown>): string {
  return Object.entries(p)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join(' · ')
}

/**
 * Os avisos, reconstruídos do estado do banco.
 *
 * Reproduz o que gerar-checklist-certidoes emite na resposta, mais o que só se
 * vê olhando o conjunto. Existe como função separada porque um aviso que só
 * aparece uma vez, no instante do clique, não é aviso — é notificação, e a
 * lacuna que ele denuncia continua lá depois de fechar o modal.
 */
function derivarAvisos(sujeitos: Sujeito[], itens: ItemChecklist[]): string[] {
  const a: string[] = []
  if (sujeitos.length === 0) return a

  for (const s of sujeitos) {
    if (!s.residencia_levantada) {
      a.push(
        `${s.papel} (${s.nome}): histórico de residência não levantado. O checklist ` +
          `cobre apenas os endereços conhecidos hoje — pode faltar certidão estadual ` +
          `ou municipal de onde a pessoa morou antes.`,
      )
    }
    if (!s.uf_atual) {
      a.push(
        `${s.papel} (${s.nome}): sem UF atual. Nenhuma certidão estadual foi ` +
          `exigida para esta pessoa.`,
      )
    }
    if (!s.municipio_atual) {
      a.push(
        `${s.papel} (${s.nome}): sem município atual. Nenhuma certidão municipal ` +
          `foi exigida para esta pessoa.`,
      )
    }
  }

  if (!sujeitos.some((s) => s.papel === 'CONJUGE')) {
    a.push(
      'Nenhum cônjuge informado. Se o cedente for casado, o checklist está ' +
        'INCOMPLETO: a planilha dá bloco próprio de certidões ao cônjuge ' +
        '(linhas 52 a 67).',
    )
  }

  // A 0042 nomeia três coisas esquecíveis: o estado anterior, o cônjuge e a
  // EMPRESA em que o cedente é sócio. As duas primeiras têm campo nesta tela; a
  // terceira ainda não, então o aviso é o que impede que a ausência passe por
  // "não se aplica".
  if (!sujeitos.some((s) => s.papel === 'PJ')) {
    a.push(
      'Nenhuma empresa (PJ) informada. Se o cedente for sócio de empresa, falta ' +
        'o bloco de certidões da PJ — CNPJ, FGTS e as estaduais/municipais dela ' +
        '(planilha, linhas 68 a 81). Esta tela ainda não cadastra PJ: por ora, ' +
        'cadastre pelo SQL ou trate como pendência manual.',
    )
  }

  const dispensadas = itens.filter((i) => i.status === 'NAO_APLICAVEL')
  if (dispensadas.length > 0) {
    a.push(
      `${dispensadas.length} certidão(ões) dispensada(s). Dispensa SAI do ` +
        `denominador do placar: "completo" abaixo significa completo entre as que ` +
        `sobraram, não entre as que a regra exigia.`,
    )
  }

  return a
}

// ------------------------------------------------------------------ componente

export function ChecklistCertidoes({
  leadId,
  cedenteDoCard,
  textoDoProcesso,
  lendoPdf,
  avisoPdf,
  open,
  onClose,
}: {
  leadId: number
  /** Nome do cedente lido do card. Sugestão: o campo continua editável. */
  cedenteDoCard: string
  /** Texto do PDF do card, se já foi lido. Vazio = ainda não lido, ou falhou. */
  textoDoProcesso: string
  lendoPdf: boolean
  avisoPdf: string | null
  open: boolean
  onClose: () => void
}) {
  const toast = useToast()
  const [carregando, setCarregando] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const [sujeitos, setSujeitos] = useState<Sujeito[]>([])
  const [itens, setItens] = useState<ItemChecklist[]>([])
  const [completude, setCompletude] = useState<Completude | null>(null)

  const [editando, setEditando] = useState(false)
  const [cedente, setCedente] = useState<FormPessoa>(VAZIO)
  const [conjuge, setConjuge] = useState<FormPessoa>(VAZIO)
  const [temConjuge, setTemConjuge] = useState(false)
  const [residenciaLevantada, setResidenciaLevantada] = useState(false)
  const [ufsAnteriores, setUfsAnteriores] = useState('')
  const [municipiosAnteriores, setMunicipiosAnteriores] = useState('')
  const [mexeu, setMexeu] = useState(false)

  const [ufs, setUfs] = useState<string[]>([])
  const [municipios, setMunicipios] = useState<Record<string, string[]>>({})

  // A lista do IBGE tem 5571 municípios: importada sob demanda, como em
  // DadosPessoaisBancarios, para não entrar no bundle de quem nunca abre isto.
  useEffect(() => {
    if (!open || ufs.length > 0) return
    void import('@/lib/municipios').then((m) => {
      setUfs(m.UFS)
      setMunicipios(m.MUNICIPIOS_POR_UF)
    })
  }, [open, ufs.length])

  const candidatos: CpfEncontrado[] = useMemo(
    () => (textoDoProcesso ? acharCpfs(textoDoProcesso) : []),
    [textoDoProcesso],
  )

  const avisos = useMemo(() => derivarAvisos(sujeitos, itens), [sujeitos, itens])

  const recarregar = useCallback(async () => {
    setCarregando(true)
    setErro(null)
    try {
      const [rs, ri, rc] = await Promise.all([
        supabase
          .from('dd_sujeito')
          .select(
            'id, papel, tipo_pessoa, nome, documento, data_nascimento, uf_atual,' +
              ' municipio_atual, ufs_anteriores, municipios_anteriores,' +
              ' residencia_levantada',
          )
          .eq('kommo_lead_id', leadId)
          .order('papel'),
        supabase
          .from('dd_certidao')
          .select(
            'id, sujeito_id, certidao_codigo, parametros, obrigatoria, status,' +
              ' erro_classe, erro_detalhe, dispensa_motivo,' +
              ' certidao_catalogo(nome_curto, orgao_emissor, metodo, captcha, login, url_oficial)',
          )
          .eq('kommo_lead_id', leadId),
        supabase
          .from('v_dd_completude')
          .select('*')
          .eq('kommo_lead_id', leadId)
          .maybeSingle(),
      ])
      if (rs.error) throw new Error(rs.error.message)
      if (ri.error) throw new Error(ri.error.message)
      // O erro da view era engolido: o placar simplesmente não aparecia, e
      // "falhou ao ler" ficava indistinguível de "não tem nada aqui ainda".
      if (rc.error) throw new Error(`Placar de completude: ${rc.error.message}`)

      const listaS = (rs.data ?? []) as unknown as Sujeito[]
      setSujeitos(listaS)
      setItens((ri.data ?? []) as unknown as ItemChecklist[])
      setCompletude((rc.data ?? null) as Completude | null)

      // Sem sujeito nenhum, a única coisa útil é o formulário. Com sujeito, o
      // padrão é ver o que já existe — corrigir é ação explícita.
      const ced = listaS.find((s) => s.papel === 'CEDENTE')
      const cnj = listaS.find((s) => s.papel === 'CONJUGE')
      const daPessoa = (s: Sujeito | undefined): FormPessoa | null =>
        s
          ? {
              nome: s.nome,
              cpf: formatCpfCnpjInput(s.documento),
              uf: s.uf_atual ?? '',
              municipio: s.municipio_atual ?? '',
              nascimento: s.data_nascimento ?? '',
            }
          : null
      setCedente(daPessoa(ced) ?? { ...VAZIO, nome: cedenteDoCard })
      setConjuge(daPessoa(cnj) ?? VAZIO)
      setTemConjuge(!!cnj)
      setResidenciaLevantada(ced?.residencia_levantada ?? false)
      setUfsAnteriores((ced?.ufs_anteriores ?? []).join(', '))
      setMunicipiosAnteriores((ced?.municipios_anteriores ?? []).join(', '))
      setEditando(listaS.length === 0)
      setMexeu(false)
    } catch (e) {
      setErro((e as Error)?.message ?? String(e))
    } finally {
      setCarregando(false)
    }
  }, [leadId, cedenteDoCard])

  useEffect(() => {
    if (open) void recarregar()
  }, [open, recarregar])

  // ---------------------------------------------------------------- validação

  const problemas = useMemo(() => {
    const p: string[] = []
    if (!cedente.nome.trim()) p.push('O nome do cedente é obrigatório.')
    if (!cpfValido(cedente.cpf) || onlyDigits(cedente.cpf).length !== 11) {
      p.push('CPF do cedente inválido — confira os 11 dígitos no processo.')
    }
    if (!cedente.uf) {
      p.push(
        'UF atual do cedente é obrigatória: é ela que define as certidões ' +
          'estaduais do checklist.',
      )
    }
    if (temConjuge) {
      if (!conjuge.nome.trim()) p.push('O nome do cônjuge é obrigatório.')
      if (!cpfValido(conjuge.cpf) || onlyDigits(conjuge.cpf).length !== 11) {
        p.push('CPF do cônjuge inválido.')
      }
      if (onlyDigits(conjuge.cpf) === onlyDigits(cedente.cpf)) {
        p.push('O CPF do cônjuge é o mesmo do cedente.')
      }
    }
    return p
  }, [cedente, conjuge, temConjuge])

  /**
   * O que a gravação vai DESTRUIR. Calculado do que já está na tela, sem ida ao
   * servidor: trocar o CPF de um sujeito apaga o sujeito antigo, e dd_certidao
   * cai em cascata — inclusive as OBTIDA, com o drive_file_id do PDF que alguém
   * já emitiu e guardou. Perder isso sem avisar é inaceitável; o número entra na
   * confirmação.
   */
  const impacto = useMemo(() => {
    const docCed = onlyDigits(cedente.cpf)
    const docCnj = temConjuge ? onlyDigits(conjuge.cpf) : null
    const condenados = sujeitos.filter(
      (s) =>
        (s.papel === 'CEDENTE' && s.documento !== docCed) ||
        (s.papel === 'CONJUGE' && (docCnj === null || s.documento !== docCnj)),
    )
    const ids = new Set(condenados.map((s) => s.id))
    const perdidas = itens.filter((i) => ids.has(i.sujeito_id))
    return {
      sujeitos: condenados,
      certidoes: perdidas.length,
      obtidas: perdidas.filter((i) => i.status === 'OBTIDA').length,
    }
  }, [sujeitos, itens, cedente.cpf, conjuge.cpf, temConjuge])

  // ---------------------------------------------------------------- gravação

  async function salvarEGerar() {
    if (problemas.length > 0) return

    if (impacto.sujeitos.length > 0) {
      const quem = impacto.sujeitos
        .map((s) => `${s.papel} ${s.nome} (${formatCpfCnpjInput(s.documento)})`)
        .join(', ')
      const perda =
        impacto.obtidas > 0
          ? `\n\nATENÇÃO: ${impacto.obtidas} certidão(ões) JÁ OBTIDA(S) serão ` +
            `apagadas do checklist, com o vínculo do arquivo no Drive. O arquivo ` +
            `continua no Drive, mas o registro de que ele existe se perde.`
          : ''
      const segue = window.confirm(
        `Isto vai REMOVER do crédito: ${quem}.\n` +
          `E apagar ${impacto.certidoes} item(ns) do checklist dessa(s) pessoa(s).` +
          `${perda}\n\nConfirma?`,
      )
      if (!segue) return
    }

    setSalvando(true)
    setErro(null)
    try {
      const listaUf = (s: string) =>
        s
          .split(/[,;]/)
          .map((x) => x.trim().toUpperCase())
          .filter((x) => /^[A-Z]{2}$/.test(x))
      const listaTexto = (s: string) =>
        s
          .split(/[,;]/)
          .map((x) => x.trim())
          .filter(Boolean)

      // UMA CHAMADA, UMA TRANSAÇÃO. A versão anterior fazia DELETE e depois
      // INSERT em requisições separadas: se a segunda falhasse — token expirado
      // depois de esperar um PDF de 200 páginas, 502, conexão caída — o crédito
      // ficava sem cedente nenhum, e a tela ainda mostrava os dados antigos.
      // Ver dd_registrar_sujeitos, migração 0043.
      const { data, error } = await supabase.rpc('dd_registrar_sujeitos', {
        p_lead_id: leadId,
        p_cedente: {
          nome: cedente.nome.trim(),
          documento: onlyDigits(cedente.cpf),
          data_nascimento: cedente.nascimento || null,
          uf_atual: cedente.uf,
          municipio_atual: cedente.municipio.trim(),
          ufs_anteriores: listaUf(ufsAnteriores),
          municipios_anteriores: listaTexto(municipiosAnteriores),
          residencia_levantada: residenciaLevantada,
        },
        // null APAGA o cônjuge no banco. É o que faz desmarcar a caixa valer
        // algo: antes, desmarcar era no-op e as certidões do cônjuge removido
        // continuavam contando como obrigatórias, para sempre.
        p_conjuge: temConjuge
          ? {
              nome: conjuge.nome.trim(),
              documento: onlyDigits(conjuge.cpf),
              data_nascimento: conjuge.nascimento || null,
              // UF e município viajam JUNTOS. Herdados em separado, escolher SP
              // para o cônjuge e deixar o município em branco gravava
              // "Contagem/SP" — e mandava alguém à prefeitura de Minas buscar
              // certidão de quem está registrado em São Paulo.
              uf_atual: conjuge.uf || cedente.uf,
              municipio_atual: conjuge.uf
                ? conjuge.municipio.trim()
                : cedente.municipio.trim(),
            }
          : null,
      })
      if (error) {
        throw new Error(
          /documento_dv|documento_digitos|tipo_bate_documento/.test(error.message)
            ? 'O banco recusou o documento: dígito verificador inválido. Confira o CPF no processo.'
            : error.message,
        )
      }
      const rel = (data ?? {}) as { certidoes_removidas?: number }
      if (rel.certidoes_removidas) {
        toast.success(`${rel.certidoes_removidas} item(ns) do checklist antigo removido(s).`)
      }

      const r = await invokeFunction<RespostaGeracao>('gerar-checklist-certidoes', {
        kommo_lead_id: leadId,
      })
      toast.success(
        `Checklist montado: ${r.total ?? 0} item(ns), ${r.obrigatorias ?? 0} obrigatório(s)` +
          (r.pendencia_imediata ? `, ${r.pendencia_imediata} já em pendência manual` : '') +
          '.',
      )
      await recarregar()
    } catch (e) {
      setErro((e as Error)?.message ?? String(e))
    } finally {
      setSalvando(false)
    }
  }

  /**
   * Roda o motor de regras de novo sobre os sujeitos já cadastrados.
   *
   * ELE SÓ ACRESCENTA. A função grava com `ignoreDuplicates`, então item que
   * deixou de ser exigido — porque a UF foi corrigida, por exemplo — NÃO sai da
   * lista, e `obrigatoria` de item existente não é atualizado. Daí o rótulo ser
   * "Gerar itens faltantes" e não "Recalcular": o botão faz o que o nome diz, e
   * um nome que prometesse reconciliação faria a pessoa confiar num acerto que
   * não aconteceu. Para tirar item que sobrou, corrija os dados — a troca de
   * sujeito apaga e remonta.
   */
  async function gerarFaltantes() {
    setSalvando(true)
    setErro(null)
    try {
      const r = await invokeFunction<RespostaGeracao>('gerar-checklist-certidoes', {
        kommo_lead_id: leadId,
      })
      await recarregar()
      toast.success(`Motor rodou: ${r.total ?? 0} item(ns) na regra de hoje.`)
    } catch (e) {
      setErro((e as Error)?.message ?? String(e))
    } finally {
      setSalvando(false)
    }
  }

  // ---------------------------------------------------------------- render

  const porSujeito = useMemo(() => {
    const mapa = new Map<string, ItemChecklist[]>()
    for (const i of itens) {
      const l = mapa.get(i.sujeito_id) ?? []
      l.push(i)
      mapa.set(i.sujeito_id, l)
    }
    for (const l of mapa.values()) {
      l.sort((a, b) =>
        (a.certidao_catalogo?.nome_curto ?? a.certidao_codigo).localeCompare(
          b.certidao_catalogo?.nome_curto ?? b.certidao_codigo,
          'pt-BR',
        ),
      )
    }
    return mapa
  }, [itens])

  const municipiosDaUf = (uf: string) => (uf ? (municipios[uf] ?? []) : [])
  const alterar = <T,>(set: (v: T) => void) => (v: T) => {
    setMexeu(true)
    set(v)
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      dirty={editando && mexeu}
      title="Certidões do crédito"
      description={
        editando
          ? 'O checklist é montado por sujeito. Sem CPF e UF não há como saber quais certidões são exigidas.'
          : 'Checklist congelado no banco. A etapa documental só fecha com todas as obrigatórias em arquivo.'
      }
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={salvando}>
            Fechar
          </Button>
          {editando ? (
            <Button
              onClick={salvarEGerar}
              loading={salvando}
              disabled={problemas.length > 0}
              icon={<Sparkles className="h-4 w-4" />}
            >
              Gravar e montar checklist
            </Button>
          ) : (
            <>
              <Button
                variant="secondary"
                onClick={() => setEditando(true)}
                disabled={salvando}
                icon={<Pencil className="h-4 w-4" />}
              >
                Corrigir dados / cônjuge
              </Button>
              <Button
                variant="outline"
                onClick={gerarFaltantes}
                loading={salvando}
                icon={<Plus className="h-4 w-4" />}
              >
                Gerar itens faltantes
              </Button>
            </>
          )}
        </div>
      }
    >
      {erro && (
        <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 ring-1 ring-inset ring-red-200">
          {erro}
        </div>
      )}

      {carregando ? (
        <div className="py-8 text-center text-sm text-slate-500">Carregando…</div>
      ) : editando ? (
        <div className="space-y-5">
          {/* ---------------- candidatos de CPF ---------------- */}
          <div className="rounded-lg bg-slate-50 p-3 ring-1 ring-inset ring-slate-200">
            <div className="mb-2 flex items-center gap-2 text-xs font-medium text-slate-700">
              <FileText className="h-4 w-4" />
              CPFs encontrados no PDF do card
            </div>
            {lendoPdf ? (
              <p className="text-xs text-slate-500">Lendo o PDF do card…</p>
            ) : candidatos.length > 0 ? (
              <>
                <p className="mb-2 text-xs text-slate-600">
                  Dígito verificador conferido. <strong>Escolher é seu</strong>: um processo
                  traz o CPF do cedente, do advogado e às vezes de terceiros — o sistema não
                  tem como saber qual é qual. A lista pode estar incompleta: o PDF nem sempre
                  entrega os números inteiros.
                </p>
                <div className="space-y-1.5">
                  {candidatos.map((c) => (
                    <button
                      key={c.cpf}
                      type="button"
                      onClick={() =>
                        alterar(setCedente)({ ...cedente, cpf: formatCpfCnpjInput(c.cpf) })
                      }
                      className="block w-full rounded-md bg-white p-2 text-left text-xs ring-1 ring-inset ring-slate-200 transition-colors hover:bg-brand-50 hover:ring-brand-300"
                    >
                      <span className="font-mono font-medium text-slate-800">
                        {formatCpfCnpjInput(c.cpf)}
                      </span>
                      {c.rotulado && (
                        <Badge size="sm" tone="blue" className="ml-2">
                          rotulado &quot;CPF&quot;
                        </Badge>
                      )}
                      <span className="mt-0.5 block truncate text-slate-500">
                        …{c.contexto}…
                      </span>
                    </button>
                  ))}
                </div>
              </>
            ) : avisoPdf ? (
              <p className="text-xs text-slate-600">{avisoPdf}</p>
            ) : textoDoProcesso ? (
              // Só se pode afirmar isto DEPOIS de ler o PDF. Sem texto, o certo é
              // dizer que não leu — não que o documento não tem CPF.
              <p className="text-xs text-slate-600">
                Li o PDF e não achei nenhum CPF de dígito válido no texto. Pode ser que o
                documento traga o número partido de um jeito que a busca não pega — digite
                abaixo, conferindo no processo.
              </p>
            ) : (
              <p className="text-xs text-slate-600">
                O PDF do card ainda não foi lido. Digite o CPF conferindo no processo.
              </p>
            )}
          </div>

          {/* ---------------- cedente ---------------- */}
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-slate-800">Cedente</h4>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Nome completo" required>
                <Input
                  value={cedente.nome}
                  onChange={(e) => alterar(setCedente)({ ...cedente, nome: e.target.value })}
                  placeholder="Como está na qualificação das partes"
                />
              </Field>
              <Field
                label="CPF"
                required
                error={
                  cedente.cpf && !cpfValido(cedente.cpf)
                    ? 'Dígito verificador não fecha.'
                    : undefined
                }
              >
                <Input
                  value={cedente.cpf}
                  onChange={(e) =>
                    alterar(setCedente)({
                      ...cedente,
                      cpf: formatCpfCnpjInput(e.target.value),
                    })
                  }
                  inputMode="numeric"
                  placeholder="000.000.000-00"
                />
              </Field>
              <Field
                label="Data de nascimento"
                hint="A CND Federal (Receita/PGFN) não sai sem ela — é o primeiro item do checklist."
              >
                <Input
                  type="date"
                  value={cedente.nascimento}
                  onChange={(e) =>
                    alterar(setCedente)({ ...cedente, nascimento: e.target.value })
                  }
                />
              </Field>
              <Field
                label="UF atual"
                required
                hint="Define as certidões estaduais (TJ, SEFAZ, Justiça Estadual)."
              >
                <Select
                  value={cedente.uf}
                  onChange={(e) =>
                    alterar(setCedente)({ ...cedente, uf: e.target.value, municipio: '' })
                  }
                >
                  <option value="">Selecione…</option>
                  {ufs.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label="Município atual"
                hint="Em branco = nenhuma certidão municipal entra no checklist."
              >
                <Select
                  value={cedente.municipio}
                  onChange={(e) =>
                    alterar(setCedente)({ ...cedente, municipio: e.target.value })
                  }
                  disabled={!cedente.uf}
                >
                  <option value="">
                    {cedente.uf ? 'Selecione…' : 'Escolha a UF primeiro'}
                  </option>
                  {municipiosDaUf(cedente.uf).map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </div>

          {/* ---------------- residência ---------------- */}
          <div className="space-y-3 rounded-lg bg-amber-50/60 p-3 ring-1 ring-inset ring-amber-200">
            <label className="flex cursor-pointer items-start gap-2">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600"
                checked={residenciaLevantada}
                onChange={(e) => alterar(setResidenciaLevantada)(e.target.checked)}
              />
              <span className="text-sm text-slate-800">
                Levantei o histórico de residência do cedente
                <span className="mt-0.5 block text-xs text-slate-600">
                  Deixe desmarcado se não conferiu. &quot;Não sei se morou em outro
                  estado&quot; e &quot;não morou&quot; são respostas diferentes, e a segunda
                  dispensa certidão que a primeira não dispensa. Vale só para o cedente: o
                  cônjuge entra sempre como não levantado, porque esta tela não pergunta o
                  histórico dele.
                </span>
              </span>
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="UFs anteriores" hint="Siglas separadas por vírgula: MG, SP">
                <Input
                  value={ufsAnteriores}
                  onChange={(e) => alterar(setUfsAnteriores)(e.target.value)}
                  placeholder="MG, SP"
                />
              </Field>
              <Field label="Municípios anteriores" hint="Separados por vírgula.">
                <Input
                  value={municipiosAnteriores}
                  onChange={(e) => alterar(setMunicipiosAnteriores)(e.target.value)}
                  placeholder="Belo Horizonte, Campinas"
                />
              </Field>
            </div>
          </div>

          {/* ---------------- cônjuge ---------------- */}
          <div className="space-y-3">
            <label className="flex cursor-pointer items-start gap-2">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600"
                checked={temConjuge}
                onChange={(e) => alterar(setTemConjuge)(e.target.checked)}
              />
              <span className="text-sm font-semibold text-slate-800">
                O cedente é casado / tem companheiro(a)
                <span className="mt-0.5 block text-xs font-normal text-slate-600">
                  A planilha dá bloco próprio de certidões ao cônjuge (linhas 52 a 67).
                  Sem isto, o checklist fecha completo com esse bloco inteiro faltando.
                  Desmarcar REMOVE o cônjuge já cadastrado e as certidões dele.
                </span>
              </span>
            </label>
            {temConjuge && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Nome do cônjuge" required>
                  <Input
                    value={conjuge.nome}
                    onChange={(e) =>
                      alterar(setConjuge)({ ...conjuge, nome: e.target.value })
                    }
                  />
                </Field>
                <Field
                  label="CPF do cônjuge"
                  required
                  error={
                    conjuge.cpf && !cpfValido(conjuge.cpf)
                      ? 'Dígito verificador não fecha.'
                      : undefined
                  }
                >
                  <Input
                    value={conjuge.cpf}
                    onChange={(e) =>
                      alterar(setConjuge)({
                        ...conjuge,
                        cpf: formatCpfCnpjInput(e.target.value),
                      })
                    }
                    inputMode="numeric"
                    placeholder="000.000.000-00"
                  />
                </Field>
                <Field label="Data de nascimento do cônjuge">
                  <Input
                    type="date"
                    value={conjuge.nascimento}
                    onChange={(e) =>
                      alterar(setConjuge)({ ...conjuge, nascimento: e.target.value })
                    }
                  />
                </Field>
                <Field
                  label="UF do cônjuge"
                  hint="Em branco = mesma UF E mesmo município do cedente."
                >
                  <Select
                    value={conjuge.uf}
                    onChange={(e) =>
                      alterar(setConjuge)({
                        ...conjuge,
                        uf: e.target.value,
                        municipio: '',
                      })
                    }
                  >
                    <option value="">Mesmo endereço do cedente</option>
                    {ufs.map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </Select>
                </Field>
                {conjuge.uf && (
                  <Field label="Município do cônjuge">
                    <Select
                      value={conjuge.municipio}
                      onChange={(e) =>
                        alterar(setConjuge)({ ...conjuge, municipio: e.target.value })
                      }
                    >
                      <option value="">Nenhuma certidão municipal</option>
                      {municipiosDaUf(conjuge.uf).map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}
              </div>
            )}
          </div>

          {impacto.sujeitos.length > 0 && (
            <div className="rounded-lg bg-red-50 p-3 text-xs text-red-800 ring-1 ring-inset ring-red-200">
              Gravar assim REMOVE{' '}
              {impacto.sujeitos.map((s) => `${s.papel} ${s.nome}`).join(', ')} e apaga{' '}
              {impacto.certidoes} item(ns) do checklist
              {impacto.obtidas > 0 && (
                <>
                  , dos quais <strong>{impacto.obtidas} já obtida(s)</strong>
                </>
              )}
              . Vai pedir confirmação.
            </div>
          )}

          {problemas.length > 0 && (
            <ul className="space-y-1 rounded-lg bg-slate-50 p-3 text-xs text-slate-700 ring-1 ring-inset ring-slate-200">
              {problemas.map((p) => (
                <li key={p}>• {p}</li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="space-y-5">
          {/* ---------------- placar ---------------- */}
          {completude && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {[
                { r: 'Obrigatórias', v: completude.necessarias },
                { r: 'Obtidas', v: completude.obtidas_validas },
                { r: 'Pendentes', v: completude.pendentes },
                { r: 'Vencidas', v: completude.vencidas },
                // Dispensadas ao lado das outras quatro, e não escondida: ela SAI
                // do denominador (v_dd_completude), então um placar "14 de 14" com
                // 8 dispensadas é um dossiê fechado sobre 8 certidões que a regra
                // exigia. O número existia no banco e não aparecia na tela.
                { r: 'Dispensadas', v: completude.dispensadas },
              ].map((c) => (
                <div
                  key={c.r}
                  className="rounded-lg bg-slate-50 p-3 ring-1 ring-inset ring-slate-200"
                >
                  <div className="text-xs text-slate-500">{c.r}</div>
                  <div className="text-xl font-semibold text-slate-800">{c.v}</div>
                </div>
              ))}
            </div>
          )}

          {completude && completude.necessarias > 0 && (
            <div className="text-sm">
              {completude.obtidas_validas === completude.necessarias ? (
                <span className="font-medium text-emerald-700">
                  ✅ Documental completa — {completude.obtidas_validas} de{' '}
                  {completude.necessarias}
                  {completude.dispensadas > 0 && (
                    <span className="text-amber-700">
                      {' '}
                      · {completude.dispensadas} dispensada(s) fora da conta
                    </span>
                  )}
                  .
                </span>
              ) : (
                <span className="font-medium text-amber-700">
                  ⏳ {completude.obtidas_validas} de {completude.necessarias} obtidas. A
                  etapa documental não fecha até chegar a {completude.necessarias}.
                </span>
              )}
            </div>
          )}

          {/* ---------------- avisos ---------------- */}
          {avisos.length > 0 && (
            <div className="space-y-1.5 rounded-lg bg-amber-50 p-3 ring-1 ring-inset ring-amber-200">
              {avisos.map((a) => (
                <div key={a} className="flex gap-2 text-xs text-amber-900">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-none" />
                  <span>{a}</span>
                </div>
              ))}
            </div>
          )}

          {/* ---------------- lista por sujeito ---------------- */}
          {sujeitos.map((s) => {
            const lista = porSujeito.get(s.id) ?? []
            return (
              <div key={s.id}>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Badge size="sm" tone="blue">
                    {s.papel}
                  </Badge>
                  <span className="text-sm font-medium text-slate-800">{s.nome}</span>
                  <span className="font-mono text-xs text-slate-500">
                    {formatCpfCnpjInput(s.documento)}
                  </span>
                  <span className="text-xs text-slate-500">
                    {s.municipio_atual ? `${s.municipio_atual}/` : ''}
                    {s.uf_atual ?? 'sem UF'}
                  </span>
                  <span className="text-xs text-slate-500">
                    · {lista.length} item(ns)
                  </span>
                  {!s.residencia_levantada && (
                    <Badge size="sm" tone="yellow">
                      residência não levantada
                    </Badge>
                  )}
                </div>
                <div className="overflow-hidden rounded-lg ring-1 ring-inset ring-slate-200">
                  {lista.length === 0 ? (
                    <div className="p-3 text-xs text-slate-500">
                      Nenhuma certidão gerada para este sujeito.
                    </div>
                  ) : (
                    lista.map((i) => (
                      <div
                        key={i.id}
                        className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-2.5 text-xs last:border-b-0"
                      >
                        <Badge size="sm" tone={TOM_STATUS[i.status] ?? 'gray'}>
                          {i.status}
                        </Badge>
                        <span className="font-medium text-slate-800">
                          {i.certidao_catalogo?.nome_curto ?? i.certidao_codigo}
                        </span>
                        <span className="text-slate-500">
                          {i.certidao_catalogo?.orgao_emissor}
                        </span>
                        {rotuloParametros(i.parametros) && (
                          <span className="text-slate-500">
                            ({rotuloParametros(i.parametros)})
                          </span>
                        )}
                        {!i.obrigatoria && (
                          <Badge size="sm" tone="gray">
                            opcional
                          </Badge>
                        )}
                        {/* A dispensa é o único caminho legítimo para tirar uma
                            obrigatória da conta, e a 0042 exige motivo escrito.
                            Mostrar o motivo aqui é o que torna esse registro
                            auditável por quem lê a tela. */}
                        {i.status === 'NAO_APLICAVEL' && (
                          <span className="text-blue-700">
                            dispensada
                            {i.dispensa_motivo ? `: ${i.dispensa_motivo}` : ' (sem motivo!)'}
                          </span>
                        )}
                        {i.erro_classe && (
                          <span className="text-amber-700">
                            {MOTIVO_MANUAL[i.erro_classe] ?? i.erro_classe}
                            {i.erro_detalhe ? `: ${i.erro_detalhe}` : ''}
                          </span>
                        )}
                        {i.certidao_catalogo?.url_oficial && (
                          <a
                            href={i.certidao_catalogo.url_oficial}
                            target="_blank"
                            rel="noreferrer"
                            className="ml-auto font-medium text-brand-600 hover:underline"
                          >
                            Abrir portal
                          </a>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            )
          })}

          {sujeitos.length === 0 && (
            <div className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">
              Nenhum sujeito cadastrado neste crédito. Clique em{' '}
              <strong>Corrigir dados / cônjuge</strong> para começar pelo cedente.
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}

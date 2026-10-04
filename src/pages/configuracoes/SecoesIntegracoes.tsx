// As seções ADVBOX, Kommo, Anthropic e DJEN das Configurações.

import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Plus, RefreshCw, Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { invokeFunction } from '@/lib/functions'
import { KOMMO_SUBDOMINIO as SUBDOMINIO_PADRAO } from '@/lib/kommo'
import type { ConfigAdvbox, ConfigDjen, ConfigKommo } from '@/lib/types'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select } from '@/components/ui/Field'
import { IconButton } from '@/components/ui/IconButton'
import { Loading } from '@/components/ui/Table'
import { useToast } from '@/components/ui/Toast'
import {
  AvisoLeitura,
  CabecalhoSecao,
  CampoSegredo,
  DUAS_COLUNAS,
  GradeCampos,
  IconeAlerta,
  IconeOk,
  RodapeSecao,
  Selo,
  SeloIntegracao,
} from './comum'
import { configuradoDe, useIntegracao, type ConsultaIntegracao } from './consultas'
import { TRAVA_LEITURA } from '@/lib/menuDasConfiguracoes'

/** Liga e desliga o lápis de "não salvo" da seção no menu. */
export type Pendencia = (sim: boolean) => void

// ----------------------- ADVBOX -----------------------
/** Listas da conta ADVBOX, para as escolhas do cadastro automático. */
interface OpcoesAdvbox {
  users: { id: number | string; name: string }[]
  stages: { id: number | string; name: string }[]
  lawsuit_types: { id: number | string; name: string }[]
  customers: { id: number | string; name: string }[]
}

type CriarProcesso = NonNullable<ConfigAdvbox['criar_processo']>

/**
 * ESCOLHAS FIXAS do cadastro de processo na ADVBOX.
 *
 * A API exige cliente, fase e tipo, mas na operação da Credijuris os três são
 * sempre os mesmos — todo crédito é um cumprimento de sentença, do mesmo cliente,
 * do mesmo tipo. Eram três listas para escolher sempre a mesma coisa, e lista com
 * uma resposta certa é convite a errar por clique.
 *
 * Os ids são da conta da Credijuris, lidos de /settings e /customers. Não são
 * segredo: sem o token da API não abrem nada, e quem tem o token já pode listá-los.
 * Se a ADVBOX recriar uma fase ou um tipo, o id muda e a criação passa a falhar
 * com o erro da API na tela — a correção é trocar o número aqui.
 */
const ADVBOX_FIXO = {
  customers_id: 8795916,
  customer_nome: 'CREDIJURIS',
  stages_id: 2935559,
  stage_nome: 'CUMPRIMENTO DE SENTENÇA',
  type_lawsuits_id: 1562480,
  type_nome: 'CREDJURIS',
} as const

/**
 * A CAIXA TRAVADA SE LÊ (auditoria visual, CF1): o fundo `superficie-3` e o
 * texto `texto-2` do Field já valiam, mas o Chrome ainda põe o <select>
 * desligado a 70% de opacidade, e o "CREDIJURIS" ficava apagado demais. Aqui
 * ele volta inteiro — o fundo cinza já diz que não se mexe.
 */
const SELECT_TRAVADO = 'disabled:opacity-100'

export function SecaoAdvbox({
  consulta,
  pendencia,
}: {
  consulta: ConsultaIntegracao
  pendencia: Pendencia
}) {
  const { data, isLoading, error } = consulta
  const qc = useQueryClient()
  const toast = useToast()
  const [baseUrl, setBaseUrl] = useState('')
  // Cadastro automático do processo. Vive no mesmo registro de integração, e por
  // isso é salvo pelo mesmo botão — dois botões de salvar no mesmo cartão levariam
  // alguém a mexer num campo e clicar no outro.
  const [cp, setCp] = useState<CriarProcesso>({})
  const [opcoes, setOpcoes] = useState<OpcoesAdvbox | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [erroOpcoes, setErroOpcoes] = useState(false)
  const [token, setToken] = useState('')
  const [saving, setSaving] = useState(false)
  // Trocar a chave do campo de segredo depois de salvar o faz voltar à caixa
  // "Configurado".
  const [versaoSegredo, setVersaoSegredo] = useState(0)

  useEffect(() => {
    const cfg = (data?.config as ConfigAdvbox) ?? {}
    setBaseUrl(cfg.base_url ?? '')
    setCp(cfg.criar_processo ?? {})
  }, [data])

  async function carregarOpcoes(silencioso = false) {
    setCarregando(true)
    try {
      const r = await invokeFunction<OpcoesAdvbox>('advbox-processos', {
        action: 'options',
        cliente_nome: 'credijuris',
      })
      setOpcoes(r)
      setErroOpcoes(false)
    } catch (err) {
      setErroOpcoes(true)
      // Carga automática que falha não vira alerta: quem abriu Configurações pode
      // ter vindo mexer no Kommo. A lista de responsáveis fica com o botão de
      // tentar de novo, e é ali que o aviso pertence.
      if (!silencioso) toast.error((err as Error).message)
    } finally {
      setCarregando(false)
    }
  }

  const configurado = configuradoDe(data)
  // LEITURA FALHOU, NADA FOI LIDO: os campos nasceriam vazios, idênticos a "nunca
  // configurado", e o Salvar regravaria a configuração inteira só com os ids fixos
  // — apagando URL, responsável e o cadastro ligado. Sem leitura, sem formulário.
  const naoLido = !!error && data === undefined

  // Busca os responsáveis ao abrir a tela, uma vez, para as três caixas já
  // aparecerem prontas — pedir um clique antes de mostrar o campo era o que fazia
  // este bloco parecer diferente do resto das Configurações. Só com token
  // configurado: sem token a chamada falharia sempre, a cada visita.
  // (A seção fica montada mesmo escondida atrás de outra no menu, então a busca
  // continua acontecendo ao abrir a tela, e não ao clicar em ADVBOX.)
  const buscou = useRef(false)
  useEffect(() => {
    if (buscou.current || !configurado) return
    buscou.current = true
    void carregarOpcoes(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configurado])

  async function salvar() {
    if (naoLido) return
    const url = baseUrl.trim()
    // URL sem esquema (ex.: "app.advbox.com.br/api/v1") vira caminho relativo no
    // fetch do servidor e a integração cai inteira, com erro que não aponta para
    // cá. Barrar na hora de salvar é o único momento em que dá para explicar.
    if (url && !/^https?:\/\//i.test(url)) {
      toast.error('A URL base precisa começar com https://.')
      return
    }
    setSaving(true)
    try {
      // base_url (não secreto) vai direto na tabela integracoes.
      // Campo em branco REMOVE a chave em vez de gravar string vazia: o servidor
      // só cai no endereço padrão quando a chave está ausente (`??` não pega
      // string vazia), e gravar '' derrubava a integração em silêncio.
      const cfg: Record<string, unknown> = { ...(data?.config as object) }
      if (url) cfg.base_url = url
      else delete cfg.base_url
      // Ligar sem responsável gravaria uma configuração que a função recusa a cada
      // crédito salvo, e o motivo ficaria só no retorno da chamada — invisível para
      // quem clicou aqui. Barra no único momento em que dá para explicar. Cliente,
      // fase e tipo não são validados porque não são escolhidos: vêm fixos.
      if (cp.ativo && (cp.users_id == null || cp.users_id === '')) {
        toast.error('Para ligar o cadastro na ADVBOX, escolha o responsável.')
        setSaving(false)
        return
      }
      // Os três fixos são gravados SEMPRE, e não só quando faltam: se um dia o id
      // mudar no código, o próximo salvamento corrige o que está no banco sem
      // ninguém precisar saber que existe essa configuração.
      cfg.criar_processo = { ...cp, ...ADVBOX_FIXO }
      const { error } = await supabase
        .from('integracoes')
        .upsert({ servico: 'advbox', config: cfg, ativo: true }, { onConflict: 'servico' })
      if (error) throw new Error(error.message)

      // token (secreto) vai via Edge Function admin-only
      if (token.trim()) {
        await invokeFunction('salvar-token-advbox', { token: token.trim() })
        setToken('')
        setVersaoSegredo((v) => v + 1)
      }
      await qc.invalidateQueries({ queryKey: ['integracoes', 'advbox'] })
      toast.success('Configurações do ADVBOX salvas.')
      pendencia(false)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <CabecalhoSecao
        titulo="Integração ADVBOX"
        direita={
          <SeloIntegracao
            error={error}
            configurado={configurado}
            rotuloOk="Token configurado"
            rotuloSem="Sem token"
          />
        }
      />
      <AvisoLeitura error={error} />
      {isLoading ? (
        <Loading />
      ) : naoLido ? null : (
        <>
          <GradeCampos>
            <Field
              label="URL base da API"
              hint="Ex.: https://app.advbox.com.br/api/v1 (confirme na sua conta)."
              className={DUAS_COLUNAS}
            >
              <Input
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://app.advbox.com.br/api/v1"
              />
            </Field>
            <CampoSegredo
              key={versaoSegredo}
              rotulo="Token de API (Bearer)"
              configurado={configurado}
              lido={!error}
              dicaConfigurado="Já configurado. Preencha apenas para substituir."
              dicaNovo="Obtido em Configurações > Integrações e API no ADVBOX."
              valor={token}
              aoMudar={setToken}
            />
          </GradeCampos>

          {/* CADASTRO AUTOMÁTICO DO PROCESSO.
              A ADVBOX só traz movimentações de processo cadastrado nela, e
              crédito esquecido lá fica sem andamento sem que nada acuse: a aba
              Movimentações apenas não mostra aquele processo, o que é igual a
              "não houve movimentação". Daí automatizar em vez de confiar na
              lembrança.

              As quatro escolhas são exigência da API — ela recusa a criação sem
              cliente, responsável, fase e tipo. Vêm em lista, da própria conta,
              porque pedir ID digitado seria pedir para errar. */}
          <div className="mt-[16px]">
            <label className="inline-flex cursor-pointer items-center gap-s2 text-corpo font-semibold text-texto">
              <input
                type="checkbox"
                className="h-[16px] w-[16px] accent-marca"
                checked={!!cp.ativo}
                onChange={(e) => setCp({ ...cp, ativo: e.target.checked })}
              />
              Cadastro de créditos no ADVBOX
            </label>
            <p className="mb-[10px] mt-s1 text-xs text-texto-3">
              Todo crédito, requerimento ou apenso novo vira um processo no ADVBOX, com o
              cliente e a fase abaixo.
            </p>

            {/* TRÊS CAIXAS LADO A LADO, e as duas primeiras desabilitadas.
                Cliente e fase são sempre os mesmos, mas aparecem como campo e não
                como texto porque a linha das três caixas é o que faz este bloco
                parecer com o resto das Configurações. O tipo saiu da tela — ele
                continua sendo enviado à ADVBOX, fixo, só não ocupa espaço numa
                escolha que não existe. */}
            <div className="grid grid-cols-[minmax(0,1fr)] gap-x-[16px] gap-y-[12px] min-[900px]:grid-cols-[repeat(3,minmax(0,1fr))]">
              <Field label="Cliente">
                <Select value="fixo" disabled onChange={() => {}} className={SELECT_TRAVADO}>
                  <option value="fixo">{ADVBOX_FIXO.customer_nome}</option>
                </Select>
              </Field>
              <Field label="Fase processual">
                <Select value="fixo" disabled onChange={() => {}} className={SELECT_TRAVADO}>
                  <option value="fixo">{ADVBOX_FIXO.stage_nome}</option>
                </Select>
              </Field>
              <Field label="Responsável">
                {opcoes ? (
                  <Select
                    value={String(cp.users_id ?? '')}
                    onChange={(e) => {
                      const achado = opcoes.users.find((u) => String(u.id) === e.target.value)
                      setCp({
                        ...cp,
                        users_id: e.target.value || undefined,
                        user_nome: achado?.name,
                      })
                    }}
                  >
                    <option value="">Escolha…</option>
                    {opcoes.users.map((u) => (
                      <option key={u.id} value={String(u.id)}>
                        {u.name}
                      </option>
                    ))}
                  </Select>
                ) : (
                  // Lista ainda não veio: a caixa mostra o que está salvo e fica
                  // travada. Select vazio e habilitado permitiria salvar por cima
                  // do responsável configurado com "nenhum" — perder configuração
                  // por causa de uma falha de rede seria o pior desfecho aqui.
                  <Select value="atual" disabled onChange={() => {}} className={SELECT_TRAVADO}>
                    <option value="atual">
                      {carregando
                        ? 'Carregando…'
                        : cp.user_nome ||
                          (cp.users_id ? 'Responsável configurado' : 'Não configurado')}
                    </option>
                  </Select>
                )}
              </Field>
            </div>

            {erroOpcoes && !opcoes && (
              <div className="mt-[8px] flex flex-wrap items-center gap-s2">
                <Button
                  variant="secondary"
                  icon={<RefreshCw className="h-[14px] w-[14px]" />}
                  onClick={() => carregarOpcoes()}
                  loading={carregando}
                >
                  Carregar responsáveis
                </Button>
                <span className="text-xs text-texto-3">
                  Não consegui buscar a lista de responsáveis na ADVBOX agora.
                </span>
              </div>
            )}
          </div>
        </>
      )}
      {!isLoading && (
        <RodapeSecao>
          <Button
            onClick={salvar}
            loading={saving}
            disabled={naoLido}
            title={naoLido ? TRAVA_LEITURA : undefined}
          >
            Salvar
          </Button>
        </RodapeSecao>
      )}
    </>
  )
}

// ----------------------- KOMMO -----------------------
// O Kommo é o CRM em kanban onde o comercial cria os cards de análise de
// crédito. Precisa de DUAS informações, não só do token: a API resolve a conta
// pelo host (https://<subdominio>.kommo.com), então subdomínio errado devolve
// 401 mesmo com token correto — daí a validação ao salvar.
export function SecaoKommo({
  consulta,
  pendencia,
}: {
  consulta: ConsultaIntegracao
  pendencia: Pendencia
}) {
  const { data, isLoading, error } = consulta
  const qc = useQueryClient()
  const toast = useToast()
  const [subdominio, setSubdominio] = useState('')
  const [token, setToken] = useState('')
  const [saving, setSaving] = useState(false)
  const [versaoSegredo, setVersaoSegredo] = useState(0)

  useEffect(() => {
    const cfg = (data?.config as ConfigKommo) ?? {}
    // Pré-preenche com a conta da Credijuris: é sempre a mesma, e digitar
    // subdomínio errado dá 401 confuso (a API resolve a conta pelo host).
    // Continua editável para o caso de a conta mudar.
    setSubdominio(cfg.subdominio ?? SUBDOMINIO_PADRAO)
  }, [data])

  const cfg = (data?.config as ConfigKommo) ?? {}
  const configurado = Boolean(cfg.configurado)

  async function salvar() {
    if (!subdominio.trim()) {
      toast.error('Informe o subdomínio da conta Kommo.')
      return
    }
    if (!configurado && !token.trim()) {
      toast.error('Informe o token de longa duração do Kommo.')
      return
    }
    setSaving(true)
    try {
      // Token e subdomínio vão juntos pela Edge Function admin-only: o token
      // nunca passa pela tabela integracoes (que é legível pelo cliente).
      const r = await invokeFunction<{ validado: boolean; aviso: string | null }>(
        'salvar-token-kommo',
        {
          subdominio: subdominio.trim(),
          ...(token.trim() ? { token: token.trim() } : {}),
        },
      )
      setToken('')
      setVersaoSegredo((v) => v + 1)
      await qc.invalidateQueries({ queryKey: ['integracoes', 'kommo'] })
      // OS TRÊS DESFECHOS: verificado, recusado com o aviso do servidor, ou salvo
      // sem validar. Nos três a gravação aconteceu — daí o lápis sair em todos.
      if (r?.validado) toast.success('Kommo salvo e conexão verificada.')
      else if (r?.aviso) toast.error(r.aviso)
      else toast.success('Kommo salvo.')
      pendencia(false)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <CabecalhoSecao
        titulo="Integração Kommo"
        direita={
          error ? (
            <Selo tom="alerta" icone={IconeAlerta}>
              Estado não carregado
            </Selo>
          ) : configurado ? (
            cfg.validado ? (
              <Selo tom="ok" icone={IconeOk}>
                Conexão verificada
              </Selo>
            ) : (
              <Selo tom="alerta" icone={IconeAlerta}>
                Salvo, sem conexão
              </Selo>
            )
          ) : (
            <Selo tom="neutro">
              Não configurado
            </Selo>
          )
        }
      />
      <AvisoLeitura error={error} />
      {isLoading ? (
        <Loading />
      ) : (
        <>
          <GradeCampos>
            <Field
              label="Subdomínio da conta"
              hint="O que aparece antes de .kommo.com. Pode colar a URL inteira."
            >
              <Input
                value={subdominio}
                onChange={(e) => setSubdominio(e.target.value)}
                placeholder="minhaconta"
                autoComplete="off"
              />
            </Field>
            <CampoSegredo
              key={versaoSegredo}
              rotulo="Token de longa duração"
              configurado={configurado}
              lido={!error}
              dicaConfigurado="Já configurado. Preencha apenas para substituir."
              dicaNovo="Kommo > Configurações > Integrações > criar integração privada."
              valor={token}
              aoMudar={setToken}
            />
          </GradeCampos>
          {/* Sem botão de sincronizar aqui: o cron roda de 5 em 5 min e a
              aba Análise de Crédito sincroniza ao abrir. Um terceiro gatilho
              nesta tela só serviria para depurar a integração. */}
          <RodapeSecao>
            <Button onClick={salvar} loading={saving}>
              Salvar
            </Button>
          </RodapeSecao>
        </>
      )}
    </>
  )
}

// ----------------------- Anthropic (assistente) -----------------------
// Só a chave, sem campo de configuração: ao contrário do ADVBOX (URL base) e do
// Kommo (subdomínio), a API da Anthropic tem endereço único.
export function SecaoAnthropic({
  consulta,
  pendencia,
}: {
  consulta: ConsultaIntegracao
  pendencia: Pendencia
}) {
  const { data, isLoading, error } = consulta
  const qc = useQueryClient()
  const toast = useToast()
  const [token, setToken] = useState('')
  const [saving, setSaving] = useState(false)
  const [versaoSegredo, setVersaoSegredo] = useState(0)

  const configurado = configuradoDe(data)

  async function salvar() {
    if (!token.trim()) {
      toast.error('Informe a chave da API.')
      return
    }
    setSaving(true)
    try {
      // A chave é secreta, então vai só pela Edge Function admin-only — nunca
      // pela tabela integracoes, que é legível por qualquer autenticado.
      await invokeFunction('salvar-token-anthropic', { token: token.trim() })
      setToken('')
      setVersaoSegredo((v) => v + 1)
      await qc.invalidateQueries({ queryKey: ['integracoes', 'anthropic'] })
      toast.success('Chave da Anthropic salva. O assistente já pode ser usado.')
      pendencia(false)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <CabecalhoSecao
        titulo="Integração Anthropic"
        direita={
          <SeloIntegracao
            error={error}
            configurado={configurado}
            rotuloOk="Chave configurada"
            rotuloSem="Sem chave"
          />
        }
      />
      <AvisoLeitura error={error} />
      {isLoading ? (
        <Loading />
      ) : (
        <>
          <GradeCampos>
            <CampoSegredo
              key={versaoSegredo}
              rotulo="Chave de API"
              configurado={configurado}
              lido={!error}
              dicaConfigurado="Já configurada. Preencha apenas para substituir."
              dicaNovo='Gerada em console.anthropic.com > API Keys. Começa com "sk-ant-".'
              valor={token}
              aoMudar={setToken}
            />
          </GradeCampos>
          <RodapeSecao>
            <Button onClick={salvar} loading={saving}>
              Salvar
            </Button>
          </RodapeSecao>
        </>
      )}
    </>
  )
}

// ----------------------- DJEN -----------------------
const UFS = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG',
  'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE',
  'TO',
]

interface OabItem {
  uf: string
  numero: string
}

export function SecaoDjen({ pendencia }: { pendencia: Pendencia }) {
  const { data, isLoading, error } = useIntegracao('djen')
  const qc = useQueryClient()
  const toast = useToast()
  const [itens, setItens] = useState<OabItem[]>([])
  const [saving, setSaving] = useState(false)
  const lista = useRef<HTMLDivElement>(null)
  // A OAB INCLUÍDA GANHA O FOCO: quem clicou em "Adicionar OAB" vai digitar o
  // número em seguida.
  const focarUltima = useRef(false)

  useEffect(() => {
    const cfg = (data?.config as ConfigDjen) ?? {}
    const parsed = (cfg.oabs ?? [])
      .map((s) => {
        const m = String(s).match(/(\d+)\s*\/?\s*([A-Za-z]{2})?/)
        return { numero: m?.[1] ?? '', uf: (m?.[2] ?? 'GO').toUpperCase() }
      })
      .filter((o) => o.numero)
    setItens(parsed)
  }, [data])

  useEffect(() => {
    if (!focarUltima.current) return
    focarUltima.current = false
    const campos = lista.current?.querySelectorAll<HTMLInputElement>('input')
    campos?.[campos.length - 1]?.focus()
  }, [itens])

  const setOab = (i: number, patch: Partial<OabItem>) =>
    setItens((l) => l.map((o, idx) => (idx === i ? { ...o, ...patch } : o)))
  const addOab = () => {
    focarUltima.current = true
    setItens((l) => [...l, { uf: 'GO', numero: '' }])
    pendencia(true)
  }
  const removeOab = (i: number) => {
    setItens((l) => l.filter((_, idx) => idx !== i))
    pendencia(true)
  }

  // LEITURA FALHOU, NADA FOI LIDO: a lista nasceria vazia, dizendo "Nenhuma OAB
  // cadastrada", e o Salvar gravaria a lista vazia por cima das OABs reais — a
  // busca no DJEN pararia em silêncio. Sem leitura, sem formulário.
  const naoLido = !!error && data === undefined

  async function salvar() {
    if (naoLido) return
    setSaving(true)
    try {
      const oabs = itens
        .map((o) => ({ uf: o.uf, numero: o.numero.replace(/\D/g, '') }))
        .filter((o) => o.numero)
        .map((o) => `${o.numero}/${o.uf}`)
      // Janela fixa de 30 dias.
      const cfg: ConfigDjen = { oabs, dias_retroativos: 30 }
      const { error } = await supabase
        .from('integracoes')
        .upsert({ servico: 'djen', config: cfg, ativo: true }, { onConflict: 'servico' })
      if (error) throw new Error(error.message)
      await qc.invalidateQueries({ queryKey: ['integracoes', 'djen'] })
      toast.success('OABs salvas.')
      pendencia(false)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <CabecalhoSecao
        titulo="Integração DJEN"
        apoio="As OABs cujas publicações a plataforma acompanha."
      />
      <AvisoLeitura error={error} />
      {isLoading ? (
        <Loading />
      ) : (
        <>
          {!naoLido && (
            <div ref={lista} className="space-y-[8px]">
              {itens.length === 0 && (
                <p className="text-corpo text-texto-2">Nenhuma OAB cadastrada.</p>
              )}
              {itens.map((o, i) => (
                // 120px, não menos: o <select> reserva pr-8 para a setinha, e com
                // menos largura a sigla saía cortada ("MG" virava "MC"). OS
                // RÓTULOS SÓ NA PRIMEIRA LINHA; as outras levam o nome no
                // aria-label, para o leitor de tela não anunciar "edição, em branco".
                <div
                  key={i}
                  className="grid grid-cols-[120px_minmax(0,1fr)_32px] items-end gap-x-[16px]"
                >
                  <Field label={i === 0 ? 'UF' : undefined}>
                    <Select
                      value={o.uf}
                      onChange={(e) => setOab(i, { uf: e.target.value })}
                      aria-label={i === 0 ? undefined : 'UF'}
                    >
                      {UFS.map((uf) => (
                        <option key={uf} value={uf}>
                          {uf}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label={i === 0 ? 'Número da OAB' : undefined}>
                    <Input
                      value={o.numero}
                      inputMode="numeric"
                      placeholder="Somente números (ex.: 54162)"
                      aria-label={i === 0 ? undefined : 'Número da OAB'}
                      onChange={(e) => setOab(i, { numero: e.target.value.replace(/\D/g, '') })}
                    />
                  </Field>
                  <IconButton
                    label="Remover OAB"
                    variant="danger"
                    className="inline-flex h-[35px] w-[32px] items-center justify-center p-0"
                    icon={<Trash2 className="h-[16px] w-[16px]" />}
                    onClick={() => removeOab(i)}
                  />
                </div>
              ))}
            </div>
          )}
          <RodapeSecao>
            <Button
              variant="secondary"
              icon={<Plus className="h-[14px] w-[14px]" />}
              onClick={addOab}
              disabled={naoLido}
            >
              Adicionar OAB
            </Button>
            <Button
              onClick={salvar}
              loading={saving}
              disabled={naoLido}
              title={naoLido ? TRAVA_LEITURA : undefined}
            >
              Salvar
            </Button>
          </RodapeSecao>
        </>
      )}
    </>
  )
}

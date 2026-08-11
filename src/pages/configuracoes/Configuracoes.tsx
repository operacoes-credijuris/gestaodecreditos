import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  KeyRound,
  KanbanSquare,
  Newspaper,
  Users,
  Plus,
  Trash2,
  CheckCircle2,
  XCircle,
  ShieldCheck,
  Pencil,
  Sparkles,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { invokeFunction } from '@/lib/functions'
import { KOMMO_SUBDOMINIO as SUBDOMINIO_PADRAO } from '@/lib/kommo'
import type {
  Integracao,
  Profile,
  ConfigAdvbox,
  ConfigAnthropic,
  ConfigDjen,
  ConfigKommo,
  ServicoIntegracao,
} from '@/lib/types'
import { ADMIN_EMAIL } from '@/contexts/AuthContext'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader, CardBody } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Field, Input, Select } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { IconButton } from '@/components/ui/IconButton'
import {
  Table,
  THead,
  TH,
  TBody,
  TR,
  TD,
  Loading,
} from '@/components/ui/Table'
import { useToast } from '@/components/ui/Toast'

export default function Configuracoes() {
  return (
    <div>
      <PageHeader title="Configurações" />
      <div className="space-y-6">
        <AdvboxConfig />
        <KommoConfig />
        <AnthropicConfig />
        <DjenConfig />
        <UsuariosConfig />
      </div>
    </div>
  )
}

/**
 * Falha de LEITURA não pode se disfarçar de "não configurado". Sem este aviso, o
 * selo do cartão dizia "Sem token" quando o que houve foi erro ao consultar a
 * tabela — e o administrador ia recadastrar token que já estava lá, ou pior,
 * concluir que a integração caiu quando o problema era outro.
 */
function AvisoLeitura({ error }: { error: unknown }) {
  if (!error) return null
  return (
    <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
      Não foi possível ler o estado atual desta integração:{' '}
      {(error as Error).message}
    </p>
  )
}

/** Selo dos cartões de integração, com o estado "não deu para saber". */
function SeloIntegracao({
  error,
  configurado,
  rotuloOk,
  rotuloSem,
}: {
  error: unknown
  configurado: boolean
  rotuloOk: string
  rotuloSem: string
}) {
  if (error)
    return (
      <Badge tone="amber">
        <XCircle className="mr-1 inline h-3.5 w-3.5" /> Estado não carregado
      </Badge>
    )
  return configurado ? (
    <Badge tone="green">
      <CheckCircle2 className="mr-1 inline h-3.5 w-3.5" /> {rotuloOk}
    </Badge>
  ) : (
    <Badge tone="gray">
      <XCircle className="mr-1 inline h-3.5 w-3.5" /> {rotuloSem}
    </Badge>
  )
}

function useIntegracao(servico: ServicoIntegracao) {
  return useQuery({
    queryKey: ['integracoes', servico],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('integracoes')
        .select('*')
        .eq('servico', servico)
        .maybeSingle()
      if (error) throw new Error(error.message)
      return (data as Integracao) ?? null
    },
  })
}

// ----------------------- Anthropic (assistente) -----------------------
// Só a chave, sem campo de configuração: ao contrário do ADVBOX (URL base) e do
// Kommo (subdomínio), a API da Anthropic tem endereço único.
function AnthropicConfig() {
  const { data, isLoading, error } = useIntegracao('anthropic')
  const qc = useQueryClient()
  const toast = useToast()
  const [token, setToken] = useState('')
  const [saving, setSaving] = useState(false)

  const configurado = Boolean((data?.config as ConfigAnthropic)?.configurado)

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
      await qc.invalidateQueries({ queryKey: ['integracoes', 'anthropic'] })
      toast.success('Chave da Anthropic salva. O assistente já pode ser usado.')
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-brand-600" /> Integração Anthropic
          </span>
        }
        action={
          <SeloIntegracao
            error={error}
            configurado={configurado}
            rotuloOk="Chave configurada"
            rotuloSem="Sem chave"
          />
        }
      />
      <CardBody>
        <AvisoLeitura error={error} />
        {isLoading ? (
          <Loading />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Chave de API"
              hint={
                configurado
                  ? 'Já configurada. Preencha apenas para substituir.'
                  : 'Gerada em console.anthropic.com > API Keys. Começa com "sk-ant-".'
              }
            >
              <Input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="••••••••••••"
                autoComplete="off"
              />
            </Field>
            <div className="sm:col-span-2">
              <Button onClick={salvar} loading={saving}>
                Salvar
              </Button>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  )
}

// ----------------------- ADVBOX -----------------------
function AdvboxConfig() {
  const { data, isLoading, error } = useIntegracao('advbox')
  const qc = useQueryClient()
  const toast = useToast()
  const [baseUrl, setBaseUrl] = useState('')
  const [token, setToken] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const cfg = (data?.config as ConfigAdvbox) ?? {}
    setBaseUrl(cfg.base_url ?? '')
  }, [data])

  const configurado = Boolean((data?.config as { configurado?: boolean })?.configurado)

  async function salvar() {
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
      const { error } = await supabase
        .from('integracoes')
        .upsert({ servico: 'advbox', config: cfg, ativo: true }, { onConflict: 'servico' })
      if (error) throw new Error(error.message)

      // token (secreto) vai via Edge Function admin-only
      if (token.trim()) {
        await invokeFunction('salvar-token-advbox', { token: token.trim() })
        setToken('')
      }
      await qc.invalidateQueries({ queryKey: ['integracoes', 'advbox'] })
      toast.success('Configurações do ADVBOX salvas.')
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-brand-600" /> Integração ADVBOX
          </span>
        }
        action={
          <SeloIntegracao
            error={error}
            configurado={configurado}
            rotuloOk="Token configurado"
            rotuloSem="Sem token"
          />
        }
      />
      <CardBody>
        <AvisoLeitura error={error} />
        {isLoading ? (
          <Loading />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="URL base da API"
              hint="Ex.: https://app.advbox.com.br/api/v1 (confirme na sua conta)."
            >
              <Input
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://app.advbox.com.br/api/v1"
              />
            </Field>
            <Field
              label="Token de API (Bearer)"
              hint={
                configurado
                  ? 'Já configurado. Preencha apenas para substituir.'
                  : 'Obtido em Configurações > Integrações e API no ADVBOX.'
              }
            >
              <Input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="••••••••••••"
                autoComplete="off"
              />
            </Field>
            <div className="sm:col-span-2">
              <Button onClick={salvar} loading={saving}>
                Salvar
              </Button>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  )
}

// ----------------------- KOMMO -----------------------
// O Kommo é o CRM em kanban onde o comercial cria os cards de análise de
// crédito. Precisa de DUAS informações, não só do token: a API resolve a conta
// pelo host (https://<subdominio>.kommo.com), então subdomínio errado devolve
// 401 mesmo com token correto — daí a validação ao salvar.
function KommoConfig() {
  const { data, isLoading, error } = useIntegracao('kommo')
  const qc = useQueryClient()
  const toast = useToast()
  const [subdominio, setSubdominio] = useState('')
  const [token, setToken] = useState('')
  const [saving, setSaving] = useState(false)

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
      await qc.invalidateQueries({ queryKey: ['integracoes', 'kommo'] })
      if (r?.validado) toast.success('Kommo salvo e conexão verificada.')
      else if (r?.aviso) toast.error(r.aviso)
      else toast.success('Kommo salvo.')
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <KanbanSquare className="h-5 w-5 text-brand-600" /> Integração Kommo
          </span>
        }
        action={
          error ? (
            <Badge tone="amber">
              <XCircle className="mr-1 inline h-3.5 w-3.5" /> Estado não carregado
            </Badge>
          ) : configurado ? (
            cfg.validado ? (
              <Badge tone="green">
                <CheckCircle2 className="mr-1 inline h-3.5 w-3.5" /> Conexão verificada
              </Badge>
            ) : (
              <Badge tone="amber">
                <XCircle className="mr-1 inline h-3.5 w-3.5" /> Salvo, sem conexão
              </Badge>
            )
          ) : (
            <Badge tone="gray">
              <XCircle className="mr-1 inline h-3.5 w-3.5" /> Não configurado
            </Badge>
          )
        }
      />
      <CardBody>
        <AvisoLeitura error={error} />
        {isLoading ? (
          <Loading />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
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
            <Field
              label="Token de longa duração"
              hint={
                configurado
                  ? 'Já configurado. Preencha apenas para substituir.'
                  : 'Kommo > Configurações > Integrações > criar integração privada.'
              }
            >
              <Input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="••••••••••••"
                autoComplete="off"
              />
            </Field>
            {/* Sem botão de sincronizar aqui: o cron roda de 15 em 15 min e a
                aba Análise de Crédito sincroniza ao abrir. Um terceiro gatilho
                nesta tela só serviria para depurar a integração. */}
            <div className="sm:col-span-2">
              <Button onClick={salvar} loading={saving}>
                Salvar
              </Button>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
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

function DjenConfig() {
  const { data, isLoading, error } = useIntegracao('djen')
  const qc = useQueryClient()
  const toast = useToast()
  const [itens, setItens] = useState<OabItem[]>([])
  const [saving, setSaving] = useState(false)

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

  const setOab = (i: number, patch: Partial<OabItem>) =>
    setItens((l) => l.map((o, idx) => (idx === i ? { ...o, ...patch } : o)))
  const addOab = () => setItens((l) => [...l, { uf: 'GO', numero: '' }])
  const removeOab = (i: number) =>
    setItens((l) => l.filter((_, idx) => idx !== i))

  async function salvar() {
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
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Newspaper className="h-5 w-5 text-brand-600" /> Integração DJEN
          </span>
        }
      />
      <CardBody>
        <AvisoLeitura error={error} />
        {isLoading ? (
          <Loading />
        ) : (
          <div className="space-y-3">
            {itens.length === 0 && (
              <p className="text-sm text-slate-600">Nenhuma OAB cadastrada.</p>
            )}
            {itens.map((o, i) => (
              <div key={i} className="flex items-end gap-2">
                <Field label={i === 0 ? 'UF' : undefined} className="w-24">
                  <Select value={o.uf} onChange={(e) => setOab(i, { uf: e.target.value })}>
                    {UFS.map((uf) => (
                      <option key={uf} value={uf}>
                        {uf}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field
                  label={i === 0 ? 'Número da OAB' : undefined}
                  className="flex-1"
                >
                  <Input
                    value={o.numero}
                    inputMode="numeric"
                    placeholder="Somente números (ex.: 54162)"
                    onChange={(e) =>
                      setOab(i, { numero: e.target.value.replace(/\D/g, '') })
                    }
                  />
                </Field>
                <Button
                  variant="ghost"
                  onClick={() => removeOab(i)}
                  title="Remover OAB"
                  icon={<Trash2 className="h-4 w-4" />}
                />
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              icon={<Plus className="h-4 w-4" />}
              onClick={addOab}
            >
              Adicionar OAB
            </Button>
            <div className="pt-1">
              <Button onClick={salvar} loading={saving}>
                Salvar
              </Button>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  )
}

// ----------------------- Usuários -----------------------
function UsuariosConfig() {
  const qc = useQueryClient()
  const toast = useToast()
  const { data, isLoading, error } = useQuery({
    queryKey: ['profiles'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: true })
      if (error) throw new Error(error.message)
      return (data as Profile[]) ?? []
    },
  })

  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ email: '', nome: '', password: '', role: 'usuario' })
  const [saving, setSaving] = useState(false)
  // Edição de usuário existente. O nome importa além do cadastro: é ele que
  // assina as anotações que a plataforma grava nos cards do Kommo.
  const [editando, setEditando] = useState<Profile | null>(null)
  const [edicao, setEdicao] = useState({ nome: '', email: '', password: '' })

  function abrirEdicao(p: Profile) {
    setEditando(p)
    // Senha em branco: o campo só é enviado se for preenchido.
    setEdicao({ nome: p.nome ?? '', email: p.email, password: '' })
  }

  async function salvarEdicao() {
    if (!editando) return
    if (!edicao.email.trim()) {
      toast.error('Informe o e-mail.')
      return
    }
    if (edicao.password && edicao.password.length < 6) {
      toast.error('A senha precisa ter ao menos 6 caracteres.')
      return
    }
    setSaving(true)
    try {
      // Vai por Edge Function porque e-mail e senha vivem no Supabase Auth, e
      // alterá-los exige a Admin API.
      await invokeFunction('admin-update-user', {
        userId: editando.id,
        nome: edicao.nome.trim(),
        email: edicao.email.trim(),
        ...(edicao.password ? { password: edicao.password } : {}),
      })
      await qc.invalidateQueries({ queryKey: ['profiles'] })
      toast.success('Usuário atualizado.')
      setEditando(null)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function criar() {
    if (!form.email.trim() || !form.password) {
      toast.error('Informe e-mail e senha.')
      return
    }
    setSaving(true)
    try {
      await invokeFunction('admin-create-user', {
        email: form.email.trim(),
        password: form.password,
        nome: form.nome.trim(),
        role: form.role,
      })
      await qc.invalidateQueries({ queryKey: ['profiles'] })
      toast.success('Usuário criado.')
      setOpen(false)
      setForm({ email: '', nome: '', password: '', role: 'usuario' })
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function toggleAtivo(p: Profile) {
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ ativo: !p.ativo })
        .eq('id', p.id)
      if (error) throw new Error(error.message)
      await qc.invalidateQueries({ queryKey: ['profiles'] })
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Users className="h-5 w-5 text-brand-600" /> Usuários
          </span>
        }
        action={
          <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setOpen(true)}>
            Novo usuário
          </Button>
        }
      />
      <CardBody className="p-0">
        {/* Erro antes de tudo: tabela vazia por falha de leitura era
            indistinguível de "não há usuário cadastrado". */}
        {error ? (
          <p className="m-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Não foi possível carregar os usuários: {(error as Error).message}
          </p>
        ) : isLoading ? (
          <Loading />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Nome</TH>
                <TH>E-mail</TH>
                <TH>Perfil</TH>
                <TH>Situação</TH>
                <TH className="w-[1%] whitespace-nowrap">Ações</TH>
              </tr>
            </THead>
            <TBody>
              {(data ?? []).map((p) => {
                const admin = p.role === 'admin' || p.email === ADMIN_EMAIL
                return (
                  <TR key={p.id}>
                    <TD className="font-medium text-slate-800">{p.nome || '—'}</TD>
                    <TD>{p.email}</TD>
                    <TD>
                      {admin ? (
                        <Badge tone="purple">
                          <ShieldCheck className="mr-1 inline h-3.5 w-3.5" /> Administrador
                        </Badge>
                      ) : (
                        <Badge tone="gray">Usuário</Badge>
                      )}
                    </TD>
                    <TD>
                      <Badge tone={p.ativo ? 'green' : 'red'}>
                        {p.ativo ? 'Ativo' : 'Inativo'}
                      </Badge>
                    </TD>
                    <TD className="whitespace-nowrap text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {!admin && (
                          <Button size="sm" variant="outline" onClick={() => toggleAtivo(p)}>
                            {p.ativo ? 'Desativar' : 'Ativar'}
                          </Button>
                        )}
                        <IconButton
                          label="Editar usuário"
                          icon={<Pencil className="h-4 w-4" />}
                          onClick={() => abrirEdicao(p)}
                        />
                      </div>
                    </TD>
                  </TR>
                )
              })}
            </TBody>
          </Table>
        )}
      </CardBody>

      <Modal
        open={!!editando}
        onClose={() => setEditando(null)}
        title="Editar usuário"
        footer={
          <>
            <Button variant="outline" onClick={() => setEditando(null)}>
              Cancelar
            </Button>
            <Button onClick={salvarEdicao} loading={saving}>
              Salvar
            </Button>
          </>
        }
      >
        {editando && (
          <div className="space-y-4">
            <Field
              label="Nome"
              hint="Assina as anotações que a plataforma grava nos cards do Kommo."
            >
              <Input
                value={edicao.nome}
                onChange={(e) => setEdicao({ ...edicao, nome: e.target.value })}
                placeholder="Nome completo"
              />
            </Field>
            <Field label="E-mail" required>
              <Input
                type="email"
                value={edicao.email}
                onChange={(e) => setEdicao({ ...edicao, email: e.target.value })}
              />
            </Field>
            <Field
              label="Nova senha"
              hint="Deixe em branco para manter a senha atual. Mínimo de 6 caracteres."
            >
              <Input
                type="password"
                value={edicao.password}
                onChange={(e) => setEdicao({ ...edicao, password: e.target.value })}
                placeholder="••••••••"
                autoComplete="new-password"
              />
            </Field>
          </div>
        )}
      </Modal>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Novo usuário"
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={criar} loading={saving}>
              Criar usuário
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Nome">
            <Input
              value={form.nome}
              onChange={(e) => setForm({ ...form, nome: e.target.value })}
            />
          </Field>
          <Field label="E-mail" required>
            <Input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </Field>
          <Field label="Senha" required hint="Mínimo de 6 caracteres.">
            <Input
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </Field>
          <Field label="Perfil" required>
            <Select
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
            >
              <option value="usuario">Usuário</option>
              <option value="admin">Administrador</option>
            </Select>
          </Field>
        </div>
      </Modal>
    </Card>
  )
}

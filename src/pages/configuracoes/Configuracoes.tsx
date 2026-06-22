import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  KeyRound,
  Newspaper,
  Users,
  Plus,
  CheckCircle2,
  XCircle,
  ShieldCheck,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { invokeFunction } from '@/lib/functions'
import type { Integracao, Profile, ConfigAdvbox, ConfigDjen } from '@/lib/types'
import { ADMIN_EMAIL } from '@/contexts/AuthContext'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader, CardBody } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Field, Input, Select } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
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
      <PageHeader
        title="Configurações"
        description="Integrações (ADVBOX e DJEN) e gestão de usuários do sistema."
      />
      <div className="space-y-6">
        <AdvboxConfig />
        <DjenConfig />
        <UsuariosConfig />
      </div>
    </div>
  )
}

function useIntegracao(servico: 'advbox' | 'djen') {
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

// ----------------------- ADVBOX -----------------------
function AdvboxConfig() {
  const { data, isLoading } = useIntegracao('advbox')
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
    setSaving(true)
    try {
      // base_url (não secreto) vai direto na tabela integracoes
      const cfg = { ...(data?.config as object), base_url: baseUrl }
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
        description="Token de API (mantido em segredo no servidor) e URL base."
        action={
          configurado ? (
            <Badge tone="green">
              <CheckCircle2 className="mr-1 inline h-3.5 w-3.5" /> Token configurado
            </Badge>
          ) : (
            <Badge tone="gray">
              <XCircle className="mr-1 inline h-3.5 w-3.5" /> Sem token
            </Badge>
          )
        }
      />
      <CardBody>
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
                Salvar ADVBOX
              </Button>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  )
}

// ----------------------- DJEN -----------------------
function DjenConfig() {
  const { data, isLoading } = useIntegracao('djen')
  const qc = useQueryClient()
  const toast = useToast()
  const [oabs, setOabs] = useState('')
  const [numeros, setNumeros] = useState('')
  const [tribunais, setTribunais] = useState('')
  const [dias, setDias] = useState('7')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const cfg = (data?.config as ConfigDjen) ?? {}
    setOabs((cfg.oabs ?? []).join(', '))
    setNumeros((cfg.numeros_processo ?? []).join(', '))
    setTribunais((cfg.tribunais ?? []).join(', '))
    setDias(String(cfg.dias_retroativos ?? 7))
  }, [data])

  function parseList(v: string) {
    return v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  }

  async function salvar() {
    setSaving(true)
    try {
      const cfg: ConfigDjen = {
        oabs: parseList(oabs),
        numeros_processo: parseList(numeros),
        tribunais: parseList(tribunais),
        dias_retroativos: Number(dias) || 7,
      }
      const { error } = await supabase
        .from('integracoes')
        .upsert({ servico: 'djen', config: cfg, ativo: true }, { onConflict: 'servico' })
      if (error) throw new Error(error.message)
      await qc.invalidateQueries({ queryKey: ['integracoes', 'djen'] })
      toast.success('Configurações do DJEN salvas.')
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
        description="Parâmetros de monitoramento das publicações (consulta pública)."
      />
      <CardBody>
        {isLoading ? (
          <Loading />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="OABs monitoradas" hint="Separadas por vírgula. Ex.: 123456/SP, 78910/RJ">
              <Input value={oabs} onChange={(e) => setOabs(e.target.value)} />
            </Field>
            <Field label="Números de processo" hint="Separados por vírgula (opcional).">
              <Input value={numeros} onChange={(e) => setNumeros(e.target.value)} />
            </Field>
            <Field label="Tribunais" hint="Siglas separadas por vírgula. Ex.: TJSP, TRF3">
              <Input value={tribunais} onChange={(e) => setTribunais(e.target.value)} />
            </Field>
            <Field label="Dias retroativos" hint="Janela de consulta a cada sincronização.">
              <Input
                type="number"
                min={1}
                value={dias}
                onChange={(e) => setDias(e.target.value)}
              />
            </Field>
            <div className="sm:col-span-2">
              <Button onClick={salvar} loading={saving}>
                Salvar DJEN
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
  const { data, isLoading } = useQuery({
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
        description="Cadastro de usuários e senhas (exclusivo do administrador)."
        action={
          <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setOpen(true)}>
            Novo usuário
          </Button>
        }
      />
      <CardBody className="p-0">
        {isLoading ? (
          <Loading />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Nome</TH>
                <TH>E-mail</TH>
                <TH>Perfil</TH>
                <TH>Situação</TH>
                <TH className="text-right">Ações</TH>
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
                    <TD className="text-right">
                      {!admin && (
                        <Button size="sm" variant="outline" onClick={() => toggleAtivo(p)}>
                          {p.ativo ? 'Desativar' : 'Ativar'}
                        </Button>
                      )}
                    </TD>
                  </TR>
                )
              })}
            </TBody>
          </Table>
        )}
      </CardBody>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Novo usuário"
        description="O usuário poderá acessar o sistema com o e-mail e senha definidos."
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

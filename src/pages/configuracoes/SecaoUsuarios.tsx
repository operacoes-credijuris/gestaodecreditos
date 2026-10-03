// A seção Usuários das Configurações: quem acessa a plataforma, e com que perfil.

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, ShieldCheck } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { invokeFunction } from '@/lib/functions'
import { iniciais } from '@/lib/iniciais'
import type { Profile } from '@/lib/types'
import { ADMIN_EMAIL } from '@/contexts/AuthContext'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select } from '@/components/ui/Field'
import { IconButton } from '@/components/ui/IconButton'
import { Modal } from '@/components/ui/Modal'
import { Table, THead, TH, TBody, TR, TD, Loading } from '@/components/ui/Table'
import { useToast } from '@/components/ui/Toast'
import { CabecalhoSecao, CaixaAviso, IconeOk, IconeRuim, Selo } from './comum'

export function SecaoUsuarios() {
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
    <>
      <CabecalhoSecao
        titulo="Usuários"
        apoio="Quem acessa a plataforma, e com que perfil."
        direita={
          <Button icon={<Plus className="h-[14px] w-[14px]" />} onClick={() => setOpen(true)}>
            Novo usuário
          </Button>
        }
      />
      {/* Erro antes de tudo: tabela vazia por falha de leitura era
          indistinguível de "não há usuário cadastrado". */}
      {error ? (
        <CaixaAviso>Não foi possível carregar os usuários: {(error as Error).message}</CaixaAviso>
      ) : isLoading ? (
        <Loading />
      ) : (
        <div className="rounded-cartao border border-borda">
          <Table>
            <THead>
              <tr>
                <TH>Nome</TH>
                <TH>E-mail</TH>
                <TH>Perfil</TH>
                <TH>Situação</TH>
                <TH className="w-[1%] whitespace-nowrap text-right">Ações</TH>
              </tr>
            </THead>
            <TBody>
              {(data ?? []).map((p) => {
                const admin = p.role === 'admin' || p.email === ADMIN_EMAIL
                return (
                  <TR key={p.id}>
                    <TD className="align-middle">
                      {p.nome ? (
                        // INICIAIS AO LADO DO NOME (item "Novo" da amostra): a
                        // lista se lê pelo rosto antes da letra. Nome vazio fica
                        // com o traço, sem círculo — um "?" redondo pareceria
                        // alguém chamado "?".
                        <div className="flex items-center gap-[10px]">
                          <span
                            aria-hidden
                            className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-full bg-marca-suave font-display text-sm font-bold text-marca-texto"
                          >
                            {iniciais(p.nome)}
                          </span>
                          <span className="font-semibold text-texto">{p.nome}</span>
                        </div>
                      ) : (
                        <span className="text-texto-3">—</span>
                      )}
                    </TD>
                    <TD className="align-middle text-texto-2">{p.email}</TD>
                    <TD className="align-middle">
                      {admin ? (
                        <Badge tone="purple">
                          <ShieldCheck className="mr-1 h-[13px] w-[13px] shrink-0" aria-hidden />
                          Administrador
                        </Badge>
                      ) : (
                        <Badge tone="gray">Usuário</Badge>
                      )}
                    </TD>
                    <TD className="align-middle">
                      {p.ativo ? (
                        <Selo tom="ok" icone={IconeOk}>
                          Ativo
                        </Selo>
                      ) : (
                        <Selo tom="ruim" icone={IconeRuim}>
                          Inativo
                        </Selo>
                      )}
                    </TD>
                    <TD className="whitespace-nowrap text-right align-middle">
                      <div className="flex items-center justify-end gap-1.5">
                        {!admin && (
                          <Button size="sm" variant="ghost" onClick={() => toggleAtivo(p)}>
                            {p.ativo ? 'Desativar' : 'Ativar'}
                          </Button>
                        )}
                        <IconButton
                          label={`Editar usuário ${p.nome || p.email}`}
                          icon={<Pencil className="h-[16px] w-[16px]" />}
                          onClick={() => abrirEdicao(p)}
                        />
                      </div>
                    </TD>
                  </TR>
                )
              })}
            </TBody>
          </Table>
        </div>
      )}

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
    </>
  )
}

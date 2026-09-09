// _shared/segredos.ts
// Leitura das chaves das integrações da Análise de Crédito, no mesmo padrão do
// Pedro (chaveAnthropic do assistente): tenta o secret de ambiente e, se não
// houver, lê da tabela integracao_*_secret com a service_role. A tabela não tem
// policy — é isso que impede o cliente de ler a chave.

import { serviceClient } from './auth.ts'

export async function chaveJudit(): Promise<string | null> {
  const doAmbiente = Deno.env.get('JUDIT_API_KEY')
  if (doAmbiente) return doAmbiente
  const { data } = await serviceClient()
    .from('integracao_judit_secret')
    .select('token')
    .eq('id', 1)
    .maybeSingle()
  return data?.token ?? null
}

export async function chaveAnthropic(): Promise<string | null> {
  const doAmbiente = Deno.env.get('ANTHROPIC_API_KEY')
  if (doAmbiente) return doAmbiente
  const { data } = await serviceClient()
    .from('integracao_anthropic_secret')
    .select('token')
    .eq('id', 1)
    .maybeSingle()
  return data?.token ?? null
}

export interface SegredoGoogle {
  client_id: string
  client_secret: string
  refresh_token: string
}

export async function segredoGoogle(): Promise<SegredoGoogle | null> {
  const { data } = await serviceClient()
    .from('integracao_google_secret')
    .select('client_id, client_secret, refresh_token')
    .eq('id', 1)
    .maybeSingle()
  return (data as SegredoGoogle | null) ?? null
}

/**
 * O PAR TOKEN + SUBDOMÍNIO, da mesma fonte que a kommo-sync e a kommo-mover.
 *
 * A kommo-anotar tinha o subdomínio FIXO no código enquanto as outras duas o
 * leem de `integracao_kommo_secret` — que é onde a salvar-token-kommo grava. Um
 * subdomínio trocado (renomear a conta no Kommo, migrar para outra) consertava
 * duas funções e deixava a terceira escrevendo no lugar errado.
 */
export async function contaKommo(): Promise<{ token: string; subdominio: string } | null> {
  const doAmbiente = Deno.env.get('KOMMO_TOKEN')
  const { data } = await serviceClient()
    .from('integracao_kommo_secret')
    .select('token, subdominio')
    .eq('id', 1)
    .maybeSingle()
  const token = doAmbiente || data?.token
  const subdominio = data?.subdominio || Deno.env.get('KOMMO_SUBDOMINIO')
  return token && subdominio ? { token, subdominio } : null
}

export async function chaveKommo(): Promise<string | null> {
  const doAmbiente = Deno.env.get('KOMMO_TOKEN')
  if (doAmbiente) return doAmbiente
  const { data } = await serviceClient()
    .from('integracao_kommo_secret')
    .select('token')
    .eq('id', 1)
    .maybeSingle()
  return data?.token ?? null
}

/**
 * O token do ESCAVADOR, a fonte da due diligence de processos judiciais.
 *
 * Gravado por salvar-token-escavador na tabela integracao_escavador_secret
 * (migração 0061), que tem RLS ligada e nenhuma policy — service_role e mais
 * ninguém. Nunca como VITE_*: variável de ambiente do front vai assada no
 * bundle público, e este token gasta crédito por requisição.
 */
export async function chaveEscavador(): Promise<string | null> {
  const doAmbiente = Deno.env.get('ESCAVADOR_API_KEY')
  if (doAmbiente) return doAmbiente
  const { data } = await serviceClient()
    .from('integracao_escavador_secret')
    .select('token')
    .eq('id', 1)
    .maybeSingle()
  return data?.token ?? null
}

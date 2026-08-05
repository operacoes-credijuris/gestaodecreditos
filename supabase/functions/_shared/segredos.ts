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

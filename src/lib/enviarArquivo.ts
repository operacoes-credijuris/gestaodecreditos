// ENVIAR UM ARQUIVO A UMA EDGE FUNCTION, com o progresso do envio.
//
// `supabase.functions.invoke` não informa progresso — o arquivo sai inteiro e a
// tela fica parada até a resposta. Para o memorando assinado (e o que vier
// depois) a tela mostra uma barra, e a barra precisa do evento de progresso do
// XMLHttpRequest, que o fetch não tem.
//
// O ARQUIVO VAI COMO O CORPO DA REQUISIÇÃO, e não num formulário: a função o
// repassa ao Kommo em partes à medida que chega, sem guardá-lo inteiro (ver
// kommo-anexo-enviar). Os dados que o acompanham vão em cabeçalhos.
//
// DUAS FASES: o arquivo subindo do computador (0 a 100%), e depois a função
// terminando com ele no Kommo — essa não tem porcentagem, e a tela a mostra como
// "gravando".
import { supabase } from '@/lib/supabase'

export type ProgressoDoEnvio = { fase: 'enviando'; pct: number } | { fase: 'processando' }

export async function enviarArquivo<T>(
  funcao: string,
  arquivo: File,
  cabecalhos: Record<string, string>,
  onProgresso: (p: ProgressoDoEnvio) => void,
): Promise<T> {
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${funcao}`
  const chave = String(import.meta.env.VITE_SUPABASE_ANON_KEY ?? '')
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Sessão expirada — entre de novo na plataforma.')

  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', url)
    xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    xhr.setRequestHeader('apikey', chave)
    xhr.setRequestHeader('Content-Type', arquivo.type || 'application/octet-stream')
    // O TAMANHO EM CABEÇALHO PRÓPRIO: o Content-Length pode não chegar à função.
    xhr.setRequestHeader('x-tamanho', String(arquivo.size))
    for (const [k, v] of Object.entries(cabecalhos)) xhr.setRequestHeader(k, v)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgresso({ fase: 'enviando', pct: Math.round((e.loaded / e.total) * 100) })
    }
    xhr.upload.onload = () => onProgresso({ fase: 'processando' })
    xhr.onerror = () => reject(new Error('A conexão caiu durante o envio do arquivo.'))
    xhr.onload = () => {
      let corpo: Record<string, unknown> = {}
      try {
        corpo = JSON.parse(xhr.responseText || '{}')
      } catch {
        /* corpo que não é JSON: o status conta a história */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(corpo as T)
      else {
        const msg = String(corpo.erro ?? corpo.error ?? corpo.message ?? xhr.responseText ?? '').slice(0, 300)
        reject(new Error(`${msg || 'O envio falhou'} (HTTP ${xhr.status})`))
      }
    }
    xhr.send(arquivo)
  })
}

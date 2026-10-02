// Caminho do arquivo gerado por Skill, para assinar o link de novo.
//
// O link assinado vence em uma hora e a conversa fica no histórico: reaberta no
// dia seguinte, o arquivo parecia perdido. A conversa nova guarda o caminho; a
// antiga só tem o link — e o caminho tem de sair dele, sem chute.

import { describe, it, expect } from 'vitest'
import { caminhoDoArquivo } from '@/lib/arquivosDoAssistente'

/** base64url sem preenchimento, como no JWT. */
function b64url(s: string): string {
  let bin = ''
  for (const b of new TextEncoder().encode(s)) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Link no formato do Storage: /object/sign/<bucket>/<caminho>?token=<jwt>. */
function linkAssinado(claimUrl: string): string {
  const jwt = [
    b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' })),
    b64url(JSON.stringify({ url: claimUrl, iat: 1, exp: 3601 })),
    'assinatura',
  ].join('.')
  return `https://exemplo.supabase.co/storage/v1/object/sign/${encodeURI(claimUrl)}?token=${jwt}`
}

describe('caminhoDoArquivo', () => {
  it('conversa nova: usa o caminho gravado', () => {
    expect(caminhoDoArquivo({ url: 'https://qualquer', caminho: 'u1/f1-a.xlsx' })).toBe(
      'u1/f1-a.xlsx',
    )
  })

  it('conversa antiga: tira o caminho do token do link', () => {
    const url = linkAssinado('assistente-arquivos/u1/file_9-relatório final.xlsx')
    expect(caminhoDoArquivo({ url })).toBe('u1/file_9-relatório final.xlsx')
  })

  it('token de outro bucket não vale', () => {
    const url = linkAssinado('outro-bucket/u1/f1.xlsx')
    expect(caminhoDoArquivo({ url })).toBeNull()
  })

  it('link sem token, ou ilegível, devolve null em vez de quebrar', () => {
    expect(caminhoDoArquivo({ url: 'https://exemplo.com/arquivo.xlsx' })).toBeNull()
    expect(caminhoDoArquivo({ url: 'https://exemplo.com/a?token=nao.e.jwt' })).toBeNull()
    expect(caminhoDoArquivo({ url: 'não é url' })).toBeNull()
  })
})

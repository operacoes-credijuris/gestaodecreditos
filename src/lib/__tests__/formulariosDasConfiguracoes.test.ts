// As regras de "sujeira" das janelas de Configurações e dos Parâmetros, e a frase
// da falha do Banco Central. Errar a sujeira para um lado pergunta "Descartar
// alterações?" a quem não digitou nada; para o outro, deixa fechar e perder o
// que foi digitado.

import { describe, it, expect } from 'vitest'
import {
  MSG_BCB_ATUALIZADO,
  PERFIL_INICIAL,
  edicaoDeUsuarioSuja,
  mensagemDaFalhaDoBcb,
  novoUsuarioSujo,
  parametrosAlterados,
} from '@/lib/formulariosDasConfiguracoes'
import { erroDaFuncao } from '@/lib/functions'

const VAZIO = { nome: '', email: '', password: '', role: PERFIL_INICIAL }

describe('novoUsuarioSujo', () => {
  it('a janela recém-aberta não está suja', () => {
    expect(novoUsuarioSujo(VAZIO)).toBe(false)
  })

  it('qualquer campo digitado suja', () => {
    expect(novoUsuarioSujo({ ...VAZIO, nome: 'Ana' })).toBe(true)
    expect(novoUsuarioSujo({ ...VAZIO, email: 'a@b.com' })).toBe(true)
    expect(novoUsuarioSujo({ ...VAZIO, password: 'x' })).toBe(true)
  })

  it('trocar o perfil também suja', () => {
    expect(novoUsuarioSujo({ ...VAZIO, role: 'admin' })).toBe(true)
  })

  it('só espaço no nome ou no e-mail não suja (o Criar apara); na senha, suja', () => {
    expect(novoUsuarioSujo({ ...VAZIO, nome: '   ', email: ' ' })).toBe(false)
    expect(novoUsuarioSujo({ ...VAZIO, password: ' ' })).toBe(true)
  })
})

describe('edicaoDeUsuarioSuja', () => {
  const gravado = { nome: 'Ana Souza', email: 'ana@x.com' }
  const aberta = { nome: 'Ana Souza', email: 'ana@x.com', password: '' }

  it('abrir e fechar sem mexer não pergunta nada', () => {
    expect(edicaoDeUsuarioSuja(aberta, gravado)).toBe(false)
  })

  it('nome nulo no cadastro é o campo vazio da tela', () => {
    expect(edicaoDeUsuarioSuja({ ...aberta, nome: '' }, { ...gravado, nome: null })).toBe(false)
  })

  it('mudar nome, e-mail ou digitar senha nova suja', () => {
    expect(edicaoDeUsuarioSuja({ ...aberta, nome: 'Ana S.' }, gravado)).toBe(true)
    expect(edicaoDeUsuarioSuja({ ...aberta, email: 'ana@y.com' }, gravado)).toBe(true)
    expect(edicaoDeUsuarioSuja({ ...aberta, password: '123456' }, gravado)).toBe(true)
  })

  it('voltar ao valor gravado deixa de sujar', () => {
    const mexido = { ...aberta, nome: 'Outra' }
    expect(edicaoDeUsuarioSuja(mexido, gravado)).toBe(true)
    expect(edicaoDeUsuarioSuja({ ...mexido, nome: 'Ana Souza' }, gravado)).toBe(false)
  })
})

describe('parametrosAlterados', () => {
  const gravados = { selic: 10.75, ipca: 4.1 }

  it('iguais ao gravado: não pergunta', () => {
    expect(parametrosAlterados({ ...gravados }, gravados)).toBe(false)
  })

  it('SELIC ou IPCA diferente: pergunta', () => {
    expect(parametrosAlterados({ ...gravados, selic: 11 }, gravados)).toBe(true)
    expect(parametrosAlterados({ ...gravados, ipca: null }, gravados)).toBe(true)
  })

  it('o que o Banco Central acabou de gravar, passado como gravado, não conta', () => {
    const daBusca = { selic: 10.5, ipca: 4.24 }
    expect(parametrosAlterados(daBusca, daBusca)).toBe(false)
  })
})

describe('mensagemDaFalhaDoBcb', () => {
  it('a falha total (gravado: false) vira a frase da amostra, avisos separados por ;', async () => {
    const corpo = JSON.stringify({
      ok: false,
      avisos: ['SELIC: série 4390 → HTTP 503', 'IPCA: série 13522 → HTTP 503'],
      gravado: false,
    })
    const e = await erroDaFuncao({
      message: 'Edge Function returned a non-2xx status code',
      context: new Response(corpo, { status: 502 }),
    } as unknown as { message: string })
    expect(mensagemDaFalhaDoBcb(e)).toBe(
      'Não consegui atualizar pelo Banco Central, e nada foi gravado: SELIC: série 4390 → HTTP 503; IPCA: série 13522 → HTTP 503.',
    )
  })

  it('aviso que já termina em ponto não fica com dois', () => {
    const e = Object.assign(new Error('x'), {
      nadaGravado: true,
      avisos: ['IPCA: série vazia — não gravei.'],
    })
    expect(mensagemDaFalhaDoBcb(e)).toBe(
      'Não consegui atualizar pelo Banco Central, e nada foi gravado: IPCA: série vazia — não gravei.',
    )
  })

  it('sem a função dizer que não gravou, a mensagem segue a de sempre', async () => {
    const e = await erroDaFuncao({
      message: 'Edge Function returned a non-2xx status code',
      context: new Response(JSON.stringify({ error: 'Acesso negado.' }), { status: 401 }),
    } as unknown as { message: string })
    expect(mensagemDaFalhaDoBcb(e)).toBe('Acesso negado. (HTTP 401)')
    expect(mensagemDaFalhaDoBcb(new Error('Failed to fetch'))).toBe('Failed to fetch')
  })

  it('o aviso de sucesso é o da amostra', () => {
    expect(MSG_BCB_ATUALIZADO).toBe('Índices atualizados pelo Banco Central e já gravados.')
  })
})

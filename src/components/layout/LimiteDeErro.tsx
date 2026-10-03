import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { ehFalhaDeCarga } from '@/lib/telaSobDemanda'

/**
 * O LIMITE DE ERRO DAS TELAS (revisão pós-virada, 03/10/2026).
 *
 * Não havia nenhum: um erro de desenho em qualquer tela derrubava a árvore
 * inteira do React, e o que sobrava era a página EM BRANCO — sem menu, sem topo,
 * sem dizer nada. Com as telas sob demanda (lib/telaSobDemanda.ts) surgiu mais um
 * jeito de falhar, o pedaço do pacote que não chega. Este limite fica em volta
 * da tela, dentro do layout: o menu e o topo continuam de pé, e a pessoa pode ir
 * a outra tela ou recarregar.
 *
 * O layout troca a `key` dele a cada tela: sair da tela que falhou o desfaz.
 */
export class LimiteDeErro extends Component<{ children: ReactNode }, { erro: unknown }> {
  state: { erro: unknown } = { erro: null }

  static getDerivedStateFromError(erro: unknown) {
    return { erro }
  }

  componentDidCatch(erro: unknown, info: ErrorInfo) {
    console.error('Erro ao desenhar a tela.', erro, info.componentStack)
  }

  render() {
    if (!this.state.erro) return this.props.children
    const carga = ehFalhaDeCarga(this.state.erro)
    return (
      <div role="alert" className="mx-auto max-w-[560px] pt-[48px]">
        <div className="rounded-cartao border border-dashed border-borda-forte bg-superficie px-6 py-[48px] text-center">
          <div className="mx-auto mb-3 grid h-[52px] w-[52px] place-items-center rounded-[16px] bg-perigo-fundo text-perigo">
            <AlertTriangle className="h-[20px] w-[20px]" aria-hidden />
          </div>
          <h1 className="font-display text-lg font-bold text-texto">Não foi possível abrir esta tela</h1>
          <p className="mx-auto mt-1.5 max-w-[420px] text-corpo text-texto-2">
            {carga
              ? 'A tela não chegou do servidor — a conexão caiu ou saiu uma versão nova da plataforma. Recarregue a página.'
              : 'Algo deu errado ao montar esta tela. Recarregue a página; se continuar, avise o administrador.'}
          </p>
          <div className="mt-[14px]">
            <Button
              icon={<RefreshCw className="h-[16px] w-[16px]" />}
              onClick={() => window.location.reload()}
            >
              Recarregar a página
            </Button>
          </div>
        </div>
      </div>
    )
  }
}

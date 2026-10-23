import { useNavigate } from 'react-router-dom'
import { Compass } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { INICIO } from '@/components/layout/navigation'

/**
 * Página exibida para rotas inexistentes (em vez de redirecionar em silêncio).
 *
 * O DESENHO É O DA AMOSTRA (`.notfound` com o `.empty` dentro): a placa
 * azul-clara com a bússola, o título, o motivo e o botão principal, numa caixa
 * de borda tracejada — a mesma do vazio das listas (ui/Table.tsx › EmptyState).
 * O título continua sendo o <h1> da página.
 */
export default function NotFound() {
  const navigate = useNavigate()
  return (
    <div className="mx-auto max-w-[560px] pt-s12">
      <div className="rounded-cartao border border-dashed border-borda-forte bg-superficie px-s5 py-s12 text-center">
        <div className="mx-auto mb-s2 grid h-[52px] w-[52px] place-items-center rounded-cartao bg-marca-suave text-marca-texto">
          <Compass className="h-[20px] w-[20px]" aria-hidden />
        </div>
        <h1 className="font-display text-lg font-bold text-texto">Página não encontrada</h1>
        <p className="mx-auto mt-s1 max-w-[420px] text-corpo text-texto-2">
          O endereço acessado não existe ou foi movido. Confira o link ou volte para o início.
        </p>
        {/* "VOLTAR" AO LADO DO INÍCIO (revisão UX em equipe, 20/10/2026): quem
            chega por um link quebrado vindo de outra tela quer, quase sempre,
            voltar para onde estava — e não recomeçar da Análise. Sem página
            anterior (link aberto numa aba nova), só o início. */}
        <div className="mt-s4 flex flex-wrap justify-center gap-s2">
          {/* PÁGINA ANTERIOR DA PLATAFORMA, e não do navegador (23/10/2026): o
              `history.length` conta também o site de onde a aba veio, e o
              Voltar saía da plataforma. O `idx` é o do React Router: 0 é a
              primeira tela desta visita. */}
          {((window.history.state as { idx?: number } | null)?.idx ?? 0) > 0 && (
            <Button variant="secondary" onClick={() => navigate(-1)}>
              Voltar
            </Button>
          )}
          <Button onClick={() => navigate(INICIO)}>Ir para o início</Button>
        </div>
      </div>
    </div>
  )
}

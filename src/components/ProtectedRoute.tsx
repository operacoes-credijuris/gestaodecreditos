import { type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { Loader2, LogOut, ShieldOff } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/components/ui/Toast'
import { Button } from '@/components/ui/Button'
import { INICIO } from '@/components/layout/navigation'
import { decidirGuarda } from '@/lib/guardaDaRota'
import marca from '@/assets/marca-credijuris.png'

function FullScreenLoader() {
  return (
    // Sobre o papel da casa, como o Entrar e a recusa abaixo: a troca entre as
    // três telas cheias não pisca de cor.
    // A LOGOMARCA NA PLACA BRANCA, acima do ícone (a `.tela-carregando` da
    // amostra): quem abre a plataforma vê de cara que chegou ao lugar certo, e
    // não uma tela vazia girando. Placa BRANCA FIXA, como no menu: é a única
    // forma fiel de mostrar o "U" azul sem recolorir a marca.
    <div className="flex h-screen flex-col items-center justify-center gap-[14px] bg-papel text-texto-2" role="status">
      <div className="flex h-[44px] w-[44px] items-center justify-center rounded-[12px] bg-white p-[7px] shadow-nivel-1">
        <img src={marca} alt="" className="block h-full w-full object-contain" />
      </div>
      <Loader2 className="h-[20px] w-[20px] animate-spin text-marca-viva" aria-hidden />
      <span className="text-corpo font-semibold">Carregando…</span>
    </div>
  )
}

/**
 * Acesso desligado pelo administrador. As policies do banco já barram a leitura
 * (migração 0025), então sem esta tela o usuário veria a plataforma inteira
 * vazia e acharia que quebrou. Dizer o motivo é o que evita o chamado.
 *
 * O DESENHO É O DA AMOSTRA (`.login-card.center`): a placa vermelha com o
 * escudo, o título, o motivo e o Sair largo, sobre o papel da casa.
 */
function AcessoDesativado() {
  const { user, signOut } = useAuth()
  // AVISO EM TOAST, e não num estado desta tela: o Sair derruba a sessão mesmo
  // quando o servidor falha, e sem sessão esta tela se desmonta (vai ao login)
  // antes de o aviso chegar — ele nunca aparecia. O ToastProvider fica acima das
  // rotas e sobrevive à troca, como no Sair do menu do topo.
  const toast = useToast()
  return (
    <div className="grid min-h-screen place-content-center bg-papel px-4 py-11">
      <div className="grid w-[min(400px,calc(100vw-32px))] justify-items-center gap-4 rounded-[18px] border border-borda bg-superficie p-9 text-center shadow-nivel-2">
        <div className="grid h-[52px] w-[52px] place-items-center rounded-[16px] bg-perigo-fundo text-perigo">
          <ShieldOff className="h-[22px] w-[22px]" aria-hidden />
        </div>
        <h1 className="font-display text-xl font-extrabold tracking-tight text-texto">
          Acesso desativado
        </h1>
        <p className="text-corpo text-texto-2">
          A conta {user?.email} está desativada. Procure o administrador da
          plataforma para reativá-la.
        </p>
        <Button
          size="lg"
          className="w-full"
          icon={<LogOut className="h-[16px] w-[16px]" />}
          onClick={async () => {
            const { error } = await signOut()
            if (error) toast.error(error)
          }}
        >
          Sair
        </Button>
      </div>
    </div>
  )
}

/** A decisão da guarda, desenhada (a regra está em lib/guardaDaRota.ts). */
function Guarda({ children, exigeAdmin }: { children: ReactNode; exigeAdmin: boolean }) {
  const { session, loading, isAdmin, acessoDesativado, perfilCarregando } = useAuth()
  const location = useLocation()
  const decisao = decidirGuarda(
    { carregando: loading, temSessao: !!session, perfilCarregando, acessoDesativado, isAdmin },
    exigeAdmin,
  )
  if (decisao === 'carregando') return <FullScreenLoader />
  // `state` guarda a rota pedida: sem isto, quem abre um link direto de
  // publicação sem sessão autenticava e caía no dashboard, com o link já
  // substituído no histórico e sem Voltar que o traga.
  if (decisao === 'login') return <Navigate to="/login" replace state={{ from: location }} />
  if (decisao === 'desativado') return <AcessoDesativado />
  if (decisao === 'inicio') return <Navigate to={INICIO} replace />
  return <>{children}</>
}

export function ProtectedRoute({ children }: { children: ReactNode }) {
  return <Guarda exigeAdmin={false}>{children}</Guarda>
}

export function AdminRoute({ children }: { children: ReactNode }) {
  return <Guarda exigeAdmin>{children}</Guarda>
}

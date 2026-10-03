import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { tituloDaAba } from './navigation'
import { tituloDoCanal } from '@/lib/canal'

/**
 * O título da aba do navegador acompanha a página ("Tarefas — Credijuris") e,
 * no Quadro econômico, a aba aberta ("Previsões — Credijuris").
 *
 * MORA ACIMA DAS ROTAS (App.tsx), E NÃO NO LAYOUT. No layout, o título só era
 * posto depois de a sessão e o perfil chegarem (o layout fica atrás do
 * `ProtectedRoute`): até lá a aba dizia "Credijuris — Gestão de Créditos" —
 * numa aba aberta em segundo plano, por muito tempo —, e ao sair do layout
 * (sessão expirada, Sair) ficava o título da última tela, "Visão geral —
 * Credijuris" sobre a tela de Entrar. Aqui ele vale para todo endereço, desde o
 * primeiro desenho.
 */
export function TituloDaAba() {
  const { pathname } = useLocation()
  useEffect(() => {
    document.title = tituloDoCanal(tituloDaAba(pathname))
  }, [pathname])
  return null
}

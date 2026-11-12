import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import { AuthProvider } from './contexts/AuthContext'
import { ToastProvider } from './components/ui/Toast'
import { JanelaDeDescarte } from './components/layout/JanelaDeDescarte'
import { TituloDaAba } from './components/layout/TituloDaAba'
// TIPOGRAFIA DA CASA (design system v3, repaginação de 12/11/2026) — duas
// fontes, cada uma no que faz melhor, declaradas à mão em ./fontes.css (só o
// subconjunto latino; o porquê está lá):
//
//   Inter — toda a interface: tabelas, formulários, rótulos e os números. Tem
//     algarismos tabulares de verdade (dinheiro alinhado na coluna) e tamanho
//     óptico, que fecha o número grande e abre o texto pequeno, sozinho.
//   Source Serif 4 — só os títulos de página e de janela (`font-titulo`): a
//     assinatura de relatório institucional. Nunca em texto corrido.
//
// EMBUTIDAS no bundle: nada depende de fonts.googleapis.com — o @import externo
// de outrora falhava em silêncio (rede lenta ou bloqueada) e derrubava o app no
// Segoe UI.
import './fontes.css'
import './index.css'
import { iniciarTema } from './lib/tema'

// O TEMA ESCOLHIDO (Claro, Escuro ou Do sistema). O script do index.html já pôs
// o atributo antes do primeiro desenho; daqui em diante quem cuida é o
// lib/tema.ts, que também acompanha a troca do sistema ao vivo.
iniciarTema()

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 30_000,
    },
  },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <HashRouter>
        <AuthProvider>
          <ToastProvider>
            {/* O título da aba do navegador, em todo endereço (TituloDaAba). */}
            <TituloDaAba />
            <App />
            {/* "Descartar alterações?" de todas as telas (lib/descarte.ts). */}
            <JanelaDeDescarte />
          </ToastProvider>
        </AuthProvider>
      </HashRouter>
    </QueryClientProvider>
  </React.StrictMode>,
)

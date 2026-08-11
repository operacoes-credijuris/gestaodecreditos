import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import { AuthProvider } from './contexts/AuthContext'
import { ToastProvider } from './components/ui/Toast'
// TIPOGRAFIA DA CASA — duas fontes, cada uma no que faz melhor:
//
//   Plus Jakarta Sans (display) — títulos, números grandes, marca. Geométrica
//     e de contraste alto: é a que ecoa o desenho do wordmark "credijuris".
//   Figtree (corpo) — tabelas, formulários, texto. Geométrica também, para
//     casar com a de display, mas com altura-x generosa, que é o que mantém
//     legibilidade nos 13px das listagens densas.
//
// VARIÁVEIS e EMBUTIDAS no bundle: um arquivo por família cobre todos os pesos,
// e nada depende de fonts.googleapis.com — o @import externo que havia aqui
// falhava em silêncio (rede lenta ou bloqueada) e derrubava o app no Segoe UI.
import '@fontsource-variable/plus-jakarta-sans'
import '@fontsource-variable/figtree'
import './index.css'

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
            <App />
          </ToastProvider>
        </AuthProvider>
      </HashRouter>
    </QueryClientProvider>
  </React.StrictMode>,
)

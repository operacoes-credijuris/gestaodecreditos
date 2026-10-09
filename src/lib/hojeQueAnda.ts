// O "HOJE" DE UMA TELA QUE FICA ABERTA (auditoria de bugs, 09/10/2026).
//
// `useMemo(() => hojeISO(), [])` congelava a data na montagem: com a página
// aberta de um dia para o outro, a expectativa que venceu ontem continuava com
// o selo âmbar em Créditos e na ficha do crédito até um F5. É o mesmo relógio da
// tela de Tarefas: confere ao voltar à aba e a cada minuto; a mesma data não
// redesenha nada.

import { useEffect, useState } from 'react'
import { hojeISO } from './format'

export function useHojeQueAnda(): string {
  const [hoje, setHoje] = useState(hojeISO)
  useEffect(() => {
    const sincronizar = () => setHoje(hojeISO())
    document.addEventListener('visibilitychange', sincronizar)
    window.addEventListener('focus', sincronizar)
    const timer = setInterval(sincronizar, 60_000)
    return () => {
      document.removeEventListener('visibilitychange', sincronizar)
      window.removeEventListener('focus', sincronizar)
      clearInterval(timer)
    }
  }, [])
  return hoje
}

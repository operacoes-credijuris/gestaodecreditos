// O botão de copiar mora em `ui/BotaoCopiar.tsx` — um só para a plataforma
// inteira (as frentes de qualidade de vida de 03/10/2026 criaram dois com a
// mesma API; ficou o de ui/, que é o mesmo com acréscimos opcionais e o recurso
// de cópia para navegador que recusa a área de transferência). Este arquivo só
// reexporta, para os imports do Comercial e do Operacional seguirem valendo.
export { BotaoCopiar, CopiarTexto, useCopiarTexto } from '@/components/ui/BotaoCopiar'

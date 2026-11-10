import RadarPrecatoriosModulo from '@/modules/radar-precatorios'
import '@/modules/radar-precatorios/radar.css'
import { CabecalhoDaAba } from '@/pages/inteligencia/compartilhado'

// Radar de Precatórios (EC 136/2025): a sexta aba do Quadro econômico.
// O módulo inteiro fica em src/modules/radar-precatorios.
export default function RadarPrecatorios() {
  return (
    <div className="space-y-s4">
      <CabecalhoDaAba
        titulo="Radar de precatórios"
        apoio="Teto anual de pagamento pela EC 136/2025 e projeção da fila de precatórios de um ente devedor."
      />
      <RadarPrecatoriosModulo incorporado />
    </div>
  )
}

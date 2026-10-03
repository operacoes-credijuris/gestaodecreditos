// Ficha completa de um crédito, na gaveta lateral — Partes, Processo,
// Aquisição e liquidação, Apensos, Fase processual (+ Situação) e o
// histórico integral do ADVBOX. Usada em DOIS lugares (Créditos, e
// Publicações e movimentações → Fase processual): um componente só,
// pra não ter duas fichas divergindo aos poucos.
//
// NO DESENHO DA AMOSTRA APROVADA (onda 2 do redesenho):
//   - "Pasta no Drive" no topo, o mesmo gesto do número clicável da tabela;
//   - os valores em CARTÕES (capital e valor de face; fora de Ativo, também o já
//     recebido e o complementar), em vez de campos soltos no meio da seção;
//   - a expectativa como selo, com a mesma régua da tabela;
//   - os apensos com as ações de cada um e "Adicionar apenso" sempre à vista.
// O que ela mostra e o que grava continuam os mesmos.
import { useMemo } from 'react'
import { Drawer } from '@/components/ui/Drawer'
import { Badge } from '@/components/ui/Badge'
import { DrawerHistorico } from '@/components/Movimentacoes'
import { FaseDrawerSection } from '@/pages/operacional/execucao/FaseProcessual'
import { useApensosManager } from '@/components/Apensos'
import { BotaoPastaDrive } from '@/components/NumeroProcessoDrive'
import {
  CabecalhoDaFicha,
  CartaoDeValor,
  Partes,
  SecaoDaFicha,
  SeloExpectativa,
  TituloDaSecao,
} from '@/components/operacional/Pecas'
import {
  getLabel,
  STATUS_PROCESSO,
  INSTRUMENTO,
  TIPO_CREDITO,
  INDICE_ATUALIZACAO,
  ESPECIE_REQUISITORIO,
} from '@/lib/labels'
import { formatBRL, formatCNJ, formatDate, hojeISO, mesesDepois } from '@/lib/format'
import { emLiquidacao } from '@/lib/regrasDoCredito'
import { MESES_ALERTA_EXPECTATIVA } from '@/lib/numerosDosCreditos'
import type { Processo } from '@/lib/types'

// Separa múltiplos nº RTDPJ (digitados com "e", vírgula, ";" ou quebra).
// Duplicada de Processos.tsx de propósito — cinco linhas não valem um módulo
// compartilhado.
function splitRtdpj(v: string): string[] {
  return v
    .split(/\s*(?:\be\b|,|;|\n)\s*/i)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** Dinheiro do cartão: valor não informado é "—", e não R$ 0,00. */
const valor = (v: number | null | undefined) => (v == null ? '—' : formatBRL(v))

export function CreditoDrawer({
  processo,
  onClose,
}: {
  processo: Processo | null
  onClose: () => void
}) {
  // OS APENSOS COM AS AÇÕES DELES, aqui dentro. Um gerenciador próprio da ficha
  // (as janelas de editar, excluir e a ficha do apenso abrem por cima desta), que
  // lê a MESMA lista em cache da tabela — gravar aqui atualiza lá.
  const apensos = useApensosManager('processo_id')

  const hoje = useMemo(() => hojeISO(), [])
  const limiteAlerta = useMemo(() => mesesDepois(hoje, MESES_ALERTA_EXPECTATIVA), [hoje])

  const st = processo ? getLabel(STATUS_PROCESSO, processo.status) : null
  const esp = processo?.especie_requisitorio
    ? getLabel(ESPECIE_REQUISITORIO, processo.especie_requisitorio)
    : null
  const liquidando = !!processo && emLiquidacao(processo.status)

  return (
    <>
      <Drawer
        open={!!processo}
        onClose={onClose}
        title={
          processo && (
            <CabecalhoDaFicha
              etiqueta={[esp?.label, st?.label].filter(Boolean).join(' · ')}
              titulo={formatCNJ(processo.numero_cnj)}
              apoio={<Partes a={processo.cedente} b={processo.cessionario} />}
            />
          )
        }
        // Sem footer: editar e excluir o crédito ficam nos botões da própria
        // linha da tabela; as ações dos apensos, aqui dentro.
      >
        {processo && (
          <div className="space-y-6">
            <div className="space-y-3">
              <BotaoPastaDrive processo={processo} />
              <div className="grid gap-3 sm:grid-cols-2">
                <CartaoDeValor rotulo="Capital investido" valor={valor(processo.capital_investido)} />
                <CartaoDeValor rotulo="Valor de face" valor={valor(processo.valor_face)} />
                {/* Mesma regra do formulário: já recebido e complementar só
                    existem fora do status Ativo. */}
                {liquidando && (
                  <>
                    <CartaoDeValor rotulo="Já recebido" valor={valor(processo.ja_recebido)} />
                    <CartaoDeValor
                      rotulo="Valor estimado complementar"
                      valor={valor(processo.valor_estimado_complementar)}
                    />
                  </>
                )}
              </div>
            </div>

            <SecaoDaFicha
              titulo="Partes"
              pares={[
                ['Cedente', processo.cedente],
                ['Advogado do cedente', processo.cedente_advogado],
                ['Cessionário', processo.cessionario],
                ['Originador', processo.originador],
                ['Entidade devedora', processo.entidade_devedora],
              ]}
            />

            <SecaoDaFicha
              titulo="Processo"
              pares={[
                ['Tribunal', processo.tribunal],
                ['Comarca', processo.comarca],
                ['Vara', processo.vara],
                // Só em precatório, como no formulário — RPV não tem processo
                // administrativo, e um "—" fixo aqui afirmaria que falta o dado.
                (processo.especie_requisitorio === 'precatorio' ||
                  !!processo.numero_processo_administrativo) && [
                  'Nº do processo administrativo',
                  processo.numero_processo_administrativo ? (
                    <span className="tabular-nums">{processo.numero_processo_administrativo}</span>
                  ) : null,
                ],
              ]}
            />

            <SecaoDaFicha
              titulo="Aquisição e liquidação"
              pares={[
                [
                  'Instrumento',
                  processo.instrumento ? (
                    <Badge tone={getLabel(INSTRUMENTO, processo.instrumento).tone}>
                      {getLabel(INSTRUMENTO, processo.instrumento).label}
                    </Badge>
                  ) : null,
                ],
                [
                  'Nº RTDPJ',
                  processo.instrumento === 'registro_publico' && processo.numero_rtdpj
                    ? splitRtdpj(processo.numero_rtdpj).map((n, i) => (
                        <div key={i} className="tabular-nums">
                          {n}
                        </div>
                      ))
                    : null,
                ],
                ['Data de aquisição', processo.data_aquisicao ? formatDate(processo.data_aquisicao) : null],
                [
                  'Expectativa de liquidação',
                  <SeloExpectativa
                    data={processo.expectativa_liquidacao}
                    hoje={hoje}
                    limiteAlerta={limiteAlerta}
                  />,
                ],
                liquidando && [
                  'Data de liquidação',
                  processo.data_liquidacao ? formatDate(processo.data_liquidacao) : null,
                ],
                ['Espécie do requisitório', esp ? <Badge tone={esp.tone}>{esp.label}</Badge> : null],
                [
                  'Tipo de crédito',
                  processo.tipo_credito?.length ? (
                    <div className="flex flex-wrap gap-1.5">
                      {processo.tipo_credito.map((t) => (
                        <Badge key={t} tone="gray">
                          {getLabel(TIPO_CREDITO, t).label}
                        </Badge>
                      ))}
                    </div>
                  ) : null,
                ],
                ['Data de referência', processo.data_referencia ? formatDate(processo.data_referencia) : null],
                [
                  'Índice de atualização',
                  processo.indice_atualizacao
                    ? getLabel(INDICE_ATUALIZACAO, processo.indice_atualizacao).label
                    : null,
                ],
              ]}
            />

            <section>
              <TituloDaSecao>Apensos ({apensos.contagem(processo.id)})</TituloDaSecao>
              {apensos.listaNaFicha(processo.id)}
            </section>

            <FaseDrawerSection processo={processo} />

            {/* Histórico integral do ADVBOX — SÓ do principal. Andamento de
                apenso fica na ficha do apenso (clique no card dele): autos
                próprios, sem mistura. */}
            <DrawerHistorico numero={processo.numero_cnj} />
          </div>
        )}
      </Drawer>
      {apensos.modals()}
    </>
  )
}

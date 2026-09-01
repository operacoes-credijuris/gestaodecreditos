// Ficha completa de um crédito, na gaveta lateral — Partes, Processo,
// Aquisição e liquidação, Apensos, Fase processual (+ Situação) e o
// histórico integral do ADVBOX. Usada em DOIS lugares (Créditos → Visão
// Global, e Publicações e Movimentações → Fase Processual): um componente só,
// pra não ter duas fichas divergindo aos poucos.
import { useMemo } from 'react'
import { apensosCrud } from '@/lib/queries'
import { Drawer, DrawerSection, DrawerField } from '@/components/ui/Drawer'
import { Badge } from '@/components/ui/Badge'
import { DrawerHistorico } from '@/components/Movimentacoes'
import { FaseDrawerSection } from '@/pages/operacional/execucao/FaseProcessual'
import {
  getLabel,
  STATUS_PROCESSO,
  INSTRUMENTO,
  TIPO_CREDITO,
  INDICE_ATUALIZACAO,
  ESPECIE_REQUISITORIO,
} from '@/lib/labels'
import { formatBRL, formatCNJ, formatDate } from '@/lib/format'
import type { Processo, StatusProcesso } from '@/lib/types'

// Separa múltiplos nº RTDPJ (digitados com "e", vírgula, ";" ou quebra).
// Duplicada de Processos.tsx de propósito — cinco linhas não valem um módulo
// compartilhado.
function splitRtdpj(v: string): string[] {
  return v
    .split(/\s*(?:\be\b|,|;|\n)\s*/i)
    .map((s) => s.trim())
    .filter(Boolean)
}

// Mesma regra de Processos.tsx: data de liquidação, já recebido e valor
// estimado complementar só existem fora do status Ativo.
const emLiquidacao = (status?: StatusProcesso): boolean =>
  status === 'complementar' || status === 'encerrado'

export function CreditoDrawer({
  processo,
  onClose,
}: {
  processo: Processo | null
  onClose: () => void
}) {
  const todosApensos = apensosCrud.useList()
  const apensosDoDetalhe = useMemo(
    () => (processo ? (todosApensos.data ?? []).filter((a) => a.processo_id === processo.id) : []),
    [todosApensos.data, processo],
  )

  return (
    <Drawer
      open={!!processo}
      onClose={onClose}
      title={
        processo && (
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold tracking-tight text-slate-800">
                {formatCNJ(processo.numero_cnj)}
              </h2>
              <Badge tone={getLabel(STATUS_PROCESSO, processo.status).tone}>
                {getLabel(STATUS_PROCESSO, processo.status).label}
              </Badge>
            </div>
            <p className="text-xs text-slate-600">
              {processo.cedente || '—'} v. {processo.cessionario || '—'}
            </p>
          </div>
        )
      }
      // Sem footer: a ficha é só leitura. Editar e excluir ficam nos botões
      // da própria linha da tabela (só existem na Visão Global de Créditos).
    >
      {processo && (
        <>
          <DrawerSection title="Partes">
            <DrawerField label="Cedente">{processo.cedente || '—'}</DrawerField>
            <DrawerField label="Advogado do cedente">{processo.cedente_advogado || '—'}</DrawerField>
            <DrawerField label="Cessionário">{processo.cessionario || '—'}</DrawerField>
            <DrawerField label="Originador">{processo.originador || '—'}</DrawerField>
            <DrawerField label="Entidade devedora">{processo.entidade_devedora || '—'}</DrawerField>
          </DrawerSection>

          <DrawerSection title="Processo">
            <DrawerField label="Tribunal">{processo.tribunal || '—'}</DrawerField>
            <DrawerField label="Comarca">{processo.comarca || '—'}</DrawerField>
            <DrawerField label="Vara">{processo.vara || '—'}</DrawerField>
            {/* Só em precatório, como no formulário — RPV não tem processo
                administrativo, e um "—" fixo aqui afirmaria que falta o dado. */}
            {(processo.especie_requisitorio === 'precatorio' || !!processo.numero_processo_administrativo) && (
              <DrawerField label="Nº do processo administrativo">
                {processo.numero_processo_administrativo || '—'}
              </DrawerField>
            )}
          </DrawerSection>

          <DrawerSection title="Aquisição e liquidação">
            <DrawerField label="Instrumento">
              {processo.instrumento ? getLabel(INSTRUMENTO, processo.instrumento).label : '—'}
            </DrawerField>
            <DrawerField label="Nº RTDPJ">
              {processo.instrumento === 'registro_publico' && processo.numero_rtdpj
                ? splitRtdpj(processo.numero_rtdpj).map((n, i) => <div key={i}>{n}</div>)
                : '—'}
            </DrawerField>
            <DrawerField label="Data de aquisição">{formatDate(processo.data_aquisicao)}</DrawerField>
            <DrawerField label="Expectativa de liquidação">
              {formatDate(processo.expectativa_liquidacao)}
            </DrawerField>
            {emLiquidacao(processo.status) && (
              <DrawerField label="Data de liquidação">{formatDate(processo.data_liquidacao)}</DrawerField>
            )}
            <DrawerField label="Espécie do requisitório">
              {processo.especie_requisitorio ? (
                <Badge tone={getLabel(ESPECIE_REQUISITORIO, processo.especie_requisitorio).tone}>
                  {getLabel(ESPECIE_REQUISITORIO, processo.especie_requisitorio).label}
                </Badge>
              ) : (
                '—'
              )}
            </DrawerField>
            {/* Ocupa a linha inteira: são até três selos lado a lado. */}
            <div className="col-span-2">
              <DrawerField label="Tipo de crédito">
                {processo.tipo_credito?.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {processo.tipo_credito.map((t) => {
                      const l = getLabel(TIPO_CREDITO, t)
                      return (
                        <Badge key={t} tone={l.tone}>
                          {l.label}
                        </Badge>
                      )
                    })}
                  </div>
                ) : (
                  '—'
                )}
              </DrawerField>
            </div>
            <DrawerField label="Capital investido">{formatBRL(processo.capital_investido)}</DrawerField>
            <DrawerField label="Valor de face">{formatBRL(processo.valor_face)}</DrawerField>
            <DrawerField label="Data de referência">{formatDate(processo.data_referencia)}</DrawerField>
            <DrawerField label="Índice de atualização">
              {processo.indice_atualizacao ? getLabel(INDICE_ATUALIZACAO, processo.indice_atualizacao).label : '—'}
            </DrawerField>
            {emLiquidacao(processo.status) && (
              <>
                <DrawerField label="Já recebido">{formatBRL(processo.ja_recebido)}</DrawerField>
                <DrawerField label="Valor estimado complementar">
                  {formatBRL(processo.valor_estimado_complementar)}
                </DrawerField>
              </>
            )}
          </DrawerSection>

          <DrawerSection title={`Apensos (${apensosDoDetalhe.length})`}>
            {apensosDoDetalhe.length === 0 ? (
              <p className="col-span-2 text-sm text-slate-600">Nenhum apenso vinculado.</p>
            ) : (
              <div className="col-span-2 space-y-2">
                {apensosDoDetalhe.map((a) => (
                  <div key={a.id} className="rounded-lg border border-slate-200 p-2.5">
                    <div className="text-sm font-medium text-slate-800">{formatCNJ(a.numero || '')}</div>
                    <div className="text-xs text-slate-600">
                      {[a.classe_processual, a.tribunal, a.comarca].filter(Boolean).join(' · ') || '—'}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </DrawerSection>

          <FaseDrawerSection processo={processo} />

          {/* Histórico integral do ADVBOX — SÓ do principal. Andamento de
              apenso fica na ficha do apenso (clique no card dele): autos
              próprios, sem mistura. */}
          <DrawerHistorico numero={processo.numero_cnj} />
        </>
      )}
    </Drawer>
  )
}

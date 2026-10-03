// Quadro Econômico — Recortes da carteira.
//
// Tribunal, ente devedor e investidor. Três recortes, três abas, uma tabela só.
//
// Toda linha responde as três perguntas de dinheiro na ordem em que se pensa
// nelas: quanto capital está ali, quanto já voltou, quanto ainda falta voltar.
// Os totais são sobre TODAS as operações do grupo — a pergunta "quanto esse
// investidor já colocou" não tem nada a ver com elegibilidade para cálculo de
// performance. As colunas de rentabilidade, essas sim, são só das encerradas,
// e o selo de amostra ao lado diz sobre quantas.
//
// Os RÓTULOS dessas três colunas mudam conforme o recorte, porque a relação com
// o dinheiro é diferente em cada um: o investidor investe e recebe, o ente deve
// e paga, e o tribunal não faz nem uma coisa nem outra. Ver `COLUNAS`.
//
// O RECORTE É UM SELETOR SEGMENTADO, e não abas: a tela já mora numa aba do
// Quadro, e aba dentro de aba confunde onde se está (a regra da amostra: abas
// mudam de assunto, seletores mudam o recorte). Acima da tabela, o RANKING do
// capital por grupo (Novo), já ordenado.

import { useState } from 'react'
import { Segmented } from '@/components/ui/Segmented'
import { Table, THead, TH, TBody, TR, TD, EmptyState } from '@/components/ui/Table'
import { cn } from '@/lib/cn'
import {
  usePainel, CarregandoPainel, ErroPainel, CabecalhoDaAba, Ressalva, SeloAmostra,
  Explicacao, Painel, TABELA_NO_PAINEL, pct, brl, dias, EXPLICA, AvisoParametros,
} from './compartilhado'
import { Ranking } from './graficos'
import type { ResumoGrupo } from '@/lib/analytics'

type Aba = 'tribunal' | 'ente' | 'investidor'

/**
 * Nome próprio legível.
 *
 * A chave do grupo de investidor vem de `normalizarNome`, que é chave primária
 * de investidor_dados e portanto intocável. O `rotulo` traz a grafia original
 * com acento; aqui só se acerta a caixa. Partículas ficam minúsculas, como se
 * escreve em português — "Ercílio Martins da Costa Junior", não "Da Costa".
 */
const PARTICULAS = new Set([
  'de', 'da', 'do', 'das', 'dos', 'e', 'em', 'no', 'na', 'a', 'o', 'di', 'du', 'del', 'la',
])

/**
 * SIGLA FICA EM MAIÚSCULAS. Texto todo em caixa alta não diz o que é sigla e o
 * que é palavra — "TJGO" e "ESTADO" chegam iguais —, e a regra de caixa virava
 * o TJGO em "Tjgo", o TRF1 em "Trf1" e o "- GO" do município em "- Go". Por
 * isso uma lista: as UFs, os tribunais pelo formato do nome, e os entes que
 * aparecem na carteira. Palavra sem vogal ou com dígito também é sigla — não
 * existe palavra portuguesa assim.
 */
const UFS_SIGLA = new Set([
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA',
  'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
])
const SIGLAS = new Set(['INSS', 'IPASGO', 'GOIASPREV', 'DNIT'])
const TRIBUNAL = /^(TJM?[A-Z]{0,4}|TR[FTE]\d{0,2}|STF|STJ|STM|TST|TSE|CJF|CNJ)$/

function ehSigla(palavra: string): boolean {
  const w = palavra.toUpperCase()
  if (UFS_SIGLA.has(w) || SIGLAS.has(w) || TRIBUNAL.test(w)) return true
  if (/\d/.test(w) && /[A-Z]/.test(w)) return true
  return w.length >= 2 && /^[A-Z]+$/.test(w) && !/[AEIOUY]/.test(w)
}

/** Exportada para o teste (src/lib/__tests__/recortes.test.ts). */
export function nomeProprio(s: string): string {
  const t = s.trim()
  if (!t) return t
  // Já vem com caixa mista de propósito (ex.: sigla de tribunal): não mexer.
  if (t !== t.toLowerCase() && t !== t.toUpperCase()) return t
  return t
    .toLowerCase()
    .split(/\s+/)
    .map((p, i) => {
      if (i > 0 && PARTICULAS.has(p)) return p
      // Preserva parênteses de rótulos como "(sem investidor)".
      const m = /^([(]*)(.*?)([)]*)$/.exec(p)
      if (!m) return p
      const [, abre, meio, fecha] = m
      const caixa = meio ? meio.charAt(0).toUpperCase() + meio.slice(1) : ''
      // Sigla colada por barra ou hífen ("GOIÂNIA/GO", "TRF-1") também volta.
      const comSiglas = caixa.replace(/[\p{L}\p{N}]+/gu, (w) =>
        ehSigla(w) ? w.toUpperCase() : w,
      )
      return abre + comSiglas + fecha
    })
    .join(' ')
}

export default function Recortes() {
  const { painel, carregando, erro, tentarDeNovo } = usePainel()
  const [aba, setAba] = useState<Aba>('tribunal')

  if (carregando) return <CarregandoPainel />
  if (erro || !painel) return <ErroPainel tentarDeNovo={tentarDeNovo} />

  const grupos: Record<Aba, ResumoGrupo[]> = {
    tribunal: painel.porTribunal,
    ente: painel.porEnte,
    investidor: painel.porInvestidor,
  }
  const contexto: Record<Aba, string> = {
    tribunal: 'tribunal',
    ente: 'ente devedor',
    investidor: 'investidor',
  }

  return (
    <div className="space-y-5">
      <CabecalhoDaAba
        titulo="Recortes"
        apoio="Onde o capital está, quanto dele já voltou e quanto ainda falta voltar."
      />
      <AvisoParametros />

      <div className="flex flex-wrap items-center gap-2.5">
        <span className="text-sm font-semibold text-texto-2">Ver por</span>
        <Segmented
          ariaLabel="Agrupar por"
          value={aba}
          onChange={(v) => setAba(v as Aba)}
          items={[
            { key: 'tribunal', label: 'Tribunal' },
            { key: 'ente', label: 'Ente devedor' },
            { key: 'investidor', label: 'Investidor' },
          ]}
        />
      </div>

      <TabelaGrupos
        grupos={grupos[aba]}
        contexto={contexto[aba]}
        colunas={COLUNAS[aba]}
        concentracao={aba === 'tribunal' ? painel.concentracao : null}
      />
    </div>
  )
}

/**
 * Os nomes das três colunas de dinheiro mudam com o recorte, e não é firula.
 *
 * Só o INVESTIDOR investe e recebe — ele é o dono do dinheiro. Tribunal e ente
 * devedor não investem coisa nenhuma: o capital apenas está aplicado em créditos
 * que tramitam naquele tribunal, ou que aquele ente deve. Escrever "já investiu"
 * na linha do TJGO afirma uma relação que não existe.
 *
 * Por isso o investidor fala na voz ativa e os outros dois na voz do dinheiro.
 * Exceção proposital: o ente devedor É quem paga, então "já pagou" descreve o
 * que de fato aconteceu e é mais claro que "já foi recebido".
 */
export const COLUNAS: Record<Aba, {
  investido: string
  recebido: string
  aReceber: string
  expInvestido: string
  expRecebido: string
  expAReceber: string
}> = {
  tribunal: {
    investido: 'Capital aplicado',
    recebido: 'Já retornou',
    aReceber: 'A receber',
    expInvestido:
      'Capital investido em créditos que tramitam neste tribunal, em qualquer ' +
      'status. O tribunal não recebe investimento — o dinheiro é dos investidores ' +
      'e está nos créditos; o tribunal é onde eles correm.',
    expRecebido: 'Quanto desse capital já voltou, somando tudo que foi pago nos créditos deste tribunal.',
    expAReceber: 'Valor projetado das operações em aberto mais os complementares a receber.',
  },
  ente: {
    investido: 'Capital aplicado',
    recebido: 'Já pagou',
    aReceber: 'Ainda deve',
    expInvestido:
      'Capital investido em créditos devidos por este ente, em qualquer status. ' +
      'O ente não recebe investimento — ele é o devedor.',
    expRecebido: 'Quanto este ente já pagou, somando todos os créditos dele na carteira.',
    expAReceber:
      'Valor projetado do que ainda falta este ente pagar: operações em aberto mais ' +
      'os complementares.',
  },
  investidor: {
    investido: 'Já investiu',
    recebido: 'Já recebeu',
    aReceber: 'Falta receber',
    expInvestido:
      'Tudo que este investidor já colocou, em qualquer status: liquidadas, em ' +
      'complementar e em aberto.',
    expRecebido: 'Tudo que já voltou para ele, somando todas as operações.',
    expAReceber: 'Valor projetado das operações em aberto mais os complementares a receber.',
  },
}

function TabelaGrupos({
  grupos, contexto, colunas, concentracao,
}: {
  grupos: ResumoGrupo[]
  contexto: string
  colunas: (typeof COLUNAS)[Aba]
  concentracao: { maior: string; fracaoOperacoes: number; fracaoCapital: number; concentrada: boolean } | null
}) {
  return (
    <div className="space-y-5">
      {concentracao?.concentrada && (
        <Ressalva>
          <strong>{pct(concentracao.fracaoOperacoes)}</strong> das operações e{' '}
          <strong>{pct(concentracao.fracaoCapital)}</strong> do capital estão em{' '}
          <strong>{nomeProprio(concentracao.maior)}</strong>.
        </Ressalva>
      )}

      {grupos.length === 0 ? (
        <section className="rounded-cartao border border-borda bg-superficie shadow-nivel-1">
          <EmptyState title="Sem dados para este recorte" />
        </section>
      ) : (
        <>
          {/* O RANKING (Novo): comparação é barra, e ordenada pelo capital. Os
              números de cada linha continuam todos na tabela logo abaixo —
              inclusive os de grupo com poucas encerradas, com o selo de amostra
              ao lado dizendo quando não dá para concluir. */}
          <Painel titulo={`Capital por ${contexto}`} apoio="Do maior para o menor.">
            <Ranking
              itens={[...grupos]
                .sort((a, b) => b.capitalTotal - a.capitalTotal)
                .map((g) => ({ rotulo: nomeProprio(g.rotulo), valor: g.capitalTotal }))}
            />
          </Painel>

          <Painel titulo={`Por ${contexto}`} apoio="Ordenado por número de operações.">
            <div className="border-t border-borda">
              <Table dense className={TABELA_NO_PAINEL}>
                <THead>
                  <tr>
                    <TH>Grupo</TH>
                    <TH className="text-right">Operações</TH>
                    <TH className="text-right">Encerradas</TH>
                    <TH className="text-right">
                      <Explicacao texto={colunas.expInvestido}>{colunas.investido}</Explicacao>
                    </TH>
                    <TH className="text-right">
                      <Explicacao texto={colunas.expRecebido}>{colunas.recebido}</Explicacao>
                    </TH>
                    <TH className="text-right">
                      <Explicacao texto={colunas.expAReceber}>{colunas.aReceber}</Explicacao>
                    </TH>
                    <TH className="text-right">
                      <Explicacao texto={EXPLICA.ponderada}>Retorno ponderado</Explicacao>
                    </TH>
                    <TH className="text-right">
                      <Explicacao texto={EXPLICA.mediana}>Mediana</Explicacao>
                    </TH>
                    <TH className="text-right">
                      <Explicacao texto={EXPLICA.tir}>Anualizada</Explicacao>
                    </TH>
                    <TH className="text-right">Prazo mediano</TH>
                    <TH>
                      <Explicacao texto={EXPLICA.representatividade}>Amostra</Explicacao>
                    </TH>
                  </tr>
                </THead>
                <TBody>
                  {grupos.map((g) => (
                    <TR key={g.nome}>
                      {/* "(sem tribunal)", "(sem investidor)": o grupo de quem
                          não tem o dado aparece apagado, para não se ler como um
                          tribunal ou um investidor de verdade. */}
                      <TD className={cn('font-bold', g.nome.startsWith('(') ? 'text-texto-3' : 'text-texto')}>
                        {nomeProprio(g.rotulo)}
                      </TD>
                      <TD className="text-right tabular-nums">{g.total}</TD>
                      <TD className="text-right tabular-nums">{g.n}</TD>
                      <TD className="whitespace-nowrap text-right tabular-nums">{brl(g.capitalTotal)}</TD>
                      <TD className="whitespace-nowrap text-right tabular-nums">{brl(g.recebidoTotal)}</TD>
                      <TD className="whitespace-nowrap text-right tabular-nums">{brl(g.aReceber)}</TD>
                      <TD className="whitespace-nowrap text-right tabular-nums">{pct(g.retornoPonderado)}</TD>
                      <TD className="whitespace-nowrap text-right tabular-nums">{pct(g.retorno.mediana)}</TD>
                      <TD className="whitespace-nowrap text-right tabular-nums">{pct(g.tir.mediana)}</TD>
                      <TD className="whitespace-nowrap text-right tabular-nums">{dias(g.prazo.mediana)}</TD>
                      <TD>
                        <SeloAmostra
                          n={g.n}
                          classe={g.representatividade.classe}
                          rotulo={g.representatividade.rotulo}
                          explicacao={g.representatividade.explicacao}
                          compacto
                        />
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
          </Painel>
        </>
      )}
    </div>
  )
}

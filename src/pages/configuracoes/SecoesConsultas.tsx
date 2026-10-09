// As seções Escavador e BullAI das Configurações: as duas integrações em que
// CADA CONSULTA CUSTA, e por isso as duas que mostram saldo.

import { useId, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ChevronDown, Copy, Info, Loader2, Wallet } from 'lucide-react'
import { cn } from '@/lib/cn'
import { invokeFunction } from '@/lib/functions'
import { formatBRL } from '@/lib/format'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Field'
import { BotaoCopiar, useCopiarTexto } from '@/components/ui/BotaoCopiar'
import { Loading } from '@/components/ui/Table'
import { useToast } from '@/components/ui/Toast'
import {
  AvisoLeitura,
  CabecalhoSecao,
  CampoSegredo,
  DUAS_COLUNAS,
  GradeCampos,
  IconeAlerta,
  IconeOk,
  PILULA,
  RodapeSecao,
  Selo,
  SeloIntegracao,
  TituloBloco,
} from './comum'
import {
  configuradoDe,
  type ConsultaCatalogo,
  type ConsultaIntegracao,
  type ConsultaSaldo,
  type CreditosBullai,
} from './consultas'
import type { Pendencia } from './SecoesIntegracoes'

/** O "saldo indisponível" do cabeçalho, com o motivo do serviço no `title`. */
function SaldoIndisponivel({ motivo }: { motivo: string }) {
  return (
    // UM SELO, COMO O "Estado não carregado" ao lado (revisão visual 2): era um texto
    // âmbar solto, de outro desenho. O motivo continua na dica.
    <span className="self-center" title={motivo}>
      <Selo tom="alerta" icone={IconeAlerta}>
        Saldo indisponível
      </Selo>
    </span>
  )
}

// ----------------------- Escavador (due diligence) -----------------------
//
// O TOKEN É TESTADO ANTES DE SER GRAVADO, e não conferido por formato: o do
// Escavador é opaco, sem prefixo que se possa exigir como o "sk-ant-" da
// Anthropic, e um palpite de formato só criaria falso negativo. A função
// salvar-token-escavador gasta uma chamada em /quantidade-creditos — que não
// consome crédito — e só grava se a API responder. De quebra volta o SALDO, que
// é o número que interessa antes de sair apurando: aqui, ao contrário das
// outras integrações, CADA CONSULTA CUSTA DINHEIRO.

/**
 * O saldo da API ao lado do selo, como selo-botão que atualiza ao clicar. A
 * consulta é a da tela (`useSaldoEscavador` em Configuracoes.tsx), a mesma que o
 * menu lê — aqui só se mostra.
 */
function SeloSaldo({ saldo }: { saldo: ConsultaSaldo }) {
  const { data, isFetching, error, refetch } = saldo

  // NADA ENQUANTO CONSULTA. O número aparece em menos de um segundo, e um "…"
  // piscando ao lado do título chama mais atenção do que o próprio saldo.
  if (isFetching && !data && !error) return null

  if (error) {
    // O TEXTO DO ESCAVADOR FICA NO title — 401 é token recusado, 429 é limite de
    // chamadas, e são consertos diferentes. Na linha, só o suficiente para
    // alguém saber que há o que conferir: o selo ao lado diz "configurado", e
    // sem isto a tela afirmaria que está tudo bem.
    return <SaldoIndisponivel motivo={(error as Error).message} />
  }

  // ATUALIZA SEM SUMIR: o número fica à vista enquanto a nova consulta corre; só
  // a carteira vira o indicador de carregando.
  const Icone = isFetching ? Loader2 : Wallet
  return (
    <button
      type="button"
      onClick={() => void refetch()}
      disabled={isFetching}
      title={
        data
          ? `Saldo na API do Escavador · ${data.creditos.toLocaleString('pt-BR')} crédito(s). ` +
            'Cada consulta da diligência gasta daqui. Clique para atualizar.'
          : undefined
      }
      className={cn(
        PILULA,
        'min-h-[24px] bg-superficie-3 tabular-nums text-texto-2 ring-borda transition-colors hover:text-texto',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-anel disabled:cursor-wait',
      )}
    >
      <Icone className={cn('h-[13px] w-[13px] shrink-0', isFetching && 'animate-spin')} aria-hidden />
      Saldo {data ? data.descricao || formatBRL(data.saldo) : '—'}
    </button>
  )
}

/**
 * O endereço que o Escavador precisa conhecer para nos avisar.
 *
 * SAI DA URL DO SUPABASE, e não de uma constante escrita à mão: o projeto é o
 * mesmo que o app já usa, e um endereço digitado aqui envelheceria calado — o
 * Escavador continuaria chamando um lugar que não existe mais, e o sintoma
 * seria "os autos nunca chegam", sem nada apontando para a causa.
 */
function enderecoDoCallback(): string {
  const base = String(import.meta.env.VITE_SUPABASE_URL ?? '').replace(/\/+$/, '')
  return base ? `${base}/functions/v1/escavador-callback` : ''
}

export function SecaoEscavador({
  consulta,
  saldo,
  pendencia,
}: {
  consulta: ConsultaIntegracao
  saldo: ConsultaSaldo
  pendencia: Pendencia
}) {
  const { data, isLoading, error } = consulta
  const qc = useQueryClient()
  const toast = useToast()
  const [token, setToken] = useState('')
  const [tokenCallback, setTokenCallback] = useState('')
  // UM `saving` PARA OS DOIS SALVAR: os dois chamam a mesma função
  // (salvar-token-escavador), e dois salvamentos cruzados nela não teriam ordem.
  const [saving, setSaving] = useState(false)
  const [versaoSegredo, setVersaoSegredo] = useState(0)

  const configurado = configuradoDe(data)
  const urlCallback = enderecoDoCallback()

  async function salvarCallback() {
    if (!tokenCallback.trim()) {
      toast.error('Informe o token de callback gerado no painel do Escavador.')
      return
    }
    setSaving(true)
    try {
      await invokeFunction('salvar-token-escavador', {
        callback_token: tokenCallback.trim(),
      })
      setTokenCallback('')
      toast.success('Token de callback salvo. A partir de agora os avisos do Escavador são aceitos.')
      // O OUTRO CAMPO PODE TER SIDO COLADO E NÃO SALVO: a pendência fica com ele.
      // Antes, salvar um apagava o "não salvo" do outro, e recarregar a aba
      // perdia o token colado sem perguntar.
      pendencia(!!token.trim())
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function salvar() {
    if (!token.trim()) {
      toast.error('Informe o token do Escavador.')
      return
    }
    setSaving(true)
    try {
      const r = await invokeFunction<{ saldo?: { descricao?: string } }>(
        'salvar-token-escavador',
        { token: token.trim() },
      )
      setToken('')
      setVersaoSegredo((v) => v + 1)
      await qc.invalidateQueries({ queryKey: ['integracoes', 'escavador'] })
      // O saldo da tela é de OUTRA chave a partir de agora.
      await qc.invalidateQueries({ queryKey: ['escavador', 'saldo'] })
      toast.success(
        'Token do Escavador salvo e confirmado' +
          (r.saldo?.descricao ? `. Saldo: ${r.saldo.descricao}` : '.'),
      )
      // Mesma regra do callback: o outro campo ainda digitado segue pendente.
      pendencia(!!tokenCallback.trim())
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <CabecalhoSecao
        titulo="Integração Escavador"
        direita={
          // O SALDO AO LADO DO SELO, e não num quadro no corpo da seção. Ele é
          // um número que se confere de passagem — "ainda tenho crédito?" —, e
          // não um campo para preencher; um quadro no meio da tela de
          // configuração dava a ele o peso de uma decisão a tomar.
          <>
            {configurado && <SeloSaldo saldo={saldo} />}
            <SeloIntegracao
              error={error}
              configurado={configurado}
              rotuloOk="Token configurado"
              rotuloSem="Sem token"
            />
          </>
        }
      />
      <AvisoLeitura error={error} />
      {isLoading ? (
        <Loading />
      ) : (
        <>
          <GradeCampos>
            <CampoSegredo
              key={versaoSegredo}
              rotulo="Token de acesso"
              configurado={configurado}
              lido={!error}
              dicaConfigurado="Já configurado. Preencha apenas para substituir."
              dicaNovo="Criado em api.escavador.com/tokens. É exibido uma única vez."
              valor={token}
              aoMudar={setToken}
            />
          </GradeCampos>
          <RodapeSecao>
            <Button onClick={salvar} loading={saving}>
              Salvar
            </Button>
          </RodapeSecao>

          {/* OS AVISOS DO ESCAVADOR.

              Baixar os autos de um processo é assíncrono: pede-se, e a
              resposta vem minutos ou horas depois. Perguntar "já foi?" de
              tempos em tempos enche o log da conta e não acelera nada — o
              caminho deles é o inverso, eles avisam. Para isso precisam saber
              nosso endereço, e nós precisamos saber que o aviso é mesmo deles;
              daí os dois campos abaixo, que se preenchem UMA vez. */}
          <div className="mt-s6">
            <TituloBloco>Avisos automáticos (callback)</TituloBloco>
            <GradeCampos>
              <Field
                label="URL para cadastrar no Escavador"
                hint="Cole este endereço em api.escavador.com/callbacks."
                className={DUAS_COLUNAS}
              >
                <div className="flex items-center gap-s1.5">
                  <Input
                    value={urlCallback}
                    readOnly
                    className="min-w-0 flex-1 tabular-nums"
                    onFocus={(e) => e.target.select()}
                  />
                  {/* O COPIAR DA PLATAFORMA (revisão visual 2), na altura do campo: o ✓
                      de copiado e a mesma saída quando o navegador recusa. */}
                  <BotaoCopiar
                    valor={urlCallback}
                    rotulo="Copiar o endereço"
                    aviso="Endereço copiado."
                    tamanho="md"
                    className="h-controle w-controle"
                  />
                </div>
              </Field>
              <Field
                label="Token de callback"
                hint="Gerado no painel do Escavador. É ele que prova que o aviso veio de lá."
              >
                <Input
                  type="password"
                  value={tokenCallback}
                  onChange={(e) => setTokenCallback(e.target.value)}
                  placeholder="••••••••••••"
                  autoComplete="off"
                />
              </Field>
            </GradeCampos>
            <RodapeSecao>
              <Button variant="secondary" onClick={salvarCallback} loading={saving}>
                Salvar token de callback
              </Button>
            </RodapeSecao>
          </div>
        </>
      )}
    </>
  )
}

// ----------------------- BullAI (emissão de certidões) -----------------------

/**
 * A BullAI emite as certidões da due diligence: recebe um CPF ou CNPJ e a
 * lista de portais, e devolve os PDFs com o resultado de cada certidão.
 *
 * O CATÁLOGO APARECE AQUI, e não só na diligência, porque é a pergunta que
 * vem antes de tudo — "que certidões ela sabe buscar?" — e porque é por ele
 * que se confere se a chave gravada é a da conta certa. O SALDO ao lado do
 * título, como no Escavador: cada portal pedido gasta uma consulta do plano.
 */
export function SecaoBullai({
  consulta,
  catalogo,
  pendencia,
}: {
  consulta: ConsultaIntegracao
  catalogo: ConsultaCatalogo
  pendencia: Pendencia
}) {
  const { data, isLoading, error } = consulta
  const qc = useQueryClient()
  const toast = useToast()
  const copiar = useCopiarTexto()
  const [token, setToken] = useState('')
  const [saving, setSaving] = useState(false)
  const [verCatalogo, setVerCatalogo] = useState(false)
  const [versaoSegredo, setVersaoSegredo] = useState(0)
  const idTabela = useId()
  const configurado = configuradoDe(data)

  async function salvar() {
    if (!token.trim()) {
      toast.error('Informe a chave da BullAI.')
      return
    }
    setSaving(true)
    try {
      const r = await invokeFunction<{ creditos?: CreditosBullai }>('salvar-token-bullai', { token: token.trim() })
      setToken('')
      setVersaoSegredo((v) => v + 1)
      await qc.invalidateQueries({ queryKey: ['integracoes', 'bullai'] })
      await qc.invalidateQueries({ queryKey: ['bullai', 'catalogo'] })
      const c = r.creditos
      toast.success(
        'Chave da BullAI salva e confirmada' +
          (c ? (c.restantes == null ? '. Plano ilimitado.' : `. ${c.restantes} consulta(s) restante(s).`) : '.'),
      )
      pendencia(false)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const c = catalogo.data?.creditos
  const portais = catalogo.data?.portais ?? []
  const automaticos = portais.filter((p) => !p.presencial)

  function copiarLista() {
    // A LISTA INTEIRA, em colunas separadas por tabulação: cola direto numa
    // planilha ou numa conversa. O catálogo não é segredo — segredo é só a
    // chave, que não vai junto.
    const TAB = String.fromCharCode(9)
    const QUEBRA = String.fromCharCode(10)
    const linhas = portais.map((p) =>
      [p.rotulo, p.documento, p.presencial ? 'presencial' : 'automática', p.chave].join(TAB),
    )
    void copiar([['Certidão', 'Documento', 'Como', 'Chave'].join(TAB), ...linhas].join(QUEBRA), 'Catálogo copiado.')
  }

  // O `.link-btn` da amostra: botão com cara de link, 28px de alvo.
  const linkBtn =
    '-ml-s2 inline-flex h-controle-sm items-center gap-s1.5 rounded-controle px-s2 text-sm font-semibold text-marca-texto transition-colors hover:bg-marca-leve focus:outline-none focus-visible:ring-2 focus-visible:ring-anel'

  return (
    <>
      <CabecalhoSecao
        titulo="Integração BullAI"
        direita={
          <>
            {configurado && c && (
              <span
                className={cn(PILULA, 'bg-info-fundo text-info ring-info-borda')}
                title="Cada portal pedido gasta uma consulta do plano."
              >
                <Info className="h-[13px] w-[13px] shrink-0" aria-hidden />
                {c.restantes == null ? 'Plano ilimitado' : `${c.restantes.toLocaleString('pt-BR')} consulta(s)`}
              </span>
            )}
            {configurado && catalogo.error && (
              <SaldoIndisponivel motivo={(catalogo.error as Error).message} />
            )}
            <SeloIntegracao error={error} configurado={configurado} rotuloOk="Chave configurada" rotuloSem="Sem chave" />
          </>
        }
      />
      <AvisoLeitura error={error} />
      {isLoading ? (
        <Loading />
      ) : (
        <>
          <GradeCampos>
            <CampoSegredo
              key={versaoSegredo}
              rotulo="Chave da API"
              configurado={configurado}
              lido={!error}
              dicaConfigurado="Já configurada. Preencha apenas para substituir."
              dicaNovo="Criada na BullAI em Configurações › Chaves de API. É mostrada uma única vez."
              valor={token}
              aoMudar={setToken}
            />
          </GradeCampos>
          <RodapeSecao>
            <Button onClick={salvar} loading={saving}>
              Salvar
            </Button>
          </RodapeSecao>

          {configurado && portais.length > 0 && (
            <div className="mt-s3 flex flex-wrap items-center gap-x-s3 gap-y-s2">
              <button
                type="button"
                className={linkBtn}
                aria-expanded={verCatalogo}
                aria-controls={idTabela}
                onClick={() => setVerCatalogo((v) => !v)}
              >
                <ChevronDown
                  className={cn('h-[16px] w-[16px] transition-transform duration-150', verCatalogo && 'rotate-180')}
                  aria-hidden
                />
                {verCatalogo
                  ? 'Esconder o catálogo'
                  : `Ver as ${portais.length} certidões que ela busca (${automaticos.length} automáticas)`}
              </button>
              {verCatalogo && (
                <button type="button" className={linkBtn} onClick={copiarLista}>
                  <Copy className="h-[16px] w-[16px]" aria-hidden />
                  Copiar a lista
                </button>
              )}
            </div>
          )}
          {verCatalogo && (
            <div
              id={idTabela}
              className="relative mt-s2 max-h-96 overflow-auto rounded-cartao border border-borda scrollbar-thin"
            >
              <table className="w-full border-collapse text-left text-corpo">
                <thead className="sticky top-0 z-cabecalho bg-superficie-2 font-display text-xs font-bold uppercase tracking-[0.06em] text-texto-3">
                  <tr>
                    <th className="px-s3 py-s2 font-bold">Certidão</th>
                    <th className="px-s3 py-s2 font-bold">Documento</th>
                    <th className="px-s3 py-s2 font-bold">Como</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-borda">
                  {portais.map((p) => (
                    <tr key={p.chave} title={p.criterio}>
                      <td className="px-s3 py-s2 text-texto">{p.rotulo}</td>
                      <td className="px-s3 py-s2 text-texto-2">{p.documento}</td>
                      <td className="px-s3 py-s2">
                        {p.presencial ? (
                          <Selo tom="neutro">presencial — não automatiza</Selo>
                        ) : (
                          <Selo tom="ok" icone={IconeOk}>
                            automática
                          </Selo>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  )
}

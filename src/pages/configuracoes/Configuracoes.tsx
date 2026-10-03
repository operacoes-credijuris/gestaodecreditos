import { useCallback, useMemo, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import { Pencil } from 'lucide-react'
import { cn } from '@/lib/cn'
import { formatBRL } from '@/lib/format'
import type { ConfigKommo } from '@/lib/types'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card } from '@/components/ui/Card'
import {
  configuradoDe,
  useCatalogoBullai,
  useIntegracao,
  useSaldoEscavador,
} from './consultas'
import {
  GRUPOS_DO_MENU,
  SECAO_INICIAL,
  extraDoMenu,
  pontoDaIntegracao,
  pontoDoKommo,
  textoDoPlanoBullai,
  type ExtraDoMenu,
  type PontoDoMenu,
  type SecaoId,
} from '@/lib/menuDasConfiguracoes'
import {
  SecaoAdvbox,
  SecaoAnthropic,
  SecaoDjen,
  SecaoKommo,
  type Pendencia,
} from './SecoesIntegracoes'
import { SecaoBullai, SecaoEscavador } from './SecoesConsultas'
import { SecaoRoteiro, SecaoSkills } from './SecoesAssistente'
import { SecaoUsuarios } from './SecaoUsuarios'

/**
 * As seções em que digitar num campo já conta como "alteração não salva". O
 * Roteiro fica de fora porque tem regra própria (o texto diferir do que está em
 * vigor — voltar ao texto salvo apaga a pendência); Usuários, porque não tem
 * campo na própria seção — os campos dele vivem nas janelas.
 */
const MARCA_AO_DIGITAR: ReadonlySet<SecaoId> = new Set<SecaoId>([
  'advbox', 'kommo', 'anthropic', 'escavador', 'bullai', 'djen', 'skills',
])

/**
 * CONFIGURAÇÕES EM SEÇÕES, com menu à esquerda.
 *
 * Eram nove cartões empilhados: para chegar a Usuários, rolava-se por todas as
 * integrações. Agora o menu leva direto à seção — mas TODAS AS SEÇÕES CONTINUAM
 * MONTADAS, só a escolhida à vista (as outras com `hidden`, nunca desmontadas).
 * É isso que mantém o que os cartões empilhados já garantiam:
 * - trocar de seção não apaga rascunho (o Roteiro tem ~17 mil caracteres);
 * - as consultas da abertura continuam saindo ao abrir a tela, em qualquer seção
 *   à vista: o saldo do Escavador, o catálogo da BullAI e os responsáveis da
 *   ADVBOX.
 *
 * A SEÇÃO ESCOLHIDA FICA NO ESTADO, NÃO NA URL: `/configuracoes/usuarios` tem de
 * continuar caindo em "página não encontrada" (rotas.test.ts), e o guarda de
 * administrador mora na rota única `/configuracoes`.
 */
export default function Configuracoes() {
  const [secao, setSecao] = useState<SecaoId>(SECAO_INICIAL)
  const [pendentes, setPendentes] = useState<ReadonlySet<SecaoId>>(() => new Set())

  // AS CONSULTAS QUE O MENU E OS CARTÕES DIVIDEM sobem para cá: uma chamada só,
  // e o ponto do menu acompanha o selo do cartão no mesmo instante, inclusive
  // depois de salvar (a invalidação do cartão atualiza as duas pontas).
  const advbox = useIntegracao('advbox')
  const kommo = useIntegracao('kommo')
  const anthropic = useIntegracao('anthropic')
  const escavador = useIntegracao('escavador')
  const bullai = useIntegracao('bullai')
  const escavadorConfigurado = configuradoDe(escavador.data)
  const bullaiConfigurado = configuradoDe(bullai.data)
  const saldo = useSaldoEscavador(escavadorConfigurado)
  const catalogo = useCatalogoBullai(bullaiConfigurado)

  const marcar = useCallback((k: SecaoId, sim: boolean) => {
    setPendentes((atual) => {
      if (atual.has(k) === sim) return atual
      const novo = new Set(atual)
      if (sim) novo.add(k)
      else novo.delete(k)
      return novo
    })
  }, [])

  // Um callback ESTÁVEL por seção: o Roteiro o usa num efeito, e um callback
  // novo a cada render dispararia o efeito à toa.
  const pendencia = useMemo(() => {
    const m = {} as Record<SecaoId, Pendencia>
    for (const g of GRUPOS_DO_MENU) for (const i of g.itens) m[i.id] = (sim) => marcar(i.id, sim)
    return m
  }, [marcar])

  const cfgKommo = (kommo.data?.config as ConfigKommo | undefined) ?? {}
  const pontos: Partial<Record<SecaoId, PontoDoMenu>> = {
    advbox: pontoDaIntegracao(advbox.error, configuradoDe(advbox.data)),
    kommo: pontoDoKommo(kommo.error, Boolean(cfgKommo.configurado), Boolean(cfgKommo.validado)),
    anthropic: pontoDaIntegracao(anthropic.error, configuradoDe(anthropic.data)),
    escavador: pontoDaIntegracao(escavador.error, escavadorConfigurado),
    bullai: pontoDaIntegracao(bullai.error, bullaiConfigurado),
  }
  const extras: Partial<Record<SecaoId, ExtraDoMenu | null>> = {
    escavador: extraDoMenu(
      escavadorConfigurado,
      saldo.data,
      saldo.error,
      (d) => d.descricao || formatBRL(d.saldo),
      'Saldo na API do Escavador',
    ),
    bullai: extraDoMenu(
      bullaiConfigurado,
      // OS CRÉDITOS, e não a resposta inteira: o cartão só mostra o plano quando
      // eles vieram (`configurado && c`), e o menu segue a mesma regra.
      catalogo.data?.creditos,
      catalogo.error,
      (c) => textoDoPlanoBullai(c.restantes),
      'Plano da BullAI',
    ),
  }

  const conteudo: Record<SecaoId, ReactNode> = {
    advbox: <SecaoAdvbox consulta={advbox} pendencia={pendencia.advbox} />,
    kommo: <SecaoKommo consulta={kommo} pendencia={pendencia.kommo} />,
    anthropic: <SecaoAnthropic consulta={anthropic} pendencia={pendencia.anthropic} />,
    escavador: <SecaoEscavador consulta={escavador} saldo={saldo} pendencia={pendencia.escavador} />,
    bullai: <SecaoBullai consulta={bullai} catalogo={catalogo} pendencia={pendencia.bullai} />,
    djen: <SecaoDjen pendencia={pendencia.djen} />,
    skills: <SecaoSkills pendencia={pendencia.skills} />,
    roteiro: <SecaoRoteiro pendencia={pendencia.roteiro} />,
    usuarios: <SecaoUsuarios />,
  }

  /**
   * Qualquer campo mexido na seção acende o lápis dela no menu. Só o que nasce
   * DENTRO da seção conta: o React propaga o evento de uma janela (que vai para
   * o <body> por portal) até o componente que a abriu, e uma janela cancelada
   * não deixa nada pendente na seção.
   */
  function aoMudarCampo(k: SecaoId, e: FormEvent<HTMLElement>) {
    if (!MARCA_AO_DIGITAR.has(k)) return
    if (!e.currentTarget.contains(e.target as Node)) return
    marcar(k, true)
  }

  return (
    <div>
      <PageHeader
        title="Configurações"
        description="Integrações, assistente e equipe. Só administradores veem esta tela."
      />
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-[16px] min-[900px]:grid-cols-[230px_minmax(0,1fr)]">
        <MenuDasSecoes
          secao={secao}
          aoEscolher={setSecao}
          pontos={pontos}
          extras={extras}
          pendentes={pendentes}
        />
        <Card className="p-[20px]">
          {GRUPOS_DO_MENU.flatMap((g) => g.itens).map(({ id, rotulo }) => (
            // SEM CLASSE DE display AQUI: uma `flex` ou `block` venceria o
            // `[hidden]` do preflight e mostraria todas as seções de uma vez.
            <section
              key={id}
              aria-label={rotulo}
              hidden={id !== secao}
              onChange={(e) => aoMudarCampo(id, e)}
            >
              {conteudo[id]}
            </section>
          ))}
        </Card>
      </div>
    </div>
  )
}

const COR_DO_PONTO: Record<PontoDoMenu['tom'], string> = {
  ok: 'bg-sucesso-cheio',
  off: 'bg-texto-3',
  aviso: 'bg-aviso-cheio',
}

/**
 * O menu das seções. No celular vira uma fileira que rola de lado, e os títulos
 * dos grupos somem (não cabem numa linha). As setas andam entre os itens; Enter
 * ou Espaço abrem a seção, como em qualquer botão.
 */
function MenuDasSecoes({
  secao,
  aoEscolher,
  pontos,
  extras,
  pendentes,
}: {
  secao: SecaoId
  aoEscolher: (k: SecaoId) => void
  pontos: Partial<Record<SecaoId, PontoDoMenu>>
  extras: Partial<Record<SecaoId, ExtraDoMenu | null>>
  pendentes: ReadonlySet<SecaoId>
}) {
  function andarComSetas(e: KeyboardEvent<HTMLElement>) {
    const passo =
      e.key === 'ArrowDown' || e.key === 'ArrowRight'
        ? 1
        : e.key === 'ArrowUp' || e.key === 'ArrowLeft'
          ? -1
          : 0
    const extremo = e.key === 'Home' ? 'inicio' : e.key === 'End' ? 'fim' : null
    if (!passo && !extremo) return
    const botoes = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button[data-secao]'))
    const atual = botoes.indexOf(document.activeElement as HTMLButtonElement)
    if (atual < 0) return
    e.preventDefault()
    const alvo =
      extremo === 'inicio'
        ? 0
        : extremo === 'fim'
          ? botoes.length - 1
          : (atual + passo + botoes.length) % botoes.length
    botoes[alvo].focus()
  }

  return (
    <nav
      aria-label="Seções das configurações"
      onKeyDown={andarComSetas}
      // NO CELULAR, A FILEIRA QUE ROLA DE LADO:
      // - `scrollbar-thin`, a barra fina da casa. Sem ela aparecia a barra NATIVA
      //   do Windows, com as setinhas, embaixo das seções — no escuro, um
      //   trilho claro atravessando a tela;
      // - `relative`, para os `sr-only` dos pontos de estado (o "(Token
      //   configurado)" de cada item) se medirem por esta fileira, e não pelo
      //   <main>. O do último item, fora da vista, alargava a página e a tela
      //   inteira rolava de lado.
      className="relative flex gap-[2px] overflow-x-auto p-[3px] scrollbar-thin min-[900px]:sticky min-[900px]:top-[80px] min-[900px]:flex-col min-[900px]:overflow-visible min-[900px]:p-0"
    >
      {GRUPOS_DO_MENU.map((g, gi) => (
        <div key={g.titulo} className="contents">
          <div
            className={cn(
              'hidden px-[10px] pb-[6px] font-display text-xs font-bold uppercase tracking-wider text-texto-3 min-[900px]:block',
              gi === 0 ? 'pt-0' : 'pt-[14px]',
            )}
          >
            {g.titulo}
          </div>
          {g.itens.map(({ id, rotulo }) => {
            const ativo = id === secao
            const ponto = pontos[id]
            const extra = extras[id]
            return (
              <button
                key={id}
                type="button"
                data-secao={id}
                aria-current={ativo ? 'true' : undefined}
                onClick={() => aoEscolher(id)}
                className={cn(
                  'flex h-[36px] shrink-0 items-center gap-2 whitespace-nowrap rounded-controle px-[10px] text-left text-corpo font-medium text-texto-2 transition-colors',
                  'hover:bg-superficie-3 hover:text-texto focus:outline-none focus-visible:ring-2 focus-visible:ring-anel',
                  ativo &&
                    'bg-superficie font-bold text-marca-texto shadow-nivel-1 hover:bg-superficie hover:text-marca-texto',
                )}
              >
                <span className="min-w-0 truncate">{rotulo}</span>
                <span className="ml-auto inline-flex shrink-0 items-center gap-[6px]">
                  {extra && (
                    <span
                      className={cn(
                        'text-xs font-medium tabular-nums',
                        extra.aviso ? 'text-aviso' : 'text-texto-3',
                      )}
                      title={extra.title}
                    >
                      {extra.texto}
                    </span>
                  )}
                  {pendentes.has(id) && (
                    <span
                      role="img"
                      aria-label="alterações não salvas"
                      title="Alterações não salvas nesta seção"
                      className="inline-flex text-aviso"
                    >
                      <Pencil className="h-[14px] w-[14px]" aria-hidden />
                    </span>
                  )}
                  {ponto && (
                    <>
                      <span
                        aria-hidden
                        title={ponto.rotulo}
                        className={cn('inline-block h-[9px] w-[9px] rounded-full', COR_DO_PONTO[ponto.tom])}
                      />
                      <span className="sr-only">({ponto.rotulo})</span>
                    </>
                  )}
                </span>
              </button>
            )
          })}
        </div>
      ))}
    </nav>
  )
}

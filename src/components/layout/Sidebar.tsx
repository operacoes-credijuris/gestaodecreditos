import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ChevronsLeft, ChevronsRight, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { haDialogoAberto, useFocoPreso, useTravaScroll } from '@/lib/dialogo'
import { useJanelaAberta } from '@/lib/janelasAbertas'
import { decidirAtalho, qualAtalho, TECLA_DO_MENU } from '@/lib/atalhos'
import { useAuth } from '@/contexts/AuthContext'
import { Dica } from '@/components/ui/Dica'
import { NAVIGATION, NAV_CONFIG, itemAtivo, type NavLeaf } from './navigation'
import { useContadoresDoMenu } from './useContadoresDoMenu'
import {
  CONTADOR_DO_ITEM,
  mostraContador,
  numeroDoContador,
  rotuloDoItemRecolhido,
  textoDoContador,
} from '@/lib/contadoresDoMenu'
import {
  PREF_MENU_RECOLHIDO,
  PREF_QUADRO_ABA,
  gravarPreferencia,
  lerMenuRecolhido,
  lerPreferenciaValida,
  umaDas,
} from '@/lib/preferencias'
import marca from '@/assets/marca-credijuris.png'

/** O contador do que pede ação (publicações novas, tarefas vencidas). */
interface ContadorDoItem {
  numero: string
  texto: string
  alerta: boolean
}

/**
 * O ITEM DO MENU (auditoria visual de 03/10/2026, §1): 36px de altura (44px no
 * celular), ícone de 18px, 12px de recuo e de vão. Aceso: o fundo azul do item,
 * a barra verde na borda do menu e o PESO 600 — uma pista que não é só cor
 * (WCAG 1.4.1). Sob o mouse, o branco a 8% (6% mal se via no navy). O foco do
 * teclado é o anel claro do menu (`nav-foco`, 7:1), POR DENTRO do item, para o
 * `overflow` do <nav> não o cortar.
 */
const classeDoItem = (opcoes: { ativo?: boolean; forte?: boolean; recolhido: boolean; celular: boolean }) =>
  cn(
    'relative flex items-center gap-s3 rounded-controle px-s3 my-s0.5 text-corpo transition-colors',
    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-nav-foco',
    opcoes.celular ? 'h-[44px]' : 'h-[36px]',
    opcoes.forte ? 'font-bold text-white' : opcoes.ativo ? 'font-semibold' : 'font-medium',
    opcoes.ativo
      ? // A BARRA VERDE fica 12px para fora do item, encostada na lateral do
        // menu (o `px-s3` do <nav>; 8px no recolhido). Desenhada por cima: o
        // rótulo não "pula" quando ela aparece.
        cn(
          'bg-nav-ativo text-white before:absolute before:inset-y-s2 before:w-[3px] before:rounded-r before:bg-acento',
          opcoes.recolhido ? 'before:-left-s2' : 'before:-left-s3',
        )
      : 'text-nav-texto hover:bg-white/[0.08] hover:text-white',
    opcoes.recolhido && 'mx-auto w-[48px] justify-center px-0',
  )

function LeafLink({
  item,
  destino,
  ativo,
  forte = false,
  onNavigate,
  contador,
  recolhido = false,
  celular = false,
}: {
  item: NavLeaf
  /** Para onde o link leva, quando não é o `to` do item (a aba lembrada do Quadro). */
  destino?: string
  /** Se o item está aceso — decidido por `itemAtivo`, um só para o menu inteiro. */
  ativo: boolean
  /** Em negrito: o item do topo, fora das seções (o `.sb-topo` da amostra). */
  forte?: boolean
  onNavigate?: () => void
  /** A pílula do que pede ação (publicações novas, tarefas vencidas). */
  contador?: ContadorDoItem
  /** Menu recolhido: só o ícone, e o nome (com o contador) vai para a dica. */
  recolhido?: boolean
  /** Na gaveta do celular: alvos de 44px. */
  celular?: boolean
}) {
  const { to: endereco, label, icon: Icon } = item
  // NO MENU, O NOME CURTO (`rotuloCurto`): "Publicações e movimentações" e
  // "Requerimentos administrativos" quebravam em duas linhas e desfaziam o
  // ritmo de 36px. O nome inteiro continua no título da tela, no caminho do
  // topo, na aba do navegador — e na dica e no nome para o leitor de tela do
  // menu recolhido, logo abaixo.
  const rotulo = item.rotuloCurto ?? label
  // RECOLHIDO, O ÍCONE SOZINHO PRECISA DIZER O NOME: na dica e para o leitor de
  // tela, com o contador junto ("Tarefas · 2 tarefas vencidas").
  const nomeRecolhido = recolhido ? rotuloDoItemRecolhido(label, contador?.texto) : undefined
  const link = (
    <Link
      to={destino ?? endereco}
      // QUEM ACENDE O ITEM É `itemAtivo` (navigation.ts), não o casamento do
      // NavLink. O Quadro econômico é um item só que precisa ficar aceso nas
      // cinco abas, e o NavLink só faz isso por PREFIXO (sem o `end`) — o
      // defeito corrigido em e9c405e, em que "Visão Geral" (/inteligencia) ficava
      // aceso junto com as subtelas embaixo dele. `itemAtivo` acende pelos
      // endereços que cada item declara, por igualdade.
      aria-current={ativo ? 'page' : undefined}
      aria-label={nomeRecolhido}
      onClick={onNavigate}
      className={classeDoItem({ ativo, forte, recolhido, celular })}
    >
      <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden />
      {!recolhido && <span className="min-w-0 truncate">{rotulo}</span>}
      {!recolhido && contador && (
        // O NÚMERO É SÓ PARA OS OLHOS; o leitor de tela ouve o texto por extenso
        // ("5 publicações novas"). Sem aria-live: o menu não anuncia sozinho.
        <b
          title={contador.texto}
          className={cn(
            'ml-auto grid h-[20px] min-w-[22px] shrink-0 place-items-center rounded-full px-[7px] text-xs font-bold tabular-nums text-white',
            contador.alerta ? 'bg-perigo-cheio' : 'bg-white/[0.12]',
          )}
        >
          <span aria-hidden>{contador.numero}</span>
          <span className="sr-only">, {contador.texto}</span>
        </b>
      )}
      {recolhido && contador && (
        // RECOLHIDO, O NÚMERO NO CANTO DO ÍCONE: o menu recolhido escondia
        // justamente o que pede ação. O anel da cor do fundo descola o número
        // do ícone. O texto por extenso já está no nome do link.
        <b
          aria-hidden
          className={cn(
            'absolute right-[4px] top-[3px] grid h-[16px] min-w-[16px] place-items-center rounded-full px-[4px] text-xs font-bold leading-none tabular-nums text-white ring-2',
            contador.alerta ? 'bg-perigo-cheio' : 'bg-marca',
            ativo ? 'ring-nav-ativo' : 'ring-nav',
          )}
        >
          {contador.numero}
        </b>
      )}
    </Link>
  )
  return (
    <Dica
      desligada={!recolhido}
      texto={
        <>
          <span className="font-semibold">{label}</span>
          {contador && <span className="opacity-80"> · {contador.texto}</span>}
        </>
      }
    >
      {link}
    </Dica>
  )
}

export function Sidebar({
  mobileOpen,
  onClose,
}: {
  mobileOpen: boolean
  onClose: () => void
}) {
  const { isAdmin } = useAuth()
  const { pathname } = useLocation()
  // UM ITEM ACESO, NO MÁXIMO, para o menu inteiro (ver `itemAtivo`).
  const ativo = itemAtivo(pathname)

  // Drawer mobile animado: `rendered` mantém o nó montado durante a saída;
  // `visible` controla as classes de "aberto" (translate/fade).
  const [rendered, setRendered] = useState(mobileOpen)
  const [visible, setVisible] = useState(mobileOpen)
  const painelRef = useRef<HTMLDivElement>(null)
  const ehTopo = useFocoPreso(mobileOpen, painelRef)
  useTravaScroll(mobileOpen)
  // O menu do celular não tem nada digitado: o Ctrl+K o fecha e abre a busca.
  useJanelaAberta(mobileOpen, false, onClose)

  useEffect(() => {
    if (mobileOpen) {
      setRendered(true)
      // Dois rAFs garantem que o navegador pinte o estado inicial (fechado)
      // antes de aplicar as classes de aberto — senão a transição não ocorre.
      let raf2 = 0
      const raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => setVisible(true))
      })
      return () => {
        cancelAnimationFrame(raf1)
        cancelAnimationFrame(raf2)
      }
    }
    setVisible(false)
    // Desmonta só depois da animação de saída (mesma duração do duration-200).
    const timer = setTimeout(() => setRendered(false), 200)
    return () => clearTimeout(timer)
  }, [mobileOpen])

  // Fecha o drawer mobile com Escape.
  useEffect(() => {
    if (!mobileOpen) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && ehTopo()) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [mobileOpen, onClose])

  // CONTADORES do que pede ação, ao lado do nome (item "Novo" da amostra).
  const contagens = useContadoresDoMenu()
  const contadorDo = (item: NavLeaf): ContadorDoItem | undefined => {
    const qual = CONTADOR_DO_ITEM[item.to]
    const n = qual ? contagens[qual] : undefined
    if (!qual || !mostraContador(n)) return undefined
    // Tarefa vencida é prazo estourado: a pílula vai no vermelho de perigo.
    return { numero: numeroDoContador(n), texto: textoDoContador(qual, n), alerta: qual === 'tarefas' }
  }

  // RECOLHER O MENU (item "Novo" da amostra): mais espaço para as listas, e o
  // menu fica só nos ícones. Lembrado no navegador de cada pessoa
  // (lib/preferencias.ts). Só no computador: no celular o menu já é gaveta.
  // SEM ESCOLHA GUARDADA, ABAIXO DE 1366PX ELE COMEÇA RECOLHIDO (AP3, aprovado
  // pelo dono em 03/10/2026): a 1280px o menu aberto apertava as tabelas. A
  // escolha da pessoa — pelo botão ou pelo "[" — vence sempre.
  const [recolhido, setRecolhido] = useState(() => lerMenuRecolhido())
  const alternarRecolhido = useCallback(() => {
    setRecolhido((atual) => {
      gravarPreferencia(PREF_MENU_RECOLHIDO, !atual)
      return !atual
    })
  }, [])

  // O "[" RECOLHE E ABRE (lib/atalhos.ts): as mesmas regras do "/" — digitando,
  // ou com uma janela aberta, não age. No celular não há o que recolher.
  useEffect(() => {
    function aoTeclar(e: KeyboardEvent) {
      if (e.defaultPrevented || qualAtalho(e) !== 'menu') return
      if (decidirAtalho('menu', e.target as HTMLElement | null, haDialogoAberto()) !== 'agir') return
      if (!window.matchMedia('(min-width: 1024px)').matches) return
      e.preventDefault()
      alternarRecolhido()
    }
    document.addEventListener('keydown', aoTeclar)
    return () => document.removeEventListener('keydown', aoTeclar)
  }, [alternarRecolhido])

  // O ITEM DE MOLDURA (o Quadro econômico) VOLTA À ÚLTIMA ABA ABERTA, que a
  // moldura guarda. Lido a cada desenho do menu — ele se redesenha a cada troca
  // de tela, que é quando a aba muda. Valor que não é aba de hoje: o `to`.
  const abaLembrada = (item: NavLeaf) =>
    item.abas
      ? lerPreferenciaValida(PREF_QUADRO_ABA, item.to, umaDas(item.abas.map((a) => a.to)))
      : undefined

  const conteudo = (recolhido: boolean, celular: boolean) => (
    // O navy chapado da amostra (--nav-bg), e não o degradê de antes. A BORDA À
    // DIREITA, nos dois temas, separa o menu do conteúdo no escuro, onde o navy
    // ficava quase igual ao papel (auditoria visual, E1).
    <div className="flex h-full flex-col border-r border-white/[0.06] bg-nav text-white">
      <div
        className={cn(
          'flex h-[64px] shrink-0 items-center gap-s3 border-b border-white/[0.07]',
          recolhido ? 'justify-center px-0' : 'px-s4',
        )}
      >
        {/* A logomarca real (o "U" azul #0B81C5) sobre placa branca: é a única
            forma fiel de exibi-la no fundo navy sem recolorir a marca. BRANCO
            FIXO, e não `bg-superficie`: no modo escuro a superfície escurece, e
            a placa tem de continuar branca (regra da marca); o contorno de 10%
            tira o ofuscamento no escuro (E5). RECOLHIDO, A PLACA FICA, sozinha
            e centrada: a marca ancora o canto nos dois estados. */}
        <div className="grid h-[32px] w-[32px] shrink-0 place-items-center rounded-controle bg-white p-[5px] ring-1 ring-black/10">
          <img src={marca} alt={recolhido ? 'Credijuris' : ''} className="h-full w-full object-contain" />
        </div>
        {!recolhido && (
          <div className="min-w-0">
            <p className="font-display text-xl font-extrabold leading-[22px] tracking-tight text-white">
              Credijuris
            </p>
            <p className="text-xs text-nav-apagado">Gestão de créditos</p>
          </div>
        )}
        {celular && (
          <button
            onClick={onClose}
            className="ml-auto grid h-[44px] w-[44px] shrink-0 place-items-center rounded-controle text-nav-apagado transition-colors hover:bg-white/[0.08] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-nav-foco"
            aria-label="Fechar menu"
          >
            <X className="h-[20px] w-[20px]" aria-hidden />
          </button>
        )}
      </div>

      <nav className="relative flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin">
        <div className={cn('pb-s4 pt-s3', recolhido ? 'px-s2' : 'px-s3')}>
          {NAVIGATION.map((section, idx) => {
            // A seção que contém a rota ativa fica mais visível — responde
            // "em que setor do negócio estou?" sem varrer a lista inteira. Pelo
            // MESMO item aceso, para o título do setor e o item nunca discordarem.
            const sectionActive = section.items.some((i) => i.to === ativo)
            return (
              <div
                key={idx}
                className={cn(
                  // A seção sem título (a Análise de crédito, no topo) fica
                  // separada das outras por uma linha, com o item em negrito.
                  !section.title ? 'mb-s2 border-b border-white/10 pb-s3' : 'mt-s5',
                )}
              >
                {/* O título do setor; recolhido, um traço no lugar dele. A caixa
                    alta é só estilo de rótulo (AP4: mantida). */}
                {section.title &&
                  (recolhido ? (
                    <div className="mx-s2 mb-s3 h-px bg-white/10" aria-hidden />
                  ) : (
                    <p
                      className={cn(
                        'font-display px-s3 pb-s2 text-xs font-bold uppercase tracking-[0.06em]',
                        sectionActive ? 'text-acento' : 'text-nav-apagado',
                      )}
                    >
                      {section.title}
                    </p>
                  ))}
                {section.items.map((item) => (
                  // O RESPIRO de 8px separa os grupos de uma seção sem título novo:
                  // em Operacional, rotina › consulta › leitura.
                  <div key={item.to} className={cn(item.respiro && 'mt-s2')}>
                    <LeafLink
                      item={item}
                      destino={abaLembrada(item)}
                      ativo={item.to === ativo}
                      forte={!section.title}
                      onNavigate={onClose}
                      contador={contadorDo(item)}
                      recolhido={recolhido}
                      celular={celular}
                    />
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      </nav>

      {/* O RODAPÉ: Configurações (administrador) e o "Recolher menu" (todos, só
          no computador). Fitts: o canto de baixo é estável e fácil de achar, e
          o controle fica no mesmo lugar nos dois estados — antes ele morava no
          cabeçalho, e sumia junto com a logo ao recolher. */}
      {(isAdmin || !celular) && (
        <div className={cn('shrink-0 border-t border-white/[0.07] py-s2', recolhido ? 'px-s2' : 'px-s3')}>
          {isAdmin && (
            <LeafLink
              item={NAV_CONFIG}
              ativo={NAV_CONFIG.to === ativo}
              onNavigate={onClose}
              recolhido={recolhido}
              celular={celular}
            />
          )}
          {!celular && (
            <Dica desligada={!recolhido} texto={<span className="font-semibold">Expandir menu ( {TECLA_DO_MENU} )</span>}>
              <button
                type="button"
                onClick={alternarRecolhido}
                aria-label={recolhido ? 'Expandir menu' : 'Recolher menu'}
                aria-expanded={!recolhido}
                aria-controls="menu-lateral"
                aria-keyshortcuts={TECLA_DO_MENU}
                className={cn(classeDoItem({ recolhido, celular: false }), 'w-full text-nav-apagado', recolhido && 'w-[48px]')}
              >
                {recolhido ? (
                  <ChevronsRight className="h-[18px] w-[18px] shrink-0" aria-hidden />
                ) : (
                  <>
                    <ChevronsLeft className="h-[18px] w-[18px] shrink-0" aria-hidden />
                    <span>Recolher menu</span>
                    <kbd
                      aria-hidden
                      className="ml-auto rounded-[4px] border border-white/[0.18] px-[5px] font-sans text-xs font-semibold leading-4 text-nav-apagado"
                    >
                      {TECLA_DO_MENU}
                    </kbd>
                  </>
                )}
              </button>
            </Dica>
          )}
        </div>
      )}
    </div>
  )

  return (
    <>
      {/* Desktop: 240px aberto, 64px recolhido (eram 256/72). Com os rótulos
          curtos nada quebra em 240, e os 16px voltam para o conteúdo, que fazem
          falta a 1280px. Em px porque a escala do Tailwind vale 3px por unidade
          com o <html> em 12px. */}
      <aside
        id="menu-lateral"
        className={cn(
          'hidden shrink-0 transition-[width] duration-200 lg:block',
          recolhido ? 'w-[64px]' : 'w-[240px]',
        )}
      >
        {conteudo(recolhido, false)}
      </aside>

      {/* A GAVETA DO CELULAR: 280px, itens de 44px (alvo de toque), sem o
          "Recolher". Na camada das janelas (z-janela): o botão do assistente
          ficava por cima dela. */}
      {rendered && (
        <div
          className="fixed inset-0 z-janela lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Menu de navegação"
        >
          <div
            className={cn(
              'absolute inset-0 bg-veu/50 transition-opacity duration-200',
              visible ? 'opacity-100' : 'opacity-0',
            )}
            onClick={onClose}
          />
          <div
            ref={painelRef}
            tabIndex={-1}
            className={cn(
              'absolute inset-y-0 left-0 w-[280px] max-w-[85vw] shadow-nivel-3 outline-none transition-transform duration-200',
              visible ? 'translate-x-0' : '-translate-x-full',
            )}
          >
            {conteudo(false, true)}
          </div>
        </div>
      )}
    </>
  )
}

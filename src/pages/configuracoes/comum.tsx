// As peças repetidas das seções das Configurações: cabeçalho, rodapé, grade de
// campos, selos, a caixa de aviso e o campo de segredo.

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, Lock, TriangleAlert, X, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Field'

/** O `.cfg-h` da amostra: título da seção, frase de apoio e, à direita, selo ou ação. */
export function CabecalhoSecao({
  titulo,
  apoio,
  direita,
}: {
  titulo: ReactNode
  apoio?: ReactNode
  direita?: ReactNode
}) {
  return (
    <div className="mb-s5 flex flex-wrap items-start justify-between gap-s3">
      <div className="min-w-0">
        <h2 className="font-display text-xl font-extrabold tracking-tight text-texto">{titulo}</h2>
        {apoio && <p className="mt-s1 text-corpo text-texto-2">{apoio}</p>}
      </div>
      {direita && <div className="flex flex-wrap items-center gap-s2">{direita}</div>}
    </div>
  )
}

/** O `.cfg-foot` da amostra: borda em cima e os botões à direita. */
export function RodapeSecao({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'mt-s5 flex flex-wrap items-center justify-end gap-s2 border-t border-borda pt-s4',
        className,
      )}
    >
      {children}
    </div>
  )
}

/**
 * O `.fgrid` da amostra: duas colunas, uma no celular. `minmax(0, …)` para um
 * texto sem quebra (o endereço do callback) não alargar a grade além da tela.
 */
export function GradeCampos({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'grid grid-cols-[minmax(0,1fr)] gap-x-[16px] gap-y-[12px] min-[900px]:grid-cols-[repeat(2,minmax(0,1fr))]',
        className,
      )}
    >
      {children}
    </div>
  )
}

/** Ocupa as duas colunas da grade (uma no celular, onde a grade já é uma só). */
export const DUAS_COLUNAS = 'min-[900px]:col-span-2'

/** O `.fs-h` da amostra: título pequeno, em caixa alta, de um bloco dentro da seção. */
export function TituloBloco({ children }: { children: ReactNode }) {
  return (
    <h3 className="mb-s2 font-display text-xs font-bold uppercase tracking-[0.06em] text-texto-3">
      {children}
    </h3>
  )
}

/**
 * A caixa âmbar de aviso (o `.note-box.warn` da amostra). NAS MEDIDAS DAS OUTRAS
 * CAIXAS DE AVISO DA PLATAFORMA (revisão visual 2): 12/8px e 8px até o ícone, como a
 * `Ressalva` do Quadro, o aviso da tela de Entrar e a faixa de pendências daqui.
 */
export function CaixaAviso({ children }: { children: ReactNode }) {
  return (
    <div
      className="mb-s4 flex items-start gap-s2 rounded-campo border border-aviso-borda bg-aviso-fundo px-s3 py-s2 text-corpo text-aviso"
    >
      <TriangleAlert className="mt-s0.5 h-[16px] w-[16px] shrink-0" aria-hidden />
      <p className="text-texto">{children}</p>
    </div>
  )
}

/**
 * Falha de LEITURA não pode se disfarçar de "não configurado". Sem este aviso, o
 * selo do cartão dizia "Sem token" quando o que houve foi erro ao consultar a
 * tabela — e o administrador ia recadastrar token que já estava lá, ou pior,
 * concluir que a integração caiu quando o problema era outro.
 */
export function AvisoLeitura({ error }: { error: unknown }) {
  if (!error) return null
  return (
    <CaixaAviso>
      Não foi possível ler o estado atual desta integração: {(error as Error).message}
    </CaixaAviso>
  )
}

type TomSelo = 'ok' | 'neutro' | 'alerta' | 'ruim'

const TOM_DO_SELO: Record<TomSelo, 'green' | 'gray' | 'yellow' | 'red'> = {
  ok: 'green',
  neutro: 'gray',
  alerta: 'yellow',
  ruim: 'red',
}

/**
 * Selo da amostra (`selo()` de base.js): pílula com ícone + texto. O ícone vai
 * junto do texto, e não no lugar dele — a cor sozinha não diz estado para quem
 * não distingue verde de âmbar.
 *
 * O NEUTRO VAI SEM ÍCONE, como na amostra (o `dot` de SELOS em base.js): "Não
 * configurado" não é erro, e o X dizia que era.
 */
export function Selo({
  tom,
  icone: Icone,
  children,
}: {
  tom: TomSelo
  icone?: LucideIcon
  children: ReactNode
}) {
  return (
    <Badge tone={TOM_DO_SELO[tom]}>
      {Icone && <Icone className="mr-s1 h-[13px] w-[13px] shrink-0" aria-hidden />}
      {children}
    </Badge>
  )
}

export const IconeOk = Check
export const IconeAlerta = TriangleAlert
export const IconeRuim = X

/** Selo dos cartões de integração, com o estado "não deu para saber". */
export function SeloIntegracao({
  error,
  configurado,
  rotuloOk,
  rotuloSem,
}: {
  error: unknown
  configurado: boolean
  rotuloOk: string
  rotuloSem: string
}) {
  if (error)
    return (
      <Selo tom="alerta" icone={IconeAlerta}>
        Estado não carregado
      </Selo>
    )
  return configurado ? (
    <Selo tom="ok" icone={IconeOk}>
      {rotuloOk}
    </Selo>
  ) : (
    <Selo tom="neutro">
      {rotuloSem}
    </Selo>
  )
}

/**
 * A pílula feita à mão, para o que a Badge não tem: o selo-botão do saldo e o
 * tom de informação do plano. Mesmas medidas da Badge `md` (20px de altura, §0.8).
 */
export const PILULA =
  'inline-flex h-[20px] items-center gap-[5px] whitespace-nowrap rounded-full px-s2 text-xs font-semibold ring-1 ring-inset'

/**
 * O SEGREDO TRATADO COMO SEGREDO (item "Novo" da amostra).
 *
 * Antes era um campo de senha vazio com a frase "Já configurado. Preencha apenas
 * para substituir." — e um campo vazio parece um campo por preencher. Agora o
 * estado vem primeiro ("Configurado", com o cadeado) e o botão Substituir abre o
 * campo. Sem segredo gravado, OU QUANDO O ESTADO NÃO PÔDE SER LIDO, o campo
 * aparece direto, com a dica de onde gerar a chave: leitura que falhou não pode
 * afirmar "Configurado".
 *
 * Quem salva troca a `key` deste componente depois do sucesso, e ele volta à
 * caixa "Configurado".
 */
export function CampoSegredo({
  rotulo,
  configurado,
  lido,
  dicaConfigurado,
  dicaNovo,
  valor,
  aoMudar,
}: {
  rotulo: string
  configurado: boolean
  /** O estado da integração foi lido (sem erro de leitura). */
  lido: boolean
  dicaConfigurado: string
  dicaNovo: string
  valor: string
  aoMudar: (v: string) => void
}) {
  const [substituindo, setSubstituindo] = useState(false)
  const campo = useRef<HTMLInputElement>(null)
  // O FOCO VAI PARA O CAMPO só quando ele abriu pelo Substituir: quem clicou ali
  // vai colar a chave nova em seguida.
  const pediuFoco = useRef(false)
  useEffect(() => {
    if (substituindo && pediuFoco.current) {
      pediuFoco.current = false
      campo.current?.focus()
    }
  }, [substituindo])

  const temSegredo = configurado && lido
  return (
    <Field label={rotulo} hint={temSegredo ? dicaConfigurado : dicaNovo}>
      {temSegredo && !substituindo ? (
        <div className="flex h-controle items-center gap-s2 rounded-campo border border-borda-forte bg-superficie-2 pl-[12px] pr-s1 text-corpo text-texto-2">
          <Lock className="h-[16px] w-[16px] shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 truncate">Configurado</span>
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Substituir ${rotulo}`}
            onClick={() => {
              pediuFoco.current = true
              setSubstituindo(true)
            }}
          >
            Substituir
          </Button>
        </div>
      ) : (
        <Input
          ref={campo}
          type="password"
          value={valor}
          onChange={(e) => aoMudar(e.target.value)}
          placeholder={substituindo ? 'Cole o novo valor' : '••••••••••••'}
          autoComplete="off"
        />
      )}
    </Field>
  )
}

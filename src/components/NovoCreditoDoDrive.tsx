// Aba "Automatizado" da janela de novo crédito: acha no Drive as pastas de
// crédito que ainda não estão cadastradas e preenche o formulário a partir delas.
//
// O QUE ESTA ETAPA FAZ, E O QUE NÃO FAZ. Aqui só entra o que o CAMINHO da pasta
// garante — espécie, originador, número do processo e cedente. É dado estrutural:
// a pasta está dentro de "Precatórios", logo a espécie é precatório; está dentro
// de "Intermediador - X", logo o originador é X. Não há interpretação, e por isso
// não há como estar errado de um jeito que ninguém veja.
//
// A leitura dos documentos pela IA (valor de face, entidade devedora, cessionário,
// capital investido) é a etapa seguinte, e vai entrar aqui mesmo.
//
// E ELA NUNCA SALVA. Escolher uma pasta preenche a aba Manual e devolve a pessoa
// para lá; quem confere e salva é ela. Extração é palpite educado, e gravar palpite
// direto no banco é como se produz dado errado com cara de certo.
import { useEffect, useMemo, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { driveConfigurado } from '@/lib/drive'
import {
  candidatasACadastro,
  listarPastasDeCredito,
  type PastaCredito,
} from '@/lib/creditoDoDrive'
import { formatCNJ } from '@/lib/format'
import type { Processo } from '@/lib/types'
import { Combobox, type OpcaoCombo } from '@/components/ui/Combobox'
import { IconButton } from '@/components/ui/IconButton'
import { EmptyState, ErrorState } from '@/components/ui/Table'

/** O que a pasta escolhida entrega ao formulário. */
export type PreenchimentoDoDrive = Pick<
  Processo,
  'numero_cnj' | 'cedente' | 'originador' | 'especie_requisitorio'
>

export function NovoCreditoDoDrive({
  processos,
  onPreencher,
}: {
  /** Créditos já cadastrados, para saber o que é novidade. */
  processos: Pick<Processo, 'numero_cnj' | 'cedente'>[] | undefined
  onPreencher: (dados: PreenchimentoDoDrive) => void
}) {
  const [buscando, setBuscando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  /** null = ainda não procurou. Lista vazia = procurou e não achou nada. */
  const [candidatas, setCandidatas] = useState<PastaCredito[] | null>(null)
  /**
   * A pasta escolhida FICA marcada no campo. Os campos do crédito ficam logo
   * abaixo, e some deles é que a pessoa vai trabalhar — o campo precisa continuar
   * dizendo de qual pasta veio aquilo que está na tela.
   */
  const [escolhida, setEscolhida] = useState<number | null>(null)

  async function procurar() {
    setBuscando(true)
    setErro(null)
    try {
      const todas = await listarPastasDeCredito()
      setCandidatas(candidatasACadastro(todas, processos))
    } catch (e) {
      setErro((e as Error).message)
    } finally {
      setBuscando(false)
    }
  }

  // Procura só de ENTRADA na aba, uma vez. Quem escolheu "Automatizado" já disse
  // o que quer; obrigar a clicar num botão depois disso é um passo a mais sem
  // informação nenhuma. Reprocurar é decisão explícita, no botão ao lado.
  const jaProcurou = useRef(false)
  useEffect(() => {
    if (jaProcurou.current || !driveConfigurado) return
    jaProcurou.current = true
    void procurar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const opcoes = useMemo<OpcaoCombo[]>(
    () =>
      (candidatas ?? []).map((c, i) => ({
        id: i,
        titulo: c.cnj ? formatCNJ(c.cnj) : (c.cedente ?? c.nome),
        // O caminho diz de onde a pasta veio, e o aviso marca o caso frágil: sem
        // número na pasta, o cotejo com o que já existe foi por nome, e "nova"
        // pode não ser nova.
        subtitulo:
          [...c.caminho, c.cnj && c.cedente ? c.cedente : null]
            .filter(Boolean)
            .join(' › ') + (c.cnj ? '' : '  ·  sem número na pasta'),
      })),
    [candidatas],
  )

  if (!driveConfigurado) {
    return (
      <EmptyState
        title="Drive não configurado neste build"
        description="Sem o acesso ao Drive não há como procurar as pastas dos créditos. Use a aba Manual."
      />
    )
  }

  if (erro) return <ErrorState message={erro} onRetry={procurar} />

  return (
    <div className="flex items-start gap-2">
      <div className="min-w-0 flex-1">
        {/* Sem rótulo: o campo é a primeira coisa da aba e o texto do próprio
            campo já diz o que ele quer. */}
        <Combobox
          opcoes={opcoes}
          valor={escolhida}
          onChange={(id) => {
            setEscolhida(id)
            const c = id === null ? null : candidatas?.[id]
            if (!c) return
            onPreencher({
              numero_cnj: c.cnj ? formatCNJ(c.cnj) : '',
              cedente: c.cedente,
              originador: c.originador,
              especie_requisitorio: c.especie,
            })
          }}
          placeholder={
            buscando
              ? 'Procurando no Drive…'
              : candidatas?.length
                ? 'Escolha a pasta do crédito'
                : 'Nenhuma pasta sem cadastro'
          }
          vazio="Nenhuma pasta sem cadastro no Drive."
        />
      </div>
      <IconButton
        label="Procurar novamente no Drive"
        icon={<RefreshCw className={buscando ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />}
        disabled={buscando}
        onClick={procurar}
      />
    </div>
  )
}

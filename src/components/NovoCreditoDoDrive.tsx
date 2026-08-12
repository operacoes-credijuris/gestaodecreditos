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
// E ELA NUNCA SALVA. Devolve os campos para a aba Manual, preenchidos, e quem
// confere e salva é a pessoa. Extração é palpite educado; gravar palpite direto no
// banco é como se produz dado errado com cara de certo.
import { useState } from 'react'
import { FolderSearch, Wand2 } from 'lucide-react'
import { driveConfigurado } from '@/lib/drive'
import {
  apenasNaoCadastradas,
  listarPastasDeCredito,
  type PastaCredito,
} from '@/lib/creditoDoDrive'
import { formatCNJ } from '@/lib/format'
import type { Processo } from '@/lib/types'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { EmptyState, ErrorState, Loading } from '@/components/ui/Table'

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

  async function procurar() {
    setBuscando(true)
    setErro(null)
    try {
      const todas = await listarPastasDeCredito()
      setCandidatas(apenasNaoCadastradas(todas, processos))
    } catch (e) {
      setErro((e as Error).message)
    } finally {
      setBuscando(false)
    }
  }

  if (!driveConfigurado) {
    return (
      <EmptyState
        title="Drive não configurado neste build"
        description="Sem o acesso ao Drive não há como procurar as pastas dos créditos. Use a aba Manual."
      />
    )
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-slate-50 px-3 py-2.5 text-sm text-slate-600">
        Procura em <strong>B. Processos</strong> as pastas de crédito que ainda não
        estão cadastradas aqui, e preenche o formulário com o que a pasta já
        informa. Nada é salvo sem você conferir na aba Manual.
      </div>

      <Button
        icon={<FolderSearch className="h-4 w-4" />}
        loading={buscando}
        onClick={procurar}
      >
        {candidatas ? 'Procurar de novo' : 'Procurar pastas no Drive'}
      </Button>

      {buscando && <Loading label="Percorrendo as pastas do Drive…" />}

      {erro && <ErrorState message={erro} onRetry={procurar} />}

      {candidatas?.length === 0 && (
        <EmptyState
          title="Nenhuma pasta sem cadastro"
          description="Todas as pastas de crédito do Drive já têm crédito correspondente na plataforma."
        />
      )}

      {!!candidatas?.length && (
        <div className="space-y-2">
          {/* CANDIDATOS, e não "créditos novos": a pasta que só tem o nome do
              cedente (convenção antiga) pode ser um crédito já cadastrado cujo
              nome foi escrito de outro jeito. Quem confirma é quem conhece. */}
          <p className="text-xs text-slate-600">
            {candidatas.length}{' '}
            {candidatas.length === 1 ? 'candidata' : 'candidatas'} — confira antes de
            usar.
          </p>
          <ul className="divide-y divide-slate-100 rounded-lg ring-1 ring-inset ring-slate-200">
            {candidatas.map((c) => (
              <li
                key={c.id}
                className="flex flex-wrap items-center justify-between gap-3 p-3"
              >
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 font-medium text-slate-800">
                    {c.cnj ? formatCNJ(c.cnj) : (c.cedente ?? c.nome)}
                    {/* Sem número na pasta, o cotejo foi por nome — vale avisar,
                        porque é o caso em que "novo" pode não ser novo. */}
                    {!c.cnj && (
                      <Badge tone="amber" size="sm">
                        sem número na pasta
                      </Badge>
                    )}
                  </p>
                  <p className="text-xs text-slate-600">
                    {c.caminho.join(' › ')}
                    {c.cnj && c.cedente ? ` › ${c.cedente}` : ''}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<Wand2 className="h-4 w-4" />}
                  onClick={() =>
                    onPreencher({
                      numero_cnj: c.cnj ? formatCNJ(c.cnj) : '',
                      cedente: c.cedente,
                      originador: c.originador,
                      especie_requisitorio: c.especie,
                    })
                  }
                >
                  Usar esta pasta
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

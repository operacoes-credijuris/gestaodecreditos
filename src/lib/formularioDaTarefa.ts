// "Descartar alterações?" na Nova tarefa (item "Novo" da amostra aprovada): quando
// fechar a janela perde o que a pessoa digitou.
//
// O QUE A TELA PREENCHE SOZINHA NÃO CONTA, senão a pergunta apareceria em toda
// janela aberta e fechada sem um toque:
//   - o processo que veio escolhido da publicação ("Criar tarefa" de uma
//     publicação já casa o número com a lista do ADVBOX);
//   - o remetente de quem não é administrador, que é sempre a própria pessoa e
//     entra sem campo na tela;
//   - a data, que abre em hoje (revisão de qualidade de vida, 03/10/2026).
// Escolher OUTRO processo, OUTRA data, ou o remetente quando a pessoa pode escolher (admin),
// conta como alteração.

export interface FormularioDaTarefa {
  lawsuit_id: number | null
  tasks_id: string
  start_date: string
  date_deadline: string
  from: string
  guests: number[]
  important: boolean
  urgent: boolean
  comments: string
}

export function tarefaAlterada(
  form: FormularioDaTarefa,
  {
    processoInicial,
    escolheRemetente,
    dataInicial = '',
  }: {
    /** O processo que a janela já abriu escolhido (o da publicação), ou null. */
    processoInicial: number | null
    /** A pessoa escolhe o remetente (admin)? Senão ele é preenchido sozinho. */
    escolheRemetente: boolean
    /** A data com que a janela abriu preenchida (hoje); '' quando abriu vazia. */
    dataInicial?: string
  },
): boolean {
  return (
    form.lawsuit_id !== processoInicial ||
    !!form.tasks_id ||
    form.start_date !== dataInicial ||
    !!form.date_deadline ||
    (escolheRemetente && !!form.from) ||
    form.guests.length > 0 ||
    form.important ||
    form.urgent ||
    !!form.comments.trim()
  )
}

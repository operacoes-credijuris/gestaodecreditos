-- 0065 — Os prompts que a operação edita sozinha.
--
-- O QUE ESTA TABELA RESOLVE. O roteiro da qualificação preliminar é o MÉTODO da
-- casa: que fases percorrer, que eixos varrer, o que é proibido afirmar sem
-- fonte. Ele nasceu dentro do repositório, e ali mudá-lo exige um programador e
-- um deploy — o que é caro demais para um texto que a operação vai ajustar toda
-- vez que um caso novo ensinar alguma coisa. Aqui ele passa a ser dado, e a
-- edição vale na análise seguinte.
--
-- O PADRÃO CONTINUA NO CÓDIGO, e isto não é redundância: é o chão. A Edge
-- Function só usa esta tabela quando ela tem texto; linha ausente ou texto vazio
-- cai no roteiro versionado no repositório. Assim nenhuma análise roda sem
-- método — nem por linha apagada, nem por banco novo, nem por salvamento com o
-- campo em branco.
--
-- POR CHAVE, e não uma tabela por prompt: o próximo texto que a operação quiser
-- editar (a redação do desfecho, o roteiro do interno) entra como outra linha.
create table if not exists public.prompts_operacao (
  chave text primary key,
  texto text not null default '',
  -- O TEXTO ANTERIOR, para desfazer em um clique.
  --
  -- São 17 mil caracteres que a análise inteira obedece, e quem edita está
  -- colando num campo de texto. Uma colagem errada por cima do roteiro afinado
  -- não tem volta sem isto — e "restaurar o padrão" não serve de volta, porque
  -- jogaria fora todo o ajuste acumulado junto com o engano.
  texto_anterior text,
  atualizado_em timestamptz not null default now(),
  -- O e-mail de quem salvou, e não o uuid: quem vai ler isto é uma pessoa na
  -- tela de Configurações, e um uuid ali não diz nada sem uma junção.
  atualizado_por text
);

alter table public.prompts_operacao enable row level security;

-- LEITURA POR TODO MUNDO QUE ENTRA: a tela mostra o roteiro em vigor, e saber
-- por qual método o crédito foi analisado é parte de conferir a análise.
drop policy if exists "prompts_operacao_select" on public.prompts_operacao;
create policy "prompts_operacao_select" on public.prompts_operacao
  for select to authenticated using (true);

-- ESCRITA TAMBÉM PELO OPERACIONAL, e não só pelo admin. Quem descobre que o
-- roteiro precisa de um eixo novo é quem analisa, não quem administra a conta —
-- e exigir o papel de admin devolveria o texto ao lugar de onde ele veio: fora
-- do alcance de quem usa. O risco disso é coberto pelo `texto_anterior` e pelo
-- registro de autoria. Para restringir a admin depois, troque `true` por
-- `public.is_admin()` nas duas linhas.
drop policy if exists "prompts_operacao_write" on public.prompts_operacao;
create policy "prompts_operacao_write" on public.prompts_operacao
  for all to authenticated using (true) with check (true);

comment on table public.prompts_operacao is
  'Prompts que a operação edita pela tela de Configurações. Vazio ou ausente = usa o padrão versionado no repositório.';

notify pgrst, 'reload schema';

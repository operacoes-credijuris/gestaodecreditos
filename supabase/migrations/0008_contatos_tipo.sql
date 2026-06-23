-- Migração 0008: Contatos — distingue órgãos julgadores de auxiliares.
-- 'tipo' = 'julgador' (puxado de Créditos/Requerimentos, badge "julg.") ou
-- 'auxiliar' (cadastro manual, badge "aux."). 'tribunal' guarda o tribunal
-- dos auxiliares. Idempotente.
--
-- ATENÇÃO: a tabela original (0001) já tinha uma coluna 'tipo' com check
-- antigo (serventia/gabinete/cartorio/vara/outro). Por isso aqui NÃO usamos
-- "add column ... check" (seria ignorado se a coluna já existe): garantimos a
-- coluna, normalizamos os valores e trocamos a constraint.

alter table public.contatos_serventias
  add column if not exists tipo     text,
  add column if not exists tribunal text;

-- Normaliza valores antigos para o novo domínio.
update public.contatos_serventias
  set tipo = 'julgador'
  where tipo is null or tipo not in ('julgador','auxiliar');

alter table public.contatos_serventias alter column tipo set default 'julgador';
alter table public.contatos_serventias alter column tipo set not null;

-- Troca a regra antiga pela nova (julgador/auxiliar).
alter table public.contatos_serventias drop constraint if exists contatos_serventias_tipo_check;
alter table public.contatos_serventias
  add constraint contatos_serventias_tipo_check check (tipo in ('julgador','auxiliar'));

-- Recarrega o cache da API (evita "column does not exist").
notify pgrst, 'reload schema';

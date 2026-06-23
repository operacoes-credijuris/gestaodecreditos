-- Migração 0008: Contatos — distingue órgãos julgadores de auxiliares.
-- 'tipo' = 'julgador' (puxado de Créditos/Requerimentos, badge "julg.") ou
-- 'auxiliar' (cadastro manual, badge "aux."). 'tribunal' guarda o tribunal
-- dos auxiliares (os julgadores derivam o tribunal da origem). Idempotente.

alter table public.contatos_serventias
  add column if not exists tipo text not null default 'julgador'
    check (tipo in ('julgador','auxiliar')),
  add column if not exists tribunal text;

-- Recarrega o cache da API (evita "column does not exist").
notify pgrst, 'reload schema';

-- 0069 — O andamento da leitura dos autos, anotado no balcão.
--
-- O PROBLEMA. "Executar análise" abre a conversa do Claude no clique, e a
-- leitura dos PDFs acontece depois, no navegador. O conector só sabia dizer
-- "achei os autos" ou "não achei" — e "não achei" cobria três coisas diferentes:
-- ainda lendo, leitura interrompida (a aba foi fechada) e código errado. O
-- modelo, sem saber qual, às vezes desistia de esperar e seguia sem os autos: a
-- análise saía com cara de completa, feita sobre nada.
--
-- E AGORA A LEITURA É UMA FILA: várias análises podem ser disparadas de uma
-- vez, e as de trás esperam as da frente. A espera ficou mais longa — e dizer
-- ao modelo QUANTO falta passou a ser a diferença entre ele esperar e ele
-- desistir.
--
-- AS TRÊS COLUNAS:
--   estado        — fila | lendo | imagens | pronto | falhou
--   progresso     — { etapa, feitos, total, na_frente, motivo }
--   atualizado_em — o último sinal de vida do navegador que está lendo. Parado
--                   há mais de três minutos sem autos, o conector conclui que a
--                   leitura morreu e manda pedir de novo, em vez de esperar
--                   para sempre.
--
-- O PADRÃO É 'pronto', e não 'fila', de propósito: toda linha que já existe foi
-- gravada pelo depósito completo, e é isso que ela é. A reserva é que nasce em
-- 'fila', e só ela.
alter table public.analise_externa_autos
  add column if not exists estado text not null default 'pronto',
  add column if not exists progresso jsonb not null default '{}'::jsonb,
  add column if not exists atualizado_em timestamptz not null default now();

comment on column public.analise_externa_autos.estado is
  'Andamento da leitura: fila | lendo | imagens | pronto | falhou.';
comment on column public.analise_externa_autos.atualizado_em is
  'Último sinal de vida do navegador que lê os PDFs. Silêncio longo sem autos = leitura interrompida.';

notify pgrst, 'reload schema';

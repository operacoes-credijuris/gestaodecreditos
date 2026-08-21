// Configuração das etapas de um funil: quais colunas do Kommo aparecem na tela
// e em qual grupo.
//
// POR QUE ISTO É UMA TELA E NÃO CÓDIGO. O funil de Precatórios no Kommo atende
// duas coisas diferentes, então a maioria das colunas não é de quem está
// olhando. A divisão poderia estar escrita em src/lib/kommo.ts — e foi
// exatamente por estar escrita lá que a aba de Precatórios não existia: os
// números das colunas eram constantes coladas no código. Coluna nova, coluna
// renomeada, equipe que muda de ideia: nada disso deveria virar pedido de
// deploy.
//
// AS COLUNAS NÃO SÃO DIGITADAS AQUI. Elas vêm de public.kommo_etapa, que o
// kommo-sync espelha do próprio Kommo (migration 0044). Quem configura escolhe
// entre o que EXISTE — não tem como escrever o número de uma coluna errada.
//
// E "OCULTAR" NÃO É "APAGAR". Card em coluna oculta continua alcançável na
// pílula "Outras etapas" da tela. Ocultar tira do caminho de quem opera; não
// tira o crédito da existência. Um crédito que desaparece da tela é o pior
// defeito possível aqui, porque ausência de card não chama atenção.
import { useEffect, useMemo, useRef, useState } from 'react'
import { EyeOff, FolderPlus } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Field, Input, Select } from '@/components/ui/Field'
import { useToast } from '@/components/ui/Toast'
import type { EtapaKommo, EtapaVisao } from '@/lib/kommo'

/** Valor do <option> que representa "não mostrar". Não é nome de grupo. */
const OCULTA = '

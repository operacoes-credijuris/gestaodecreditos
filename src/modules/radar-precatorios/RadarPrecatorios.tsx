'use client';
/**
 * Ponto de entrada para incorporar o Radar de Precatórios em outra
 * aplicação React/Next.js. Tudo fica dentro de <div class="radar">, e o
 * CSS (radar.css) só estiliza o que está dentro dele.
 */
import React from 'react';
import { App } from './App';
import type { Armazenamento } from './persistencia/armazenamento';

export interface PropsRadar {
  /** "sistema" segue o tema do sistema operacional; "claro"/"escuro" fixam. */
  tema?: 'sistema' | 'claro' | 'escuro';
  /** Esconde a marca própria e não altera o endereço (#aba). Use dentro da plataforma. */
  incorporado?: boolean;
  /** Onde salvar o projeto. Padrão: navegador do usuário (Fase 1). */
  armazenamento?: Armazenamento;
  className?: string;
}

export function RadarPrecatorios({ tema = 'sistema', incorporado = false, armazenamento, className }: PropsRadar) {
  return (
    <div className={className ? `radar ${className}` : 'radar'} data-tema={tema}>
      <App incorporado={incorporado} armazenamento={armazenamento} />
    </div>
  );
}

export default RadarPrecatorios;

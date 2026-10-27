/**
 * Salvamento automático no navegador (conveniência por usuário).
 * Pode falhar (janela privativa, dados bloqueados): tudo em try/catch.
 * A cópia confiável é o arquivo JSON exportado.
 */
import type { Projeto } from '../dominio/tipos';
import { validarProjeto } from './projetoJSON';

const CHAVE = 'radar-precatorios:projeto:v1';
const CHAVE_ABA = 'radar-precatorios:aba';

export function carregarLocal(): Projeto | null {
  try {
    const t = window.localStorage.getItem(CHAVE);
    if (!t) return null;
    const v = validarProjeto(JSON.parse(t));
    return v.ok && v.projeto ? v.projeto : null;
  } catch {
    return null;
  }
}

export function salvarLocal(p: Projeto): boolean {
  try {
    window.localStorage.setItem(CHAVE, JSON.stringify(p));
    return true;
  } catch {
    return false;
  }
}

export function limparLocal(): void {
  try {
    window.localStorage.removeItem(CHAVE);
  } catch {
    /* sem armazenamento */
  }
}

export function lerAba(): string | null {
  try {
    return window.localStorage.getItem(CHAVE_ABA);
  } catch {
    return null;
  }
}

export function gravarAba(aba: string): void {
  try {
    window.localStorage.setItem(CHAVE_ABA, aba);
  } catch {
    /* sem armazenamento */
  }
}

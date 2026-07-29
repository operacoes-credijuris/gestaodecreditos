import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Concatena classes condicionalmente e resolve conflitos de Tailwind de forma
 * determinística (a última classe vence — ex.: cn('p-4', 'p-0') === 'p-0').
 */
export function cn(...parts: ClassValue[]): string {
  return twMerge(clsx(parts))
}

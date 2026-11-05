/**
 * Radar de Precatórios — módulo para a plataforma Credijuris.
 * Importe também o CSS uma vez: import '<caminho>/radar-precatorios/radar.css'.
 */
export { RadarPrecatorios, default } from './RadarPrecatorios';
export type { PropsRadar } from './RadarPrecatorios';
export { armazenamentoNavegador, criarArmazenamentoHTTP } from './persistencia/armazenamento';
export type { Armazenamento } from './persistencia/armazenamento';
export { validarProjeto, importarProjeto, exportarProjeto } from './persistencia/projetoJSON';

// Motores puros, reutilizáveis em outras telas, rotas de API ou no assistente de IA da plataforma
export { calcularEnquadramento, faixaConstitucional, adicionalDecenal } from './motores/motorPercentualRCL';
export { projetar } from './motores/motorProjecao';
export { aplicarMovimentos } from './motores/motorFluxoCaixa';
export { exercicioDePagamento, interpretarSerie } from './motores/motorEstoque';
export { REGRAS_V1, obterRegras } from './regras/regrasJuridicas';
export type { Projeto, Cenario, DadoRastreado, Origem, Centavos } from './dominio/tipos';

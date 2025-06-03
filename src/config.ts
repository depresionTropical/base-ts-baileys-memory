// src/config.ts

import 'dotenv/config'; // Importa dotenv para cargar variables de entorno

export const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
export const LLM_MODEL = process.env.LLM_MODEL || 'gpt-4o-mini';
export const TEMPERATURE = parseFloat(process.env.TEMPERATURE || '0.7');

// Asegúrate de que las variables importantes estén definidas
if (!OPENAI_API_KEY) {
  console.error("ERROR: La variable de entorno OPENAI_API_KEY no está configurada.");
  console.error("Por favor, crea un archivo .env en la raíz de tu proyecto y añade OPENAI_API_KEY=tu_clave_aqui");
  process.exit(1); // Sale de la aplicación si no se encuentra la clave
}

console.log(`[Config] LLM Model: ${LLM_MODEL}`);
console.log(`[Config] Temperature: ${TEMPERATURE}`);
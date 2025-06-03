// src/bot/state/types.ts

import { BaseMessage } from '@langchain/core/messages';

// Define el tipo para un producto en el carrito de cotización
export interface QuoteItem {
  id: string; // ID único del producto (podría ser un SKU o similar)
  name: string; // Nombre del producto
  price: number; // Precio unitario
  quantity: number; // Cantidad deseada
}

// Define el estado del Agente (LangGraph)
// LangGraph automáticamente gestiona el 'messages' array.
// Aquí añadimos las partes de tu estado que son específicas del bot.
export interface AgentState {
  messages: BaseMessage[];
  thread_id: string; // <-- ¡Asegúrate de que esta línea esté presente!
  quote_items: QuoteItem[];
  // Puedes añadir otros campos según sea necesario para tu estado.
}

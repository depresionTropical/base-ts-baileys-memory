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
  messages: BaseMessage[]; // LangGraph ya espera esto.
  quote_items?: QuoteItem[]; // Productos en el carrito de cotización
  // Puedes añadir más campos si necesitas recordar algo específico
  // a lo largo de las interacciones, por ejemplo, el último tipo de producto buscado.
}
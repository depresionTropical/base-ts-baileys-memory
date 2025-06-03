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
export interface Product {
    ID: number; // Tu API devuelve "ID" en mayúsculas
    ID_Producto: number;
    Producto: string; // Tu API devuelve "Producto" para el nombre
    Codigo_Producto: string;
    Almacen: string;
    Codigo_Alm: string;
    Periodo: string; // O number, según tu DB
    Precio_Venta: number; // Tu API devuelve "Precio_Venta"
    Existencias: number; // Tu API devuelve "Existencias"
    Estado_Producto: number; // Tu API devuelve "Estado_Producto"
    createdAt: string;
    updatedAt: string;
}


export interface Product {
    ID: number;
    ID_Producto: number;
    Producto: string; // Nombre del producto
    Codigo_Producto: string;
    Almacen: string;
    Codigo_Alm: string;
    Periodo: string; // O number
    Precio_Venta: number;
    Existencias: number; // Campo para filtrar
    Estado_Producto: number; // Campo para filtrar
    createdAt: string;
    updatedAt: string;
    // Puedes añadir más campos que tu API devuelva y que sean relevantes
    // Por ejemplo, si tienes una 'Marca' o 'Descripción' en tu API.
}

// Interfaces de respuesta de la herramienta (mantener igual)
export interface SearchProductsSuccessResponse {
    status: "success";
    products: Product[];
}

export interface SearchProductsManyResultsResponse {
    status: "many_results";
    count: number;
    common_attributes: string[]; 
}

export interface SearchProductsNoResultsResponse {
    status: "no_results";
    message: string;
}

export type SearchProductsToolOutput = 
    SearchProductsSuccessResponse | 
    SearchProductsManyResultsResponse | 
    SearchProductsNoResultsResponse;


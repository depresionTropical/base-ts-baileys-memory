// src/bot/tools/quoteManagement.ts

import { z } from "zod";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { AgentState, QuoteItem } from "../state/types";

// Simulación de productos para validar la adición a la cotización
const availableProducts = [
  { id: "P001", nombre: "Papel Bond Carta", precio: 500 },
  { id: "P002", nombre: "Papel Fotográfico A4", precio: 850 },
  { id: "T001", nombre: "Tinta Negra HP 664", precio: 350 },
  { id: "P003", nombre: "Papel Couche Brillante A3", precio: 1200 },
  { id: "T002", nombre: "Tinta Cyan Epson T50", precio: 400 },
  { id: "T003", nombre: "Cartuchos de Tinta EPSON T2991-T2994", precio: 1500},
  { id: "C001", nombre: "Papel Sulfatado Blanco 12x18 12pt", precio: 900 },
  { id: "C002", nombre: "Papel Sulfatado Brillante 12x18 14pt", precio: 1100 },
  { id: "I001", nombre: "Plotter de Impresión de Gran Formato HP DesignJet T210", precio: 25000},
];

export const addToQuote = new DynamicStructuredTool({
  name: "add_to_quote",
  description: "Añade un producto al carrito de cotización del usuario. Requiere el ID exacto del producto (por ejemplo, 'P001') y la cantidad. Úsalo solo si el usuario ha especificado un producto y una cantidad clara, por ejemplo, 'agrega 2 de P001'.",
  schema: z.object({
    productId: z.string().describe("El ID único del producto a añadir (ej. 'P001', 'T002'). DEBE SER EL ID EXACTO DEL PRODUCTO."),
    quantity: z.number().int().positive().describe("La cantidad del producto a añadir. Debe ser un número entero positivo."),
  }),
  func: async (input, config) => {
    const { productId, quantity } = input;
    const { configurable } = config;
    const threadId = configurable?.thread_id;

    const product = availableProducts.find(p => p.id === productId);

    if (!product) {
      return `Error: Producto con ID "${productId}" no encontrado. Por favor, asegúrate de que el ID sea correcto.`;
    }

    // Lógica para añadir/actualizar en el carrito (simulada en memoria global)
    // CAMBIO AQUÍ: de 'let' a 'const'
    const currentQuoteItems: QuoteItem[] = (global as any)._quote_storage?.[threadId] || [];
    const existingItemIndex = currentQuoteItems.findIndex(item => item.id === productId);

    if (existingItemIndex !== -1) {
      currentQuoteItems[existingItemIndex].quantity += quantity;
    } else {
      currentQuoteItems.push({
        id: product.id,
        name: product.nombre,
        price: product.precio,
        quantity: quantity,
      });
    }

    // Actualizar el "estado" simulado
    (global as any)._quote_storage = (global as any)._quote_storage || {};
    (global as any)._quote_storage[threadId] = currentQuoteItems;

    return `"${product.nombre}" (ID: ${productId}) x${quantity} añadido a tu cotización.`;
  },
});

export const getQuoteSummary = new DynamicStructuredTool({
  name: "get_quote_summary",
  description: "Muestra un resumen de los productos que el usuario ha añadido a su cotización (carrito de compras) y el total. Útil cuando el usuario pregunta por su 'carrito' o 'cotización actual'.",
  schema: z.object({}),
  func: async (_, config) => {
    const { configurable } = config;
    const threadId = configurable?.thread_id;

    // CAMBIO AQUÍ: de 'let' a 'const'
    const currentQuoteItems: QuoteItem[] = (global as any)._quote_storage?.[threadId] || [];

    if (currentQuoteItems.length === 0) {
      return "Tu cotización (carrito) está vacía.";
    }

    let summary = "Aquí está tu cotización actual:\n";
    let total = 0;
    currentQuoteItems.forEach(item => {
      const itemTotal = item.price * item.quantity;
      summary += `- ${item.name} (ID: ${item.id}) x${item.quantity} = $${itemTotal.toFixed(2)}\n`;
      total += itemTotal;
    });
    summary += `\nTotal estimado: $${total.toFixed(2)}`;

    return summary;
  },
});

export const clearQuote = new DynamicStructuredTool({
  name: "clear_quote",
  description: "Vacía el carrito de cotización del usuario. Útil si el usuario quiere empezar una cotización nueva o eliminar todos los productos.",
  schema: z.object({}),
  func: async (_, config) => {
    const { configurable } = config;
    const threadId = configurable?.thread_id;

    (global as any)._quote_storage = (global as any)._quote_storage || {};
    (global as any)._quote_storage[threadId] = [];

    return "Tu cotización (carrito) ha sido vaciada.";
  },
});
// src/bot/tools/quoteManagement.ts

import { z } from "zod";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { AgentState, QuoteItem } from "../state/types";
// Importa CallbackConfig si la necesitas, aunque la desestructuración de configurable no la requiere directamente aquí.
// import { CallbackConfig } from "@langchain/core/callbacks"; // No es estrictamente necesaria para esta corrección, pero útil para tipado si la usas.

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
  // CAMBIO CLAVE AQUÍ: Asegúrate de que 'config' no sea undefined antes de acceder a 'configurable'
  // También, usaremos un objeto vacío como valor por defecto para 'config'
  func: async (input, config: Record<string, any> = {}) => { // Añade un valor por defecto {} para config
    const { productId, quantity } = input;
    // Acceso seguro a configurable usando el operador de encadenamiento opcional (?)
    const threadId = config.configurable?.thread_id; 

    const product = availableProducts.find(p => p.id === productId);

    if (!product) {
      return `Error: Producto con ID "${productId}" no encontrado. Por favor, asegúrate de que el ID sea correcto.`;
    }

    // Lógica para añadir/actualizar en el carrito (simulada en memoria global)
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
  // Aplica el mismo cambio aquí
  func: async (_, config: Record<string, any> = {}) => {
    const threadId = config.configurable?.thread_id;

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
  // Aplica el mismo cambio aquí
  func: async (_, config: Record<string, any> = {}) => {
    const threadId = config.configurable?.thread_id;

    (global as any)._quote_storage = (global as any)._quote_storage || {};
    (global as any)._quote_storage[threadId] = [];

    return "Tu cotización (carrito) ha sido vaciada.";
  },
});

export const sendQuoteToEmail = new DynamicStructuredTool({
  name: "send_quote_to_email",
  description: "Envía la cotización actual a una dirección de correo electrónico proporcionada por el usuario. Útil cuando el usuario indica que quiere 'recibir su cotización' o 'finalizar y enviar'.",
  schema: z.object({
    email: z.string().email().describe("La dirección de correo electrónico a la que se enviará la cotización. Ejemplo: 'usuario@example.com'"),
  }),
  func: async ({ email }, config: Record<string, any> = {}) => {
    const threadId = config.configurable?.thread_id;
    const currentQuoteItems: QuoteItem[] = (global as any)._quote_storage?.[threadId] || [];

    if (currentQuoteItems.length === 0) {
      return "Tu cotización está vacía. No puedo enviar una cotización sin productos.";
    }

    let quoteContent = "Estimado cliente,\n\n";
    quoteContent += "Aquí está el resumen de su cotización de Proveedora de Artes Gráficas:\n\n";
    let total = 0;

    currentQuoteItems.forEach(item => {
      const itemTotal = item.price * item.quantity;
      quoteContent += `- ${item.name} (ID: ${item.id}) - Cantidad: ${item.quantity} - Precio Unitario: $${item.price.toFixed(2)} - Subtotal: $${itemTotal.toFixed(2)}\n`;
      total += itemTotal;
    });

    quoteContent += `\nTotal estimado de la cotización: $${total.toFixed(2)}`;
    quoteContent += "\n\nGracias por su interés en nuestros productos. Si tiene alguna pregunta, no dude en contactarnos.\n";
    quoteContent += "Atentamente,\nEl equipo de Proveedora de Artes Gráficas.";

    // Simulación del envío de correo electrónico
    console.log(`[Tool] Enviando cotización a ${email}:\n${quoteContent}`);

    // Aquí integrarías una API de envío de correo real
    // const emailServiceResult = await someEmailService.send(email, "Tu Cotización de Artes Gráficas", quoteContent);
    // if (!emailServiceResult.success) {
    //   return "Lo siento, hubo un error al intentar enviar la cotización. Por favor, inténtalo de nuevo más tarde.";
    // }

    // Opcional: limpiar la cotización después de enviarla
    // (global as any)._quote_storage[threadId] = [];

    return `Cotización enviada exitosamente a ${email}. ¡Recibirás un correo pronto!`;
  },
});
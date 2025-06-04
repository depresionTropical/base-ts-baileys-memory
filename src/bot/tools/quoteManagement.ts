// src/bot/tools/quoteManagement.ts

import { z } from "zod";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { AgentState, QuoteItem, ConsolidatedProduct } from "../state/types";
// Importa la función para obtener los productos consolidados
import { getConsolidatedProducts } from '../../services/productVectorStore'; 

// *** ESTE ARRAY HA SIDO ELIMINADO. YA NO ES NECESARIO. ***
// const availableProducts = [ ... ];

export const addToQuote = new DynamicStructuredTool({
  name: "add_to_quote",
  description: "Añade un producto al carrito de cotización del usuario. Requiere el ID único del producto. Siempre usa el 'ID_Producto' que se te proporcionó en las búsquedas (es un número, por ejemplo, 1341), NUNCA el 'Codigo_Producto' (el texto de código).",
  schema: z.object({
    // productId ahora es de tipo 'number' para coincidir con ID_Producto
    productId: z.number().describe("El ID único numérico del producto a añadir (ej. 1341). DEBE SER EL ID_Producto EXACTO RETORNADO POR search_products."),
    quantity: z.number().int().positive().describe("La cantidad del producto a añadir. Debe ser un número entero positivo."),
  }),
  func: async (input, config: Record<string, any> = {}) => {
    const { productId, quantity } = input;
    const threadId = config.configurable?.thread_id; 

    // Obtén la lista de productos consolidados de la fuente compartida
    // Esta lista se carga y cachea desde tu API de inventario
    const consolidatedProducts = getConsolidatedProducts();

    // Busca el producto por su ID_Producto numérico
    const product = consolidatedProducts.find(p => p.ID_Producto === productId);

    if (!product) {
      return `Error: Producto con ID "${productId}" no encontrado o no disponible en el inventario. Por favor, asegúrate de que el ID sea correcto y esté en existencia.`;
    }
    
    // Verifica si hay existencias suficientes
    if (product.Existencias_Total < quantity) {
        return `Error: Solo hay ${product.Existencias_Total} unidades de "${product.Producto}" (ID: ${productId}) disponibles. No se pueden añadir ${quantity}.`;
    }

    // Lógica para añadir/actualizar en el carrito (simulada en memoria global)
    const currentQuoteItems: QuoteItem[] = (global as any)._quote_storage?.[threadId] || [];
    // Busca un item existente por su ID_Producto
    const existingItemIndex = currentQuoteItems.findIndex(item => item.id === product.ID_Producto);

    if (existingItemIndex !== -1) {
      // Si el producto ya está en el carrito, actualiza la cantidad
      currentQuoteItems[existingItemIndex].quantity += quantity;
    } else {
      // Si no, añade el nuevo producto al carrito
      currentQuoteItems.push({
        id: product.ID_Producto,     // Usa el ID_Producto del producto encontrado
        name: product.Producto,      // Usa el nombre del producto encontrado
        price: product.Precio_Venta, // Usa el precio del producto encontrado
        quantity: quantity,
      });
    }

    // Actualiza el "estado" simulado del carrito
    (global as any)._quote_storage = (global as any)._quote_storage || {};
    (global as any)._quote_storage[threadId] = currentQuoteItems;

    return `"${product.Producto}" (ID: ${productId}) x${quantity} añadido a tu cotización.`
  },
});

export const getQuoteSummary = new DynamicStructuredTool({
  name: "get_quote_summary",
  description: "Muestra un resumen de los productos que el usuario ha añadido a su cotización (carrito de compras) y el total. Útil cuando el usuario pregunta por su 'carrito' o 'cotización actual'.",
  schema: z.object({}),
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

    quoteContent += `\nTotal estimado: $${total.toFixed(2)}`;
    quoteContent += "\n\nGracias por su interés en nuestros productos. Si tiene alguna pregunta, no dude en contactarnos.\n";
    quoteContent += "Atentamente,\nEl equipo de Proveedora de Artes Gráficas.";

    console.log(`[Tool] Enviando cotización a ${email}:\n${quoteContent}`);

    // Aquí integrarías una API de envío de correo real
    // const emailServiceResult = await someEmailService.send(email, "Tu Cotización de Artes Gráficas", quoteContent);
    // if (!emailServiceResult.success) {
    //   return "Lo siento, hubo un error al intentar enviar la cotización. Por favor, inténtalo de nuevo más tarde.";
    // }

    return `Cotización enviada exitosamente a ${email}. ¡Recibirás un correo pronto!`;
  },
});
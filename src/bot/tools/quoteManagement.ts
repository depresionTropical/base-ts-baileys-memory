// src/bot/tools/quoteManagement.ts

import { z } from "zod";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { AgentState, QuoteItem, ConsolidatedProduct } from "../state/types";
// Importa la función para obtener los productos consolidados
import { getConsolidatedProducts } from '../../services/productVectorStore'; 
import fs from 'fs';
import path from 'path';
import PDFDocument from 'pdfkit';

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

function generateQuotePDF(quoteItems: QuoteItem[], threadId: string): string {
  const currentDate = new Date().toLocaleDateString('es-MX');
  const currentTime = new Date().toLocaleTimeString('es-MX');
  
  // Crear directorio si no existe
  const assetsDir = path.join(process.cwd(), 'assets');
  if (!fs.existsSync(assetsDir)) {
    fs.mkdirSync(assetsDir, { recursive: true });
  }

  // Generar nombre de archivo único
  const fileName = `cotizacion_${threadId}_${Date.now()}.pdf`;
  const filePath = path.join(assetsDir, fileName);
  
  // Crear documento PDF
  const doc = new PDFDocument();
  doc.pipe(fs.createWriteStream(filePath));

  // Encabezado
  doc.fontSize(18).text('PROVEEDORA DE LAS ARTES GRÁFICAS', 50, 50);
  doc.fontSize(16).text('COTIZACIÓN', 50, 80);
  
  // Información de la cotización
  doc.fontSize(12);
  doc.text(`Fecha: ${currentDate}`, 50, 120);
  doc.text(`Hora: ${currentTime}`, 50, 140);
  doc.text(`Folio: COT-${threadId}-${Date.now()}`, 50, 160);
  doc.text(`Teléfono: ${threadId}`, 50, 180);

  // Línea separadora
  doc.moveTo(50, 210).lineTo(550, 210).stroke();

  // Productos
  doc.fontSize(14).text('PRODUCTOS:', 50, 230);
  
  let yPosition = 260;
  let total = 0;

  quoteItems.forEach((item, index) => {
    const itemTotal = item.price * item.quantity;
    total += itemTotal;
    
    doc.fontSize(10);
    doc.text(`${index + 1}. ${item.name}`, 50, yPosition);
    doc.text(`ID: ${item.id}`, 50, yPosition + 15);
    doc.text(`Cantidad: ${item.quantity}`, 200, yPosition + 15);
    doc.text(`Precio: ${item.price.toFixed(2)}`, 300, yPosition + 15);
    doc.text(`Subtotal: ${itemTotal.toFixed(2)}`, 400, yPosition + 15);
    
    yPosition += 40;
  });

  // Total
  doc.moveTo(50, yPosition + 10).lineTo(550, yPosition + 10).stroke();
  doc.fontSize(14).text(`TOTAL: ${total.toFixed(2)}`, 400, yPosition + 25);

  // Pie de página
  doc.fontSize(10);
  doc.text('Cotización válida por 48 horas y/o agotar existencias.', 50, yPosition + 60);
  doc.text('Esperamos la confirmación de su pedido.', 50, yPosition + 75);
  doc.text('Con gusto, le atiende nuestro equipo.', 50, yPosition + 90);
  
  doc.text('CONTACTO:', 50, yPosition + 120);
  doc.text('WhatsApp: (662) 171-0425', 50, yPosition + 135);
  doc.text('Matriz: (662) 215-7878', 50, yPosition + 150);

  // Finalizar el documento
  doc.end();
  
  return filePath;
}

export const sendQuoteToWhatsApp = new DynamicStructuredTool({
  name: "send_quote_to_whatsapp",
  description: "Genera y envía la cotización actual como archivo por WhatsApp. Útil cuando el usuario indica que quiere 'recibir su cotización', 'finalizar' o 'enviar cotización'.",
  schema: z.object({}),
  func: async (_, config: Record<string, any> = {}) => {
    const threadId = config.configurable?.thread_id;
    const currentQuoteItems: QuoteItem[] = (global as any)._quote_storage?.[threadId] || [];

    if (currentQuoteItems.length === 0) {
      return "Tu cotización está vacía. No puedo enviar una cotización sin productos.";
    }

    // Generar el archivo de cotización
    const filePath = generateQuotePDF(currentQuoteItems, threadId);
    
    console.log(`[Tool] Cotización generada en: ${filePath}`);

    // Retornar un JSON especial que indica que se debe enviar un archivo
    return JSON.stringify({
      type: "file",
      path: filePath,
      message: "Aquí tienes tu cotización. ¡Gracias por tu interés en nuestros productos!"
    });
  },
});

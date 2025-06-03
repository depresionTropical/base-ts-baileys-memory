// src/bot/tools/miscTools.ts

import { z } from "zod";
import { DynamicStructuredTool } from "@langchain/core/tools";

export const handleGreeting = new DynamicStructuredTool({
  name: "handle_greeting",
  description: "Responde a saludos cordiales como 'hola', 'buenos días', 'qué tal'. Útil para dar una bienvenida amigable al usuario.",
  schema: z.object({}), // No requiere inputs
  func: async () => {
    const greetings = [
      "¡Hola! Soy tu asistente de Proveedora de Artes Gráficas. ¿En qué puedo ayudarte hoy?",
      "¡Saludos! ¿Cómo puedo asistirte con tus necesidades de artes gráficas?",
      "¡Bienvenido! Estoy aquí para ayudarte a encontrar productos y responder tus preguntas.",
    ];
    return greetings[Math.floor(Math.random() * greetings.length)];
  },
});

export const getFAQAnswer = new DynamicStructuredTool({
  name: "get_faq_answer",
  description: "Busca y proporciona respuestas a preguntas frecuentes sobre políticas de la empresa (envíos, devoluciones, pagos, garantías, etc.). Útil cuando el usuario pregunta sobre estos temas. Responde con la información más relevante.",
  schema: z.object({
    query: z.string().describe("La pregunta o tema específico sobre el que el usuario busca información (ej. 'costo de envío', 'política de devolución', 'formas de pago')."),
  }),
  func: async (input) => {
    const faqData: { [key: string]: string } = {
      "envio": "Realizamos envíos a toda la república mexicana. El costo y tiempo de entrega varían según el destino y el tamaño del pedido. ¿Podrías indicarme tu código postal para darte una estimación más precisa?",
      "devolucion": "Nuestra política de devoluciones permite cambios o reembolsos dentro de los 30 días posteriores a la compra, siempre y cuando el producto esté en su empaque original y sin usar. Se requiere el ticket de compra. Para más detalles, por favor contacta a nuestro equipo de soporte.",
      "pago": "Aceptamos pagos con tarjeta de crédito/débito (Visa, MasterCard, American Express), transferencias bancarias y pagos en efectivo en nuestras sucursales. También ofrecemos opciones de pago a meses sin intereses en compras mayores a $5,000 MXN.",
      "garantia": "Todos nuestros productos cuentan con garantía de fabricante por defectos de fábrica. La duración de la garantía varía según el producto. Por favor, conserva tu ticket de compra y contáctanos si presentas algún problema.",
      "horario": "Nuestro horario de atención en sucursales es de Lunes a Viernes de 9:00 AM a 6:00 PM y Sábados de 9:00 AM a 2:00 PM. Nuestro servicio de atención al cliente en línea está disponible 24/7.",
      // Agrega más FAQs aquí
      "defecto": "Si un producto presenta un defecto de fábrica, por favor, contáctanos inmediatamente con tu número de pedido y una descripción del problema. Gestionaremos el reemplazo o la reparación bajo garantía.",
    };

    const lowerCaseQuery = input.query.toLowerCase();
    for (const keyword in faqData) {
      if (lowerCaseQuery.includes(keyword)) {
        console.log(`[Tool] get_faq_answer: Respondiendo a "${input.query}" con info sobre "${keyword}"`);
        return faqData[keyword];
      }
    }
    console.log(`[Tool] get_faq_answer: No se encontró FAQ para "${input.query}"`);
    return "Lo siento, no encontré una respuesta específica para tu pregunta en nuestras preguntas frecuentes. ¿Podrías reformularla o darme más detalles?";
  },
});

export const explainChatbotCapabilities = new DynamicStructuredTool({
  name: "explain_chatbot_capabilities",
  description: "Proporciona al usuario información sobre cómo funciona el chatbot y qué puede hacer por ellos. Útil cuando el usuario pregunta 'cómo funcionas', 'ayuda', o 'qué puedes hacer'.",
  schema: z.object({}), // No requiere inputs
  func: async () => {
    return `¡Hola! Soy tu asistente virtual de Proveedora de Artes Gráficas. Puedo ayudarte con lo siguiente:
1.  **Buscar Productos:** Dime qué necesitas (ej. "papel bond", "tinta para Epson") y te ayudaré a encontrarlo. Si hay muchos resultados, te haré preguntas para refinar la búsqueda.
2.  **Gestionar tu Cotización:** Puedes pedirme "agregar papel A4 a mi cotización", "ver mi carrito" o "vaciar mi cotización".
3.  **Preguntas Frecuentes:** Respondo sobre envíos, devoluciones, pagos, garantías, etc.
4.  **Saludos:** Siempre estoy listo para un saludo cordial.

¡Solo dime lo que necesitas!`;
  },
});
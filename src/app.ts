// src/app.ts

import { createBot, createProvider, createFlow, addKeyword, MemoryDB, EVENTS } from '@builderbot/bot';
import { BaileysProvider } from '@builderbot/provider-baileys';
import { askAgent } from './bot'; // Importa askAgent desde el nuevo bot/index.ts
// Ya NO necesitas importar getChatHistory, addMessageToHistory, clearChatHistory
// porque LangGraph gestiona la memoria internamente con el checkpointer.

const welcomeFlow = addKeyword(EVENTS.WELCOME)
  .addAnswer('¡Hola! Soy tu asistente de *Proveedora de Artes Gráficas*. ¿En qué puedo ayudarte hoy?', null, async (_, { flowDynamic }) => {
    // Puedes dar un mensaje de bienvenida más detallado aquí si lo deseas
    // Por ejemplo: "Puedes preguntarme sobre nuestros productos, pedir una cotización o hacer preguntas sobre envíos."
  })
  .addAction(
    async (ctx, { flowDynamic, endFlow }) => {
      const numero = ctx.from; // Número de teléfono del usuario
      const mensaje = ctx.body; // Contenido del mensaje del usuario

      // --- Comandos especiales (si aún los necesitas) ---
      // Con LangGraph, el historial se gestiona a través del checkpointer.
      // Para mostrar o limpiar el historial, necesitarías una forma de acceder al checkpointer
      // directamente o una herramienta que lo haga (más avanzado).
      // Por ahora, eliminamos los comandos de historial específicos si no tienes acceso al checkpointer.
      // Si deseas una funcionalidad de "limpiar historial", podrías implementar una herramienta para eso.

      // Por ejemplo, para un comando de "cómo funcionas":
      if (mensaje.toLowerCase().trim() === "¿cómo funcionas?" || mensaje.toLowerCase().trim() === "ayuda") {
        // Redirige al agente para que use la herramienta explainChatbotCapabilities
        const explanationResponse = await askAgent("Explícame cómo funcionas", numero);
        return await flowDynamic(explanationResponse);
      }
      // --- Fin de comandos especiales ---

      // Delega la lógica principal de la conversación al agente de LangGraph.
      // LangGraph maneja la memoria y el contexto internamente usando el `thread_id` (numero de teléfono).
      const agentResponse = await askAgent(mensaje, numero);

      // Envía la respuesta del agente al usuario a través de BuilderBot.
      await flowDynamic(agentResponse);
    }
  );

const adapterFlow = createFlow([welcomeFlow]);

const main = async () => {
  // **IMPORTANTE:** Para producción, usa una base de datos persistente para BuilderBot.
  // MemoryDB solo es para desarrollo y pruebas rápidas, no persiste los datos.
  const adapterDB = new MemoryDB();
  const adapterProvider = createProvider(BaileysProvider);

  const { handleCtx, httpServer } = await createBot({
    flow: adapterFlow,
    provider: adapterProvider,
    database: adapterDB,
  });

  httpServer(3000);

  adapterProvider.server.post(
    '/v1/messages',
    handleCtx(async (bot, req, res) => {
      const { number, message } = req.body;
      await bot.sendMessage(number, message, {});
      return res.end('send');
    })
  );
};

main();
// src/app.ts

import 'dotenv/config'; 
import { createBot, createProvider, createFlow, addKeyword, MemoryDB, EVENTS } from '@builderbot/bot';
import { BaileysProvider } from '@builderbot/provider-baileys';

// Importa askAgent desde './bot'
import { askAgent } from './bot'; 
// Importa la función de inicialización de Redis desde el NUEVO servicio
import { initializeRedisClient } from './services/redisService'; // <--- ¡CAMBIO AQUÍ!
import { initializeOrRefreshProductVectorStore } from './services/productVectorStore'; // Importa la función de inicialización
// Ya NO necesitas importar getChatHistory, addMessageToHistory, clearChatHistory

const welcomeFlow = addKeyword(EVENTS.WELCOME)
  .addAction(
    async (ctx, { flowDynamic, endFlow }) => {
      const numero = ctx.from; // Número de teléfono del usuario
      const mensaje = ctx.body; // Contenido del mensaje del usuario

      // --- Comandos especiales (si aún los necesitas) ---
      // Si el LLM tiene la herramienta 'explain_chatbot_capabilities', el comando "¿cómo funcionas?"
      // puede ir directo a askAgent sin esta verificación manual.
      if (mensaje.toLowerCase().trim() === "¿cómo funcionas?" || mensaje.toLowerCase().trim() === "ayuda") {
        const explanationResponse = await askAgent("Explícame cómo funcionas", numero); 
        return await flowDynamic(explanationResponse);
      }
      // --- Fin de comandos especiales ---

      // Delega la lógica principal de la conversación al agente de LangGraph.
      // LangGraph manejará la memoria y el contexto internamente usando el `thread_id` (numero de teléfono).
      const agentResponse = await askAgent(mensaje, numero);

      // Envía la respuesta del agente al usuario a través de BuilderBot.
      await flowDynamic(agentResponse);
    }
  );

const adapterFlow = createFlow([welcomeFlow]);

const main = async () => {
  // Llama a la función para inicializar el cliente de Redis desde el servicio.
  await initializeRedisClient(); // Ahora se importa de './services/redisService'

  const adapterDB = new MemoryDB(); 
  const adapterProvider = createProvider(BaileysProvider);

  const { handleCtx, httpServer } = await createBot({
    flow: adapterFlow,
    provider: adapterProvider,
    database: adapterDB,
  });
  // Inicializa la Vector Store al inicio de la aplicación
    await initializeOrRefreshProductVectorStore().catch(err => {
        console.error("Fallo al inicializar la Product Vector Store al inicio:", err);
        // Decide si la aplicación debe salir o continuar sin la función de búsqueda
        process.exit(1); // O maneja el error de otra manera
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
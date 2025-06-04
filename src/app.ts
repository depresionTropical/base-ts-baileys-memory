// src/app.ts

import 'dotenv/config'; 
import { createBot, createProvider, createFlow, addKeyword, MemoryDB, EVENTS } from '@builderbot/bot';
import { BaileysProvider } from '@builderbot/provider-baileys';
import fs from 'fs';
import path from 'path';

// Importa askAgent desde './bot'
import { askAgent } from './bot'; 
// Importa la función de inicialización de Redis desde el NUEVO servicio
import { initializeRedisClient } from './services/redisService'; // <--- ¡CAMBIO AQUÍ!
import { initializeOrRefreshProductVectorStore } from './services/productVectorStore'; // Importa la función de inicialización
// Ya NO necesitas importar getChatHistory, addMessageToHistory, clearChatHistory

// Store para mantener track de archivos pendientes por usuario
const pendingFiles: { [phoneNumber: string]: { path: string, message: string } } = {};

const flow = addKeyword('hello')
    .addAction(async (_,{flowDynamic}) => {
        // ...db get source...
        
        await flowDynamic([
            {body:'This is a video', media:'assets/cotizacion_5215542134811_1749072473920.pdf'}
        ])
    })

const welcomeFlow = addKeyword(EVENTS.WELCOME)
  .addAction(
    async (ctx, { flowDynamic, endFlow }) => {
      const numero = ctx.from; // Número de teléfono del usuario
      const mensaje = ctx.body; // Contenido del mensaje del usuario

      // Verificar si hay archivos pendientes para este usuario
      if (pendingFiles[numero]) {
        const { path: filePath, message } = pendingFiles[numero];
        // Enviar el archivo usando el formato correcto
        await flowDynamic([
          { body: message, media: filePath }
        ]);
        // Limpiar el archivo pendiente
        delete pendingFiles[numero];
        return;
      }

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

      // Verificar si la respuesta contiene un archivo para enviar
      try {
        const parsedResponse = JSON.parse(agentResponse);
        if (parsedResponse.type === "file" && parsedResponse.path) {
          // Verificar que el archivo existe
          if (fs.existsSync(parsedResponse.path)) {
            // Enviar el archivo usando el formato correcto de BuilderBot
            await flowDynamic([
              { body: parsedResponse.message, media: parsedResponse.path }
            ]);
          } else {
            await flowDynamic("Error: No se pudo generar el archivo de cotización.");
          }
          return;
        }
      } catch (e) {
        // Si no es JSON, continuar con flujo normal
      }

      // Envía la respuesta del agente al usuario a través de BuilderBot.
      await flowDynamic(agentResponse);
    }
  );

// Watcher para detectar archivos nuevos en assets (opcional, para monitoreo)
function setupFileWatcher() {
  const assetsDir = path.join(process.cwd(), 'assets');
  
  // Crear directorio si no existe
  if (!fs.existsSync(assetsDir)) {
    fs.mkdirSync(assetsDir, { recursive: true });
  }

  fs.watch(assetsDir, (eventType, filename) => {
    if (eventType === 'rename' && filename && filename.includes('cotizacion_')) {
      const fullPath = path.join(assetsDir, filename);
      console.log(`[FileWatcher] Nuevo archivo de cotización detectado: ${fullPath}`);
      
      // Extraer el número de teléfono del nombre del archivo
      const match = filename.match(/cotizacion_(\d+)_/);
      if (match) {
        const phoneNumber = match[1];
        console.log(`[FileWatcher] Archivo asociado al usuario: ${phoneNumber}`);
      }
    }
  });
}

const adapterFlow = createFlow([welcomeFlow,flow]);

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

  // Configurar el watcher de archivos
  setupFileWatcher();

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
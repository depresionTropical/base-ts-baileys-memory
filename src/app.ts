import { createBot, createProvider, createFlow, addKeyword, MemoryDB, EVENTS } from '@builderbot/bot'
import { BaileysProvider } from '@builderbot/provider-baileys'
import { askAgent } from './bot/agent'
import { getChatHistory } from './bot/memory/conversationMemory';


const welcomeFlow = addKeyword(EVENTS.WELCOME).addAction(
  async (ctx, { flowDynamic }) => {
    const numero = ctx.from;
    const mensaje = ctx.body;
    if (mensaje === "#historial") {
  const history = getChatHistory(numero);
  const resumen = history
    .map((msg) => `${msg.role === "user" ? "👤" : "🤖"}: ${msg.content}`)
    .join("\n");
  return await flowDynamic(resumen || "No hay historial disponible.");
}

    const agentResponse = await askAgent(mensaje, numero);
    await flowDynamic(agentResponse);
  }
);
const  adapterFlow = createFlow([welcomeFlow] )

const main = async () => {
  const adapterDB = new MemoryDB()
  const adapterProvider = createProvider(BaileysProvider)

  const { handleCtx, httpServer } = await createBot({
    flow: adapterFlow,
    provider: adapterProvider,
    database: adapterDB,
  })

  httpServer(3000)

  // Endpoint opcional para enviar mensajes desde POST
  adapterProvider.server.post(
    '/v1/messages',
    handleCtx(async (bot, req, res) => {
      const { number, message } = req.body
      await bot.sendMessage(number, message, {})
      return res.end('send')
    })
  )
}

main()

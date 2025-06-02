import { initializeAgentExecutorWithOptions } from "langchain/agents";
import { ChatOpenAI } from "@langchain/openai";
import { DynamicTool } from "langchain/tools";

import chainProduct from "./chain/chainProduct";
import { HumanMessage, AIMessage } from "@langchain/core/messages";

import chainFaq from "./chain/chainFaq"; // Adjust the path and import if needed
import { getChatHistory, addToChatHistory } from './memory/conversationMemory';

import { BufferMemory, ChatMessageHistory} from "langchain/memory";


const tools = [
  new DynamicTool({
    name: "Productos",
    description: "Responde preguntas sobre productos disponibles en la tienda.",
    func: async (input) => {
      const chain = await chainProduct();
      const res = await chain.invoke({ question: input, chat_history: [] });
      console.log("🔧 Tool llamada con:", input);

      const docs = res.sourceDocuments || [];

      if (docs.length === 0) {
        return "No se encontró información disponible sobre ese producto.";
      }
      // let resumen = "Estos son los productos encontrados para tu busqueda:\n";

      
       const resumen = docs.map((doc: any, index: number) => {
        const meta = doc.metadata || {};
        const existencias = meta.Existencias ?? 0;
        const unidad = existencias === 1 ? 'existencia' : 'existencias';
        // return `${index + 1}. 📦 ${meta.Producto} con un precio 💲 ${meta.Precio_Venta}`;
        return `${index + 1}. ${meta.Producto} con un precio $ ${meta.Precio_Venta}`;
        
      }).join('\n');
      console.log(resumen);
      return resumen;
    },
  }),
  new DynamicTool({
    name: "PreguntasFrecuentes",
    description: "Responde preguntas frecuentes y políticas de la empresa.",
    func: async (input,) => {
    

      const chain = await chainFaq();
      const res = await chain.invoke({ question: input, chat_history: [] });
      return res.text;
    },
  }),
  new DynamicTool({
    name: "Saludo",
    description: "Responde saludos cordiales y da la bienvenida al usuario.",
    func: async () => {

      return "¡Hola! Bienvenido a Proveedora de Artes Gráficas ¿En qué puedo ayudarte hoy?";

    },
  }),
];
// Agente de routing
const llm = new ChatOpenAI({ temperature: 0, apiKey: process.env.OPENAI_API_KEY });




export async function askAgent(input: string, phone: string): Promise<string> {
   const history = getChatHistory(phone);

  // Crear instancia vacía de ChatMessageHistory
  const chatHistory = new ChatMessageHistory();

  // Cargar los mensajes previos
  for (const m of history) {
    if (m.role === "user") {
      chatHistory.addUserMessage(m.content);
    } else {
      chatHistory.addAIMessage(m.content);
    }
  }

  const memory = new BufferMemory({
    returnMessages: true,
    memoryKey: "chat_history",
    chatHistory,

  });
  const executor = await initializeAgentExecutorWithOptions(tools, llm, {
    agentType: "chat-conversational-react-description",
    // verbose: true,
    returnIntermediateSteps: true,
    agentArgs: { 
      prefix: `res un asistente conversacional profesional de "Proveedora de Artes Gráficas", una tienda online de suministros para artes gráficas.

REGLA IMPORTANTE: Siempre responde ÚNICAMENTE en español, sin importar el idioma en que te escriban.

PERSONALIDAD: Sé servicial, amigable, profesional y conocedor de suministros para artes gráficas.

HERRAMIENTAS DISPONIBLES:
- Productos: Busca y obtiene información de productos del catálogo de la tienda
- PreguntasFrecuentes: Responde preguntas sobre políticas de la tienda, envíos, devoluciones, pagos, garantías
- Saludo: Proporciona saludos de bienvenida e información general de la tienda

INSTRUCCIONES:
1. Siempre usa las herramientas para obtener información precisa y actualizada
2. Presenta la información de productos claramente con precios, especificaciones y disponibilidad
3. Para preguntas sobre políticas, proporciona información completa y precisa usando la herramienta FAQ
4. Sé conversacional y útil, no robótico
5. Si no encuentras información específica, reconócelo y ofrece alternativas
6. Al mostrar múltiples productos, organízalos claramente
7. Mantén siempre un tono profesional pero cercano

FORMATO DE RESPUESTA:
Question: [pregunta del usuario]
Thought: [analiza qué necesita el usuario y qué herramienta usar]
Action: [elige entre: Productos, PreguntasFrecuentes, o Saludo]
Action Input: [entrada específica para la herramienta seleccionada]
Observation: [resultado de la herramienta]
[Repite Action/Action Input/Observation si es necesario]
Thought: [sintetiza la información para dar una respuesta completa]
Final Answer: [respuesta comprensiva en español]IMPORTANTE: Tu respuesta final debe ser directa y natural.

Question: {input}
Thought:`
    },
    // memory,
  });

  const result = await executor.invoke({ input });

  // Guardar el mensaje del usuario
  addToChatHistory(phone, { role: "user", content: input });

  // Obtener la observación de la herramienta si existe
  const toolResponse = result.intermediateSteps?.[0]?.observation;

  // Definir la respuesta final que se mostrará y guardará en historial
  const respuestaFinal = (toolResponse?.startsWith("1.")) ? toolResponse : result.output;

  // Guardar la respuesta final en el historial
  addToChatHistory(phone, { role: "assistant", content: respuestaFinal });

  // Retornar la respuesta final al llamador
  return respuestaFinal;
}
// src/bot/index.ts

import { ChatOpenAI } from '@langchain/openai';
import { BaseMessage, HumanMessage, AIMessage, ToolMessage, SystemMessage } from '@langchain/core/messages';
import { END, StateGraph } from '@langchain/langgraph';
import { ToolExecutor } from '@langchain/langgraph/prebuilt';
import { MemorySaver } from '@langchain/langgraph';

import { allTools } from './tools'; // Tus herramientas
import { LLM_MODEL, OPENAI_API_KEY, TEMPERATURE } from '../config'; // Tus configuraciones
import { AgentState, QuoteItem } from './state/types'; // Tu tipo de estado

// --- 1. Configuración del Modelo de Lenguaje (LLM) ---
const llm = new ChatOpenAI({
  modelName: LLM_MODEL,
  temperature: TEMPERATURE,
  openAIApiKey: OPENAI_API_KEY,
});

// --- 2. Preparación de Herramientas para LangGraph ---
const toolExecutor = new ToolExecutor({ tools: allTools });

// --- 3. Definición del Grafo de LangGraph ---

// Nodo para el LLM (decide la acción o la respuesta final)
async function callAgent(
  state: AgentState
): Promise<Partial<AgentState>> {
  const { messages } = state;
  console.log("[Agent Node] Llamando al LLM para decidir la siguiente acción...");

  // Instrucciones de sistema para el LLM
  const systemMessage = new SystemMessage(`
   Eres un asistente conversacional profesional de 'Proveedora de Artes Gráficas'.
    Tu objetivo es ayudar a los clientes a encontrar productos, cotizar y responder preguntas sobre la empresa.
    Debes ser servicial, amigable y profesional en todo momento.
    ES FUNDAMENTAL que todas tus respuestas sean ÚNICAMENTE EN ESPAÑOL, bajo cualquier circunstancia. Si el usuario te pregunta algo en otro idioma, discúlpate y pídele que se comunique en español.

    Tienes acceso a las siguientes herramientas:
    ${allTools.map(tool => `- ${tool.name}: ${tool.description}`).join('\n')}

    ***REGLAS ESTRICTAS PARA LA BÚSQUEDA DE PRODUCTOS (MUY IMPORTANTE):***
    1.  **SIEMPRE** utiliza la herramienta 'search_products' cuando el usuario pregunte por un producto o un tipo de producto. No intentes responder tú mismo sobre productos, **DEBES USAR LA HERRAMIENTA**.
    2.  Si la herramienta 'search_products' devuelve un JSON con "status": "many_results" y "common_attributes", DEBES usar esos atributos para formular una pregunta específica al usuario para refinar la búsqueda. Por ejemplo: "¿Qué marca de papel te interesa?" o "¿De qué color lo necesitas?". La meta es refinar la búsqueda hasta tener 8 productos o menos.
    3.  Si la herramienta 'search_products' devuelve un JSON con "status": "success", presenta los productos de forma clara y pregunta al usuario si desea añadir alguno a su cotización o si tiene otra pregunta.
    4.  Si la herramienta 'search_products' devuelve "status": "no_results", informa al usuario y sugiere reformular la búsqueda.

    ***EJEMPLO DE FLUJO DE BÚSQUEDA IDEAL:***
    Usuario: "Busco papel"
    Thought: El usuario busca un producto, debo usar la herramienta 'search_products'.
    Action: search_products
    Action Input: {"query": "papel"}
    Observation: {"status": "many_results", "count": 15, "common_attributes": ["marca: HP", "tipo: Papel", "gramaje: 75g"]}
    Thought: Hay muchos resultados. Debo preguntar al usuario para refinar.
    Final Answer: Encontré 15 resultados. Para ayudarte a encontrar lo que necesitas, ¿podrías especificar la marca o el gramaje?

    Usuario: "Quiero papel fotográfico"
    Thought: El usuario está refinando la búsqueda de un producto. Debo usar la herramienta 'search_products' de nuevo con la nueva información.
    Action: search_products
    Action Input: {"query": "papel fotográfico"}
    Observation: {"status": "success", "products": [{"id": "P002", "nombre": "Papel Fotográfico A4", "marca": "Epson", "precio": 850}]}
    Thought: Encontré pocos resultados. Debo presentarlos al usuario y preguntar si desea agregarlos a la cotización.
    Final Answer: ¡Claro! Encontré esto para ti:\n- Papel Fotográfico A4 (Marca: Epson, ID: P002) - $850.00\n\n¿Hay alguno que te interese o deseas agregar a tu cotización (por ejemplo, "agregar P002 1 unidad")?

    ***OTRAS REGLAS:***
    Utiliza 'add_to_quote' cuando el usuario pida añadir un producto con un ID y cantidad CLAROS.
    Utiliza 'get_quote_summary' cuando el usuario pregunte por su carrito o cotización.
    Utiliza 'clear_quote' si el usuario pide vaciar su carrito.
    Utiliza 'handle_greeting' para responder a saludos simples.
    Utiliza 'get_faq_answer' para preguntas sobre políticas o información general de la empresa.
    Utiliza 'explain_chatbot_capabilities' si el usuario pregunta cómo funcionas o qué puedes hacer.

    Considera el historial de la conversación para mantener el contexto.
    Siempre sé conciso y ve al punto.
  `);

  // Combina el mensaje del sistema con el historial de mensajes
  const messagesForLlm = [systemMessage, ...messages];

  const response = await llm.invoke(messagesForLlm);
  return { messages: [response] };
}

// Nodo para la ejecución de herramientas
async function callTool(
  state: AgentState
): Promise<Partial<AgentState>> {
  const { messages } = state;
  const lastMessage = messages[messages.length - 1] as AIMessage;
  console.log(`[Tool Node] Ejecutando herramienta: ${lastMessage.tool_calls?.[0]?.name}`);

  if (!lastMessage.tool_calls || lastMessage.tool_calls.length === 0) {
    throw new Error("No hay llamadas a herramientas en el último mensaje del LLM.");
  }

  // Ejecuta la herramienta y añade el ToolMessage al estado.
  const toolResponse = await toolExecutor.invoke(lastMessage);
  return { messages: [new ToolMessage({ tool_message_id: lastMessage.tool_calls[0].id, content: toolResponse})] };
}

// Definición de los Nodos
const workflow = new StateGraph<AgentState>({
  channels: {
    messages: {
      value: (x: BaseMessage[], y: BaseMessage[]) => x.concat(y), // Acumula mensajes
      default: () => [],
    },
    // Añadimos canales para el estado de la cotización si quisiéramos pasarlo explícitamente
    // Aunque LangGraph también permite que las herramientas accedan al estado del checkpoint
    quote_items: {
      value: (x: QuoteItem[], y: QuoteItem[]) => y, // Reemplaza o actualiza
      default: () => [],
    },
  },
})
  .addNode("agent", callAgent) // El LLM decide qué hacer
  .addNode("tools", callTool); // Las herramientas se ejecutan

// --- Definición de Bordes y Lógica Condicional ---

// Si el LLM decide llamar a una herramienta, ve al nodo 'tools'.
// Si no, termina la conversación (END).
workflow.addConditionalEdges(
  "agent",
  (state: AgentState) => {
    const lastMessage = state.messages[state.messages.length - 1] as AIMessage;
    return lastMessage.tool_calls && lastMessage.tool_calls.length > 0 ? "tools" : END;
  }
);

// Después de ejecutar una herramienta, vuelve al LLM para que procese el resultado.
workflow.addEdge("tools", "agent");

// Define el punto de entrada
workflow.setEntryPoint("agent");

// --- 4. Construcción de la Aplicación LangGraph ---
const app = workflow.compile();

// --- 5. Configuración de la Persistencia de Memoria (Checkpointer) ---
// Usa MemorySaver para desarrollo. Para producción, usarías una integración con DB.
const checkpointer = new MemorySaver();

/**
 * Función principal para interactuar con el agente de LangGraph.
 * Esta función es la que será llamada por tu flujo de BuilderBot.
 *
 * @param {string} message - El mensaje de texto que el usuario ha enviado.
 * @param {string} phoneNumber - El número de teléfono del usuario (thread_id para LangGraph).
 * @returns {Promise<string>} - La respuesta final que el bot enviará al usuario.
 */
export async function askAgent(message: string, phoneNumber: string): Promise<string> {
  console.log(`[Agent] Recibiendo mensaje de ${phoneNumber}: "${message}"`);

  // Crear un HumanMessage para la entrada del usuario
  const inputMessage = new HumanMessage({ content: message });

  let finalResponse = "Lo siento, no pude generar una respuesta.";

  try {
    // Invocar a la aplicación LangGraph con el thread_id para la memoria
    // y el mensaje del usuario.
    const result = await app.invoke(
      { messages: [inputMessage] },
      { configurable: { thread_id: phoneNumber }, recursionLimit: 50, checkpointer } // RecursionLimit para evitar bucles infinitos
    );

    // LangGraph devuelve el estado completo del grafo.
    // La última AIMessage (o HumanMessage si el LLM terminó sin acción) será la respuesta final.
    const allMessages = result.messages as BaseMessage[];
    const lastOutputMessage = allMessages[allMessages.length - 1];

    if (lastOutputMessage && lastOutputMessage instanceof AIMessage) {
      finalResponse = lastOutputMessage.content;
    } else if (lastOutputMessage && lastOutputMessage instanceof ToolMessage) {
      // Si la última acción fue una herramienta, el LLM debería haber respondido después.
      // Esto es un fallback por si el grafo terminó inesperadamente en un ToolMessage.
      // En un flujo ideal, el LLM procesaría la salida de la herramienta y generaría una AIMessage.
      finalResponse = `La herramienta ejecutó: ${lastOutputMessage.name}. Resultado: ${lastOutputMessage.content.substring(0, 100)}...`;
      console.warn("[Agent] La respuesta final es un ToolMessage. Esto es inesperado. El LLM debería haber generado una AIMessage después.");
    } else {
       finalResponse = "Parece que no pude procesar tu solicitud o el agente no generó una respuesta clara. ¿Podrías intentar de nuevo?";
    }

    // --- Lógica de procesamiento de respuestas de herramientas (JSON) ---
    // El LLM debería ser el encargado de interpretar las salidas de las herramientas,
    // pero podemos tener una lógica de respaldo o un "post-procesamiento" aquí.
    try {
      const parsedOutput = JSON.parse(finalResponse);
      if (parsedOutput && parsedOutput.status) {
        if (parsedOutput.status === "many_results") {
          const commonAttrs = parsedOutput.common_attributes.join(', ');
          finalResponse = `Encontré ${parsedOutput.count} resultados. Para ayudarte a encontrar lo que necesitas, ¿podrías especificar algún atributo como ${commonAttrs.split(':')[0].trim().toLowerCase()} o ${commonAttrs.split(':')[1].split(',')[0].trim().toLowerCase()}?`;
          console.log("[Agent] Output de herramienta 'many_results', esperando que el LLM refine.");
          // Asegurar que siempre sea una pregunta
          if (!finalResponse.includes("¿") && !finalResponse.includes("?")) {
             finalResponse = `Encontré ${parsedOutput.count} resultados. Para ayudarte a encontrar lo que necesitas, ¿podrías especificar un poco más? Por ejemplo, ¿qué marca, tipo, color o gramaje te interesa?`;
          }
        } else if (parsedOutput.status === "success") {
          const productsList = parsedOutput.products.map((p: any) => `- ${p.nombre} (Marca: ${p.marca}, ID: ${p.id}) - $${p.precio}`).join('\n');
          finalResponse = `¡Claro! Encontré esto para ti:\n${productsList}\n\n¿Hay alguno que te interese o deseas agregar a tu cotización (por ejemplo, "agregar P001 2 unidades")?`;
        } else if (parsedOutput.status === "no_results") {
          finalResponse = "Lo siento, no pude encontrar ningún producto con esa descripción. ¿Puedes ser más específico o probar con otra cosa?";
        }
      }
    } catch (jsonError) {
      // Si la respuesta no es un JSON, significa que el LLM generó una respuesta directa.
      // No se necesita hacer nada, 'finalResponse' ya tiene el mensaje del LLM.
    }

  } catch (error) {
    console.error("[LangGraph Error]:", error);
    finalResponse = "Lo siento, tuve un problema interno al procesar tu solicitud. Por favor, intenta de nuevo más tarde.";
  }

  // La memoria ya la gestiona LangGraph con el checkpointer, no necesitamos addMessageToHistory aquí.
  // Pero si quieres ver la respuesta completa del LLM en tu consola para depurar:
  console.log(`[Agent] Respuesta final para ${phoneNumber}: ${finalResponse.substring(0, 100)}...`);

  return finalResponse;
}
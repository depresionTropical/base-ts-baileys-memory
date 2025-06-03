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

// --- 2. Vinculación de Herramientas al LLM ---
// CRUCIAL: Vincula las herramientas al LLM para que sepa cómo llamarlas
// y el LLM genere el 'tool_calls' en el formato correcto (no solo texto).
const llmWithTools = llm.bindTools(allTools);

// --- 3. Preparación de Herramientas para LangGraph (ToolExecutor) ---
// El ToolExecutor es responsable de ejecutar las funciones de tus herramientas.
const toolExecutor = new ToolExecutor({ tools: allTools });

// --- 4. Definición de los Nodos del Grafo ---

// Nodo: callAgent (El LLM decide la siguiente acción: responder o usar una herramienta)
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

  // Invoca el LLM que tiene las herramientas vinculadas
  const response = await llmWithTools.invoke(messagesForLlm); // Usa 'llmWithTools'
  return { messages: [response] };
}

// Nodo: callTool (Ejecuta la herramienta que el LLM decidió)
async function callTool(state: AgentState): Promise<Partial<AgentState>> {
  const { messages } = state;
  const lastMessage = messages[messages.length - 1] as AIMessage;

  console.log(`[Tool Node Debug] >>> ENTERED callTool function <<<`);
  console.log(`[Tool Node Debug] lastMessage type: ${lastMessage.type}`);
  console.log(`[Tool Node Debug] lastMessage content (truncated): ${lastMessage.content?.substring(0, 100)}...`);
  console.log(`[Tool Node Debug] lastMessage tool_calls (raw): ${JSON.stringify(lastMessage.tool_calls, null, 2)}`);

  if (!lastMessage.tool_calls || lastMessage.tool_calls.length === 0) {
    console.error("[Tool Node ERROR] lastMessage does not contain valid tool_calls. Returning error message.");
    // Devolver un ToolMessage con un ID de error si no hay tool_calls para evitar fallos futuros
    // Se usa un tool_call_id ficticio para cumplir con la API, ya que no hay una llamada de herramienta real a la que responder.
    return { messages: [new ToolMessage({ tool_call_id: "error_no_tool_call_found", content: "Error: El agente intentó llamar una herramienta sin una definición de llamada válida." })] };
  }

  // SOLO TOMAMOS LA PRIMERA LLAMADA A HERRAMIENTA POR SIMPLICIDAD
  const toolCall = lastMessage.tool_calls[0];

  console.log(`[Tool Node Debug] Attempting to invoke tool: "${toolCall.name}" with arguments: ${JSON.stringify(toolCall.args)}`);

  try {
    // CAMBIO CLAVE AQUÍ: Llama directamente a la herramienta por su nombre y argumentos
    // Esto es más explícito y asegura que controlamos el ToolMessage de retorno.
    const toolToExecute = allTools.find(tool => tool.name === toolCall.name);

    if (!toolToExecute) {
      const errorMessage = `Error: La herramienta "${toolCall.name}" no fue encontrada.`;
      console.error(`[Tool Node ERROR] ${errorMessage}`);
      return {
        messages: [
          new ToolMessage({
            tool_call_id: toolCall.id, // Asegura que el ID de la llamada original esté presente
            content: errorMessage
          })
        ]
      };
    }

    // Asegúrate de que los argumentos sean pasados correctamente.
    // toolExecutor.invoke(lastMessage) es una forma, pero si no funciona,
    // es mejor llamar a la función de la herramienta directamente.
    // La herramienta 'search_products' parece esperar un objeto con 'query'.
    const toolOutput = await toolToExecute.func(toolCall.args);

    console.log(`[Tool Node Debug] Tool "${toolCall.name}" EXECUTED SUCCESSFULLY. Raw output (truncated): ${JSON.stringify(toolOutput)?.substring(0, 100)}...`);

    // Crea un ToolMessage explícitamente con el tool_call_id de la llamada del AIMessage
    return {
      messages: [
        new ToolMessage({
          tool_call_id: toolCall.id, // ¡ESENCIAL! Usa el ID de la llamada de herramienta del AIMessage anterior
          content: JSON.stringify(toolOutput) // Asegúrate de que la salida sea una cadena
        })
      ]
    };
  } catch (error: any) {
    console.error(`[Tool Node ERROR] FAILED to execute tool "${toolCall.name}". Error: ${error.message}`);
    console.error(`[Tool Node ERROR] Stack Trace:`, error.stack);

    // En caso de error, siempre devuelve un ToolMessage con el tool_call_id original
    return {
      messages: [
        new ToolMessage({
          tool_call_id: toolCall.id || "tool_error_fallback", // Usa el ID si existe, o un fallback
          content: `Error ejecutando herramienta ${toolCall.name}: ${error.message}`
        })
      ]
    };
  }
}

// --- 5. Definición del Grafo de LangGraph (Flujo) ---
const workflow = new StateGraph<AgentState>({
  channels: {
    messages: {
      value: (x: BaseMessage[], y: BaseMessage[]) => x.concat(y), // Acumula mensajes
      default: () => [],
    },
    quote_items: {
      value: (x: QuoteItem[], y: QuoteItem[]) => y, // Reemplaza o actualiza (dependiendo de tu lógica de carrito)
      default: () => [],
    },
  },
})
  .addNode("agent", callAgent) // El LLM decide qué hacer
  .addNode("tools", callTool); // Las herramientas se ejecutan

// --- 6. Definición de Bordes y Lógica Condicional ---

// Transición principal: si el LLM decide usar una herramienta, va a 'tools'; si no, termina.
workflow.addConditionalEdges(
  "agent",
  (state: AgentState) => {
    const lastMessage = state.messages[state.messages.length - 1] as AIMessage;
    // La condición ahora funcionará porque `llmWithTools` genera 'tool_calls'
    return lastMessage.tool_calls && lastMessage.tool_calls.length > 0 ? "tools" : END;
  }
);

// Después de ejecutar una herramienta, vuelve al LLM para que procese el resultado.
workflow.addEdge("tools", "agent");

// Define el punto de entrada al grafo.
workflow.setEntryPoint("agent");

// --- 7. Compilación de la Aplicación LangGraph ---
const app = workflow.compile();

// --- 8. Configuración de la Persistencia de Memoria (Checkpointer) ---
const checkpointer = new MemorySaver(); // Ideal para desarrollo. Para producción, considera una DB.

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

  const inputMessage = new HumanMessage({ content: message });
  let finalResponse = "Lo siento, no pude generar una respuesta.";

  try {
    const result = await app.invoke(
      { messages: [inputMessage] },
      { configurable: { thread_id: phoneNumber }, recursionLimit: 50, checkpointer }
    );

    const allMessages = result.messages as BaseMessage[];

    // *** ESTE ES EL LOG CRÍTICO PARA LA DEPURACIÓN ***
    console.log("[DEBUG] Estado final de mensajes del grafo:");
    console.log(JSON.stringify(allMessages, null, 2));

    let lastOutputMessage: BaseMessage | null = null;
    // Iterar de atrás hacia adelante para encontrar el último AIMessage del agente
    for (let i = allMessages.length - 1; i >= 0; i--) {
      // Un AIMessage puede ser la respuesta final del agente
      // o una llamada a herramienta que fue respondida por una ToolMessage.
      // Buscamos el último que sea una respuesta *final* o un mensaje sin tool_calls.
      if (allMessages[i] instanceof AIMessage && !allMessages[i].tool_calls?.length) {
        lastOutputMessage = allMessages[i];
        break;
      }
      // También podríamos considerar el último ToolMessage si es la salida final
      // y el agente no generó una respuesta después de ella.
      if (allMessages[i] instanceof ToolMessage && i === allMessages.length - 1) {
          // Si el último mensaje es un ToolMessage y no fue seguido por un AIMessage,
          // podríamos querer procesarlo como la respuesta final.
          // Esto depende de cómo quieras que tu bot se comporte si la herramienta es lo último.
          // Para este ejemplo, lo dejaremos que el agente genere la respuesta final.
      }
    }

    if (lastOutputMessage && lastOutputMessage instanceof AIMessage) {
      finalResponse = lastOutputMessage.content;
    } else {
      // Fallback si no encontramos un AIMessage final, o si el grafo termina inesperadamente
      console.warn("[Agent] No se encontró un AIMessage final claro en el historial. Verificando ToolMessages recientes.");
      // Buscar el último ToolMessage para intentar extraer la información
      const lastToolMessage = allMessages.findLast(msg => msg instanceof ToolMessage) as ToolMessage | undefined;
      if (lastToolMessage) {
         try {
           const parsedOutput = JSON.parse(lastToolMessage.content);
           if (parsedOutput && parsedOutput.status) {
             if (parsedOutput.status === "many_results" && parsedOutput.common_attributes) {
               const commonAttrsList = parsedOutput.common_attributes.map((attr: string) => {
                 const [key, value] = attr.split(': ');
                 return `${key.toLowerCase()} como "${value}"`;
               }).join(' o ');
               finalResponse = `Encontré ${parsedOutput.count} resultados. Para ayudarte a encontrar lo que necesitas, ¿podrías especificar algún atributo como ${commonAttrsList}?`;
             } else if (parsedOutput.status === "success" && parsedOutput.products && parsedOutput.products.length > 0) {
               const productsList = parsedOutput.products.map((p: any) => `- ${p.nombre} (Marca: ${p.marca}, ID: ${p.id}) - $${p.precio.toFixed(2)}`).join('\n');
               finalResponse = `¡Claro! Encontré esto para ti:\n${productsList}\n\n¿Hay alguno que te interese o deseas agregar a tu cotización (por ejemplo, "agregar ${parsedOutput.products[0].id} 1 unidad")?`;
             } else if (parsedOutput.status === "no_results") {
               finalResponse = "Lo siento, no pude encontrar ningún producto con esa descripción. ¿Puedes ser más específico o probar con otra cosa?";
             } else {
                 finalResponse = `La herramienta ejecutó con un estado inesperado. Contenido: ${lastToolMessage.content.substring(0, 100)}...`;
             }
           } else {
               finalResponse = `La herramienta ejecutó, pero la salida no tiene el formato esperado. Contenido: ${lastToolMessage.content.substring(0, 100)}...`;
           }
         } catch (jsonParseError) {
             finalResponse = `La herramienta ejecutó con un resultado no JSON o hubo un error al procesar la salida. Contenido: ${lastToolMessage.content.substring(0, 100)}...`;
         }
      } else {
        finalResponse = "Parece que no pude procesar tu solicitud o el agente no generó una respuesta clara. ¿Podrías intentar de nuevo?";
      }
    }

  } catch (error) {
    console.error("[LangGraph Error]:", error);
    finalResponse = "Lo siento, tuve un problema interno al procesar tu solicitud. Por favor, intenta de nuevo más tarde.";
  }

  console.log(`[Agent] Respuesta final para ${phoneNumber}: ${finalResponse.substring(0, 100)}...`);

  return finalResponse;
}
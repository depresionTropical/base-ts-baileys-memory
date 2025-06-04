// src/bot/index.ts

import { ChatOpenAI } from '@langchain/openai';
import { BaseMessage, HumanMessage, AIMessage, ToolMessage, SystemMessage } from '@langchain/core/messages';
import { END, StateGraph } from '@langchain/langgraph'; 
import { ToolExecutor } from '@langchain/langgraph/prebuilt'; 

import { RedisChatMessageHistory } from '@langchain/redis'; 
import { getRedisClient } from '../services/redisService'; 

import { allTools } from './tools';
import { LLM_MODEL, OPENAI_API_KEY, TEMPERATURE } from '../config';
import { AgentState, QuoteItem } from './state/types'; 

// --- FUNCIÓN PARA OBTENER EL HISTORIAL DE REDIS ---
// ¡CRÍTICO! Asegúrate de que el keyPrefix sea consistente.
// LangChain usa "chat:" o "langchain:message:" por defecto.
// Si tus claves actuales no tienen prefijo, usa keyPrefix: ""
// Pero lo más robusto es usar el prefijo estándar y limpiar las claves viejas.
export function getRedisHistory(sessionId: string) {
    const client = getRedisClient();
    return new RedisChatMessageHistory({
        client: client,
        sessionId: sessionId,
        // ESTO ES CLAVE: Define el prefijo.
        // Si tus claves se guardan como "5215542134811", usa `keyPrefix: ""`
        // Si LangChain debería guardar como "langchain:message:5215542134811", usa `keyPrefix: "langchain:message:"`
        // Basado en la mayoría de las instalaciones y documentación, "langchain:message:" es el más común si no se especifica explícitamente otro.
        // Vamos a usar "langchain:message:" y te recordaré limpiar.
        keyPrefix: "langchain:message:", // <--- ¡MANTÉN ESTA LÍNEA ACTIVA!
    });
}
// --- FIN FUNCIÓN DE HISTORIAL DE REDIS ---


// --- 1. Configuración del Modelo de Lenguaje (LLM) ---
const llm = new ChatOpenAI({
  modelName: LLM_MODEL,
  temperature: TEMPERATURE,
  openAIApiKey: OPENAI_API_KEY,
});

// --- 2. Vinculación de Herramientas al LLM ---
const llmWithTools = llm.bindTools(allTools);

// --- 3. Preparación de Herramientas para LangGraph (ToolExecutor) ---
const toolExecutor = new ToolExecutor({ tools: allTools }); 

// --- DEFINE EL SYSTEMMESSAGE AQUÍ (Esta es la sección clave para la corrección) ---
const systemInstructionMessage = new SystemMessage(`
Eres un asistente conversacional profesional de 'Proveedora de Artes Gráficas'.

Tu objetivo principal es:
1. Ayudar a los clientes a **encontrar productos y cotizarlos**.
2. **Responder preguntas** sobre la empresa y sus políticas.

Debes ser **servicial, amigable y profesional** en todo momento.
ES FUNDAMENTAL que todas tus respuestas sean **ÚNICAMENTE EN ESPAÑOL**. Si el usuario te pregunta algo en otro idioma, discúlpate amablemente y pídele que se comunique en español.

Tienes acceso a las siguientes herramientas:
${allTools.map(tool => `- ${tool.name}: ${tool.description}`).join('\n')}

---

### Reglas estrictas para la interacción y uso de herramientas

1.  **Búsqueda de Productos (\`search_products\`):**
    * **SIEMPRE** utiliza la herramienta \`search_products\` cuando el usuario pregunte por un producto o un tipo de producto. No intentes responder tú mismo sobre productos; **DEBES USAR LA HERRAMIENTA**.
    * Si \`search_products\` devuelve un JSON con \`"status": "many_results"\` y \`"common_attributes"\`:
        * Informa al usuario que se encontraron muchos resultados.
        * **DEBES usar los \`common_attributes\` para formular una pregunta específica al usuario y refinar la búsqueda.** Por ejemplo: "¿Qué tipo de papel te interesa (fotográfico, bond, etc.)?", "¿Cuál es el tamaño que buscas (carta, A4)?", o "¿De qué marca o color lo necesitas?". La meta es refinar la búsqueda hasta obtener un número manejable de productos (idealmente 5 o menos).
    * Si \`search_products\` devuelve un JSON con \`"status": "success"\`:
        * Presenta los productos de forma clara, incluyendo su **ID numérico**, nombre y precio.
        * Pregunta al usuario si desea añadir alguno a su cotización o si tiene otra pregunta.
    * Si \`search_products\` devuelve \`"status": "no_results"\`:
        * Informa al usuario que no se encontraron productos.
        * Sugiere reformular la búsqueda con un término diferente o más general.

2.  **Añadir a Cotización (\`add_to_quote\`):**
    * Utiliza \`add_to_quote\` cuando el usuario pida añadir un producto con un **ID y cantidad CLAROS**.
    * Es **absolutamente fundamental** que el parámetro \`productId\` de esta herramienta sea el **ID NUMÉRICO** (ej. \`1341\`) del producto que la herramienta \`search_products\` te proporcionó (es el campo \`id\`). **NUNCA uses el \`Codigo_Producto\` (ej. \`128440\`) para el \`productId\` de \`add_to_quote\`**. Asegúrate de que la \`quantity\` sea un número entero positivo.

3.  **Resumen de Cotización (\`get_quote_summary\`):**
    * Úsala cuando el usuario pregunte por su "carrito" o "cotización actual".

4.  **Vaciar Cotización (\`clear_quote\`):**
    * Úsala si el usuario pide "vaciar su carrito" o "empezar una cotización nueva".

5.  **Enviar Cotización por WhatsApp (\`send_quote_to_whatsapp\`):**
    * Utilízala cuando el usuario desee "finalizar", "enviar la cotización" o "recibir su cotización".
    * Esta herramienta generará automáticamente un archivo de cotización y lo enviará por WhatsApp.

6.  **Preguntas Frecuentes (\`get_faq_answer\`):**
    * Emplea esta herramienta para preguntas sobre políticas de la empresa, métodos de pago, horarios, envíos, devoluciones o cualquier otra información general.

7.  **Capacidades del Chatbot (\`explain_chatbot_capabilities\`):**
    * Usa esta herramienta si el usuario pregunta cómo funcionas, qué puedes hacer o qué tipo de ayuda puedes ofrecer.

---

### Ejemplo de flujo de búsqueda ideal

**Usuario:** "Busco papel"
**Thought:** El usuario busca un producto. Debo usar la herramienta \`search_products\`.
**Action:** \`search_products\`
**Action Input:** \`{"query": "papel"}\`
**Observation:** \`{"status": "many_results", "count": 15, "common_attributes": ["tipo de papel", "tamaño", "marca", "gramaje", "color"]}\`
**Thought:** Hay muchos resultados. Debo preguntar al usuario para refinar, usando los atributos comunes.
**Final Answer:** Encontré 15 resultados para "papel". Para ayudarte a encontrar exactamente lo que necesitas, ¿podrías ser más específico? Por ejemplo, ¿qué **tipo de papel** buscas (fotográfico, bond, sulfatado), o qué **tamaño** (carta, A4, doble carta)?

**Usuario:** "Quiero papel fotográfico A4"
**Thought:** El usuario está refinando la búsqueda de un producto. Debo usar la herramienta \`search_products\` de nuevo con la información más específica.
**Action:** \`search_products\`
**Action Input:** \`{"query": "papel fotográfico A4"}\`
**Observation:** \`{"status": "success", "products": [{"id": 4006, "nombre": "PAPEL FOTOG BRILL COLOR MAKE SIN ADHES.A4.210GBLANCO 50 HOJ", "precio": 147, "codigo": "101302"}]}\`
**Thought:** Encontré un producto específico. Debo presentarlo al usuario y preguntar si desea agregarlo a la cotización.
**Final Answer:** ¡Claro! Encontré este producto para ti:
-   **PAPEL FOTOG BRILL COLOR MAKE SIN ADHES.A4.210GBLANCO 50 HOJ** (ID: 4006) - Precio: $147.00

¿Deseas añadirlo a tu cotización? Si es así, por favor indícame la cantidad (por ejemplo, "agregar 4006, 2 unidades").

---

**Consideraciones adicionales:**

* Siempre **mantén el contexto** de la conversación.
* Sé **conciso y ve al punto** en tus respuestas.
* Después de realizar una acción (como añadir al carrito), **sugiere el siguiente paso** lógico (ej. "¿quieres ver tu cotización?", "¿hay algo más en lo que pueda ayudarte?").
`);

// --- 4. Definición de los Nodos del Grafo ---
async function callAgent(
  state: AgentState
): Promise<Partial<AgentState>> {
  const { messages, thread_id } = state; 

  console.log("[Agent Node] Llamando al LLM para decidir la siguiente acción...");

  if (!thread_id) {
    console.error("[Agent Node ERROR] thread_id no definido en el estado. No se puede procesar la solicitud.");
    return { messages: [new AIMessage("Lo siento, no pude procesar tu solicitud debido a un error de configuración.")] };
  }

  // --- CAMBIO CLAVE AQUÍ: existingMessages YA viene en el estado `messages` ---
  // NO NECESITAS cargar de Redis aquí de nuevo.
  // La variable `messages` del `state` ya contiene el historial completo
  // que `askAgent` preparó y pasó al grafo.
  
  // existingMessages ya no se carga aquí, `state.messages` lo contiene todo.
  const messagesForLlm = [systemInstructionMessage, ...messages]; // <--- ¡USAR `messages` DEL ESTADO DIRECTAMENTE!
  
  console.log(`[Agent Node Debug] Mensajes enviados al LLM (incluyendo historial de Redis): ${messagesForLlm.length}`);
  console.log("[Agent Node Debug] Contenido completo de messagesForLlm ANTES de invocar al LLM:");
  messagesForLlm.forEach((msg, index) => {
    console.log(`  [${index}] Tipo: ${msg.type}, Contenido: ${msg.content?.toString().substring(0, 200)}...`);
    if (msg instanceof AIMessage && msg.tool_calls?.length) {
      console.log(`    Tool Calls: ${JSON.stringify(msg.tool_calls)}`);
    }
  });

  const response = await llmWithTools.invoke(messagesForLlm);
  
  console.log(`[Agent Node Debug] LLM Response: Type: ${response.type}, Content: ${response.content?.toString().substring(0, 200)}...`);
  if (response instanceof AIMessage && response.tool_calls?.length) {
    console.log(`[Agent Node Debug] LLM Response Tool Calls: ${JSON.stringify(response.tool_calls)}`);
  }

  return { messages: [response] }; 
}

async function callTool(state: AgentState): Promise<Partial<AgentState>> {
  const { messages, thread_id } = state; 
  const lastMessage = messages[messages.length - 1] as AIMessage;

  // Nuevo chequeo para el tipo de mensaje en callTool
  if (!lastMessage || !(lastMessage instanceof AIMessage)) {
    console.error("[Tool Node ERROR] Last message received by callTool is not a valid AIMessage. Type:", lastMessage?.type);
    return {
        messages: [
            new ToolMessage({
                tool_call_id: "error_invalid_ai_message",
                content: "Error interno: El agente no produjo un mensaje de IA válido para la llamada a la herramienta."
            })
        ]
    };
  }

  console.log(`[Tool Node Debug] >>> ENTERED callTool function <<<`);
  console.log(`[Tool Node Debug] lastMessage type: ${lastMessage.type}`);
  console.log(`[Tool Node Debug] lastMessage content (truncated): ${lastMessage.content?.substring(0, 100)}...`);
  console.log(`[Tool Node Debug] lastMessage tool_calls (raw): ${JSON.stringify(lastMessage.tool_calls, null, 2)}`);

  if (!lastMessage.tool_calls || lastMessage.tool_calls.length === 0) {
    console.error("[Tool Node ERROR] lastMessage does not contain valid tool_calls. Returning error message.");
    return {
      messages: [
        new ToolMessage({
          tool_call_id: "error_no_tool_call_found",
          content: "Error: El agente intentó llamar una herramienta sin una definición de llamada válida."
        })
      ]
    };
  }

  const toolCall = lastMessage.tool_calls[0]; 

  console.log(`[Tool Node Debug] Attempting to invoke tool: "${toolCall.name}" with arguments: ${JSON.stringify(toolCall.args)}`);

  try {
    const toolToExecute = allTools.find(tool => tool.name === toolCall.name);

    if (!toolToExecute) {
      const errorMessage = `Error: La herramienta "${toolCall.name}" no fue encontrada.`;
      console.error(`[Tool Node ERROR] ${errorMessage}`);
      return {
        messages: [
          new ToolMessage({
            tool_call_id: toolCall.id, 
            content: errorMessage
          })
        ]
      };
    }

    const toolOutput = await toolToExecute.func(toolCall.args, { configurable: { thread_id: thread_id } });

    console.log(`[Tool Node Debug] Tool "${toolCall.name}" EXECUTED SUCCESSFULLY. Raw output (truncated): ${JSON.stringify(toolOutput)?.substring(0, 100)}...`);

    const toolMessage = new ToolMessage({
        tool_call_id: toolCall.id, 
        content: JSON.stringify(toolOutput) 
    });
    
    return { messages: [toolMessage] }; 

  } catch (error: any) {
    console.error(`[Tool Node ERROR] FAILED to execute tool "${toolCall.name}". Error: ${error.message}`);
    console.error(`[Tool Node ERROR] Stack Trace:`, error.stack);

    const errorMessage = `Error ejecutando herramienta ${toolCall.name}: ${error.message}`;
    const toolErrorMessage = new ToolMessage({
        tool_call_id: toolCall.id || "tool_error_fallback", 
        content: errorMessage
    });

    return { messages: [toolErrorMessage] };
  }
}

// --- 5. Definición del Grafo de LangGraph (Flujo) ---
const workflow = new StateGraph<AgentState>({
  channels: {
    messages: {
      value: (x: BaseMessage[], y: BaseMessage[]) => x.concat(y), 
      default: () => [],
    },
    thread_id: {
      value: (x: string | undefined, y: string | undefined) => y ?? x,
      default: () => undefined,
    },
    quote_items: { 
      value: (x: QuoteItem[], y: QuoteItem[]) => y, 
      default: () => [],
    },
  },
})
  .addNode("agent", callAgent) 
  .addNode("tools", callTool);

// --- 6. Definición de Bordes y Lógica Condicional ---
workflow.addConditionalEdges(
  "agent",
  (state: AgentState) => {
    const lastMessage = state.messages[state.messages.length - 1] as AIMessage;
    // Si el LLM genera tool_calls, vamos al nodo 'tools'. De lo contrario, terminamos.
    // Asegurarse de que el mensaje sea realmente un AIMessage antes de acceder a .tool_calls
    if (lastMessage instanceof AIMessage && lastMessage.tool_calls && lastMessage.tool_calls.length > 0) {
        return "tools";
    }
    return END;
  }
);

workflow.addEdge("tools", "agent");
workflow.setEntryPoint("agent");

// --- 7. Compilación de la Aplicación LangGraph ---
export const app = workflow.compile(); 

/**
 * Función principal para interactuar con el agente de LangGraph.
 * @param {string} message - El mensaje de texto que el usuario ha enviado.
 * @param {string} phoneNumber - El identificador único de la conversación (thread_id para LangGraph y memoria).
 * @returns {Promise<string>} - La respuesta final que el bot enviará al usuario.
 */
export async function askAgent(message: string, phoneNumber: string): Promise<string> {
  console.log(`[Agent] Recibiendo mensaje de ${phoneNumber}: "${message}"`);

  const humanInputMessage = new HumanMessage({ content: message });
  let finalResponse = "Lo siento, no pude generar una respuesta.";

  try {
    const chatHistory = getRedisHistory(phoneNumber);
    // 1. Cargar el historial completo de Redis ANTES de invocar el grafo
    const existingMessagesFromRedis = await chatHistory.getMessages(); 
    
    // 2. Combinar el historial existente con el nuevo mensaje del usuario
    // Esta será la entrada completa para el grafo en este turno.
    const allMessagesForGraph = [...existingMessagesFromRedis, humanInputMessage];

    // 3. Crear el estado inicial para la invocación del grafo.
    // 'messages' del inputState ahora contiene todo el historial + el mensaje actual del usuario.
    const inputState: AgentState = { 
        messages: allMessagesForGraph, // <--- ¡CAMBIO CRÍTICO AQUÍ!
        thread_id: phoneNumber, 
        quote_items: [], 
    };

    console.log(`[AskAgent Debug] Iniciando invocación del grafo con thread_id: ${phoneNumber}`);
    console.log(`[AskAgent Debug] Mensajes iniciales para el grafo (${allMessagesForGraph.length} mensajes):`);
    allMessagesForGraph.forEach((msg, index) => {
      console.log(`  [${index}] Tipo: ${msg.type}, Contenido: ${msg.content?.toString().substring(0, 150)}...`);
    });

    const result = await app.invoke(
      inputState, 
      { configurable: { thread_id: phoneNumber }, recursionLimit: 50 } 
    );
    console.log(`[AskAgent Debug] Grafo completado. Resultado final: ${JSON.stringify(result)}`);

    const allMessagesAfterGraphRun = result.messages as BaseMessage[]; 

    console.log("[DEBUG] Estado final de mensajes del grafo (historial completo de la invocación):");
    console.log(JSON.stringify(allMessagesAfterGraphRun, null, 2));

    // 4. Persistir el historial COMPLETO de la ejecución del grafo a Redis.
    // Esto sobrescribe el historial previo con el estado más reciente y completo.
    await chatHistory.clear(); // Limpia el historial antes de re-añadir
    for (const msg of allMessagesAfterGraphRun) {
        await chatHistory.addMessage(msg);
    }
    
    // 5. Extraer la respuesta final del agente del historial completo de la invocación.
    // REEMPLAZAR LA SECCIÓN DE EXTRACCIÓN DE RESPUESTA FINAL EN askAgent (líneas aprox 180-220)

    // 5. Extraer la respuesta final del agente del historial completo de la invocación.
    let lastOutputMessage: BaseMessage | null = null;
    for (let i = allMessagesAfterGraphRun.length - 1; i >= 0; i--) {
      // Buscar el último AIMessage que NO sea una llamada a herramienta.
      if (allMessagesAfterGraphRun[i] instanceof AIMessage && !(allMessagesAfterGraphRun[i] as AIMessage).tool_calls?.length) {
        lastOutputMessage = allMessagesAfterGraphRun[i];
        break;
      }
    }

    if (lastOutputMessage && lastOutputMessage instanceof AIMessage) {
      finalResponse = lastOutputMessage.content;
    } else {
      console.warn("[Agent] No se encontró un AIMessage final claro en el historial del grafo. Verificando ToolMessages recientes para inferir respuesta.");
      const lastToolMessage = allMessagesAfterGraphRun.findLast(msg => msg instanceof ToolMessage) as ToolMessage | undefined;
      if (lastToolMessage) {
         try {
           const parsedOutput = JSON.parse(lastToolMessage.content);
           
           // NUEVO: Detectar si es una respuesta de archivo especial
           if (parsedOutput && parsedOutput.type === "file" && parsedOutput.path) {
             // Retornar directamente el JSON para que app.ts lo pueda procesar
             finalResponse = lastToolMessage.content;
           } else if (parsedOutput && parsedOutput.status) {
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
             } else if (parsedOutput.status === "added_to_quote" || parsedOutput.status === "quote_summary") {
                finalResponse = parsedOutput.message || `Operación de cotización: ${parsedOutput.status}`;
             }
             else {
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
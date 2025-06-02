// conversationMemory.ts
type Message = { role: "user" | "assistant"; content: string };

const memoryStore: Record<string, Message[]> = {};

export function getChatHistory(phone: string): Message[] {
  return memoryStore[phone] || [];
}

export function addToChatHistory(phone: string, message: Message) {
  if (!memoryStore[phone]) {
    memoryStore[phone] = [];
  }
  memoryStore[phone].push(message);

  // Opcional: Limitar a los últimos N mensajes
  if (memoryStore[phone].length > 20) {
    memoryStore[phone] = memoryStore[phone].slice(-20);
  }
}

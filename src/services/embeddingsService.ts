// src/services/embeddingsService.ts
import { OpenAIEmbeddings } from '@langchain/openai';
import { OPENAI_API_KEY } from '../config'; // Asegúrate de tener tu API Key

export const embeddings = new OpenAIEmbeddings({
  apiKey: OPENAI_API_KEY,
  modelName: "text-embedding-ada-002", // O "text-embedding-3-small" (más reciente y eficiente)
});
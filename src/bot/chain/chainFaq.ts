import { ChatOpenAI } from "@langchain/openai";
import { ConversationalRetrievalQAChain } from "langchain/chains";
import 'dotenv/config';

import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { OpenAIEmbeddings } from "@langchain/openai";
import { Document } from "langchain/document";
import * as fs from "fs/promises";
import 'dotenv/config';

export async function crearVectorStoreFAQ() {
  // Lee el archivo de texto plano
  const texto = await fs.readFile("../data/faq.txt", "utf-8");

  // Divide en párrafos o preguntas, en este caso dividimos por doble salto de línea para separar FAQ
  const partes = texto.split("\n\n").filter(p => p.trim().length > 0);

  // Mapea a documentos
  const docs = partes.map((parte) => new Document({ pageContent: parte }));

  // Crea vectorstore con embeddings
  const vectorstore = await MemoryVectorStore.fromDocuments(
    docs,
    new OpenAIEmbeddings({
      apiKey: process.env.OPENAI_API_KEY,
    })
  );

  return vectorstore;
}


export async function crearAgenteFAQ() {
  const model = new ChatOpenAI({ 
    temperature: 0,
    apiKey: process.env.OPENAI_API_KEY,
  });
  const vectorstore = crearVectorStoreFAQ();
  const chain = ConversationalRetrievalQAChain.fromLLM(
    model,
    (await vectorstore).asRetriever(),
    {
      returnSourceDocuments: true,
    }
  );

  return chain;
}


export default crearAgenteFAQ;
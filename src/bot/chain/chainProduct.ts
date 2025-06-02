// src/agents/productAgent.ts
import { ChatOpenAI } from "@langchain/openai";
import { ConversationalRetrievalQAChain } from "langchain/chains";
import 'dotenv/config';

// src/utils/vectorstore.ts
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { OpenAIEmbeddings } from "@langchain/openai";
import { Document } from "langchain/document";
import 'dotenv/config';


import axios from "axios";

async function getData() {
  try {
    const response = await axios.get("http://localhost:4001/inventario");

    // El arreglo real está en response.data.data
    const productos = response.data.products;

    if (!Array.isArray(productos)) {
      throw new Error("La respuesta no contiene un arreglo de productos");
    }

    // Filtro: productos con Existencias > 0 y Estado_Producto === 1
    const productosFiltrados = productos.filter(p =>p.Existencias >=1 &&p.Estado_Producto === 1);

    return productosFiltrados;

  } catch (error) {
    console.error("Error al obtener los datos:", error);
    throw error;
  }
}




export async function crearVectorStore(productos: any[]) {
  const docs = productos.map((p) => {
    const texto = `${p.Producto}`;
    return new Document({ pageContent: texto, metadata: { ...p } });
  });

  const vectorstore = await MemoryVectorStore.fromDocuments(
    docs,
    new OpenAIEmbeddings(
      {
        apiKey: process.env.OPENAI_API_KEY,
      }
    ),
    
  );

  return vectorstore;
}


export async function crearAgente( ) {
  const products = await getData();
  const vectorstore = await crearVectorStore(products);
  const model = new ChatOpenAI({ 
    temperature: 0,
    apiKey: process.env.OPENAI_API_KEY,
  });

  const chain = ConversationalRetrievalQAChain.fromLLM(
    model,
    vectorstore.asRetriever(),
    {
      returnSourceDocuments: true,

    }
  );

  return chain;
}

export default crearAgente
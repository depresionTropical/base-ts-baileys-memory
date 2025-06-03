// src/scripts/indexProducts.ts
import { fetchAndFilterAllProducts } from '../bot/tools/searchProducts'; // Reutiliza tu función de API
import { getVectorStore } from '../services/vectorStoreService';
import { Document } from '@langchain/core/documents';

async function indexProducts() {
  console.log("Iniciando indexación de productos...");
  const products = await fetchAndFilterAllProducts(); // Obtiene tus productos filtrados
  const vectorStore = await getVectorStore();

  // Transforma tus productos en documentos para LangChain
  const documents: Document[] = products.map(p => new Document({
    pageContent: `${p.Producto} ${p.Codigo_Producto || ''} ${p.marca || ''} ${p.descripcion || ''}`, // Texto a vectorizar
    metadata: {
      id: p.ID_Producto,
      nombre: p.Producto,
      precio: p.Precio_Venta,
      // Añade aquí otros metadatos que quieras recuperar
    },
  }));

  // Añade los documentos al VectorStore
  // Ojo: Esto eliminará la colección existente si la estás inicializando así
  // Para actualizar, tendrías que manejar upserts o borrar y recrear.
  await vectorStore.addDocuments(documents);
  console.log(`Indexación completa: ${documents.length} productos vectorizados.`);
}

indexProducts().catch(console.error);
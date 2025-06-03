// src/services/vectorStoreService.ts
import { Chroma } from '@langchain/community/vectorstores/chroma';
import { embeddings } from './embeddingsService';

// Puedes definir una colección por defecto o crear una para tus productos
const collectionName = "products-collection";

export async function initializeOrRefreshProductVectorStore(): Promise<void> {
    // ... (lógica de caché y fetchAndFilterProductsFromAPI) ...

    try {
        const products = await fetchAndFilterProductsFromAPI();

        // ... (manejo de productos vacíos) ...

        const docs = products.map((p) => {
            // **AJUSTE CLAVE AQUÍ:** Solo usa p.Producto como pageContent.
            // El embedding de OpenAI es lo suficientemente inteligente para entender
            // palabras clave dentro de una cadena.
            const pageContent = p.Producto; 

            return new Document({ 
                pageContent: pageContent, 
                metadata: { ...p } // Mantén todos los metadatos del producto original
            });
        });

        globalVectorStore = await MemoryVectorStore.fromDocuments(
            docs,
            new OpenAIEmbeddings({
                apiKey: process.env.OPENAI_API_KEY,
                modelName: "text-embedding-ada-002", // o "text-embedding-3-small"
            })
        );
        lastSuccessfulFetchTime = now;
        console.log(`[VectorStore] Product Vector Store inicializada/actualizada con ${products.length} productos.`);
    } catch (error) {
        console.error("[VectorStore] Fallo al inicializar/refrescar la Vector Store:", error);
        throw error;
    }
}
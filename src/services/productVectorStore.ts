// src/services/productVectorStore.ts

import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { OpenAIEmbeddings } from "@langchain/openai";
import { Document } from "langchain/document";
import axios from "axios";
import { Product } from '../bot/state/types'; // Importa tu interfaz Product

let globalVectorStore: MemoryVectorStore | null = null; // Variable global para la vector store
let lastSuccessfulFetchTime: number = 0;
const REFRESH_INTERVAL_MS = 30 * 60 * 1000; // Refrescar cada 30 minutos (ajusta según necesites)

/**
 * Obtiene los productos del inventario de tu API, aplicando los filtros de Existencias y Estado_Producto.
 * @returns {Promise<Product[]>} Un array de productos filtrados.
 */
async function fetchAndFilterProductsFromAPI(): Promise<Product[]> {
    try {
        console.log("[API] Obteniendo productos de http://localhost:4001/inventario...");
        const response = await axios.get("http://localhost:4001/inventario");

        const productosRaw = response.data.products;

        if (!Array.isArray(productosRaw)) {
            console.error("API Response structure error: expected an array of products under 'products' key.", response.data);
            throw new Error("La respuesta de la API no contiene un arreglo de productos válido bajo la clave 'products'.");
        }

        const productosFiltrados = productosRaw.filter((p: any) =>
            p.Existencias >= 1 && p.Estado_Producto === 1
        ) as Product[];

        console.log(`[API] Productos cargados y filtrados (Existencias >= 1, Estado_Producto === 1): ${productosFiltrados.length} encontrados.`);
        return productosFiltrados;

    } catch (error: any) {
        console.error("Error al obtener los datos del inventario desde la API:", error.message);
        throw new Error(`Error al conectar con el servicio de inventario: ${error.message}. Por favor, verifica que tu servicio está corriendo en http://localhost:4001.`);
    }
}

/**
 * Crea o actualiza la MemoryVectorStore con los productos obtenidos de la API.
 * Se puede llamar periódicamente para mantener la Store actualizada.
 */
export async function initializeOrRefreshProductVectorStore(): Promise<void> {
    const now = Date.now();
    if (globalVectorStore && (now - lastSuccessfulFetchTime < REFRESH_INTERVAL_MS)) {
        console.log("[VectorStore] Saltando refresh, usando VectorStore en caché.");
        return; // No refrescar si no ha pasado suficiente tiempo
    }

    console.log("[VectorStore] Inicializando/Refrescando Product Vector Store...");
    try {
        const products = await fetchAndFilterProductsFromAPI();

        if (products.length === 0) {
            console.warn("[VectorStore] No se encontraron productos con Existencias > 0 y Estado_Producto === 1. La VectorStore estará vacía.");
            globalVectorStore = new MemoryVectorStore(
                new OpenAIEmbeddings({ apiKey: process.env.OPENAI_API_KEY })
            );
            return;
        }

        const docs = products.map((p) => {
            // Combina campos relevantes para crear el contenido del documento.
            // Esto es lo que el modelo de embeddings 'leerá' para crear el vector.
            const pageContent = `Producto: ${p.Producto}, Código: ${p.Codigo_Producto}, Precio: ${p.Precio_Venta}`;
            
            // Incluye todos los datos del producto en los metadatos para recuperarlos más tarde
            return new Document({ pageContent: pageContent, metadata: { ...p } });
        });

        // NOTA: MemoryVectorStore.fromDocuments recrea la store. Si quieres añadir/actualizar
        // productos incrementalmente sin borrar lo existente, necesitarías un VectorStore diferente
        // o manejarlo manualmente con addDocuments. Para este caso simple, fromDocuments es suficiente.
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
        // Podrías lanzar el error o permitir que continue con una store vacía/vieja
        // Depende de cómo quieras manejar fallos de carga inicial.
        throw error;
    }
}

/**
 * Obtiene la instancia de la MemoryVectorStore. Asegura que esté inicializada.
 * @returns {Promise<MemoryVectorStore>} La instancia de la Vector Store.
 */
export async function getProductVectorStore(): Promise<MemoryVectorStore> {
    if (!globalVectorStore) {
        // Intenta inicializar si aún no lo ha hecho
        await initializeOrRefreshProductVectorStore();
    }
    return globalVectorStore!; // ! para asegurar que no es null después del await
}

// Puedes añadir una función para llamar al refresh en un cron job o setInterval si tu app lo soporta
// Por ejemplo, setInterval(initializeOrRefreshProductVectorStore, REFRESH_INTERVAL_MS);
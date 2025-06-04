// src/services/productVectorStore.ts

import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { OpenAIEmbeddings } from "@langchain/openai";
import { Document } from "langchain/document";
import axios from "axios";
import { Product, ConsolidatedProduct} from '../bot/state/types'; // Importa tu interfaz Product

let globalVectorStore: MemoryVectorStore | null = null; // Variable global para la vector store
let lastSuccessfulFetchTime: number = 0;
const REFRESH_INTERVAL_MS = 30 * 60 * 1000; // Refrescar cada 30 minutos (ajusta según necesites)

/**
 * Obtiene los productos del inventario de tu API, aplicando los filtros de Existencias y Estado_Producto,
 * y consolidando productos duplicados por almacén.
 * @returns {Promise<ConsolidatedProduct[]>} Un array de productos consolidados y filtrados.
 */
async function fetchAndFilterAndConsolidateProductsFromAPI(): Promise<ConsolidatedProduct[]> {
    try {
        console.log("[API] Obteniendo productos de http://localhost:4001/inventario...");
        const response = await axios.get("http://localhost:4001/inventario");

        const productosRaw = response.data.products;

        if (!Array.isArray(productosRaw)) {
            console.error("API Response structure error: expected an array of products under 'products' key.", response.data);
            throw new Error("La respuesta de la API no contiene un arreglo de productos válido bajo la clave 'products'.");
        }

        // 1. Filtrar productos por Existencias y Estado_Producto
        const productosDisponibles = productosRaw.filter((p: Product) =>
            p.Existencias >= 1 && p.Estado_Producto === 1
        ) as Product[];

        // 2. Consolidar productos por Codigo_Producto
        const productosConsolidadosMap: { [key: string]: ConsolidatedProduct } = {};

        for (const p of productosDisponibles) {
            const codigoProducto = p.Codigo_Producto;

            if (productosConsolidadosMap[codigoProducto]) {
                // Producto ya visto, agrega el almacén actual a su lista
                if (!productosConsolidadosMap[codigoProducto].Almacenes_Disponibles.includes(p.Almacen)) {
                    productosConsolidadosMap[codigoProducto].Almacenes_Disponibles.push(p.Almacen);
                }
                // Suma las existencias para obtener el total consolidado
                productosConsolidadosMap[codigoProducto].Existencias_Total += p.Existencias;
                // Nota: El Precio_Venta se mantiene como el del primer almacén encontrado para este producto.
                // Si necesitas una lógica diferente para el precio (ej. promedio, mínimo, máximo), ajústalo aquí.

            } else {
                // Primera vez que vemos este producto, crea una nueva entrada consolidada
                productosConsolidadosMap[codigoProducto] = {
                    ID_Producto: p.ID_Producto,
                    Producto: p.Producto,
                    Codigo_Producto: p.Codigo_Producto,
                    Precio_Venta: p.Precio_Venta, // Toma el precio del primer almacén encontrado
                    Existencias_Total: p.Existencias,
                    Estado_Producto: p.Estado_Producto,
                    Almacenes_Disponibles: [p.Almacen] // Empieza con el almacén actual
                };
            }
        }

        // Convierte el mapa de productos consolidados de vuelta a un array
        const productosFinales = Object.values(productosConsolidadosMap);

        console.log(`[API] Productos cargados, filtrados y consolidados: ${productosFinales.length} productos únicos encontrados.`);
        return productosFinales;

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
        // Llama a la nueva función que también consolida
        const products = await fetchAndFilterAndConsolidateProductsFromAPI();

        if (products.length === 0) {
            console.warn("[VectorStore] No se encontraron productos únicos con Existencias > 0 y Estado_Producto === 1. La VectorStore estará vacía.");
            globalVectorStore = new MemoryVectorStore(
                new OpenAIEmbeddings({ apiKey: process.env.OPENAI_API_KEY })
            );
            return;
        }

        const docs = products.map((p) => {
            // Combina campos relevantes para crear el contenido del documento.
            // Ahora incluye la información de almacenes disponibles y existencias totales.
            const pageContent = `Producto: ${p.Producto}, Código: ${p.Codigo_Producto}, Precio: ${p.Precio_Venta}, Existencias totales: ${p.Existencias_Total}, Disponible en almacenes: ${p.Almacenes_Disponibles.join(', ')}`;
            
            // Incluye todos los datos del producto consolidado en los metadatos para recuperarlos más tarde
            return new Document({ pageContent: pageContent, metadata: { ...p } });
        });

        globalVectorStore = await MemoryVectorStore.fromDocuments(
            docs,
            new OpenAIEmbeddings({
                apiKey: process.env.OPENAI_API_KEY,
                modelName: "text-embedding-3-small", // o "text-embedding-3-large"
            })
        );
        lastSuccessfulFetchTime = now;
        console.log(`[VectorStore] Product Vector Store inicializada/actualizada con ${products.length} productos únicos.`);
    } catch (error) {
        console.error("[VectorStore] Fallo al inicializar/refrescar la Vector Store:", error);
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

// src/bot/tools/searchProducts.ts

import { z } from "zod";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { getProductVectorStore } from '../../services/productVectorStore'; 
import { Product, SearchProductsSuccessResponse, SearchProductsManyResultsResponse, SearchProductsNoResultsResponse } from '../state/types'; 

const searchProductsSchema = z.object({
  query: z.string().describe("El término de búsqueda o descripción del producto a buscar. Ejemplos: 'papel bond', 'tinta hp', 'papel fotográfico a4', 'papel sulfatado blanco'"),
});

async function searchProductsLogic(args: z.infer<typeof searchProductsSchema>): Promise<string> {
  const query = args.query;
  console.log(`[Tool] search_products (MemoryVectorStore Search) llamada con query: "${query}"`);

  try {
    const vectorStore = await getProductVectorStore();

    // **CORRECCIÓN CRÍTICA AQUÍ:** El segundo argumento es el número de resultados (k), no el umbral.
    // Le estamos pidiendo los 20 documentos más similares.
    const rawResultsWithScores = await vectorStore.similaritySearchWithScore(query, 20); 

    // ************************************************************
    // IMPORTANTE: Estos logs te mostrarán las puntuaciones de similitud.
    console.log(`[SearchProducts Debug] Resultados RAW (top ${rawResultsWithScores.length}) para "${query}":`);
    if (rawResultsWithScores.length === 0) {
        console.log("  No se encontraron resultados raw en la búsqueda de similitud.");
    } else {
        rawResultsWithScores.forEach(([doc, score], index) => {
            console.log(`  ${index + 1}. Producto: "${doc.pageContent}" - Score: ${score.toFixed(4)}`);
        });
    }
    // ************************************************************

    // **RELEVANCE_THRESHOLD:** Este es tu filtro.
    // Ajusta este valor en base a los 'Scores' que veas en los logs de arriba.
    // Recuerda: para distancia coseno, score CERCANO A 0 es ALTA SIMILITUD.
    // score CERCANO A 1 es BAJA SIMILITUD.
    // Si tus productos relevantes tienen scores de 0.8, necesitas un threshold como 0.85 o 0.9.
    const RELEVANCE_THRESHOLD = 0.5; // <<-- AJUSTA ESTE VALOR SEGÚN TUS PRUEBAS
    console.log(`[SearchProducts Debug] Usando RELEVANCE_THRESHOLD: ${RELEVANCE_THRESHOLD}`);

    const relevantProducts: Product[] = rawResultsWithScores
        .filter(([doc, score]) => score < RELEVANCE_THRESHOLD)
        .map(([doc, score]) => {
            const product = doc.metadata as Product;
            // !!! ADD THIS LOG !!!
            console.log(`[SearchProducts Debug] Mapped Product (ID: ${product.ID_Producto || 'N/A'}):`, JSON.stringify(product, null, 2));
            console.log(`[SearchProducts Debug] Product Existencias: ${product.Existencias}, Estado_Producto: ${product.Estado_Producto}`);
            return product;
        }); 

    // Filtro adicional para productos con existencias y estado activo
    const validFoundProducts = relevantProducts.filter(p => p.Existencias >= 1 && p.Estado_Producto === 1);


    if (validFoundProducts.length === 0) {
        console.log(`[SearchProducts] No se encontraron productos semánticamente similares o disponibles para la query: "${query}".`);
        const output: SearchProductsNoResultsResponse = {
            status: "no_results",
            message: `Lo siento, no pude encontrar ningún producto que coincida con "${query}" o que esté disponible. ¿Puedes ser más específico o probar con otra cosa?`
        };
        return JSON.stringify(output);
    }

    const MAX_RESULTS_FOR_DIRECT_LISTING = 8; 

    if (validFoundProducts.length > MAX_RESULTS_FOR_DIRECT_LISTING) {
        console.log(`[SearchProducts] Demasiados resultados (${validFoundProducts.length}) para la query: "${query}".`);

        const attributesToAsk: string[] = [
            "tipo de papel", 
            "tamaño", 
            "marca", 
            "característica específica (ej: brillo, mate, gramaje, color)"
        ];
        
        const output: SearchProductsManyResultsResponse = {
            status: "many_results",
            count: validFoundProducts.length,
            common_attributes: attributesToAsk 
        };
        return JSON.stringify(output);

    } else {
        console.log(`[SearchProducts] Se encontraron ${validFoundProducts.length} productos para la query: "${query}".`);
        const productsToReturn = validFoundProducts.map(p => ({
            id: p.ID_Producto,
            nombre: p.Producto,
            precio: p.Precio_Venta,
            codigo: p.Codigo_Producto
        }));
        const output: SearchProductsSuccessResponse = {
            status: "success",
            products: productsToReturn
        };
        return JSON.stringify(output);
    }

  } catch (error: any) {
    console.error(`[Tool] Error en search_products (Vector Search Logic): ${error.message}`);
    return JSON.stringify({
      status: "error",
      message: `Hubo un error al buscar productos con el motor de búsqueda semántica: ${error.message}. Asegúrate de que el servicio de inventario esté funcionando y el VectorStore se haya inicializado correctamente.`
    });
  }
}

export const searchProducts = new DynamicStructuredTool({
  name: "search_products",
  description: `Busca productos en el catálogo de Proveedora de Artes Gráficas usando búsqueda semántica para entender mejor tu consulta. 
                  Útil para encontrar cualquier tipo de material o equipo. 
                  Retorna si hay 'many_results', 'success' (con productos) o 'no_results'. 
                  Si hay muchos resultados, también proporciona 'common_attributes' para refinar la búsqueda.`,
  schema: searchProductsSchema, 
  func: searchProductsLogic, 
});
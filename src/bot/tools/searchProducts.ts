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

    // Paso 1: Obtener una lista más amplia de candidatos semánticos (ej. top 20 o top 30)
    // Mantendremos un umbral de similitud inicial más bajo para capturar más resultados.
    // Ajusta el 'k' (segundo argumento) si necesitas más de 20 resultados base para el reranking.
    const rawResultsWithScores = await vectorStore.similaritySearchWithScore(query, 20);

    console.log(`[SearchProducts Debug] Resultados RAW (top ${rawResultsWithScores.length}) para "${query}":`);
    if (rawResultsWithScores.length === 0) {
        console.log("  No se encontraron resultados raw en la búsqueda de similitud.");
    } else {
        rawResultsWithScores.forEach(([doc, score], index) => {
            console.log(`  ${index + 1}. Producto: "${doc.pageContent}" - Score: ${score.toFixed(4)}`);
        });
    }

    // Paso 2: Definir el umbral de relevancia "base" (más bajo)
    // Este umbral es para *aceptar* productos semánticamente similares antes del reranking.
    // Un 0.5 es un buen punto de partida, si los scores tienden a ser bajos.
    // Si tus scores son normalmente más altos, podrías usar 0.6 o 0.7.
    const BASE_RELEVANCE_THRESHOLD = 0.5;
    console.log(`[SearchProducts Debug] Usando BASE_RELEVANCE_THRESHOLD: ${BASE_RELEVANCE_THRESHOLD}`);


    // Paso 3: Aplicar reglas heurísticas para reranking y filtrado
    // Convertir a un formato fácil de manipular y aplicar el umbral base
    let candidateProducts: Array<{ product: Product, score: number, heuristic_boost: number }> = rawResultsWithScores
        .filter(([doc, score]) => score >= BASE_RELEVANCE_THRESHOLD) // Filtro inicial por relevancia base
        .map(([doc, score]) => {
            const product = doc.metadata as Product;
            // console.log(`[SearchProducts Debug] Mapped Product (ID: ${product.ID_Producto || 'N/A'}):`, JSON.stringify(product, null, 2));
            // console.log(`[SearchProducts Debug] Product Existencias: ${product.Existencias_Total}, Estado_Producto: ${product.Estado_Producto}`);
            return { product, score, heuristic_boost: 0 }; // Inicializar el boost
        });

    // Normalizar la consulta para comparación (minúsculas, sin acentos, etc.)
    const normalizedQuery = query.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const queryWords = normalizedQuery.split(/\s+/).filter(word => word.length > 1); // Ignorar palabras muy cortas

    // Aplicar reglas heurísticas para dar "boost" a productos
    candidateProducts = candidateProducts.map(item => {
        let currentBoost = 0;
        const normalizedProductName = item.product.Producto.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

        // Regla 1: Coincidencia exacta de la query en el nombre del producto
        if (normalizedProductName.includes(normalizedQuery)) {
            currentBoost += 0.2; // Un buen boost si la query completa está en el nombre
        }

        // Regla 2: Coincidencia de palabras clave importantes (ej: "HP", "negra", "carta")
        // Podrías tener una lista de palabras clave relevantes para tu catálogo
        const importantKeywords = queryWords.filter(word => !['papel', 'tinta', 'para', 'color', 'bot'].includes(word)); // Evitar palabras genéricas

        importantKeywords.forEach(keyword => {
            if (normalizedProductName.includes(keyword)) {
                currentBoost += 0.05; // Boost menor por cada palabra clave que coincida
            }
        });

        // Regla 3: Coincidencia de prefijo o sufijo (ej. "TINTA NEGRA" y "NEGRA TINTA")
        // Esto es más complejo, pero si las palabras clave de la query están al inicio o final del producto
        const productWords = normalizedProductName.split(/\s+/).filter(word => word.length > 1);
        if (queryWords.length > 0 && productWords.length > 0) {
            if (productWords[0].includes(queryWords[0]) || productWords[productWords.length - 1].includes(queryWords[queryWords.length - 1])) {
                currentBoost += 0.03;
            }
        }
        
        // Puedes añadir más reglas aquí:
        // - Coincidencia de códigos de producto si la query parece un código
        // - Priorizar por marca si la marca se menciona en la query
        // - Penalizar productos que contengan palabras *excluidas* (ej. si busca "papel", penalizar "tinta")

        return { ...item, heuristic_boost: currentBoost };
    });

    // Paso 4: Calcular la puntuación final (score original + boost) y ordenar
    candidateProducts.forEach(item => {
        item.score += item.heuristic_boost; // Sumar el boost al score original
    });

    // Ordenar de mayor a menor score final
    candidateProducts.sort((a, b) => b.score - a.score);

    console.log(`[SearchProducts Debug] Productos Reranked (top ${candidateProducts.length}):`);
    candidateProducts.forEach((item, index) => {
        console.log(`  ${index + 1}. Producto: "${item.product.Producto}" - Score Final: ${item.score.toFixed(4)} (Original: ${rawResultsWithScores.find(([doc,]) => doc.metadata.ID_Producto === item.product.ID_Producto)?.[1]?.toFixed(4) || 'N/A'}, Boost: ${item.heuristic_boost.toFixed(4)})`);
    });

    // Paso 5: Aplicar filtros de negocio (existencias y estado) y seleccionar los top N
    const finalFoundProducts = candidateProducts
        .filter(item => item.product.Existencias_Total > 0 && item.product.Estado_Producto === 1)
        .slice(0, 5) // Limitar a los primeros 8 resultados después de ordenar y filtrar por existencias
        .map(item => item.product); // Extraer solo el objeto Product

    if (finalFoundProducts.length === 0) {
        console.log(`[SearchProducts] No se encontraron productos semánticamente similares o disponibles para la query: "${query}".`);
        const output: SearchProductsNoResultsResponse = {
            status: "no_results",
            message: `Lo siento, no pude encontrar ningún producto que coincida con "${query}" o que esté disponible. ¿Puedes ser más específico o probar con otra cosa?`
        };
        return JSON.stringify(output);
    }

    const MAX_RESULTS_FOR_DIRECT_LISTING = 5; // Cambiado a 5 para un listado más conciso

    if (finalFoundProducts.length > MAX_RESULTS_FOR_DIRECT_LISTING) {
        console.log(`[SearchProducts] Demasiados resultados (${finalFoundProducts.length}) para la query: "${query}".`);

        const attributesToAsk: string[] = [
            "tipo de papel",
            "tamaño",
            "marca",
            "gramaje",
            "color"
        ];
        // Podrías analizar los `finalFoundProducts` para sugerir atributos específicos a los productos encontrados.
        // Por ejemplo, si todos los resultados son de "tinta", sugerir "tipo de impresora" o "marca de tinta".

        const output: SearchProductsManyResultsResponse = {
            status: "many_results",
            count: finalFoundProducts.length,
            common_attributes: attributesToAsk
        };
        return JSON.stringify(output);

    } else {
        console.log(`[SearchProducts] Se encontraron ${finalFoundProducts.length} productos para la query: "${query}".`);
        const productsToReturn = finalFoundProducts.map(p => ({
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
                  Aplica un reranking inteligente para priorizar los resultados más relevantes.
                  Útil para encontrar cualquier tipo de material o equipo.
                  Retorna si hay 'many_results', 'success' (con productos) o 'no_results'.
                  Si hay muchos resultados, también proporciona 'common_attributes' para refinar la búsqueda.`,
  schema: searchProductsSchema,
  func: searchProductsLogic,
});
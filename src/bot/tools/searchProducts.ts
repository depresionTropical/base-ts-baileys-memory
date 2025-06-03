// src/bot/tools/searchProducts.ts

import { z } from "zod";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { getProductVectorStore } from '../../services/productVectorStore'; 
import { Product, SearchProductsSuccessResponse, SearchProductsManyResultsResponse, SearchProductsNoResultsResponse } from '../state/types'; 
import { Document } from "langchain/document"; 

const searchProductsSchema = z.object({
  query: z.string().describe("El término de búsqueda o descripción del producto a buscar. Ejemplos: 'papel bond', 'tinta hp', 'papel fotográfico a4', 'papel sulfatado blanco'"),
});

async function searchProductsLogic(args: z.infer<typeof searchProductsSchema>): Promise<string> {
  const query = args.query;
  console.log(`[Tool] search_products (MemoryVectorStore Search) llamada con query: "${query}"`);

  try {
    const vectorStore = await getProductVectorStore();

    const rawResultsWithScores = await vectorStore.similaritySearchWithScore(query, 20); 

    const RELEVANCE_THRESHOLD = 0.75; // Puedes ajustar este valor si los resultados no son buenos.
                                    // Prueba con 0.8 si quieres ser un poco más estricto.

    const relevantProducts: Product[] = rawResultsWithScores
        .filter(([doc, score]) => score < RELEVANCE_THRESHOLD) 
        .map(([doc, score]) => doc.metadata as Product); 

    const validFoundProducts = relevantProducts.filter(p => p.Existencias >= 1 && p.Estado_Producto === 1);


    if (validFoundProducts.length === 0) {
        console.log(`[SearchProducts] No se encontraron productos semánticamente similares o disponibles para la query: "${query}".`);
        const output: SearchProductsNoResultsResponse = {
            status: "no_results",
            message: `Lo siento, no pude encontrar ningún producto que coincida con "${query}" o que esté disponible. ¿Puedes ser más específico o probar con otra cosa?`
        };
        return JSON.stringify(output);
    }

    const MAX_RESULTS_FOR_DIRECT_LISTING = 12; // Mantenemos este umbral elevado.

    if (validFoundProducts.length > MAX_RESULTS_FOR_DIRECT_LISTING) {
        console.log(`[SearchProducts] Demasiados resultados (<span class="math-inline">\{validFoundProducts\.length\}\) para la query\: "</span>{query}".`);

        // **AJUSTE CLAVE AQUÍ:** Lógica para common_attributes sin campos explícitos.
        // Dada tu estructura de datos, no podemos agrupar por 'Marca' o 'Tipo' directamente
        // de los metadatos. En su lugar, ofrecemos sugerencias genéricas al LLM
        // para que pida más detalles relevantes para tu catálogo.

        const attributesToAsk: string[] = [
            "tipo de papel", 
            "tamaño", 
            "marca", 
            "característica específica (ej: brillo, mate, gramaje, color)"
        ];

        // Si el LLM necesita más ayuda, se le pueden dar ejemplos más específicos si los tienes.
        // Por ejemplo, si sabes que tienes marcas comunes como "HP", "Epson", "Canon", etc.
        // Pero esto requiere conocimiento de tu catálogo, no extracción automática de datos.

        const output: SearchProductsManyResultsResponse = {
            status: "many_results",
            count: validFoundProducts.length,
            common_attributes: attributesToAsk 
        };
        return JSON.stringify(output);

    } else {
        console.log(`[SearchProducts] Se encontraron <span class="math-inline">\{validFoundProducts\.length\} productos para la query\: "</span>{query}".`);
        const productsToReturn = validFoundProducts.map(p => ({
            id: p.ID_Producto,
            nombre: p.Producto,
            precio: p.Precio_Venta,
            codigo: p.Codigo_Producto
            // No incluyas 'marca' o 'tipo' aquí si no son propiedades directas.
            // El LLM puede inferirlas del 'nombre' del producto.
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
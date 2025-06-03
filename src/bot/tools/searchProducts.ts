// src/bot/tools/searchProducts.ts

import { z } from "zod";
import { DynamicStructuredTool } from "@langchain/core/tools";

/**
 * Define el esquema de entrada para la herramienta searchProducts.
 * Esto asegura que el LLM pase los argumentos correctos.
 */
const searchProductsSchema = z.object({
  query: z.string().describe("El término de búsqueda o descripción del producto a buscar. Ejemplos: 'papel bond', 'tinta hp', 'papel fotográfico a4', 'papel sulfatado blanco'"),
});

/**
 * Simula una función para buscar productos en una base de datos o sistema.
 * @param args Objeto que contiene los argumentos de la herramienta, según searchProductsSchema.
 * Debe incluir una propiedad 'query'.
 * @returns Un objeto JSON que simula los resultados de la búsqueda.
 */
async function searchProductsLogic(args: z.infer<typeof searchProductsSchema>) {
  // CORRECTO: Accede a la propiedad 'query' del objeto 'args'
  const query = args.query;
  console.log(`[Tool] search_products llamada con query: "${query}"`);

  // Simulación de una base de datos de productos (¡reemplaza con tu lógica real!)
  const mockProducts = [
    { id: "P001", nombre: "Papel Bond Carta", marca: "HP", color: "Blanco", gramaje: "75g", precio: 500, tipo: "Papel", tamaño: "Carta" },
    { id: "P002", nombre: "Papel Fotográfico A4", marca: "Epson", color: "Blanco", gramaje: "200g", precio: 850, tipo: "Papel", tamaño: "A4" },
    { id: "T001", nombre: "Tinta Negra HP 664", marca: "HP", color: "Negro", tipo: "Tinta", precio: 350 },
    { id: "P003", nombre: "Papel Couche Brillante A3", marca: "ProPal", color: "Blanco", gramaje: "150g", precio: 1200, tipo: "Papel", tamaño: "A3" },
    { id: "T002", nombre: "Tinta Cyan Epson T50", marca: "Epson", color: "Cyan", tipo: "Tinta", precio: 400 },
    { id: "T003", nombre: "Cartuchos de Tinta EPSON T2991-T2994", marca: "Epson", tipo: "Tinta", precio: 1500},
    { id: "C001", nombre: "Papel Sulfatado Blanco 12x18 12pt", marca: "Kimberly", color: "Blanco", gramaje: "250g", precio: 900, tipo: "Cartulina", tamaño: "12x18" },
    { id: "C002", nombre: "Papel Sulfatado Brillante 12x18 14pt", marca: "Kimberly", color: "Blanco", gramaje: "300g", precio: 1100, tipo: "Cartulina", tamaño: "12x18" },
    { id: "I001", nombre: "Plotter de Impresión de Gran Formato HP DesignJet T210", marca: "HP", tipo: "Impresora", precio: 25000},
  ];

  const lowerCaseQuery = query.toLowerCase(); // Ahora 'query' es una cadena, ¡funciona!
  const results = mockProducts.filter(p =>
    p.nombre.toLowerCase().includes(lowerCaseQuery) ||
    p.marca.toLowerCase().includes(lowerCaseQuery) ||
    p.tipo?.toLowerCase().includes(lowerCaseQuery) ||
    p.color?.toLowerCase().includes(lowerCaseQuery) ||
    p.tamaño?.toLowerCase().includes(lowerCaseQuery) ||
    p.id.toLowerCase() === lowerCaseQuery
  );

  const MAX_DISPLAY_RESULTS = 8; // Límite para mostrar directamente los resultados

  if (results.length > MAX_DISPLAY_RESULTS) {
    const attributes = new Set<string>();
    results.forEach(p => {
      if (p.marca) attributes.add(`marca: ${p.marca}`);
      if (p.tipo) attributes.add(`tipo: ${p.tipo}`);
      if (p.color) attributes.add(`color: ${p.color}`);
      if (p.gramaje) attributes.add(`gramaje: ${p.gramaje}`);
      if (p.tamaño) attributes.add(`tamaño: ${p.tamaño}`);
    });
    const commonAttributes = Array.from(attributes).slice(0, 3); // Obtener hasta 3 atributos comunes

    return JSON.stringify({
      status: "many_results",
      count: results.length,
      common_attributes: commonAttributes,
    });
  } else if (results.length > 0) {
    return JSON.stringify({
      status: "success",
      products: results.map(p => ({
        id: p.id,
        nombre: p.nombre,
        marca: p.marca,
        precio: p.precio,
      })),
    });
  } else {
    return JSON.stringify({
      status: "no_results",
    });
  }
}

export const searchProducts = new DynamicStructuredTool({
  name: "search_products",
  description: "Busca productos en el catálogo de Proveedora de Artes Gráficas. Útil para encontrar cualquier tipo de material o equipo. Retorna si hay 'many_results', 'success' (con productos) o 'no_results'. Si hay muchos resultados, también proporciona 'common_attributes' para refinar la búsqueda.",
  schema: searchProductsSchema, // Usa el esquema definido
  func: searchProductsLogic, // Usa la función corregida
});
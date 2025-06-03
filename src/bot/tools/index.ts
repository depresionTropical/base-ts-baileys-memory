// src/bot/tools/index.ts

import { searchProducts } from "./searchProducts";
import { addToQuote, getQuoteSummary, clearQuote , sendQuoteToEmail} from "./quoteManagement";
import { handleGreeting, getFAQAnswer, explainChatbotCapabilities } from "./miscTools";

// Exporta todas las herramientas que el agente puede usar
export const allTools = [
  searchProducts,
  addToQuote,
  getQuoteSummary,
  clearQuote,
  handleGreeting,
  getFAQAnswer,
  explainChatbotCapabilities,
  sendQuoteToEmail
];
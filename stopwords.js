// stopwords.js
// Common stopwords in Spanish and English to filter out during keyword extraction

export const STOPWORDS_ES = new Set([
  // Artículos
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas',
  // Preposiciones
  'a', 'ante', 'bajo', 'con', 'contra', 'de', 'desde', 'durante', 'en', 'entre',
  'hacia', 'hasta', 'mediante', 'para', 'por', 'según', 'sin', 'sobre', 'tras',
  // Conjunciones
  'y', 'e', 'o', 'u', 'pero', 'sino', 'que', 'si',
  // Pronombres
  'yo', 'tú', 'él', 'ella', 'nosotros', 'vosotros', 'ellos', 'ellas',
  'me', 'te', 'se', 'nos', 'os', 'lo', 'le', 'les',
  'mi', 'tu', 'su', 'nuestro', 'vuestro',
  // Verbos auxiliares comunes
  'es', 'está', 'son', 'están', 'ser', 'estar', 'hay', 'haber',
  // Interrogativos
  'cómo', 'como', 'qué', 'cuál', 'cuáles', 'dónde', 'donde',
  // Otros comunes
  'del', 'al', 'ver', 'hacer', 'tiene', 'tengo', 'puede', 'puedo'
]);

export const STOPWORDS_EN = new Set([
  // Articles
  'a', 'an', 'the',
  // Prepositions
  'in', 'on', 'at', 'to', 'for', 'with', 'from', 'by', 'about', 'into',
  'through', 'during', 'before', 'after', 'above', 'below', 'between', 'under',
  // Conjunctions
  'and', 'or', 'but', 'if', 'because', 'as', 'until', 'while',
  // Pronouns
  'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them',
  'my', 'your', 'his', 'its', 'our', 'their',
  // Auxiliary verbs
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
  'do', 'does', 'did', 'can', 'could', 'will', 'would', 'should',
  // Interrogatives
  'what', 'where', 'when', 'why', 'how', 'which', 'who',
  // Others
  'this', 'that', 'these', 'those', 'there', 'here', 'of', 'up', 'down', 'out',
  'show', 'get', 'see', 'view'
]);

// Combined stopwords (ES + EN)
export const STOPWORDS = new Set([...STOPWORDS_ES, ...STOPWORDS_EN]);

/**
 * Extract keywords from text by removing stopwords and short words
 * @param {string} text - Input text to extract keywords from
 * @param {number} minLength - Minimum word length to keep (default: 3)
 * @returns {string[]} Array of filtered keywords
 */
export function extractKeywords(text, minLength = 3) {
  if (!text) return [];
  
  // Normalize: lowercase, remove special chars, split into words
  const words = text
    .toLowerCase()
    .replace(/[¿?¡!.,;:()[\]{}"""''`]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length >= minLength && !STOPWORDS.has(word));
  
  // Remove duplicates while preserving order
  return [...new Set(words)];
}

// database.js
// SQLite database operations and Ollama embeddings integration

import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { extractKeywords } from './stopwords.js';

const OLLAMA_HOST = "http://localhost:11434";
const EMBEDDING_MODEL = "nomic-embed-text";

/**
 * Initialize database and create tables
 */
export function initDatabase(dbPath = './commands.db') {
  const db = new Database(dbPath);
  
  // Read and execute schema
  const schema = readFileSync('./schema.sql', 'utf-8');
  db.exec(schema);
  
  console.error('✓ Database initialized successfully');
  return db;
}

/**
 * Get embedding from Ollama
 * @param {string} text - Text to embed
 * @returns {Promise<number[]>} Embedding vector
 */
export async function getEmbedding(text) {
  const response = await fetch(`${OLLAMA_HOST}/api/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      prompt: text
    })
  });
  
  if (!response.ok) {
    throw new Error(`Ollama API error: ${response.statusText}`);
  }
  
  const data = await response.json();
  return data.embedding;
}

/**
 * Calculate cosine similarity between two vectors
 * @param {number[]} vecA - First vector
 * @param {number[]} vecB - Second vector
 * @returns {number} Similarity score (0-1)
 */
export function cosineSimilarity(vecA, vecB) {
  if (vecA.length !== vecB.length) {
    throw new Error('Vectors must have same length');
  }
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Convert embedding array to BLOB for SQLite storage
 * @param {number[]} embedding - Embedding vector
 * @returns {Buffer} Binary buffer
 */
function embeddingToBlob(embedding) {
  const buffer = Buffer.allocUnsafe(embedding.length * 8); // 8 bytes per float64
  embedding.forEach((value, index) => {
    buffer.writeDoubleLE(value, index * 8);
  });
  return buffer;
}

/**
 * Convert BLOB back to embedding array
 * @param {Buffer} blob - Binary buffer from database
 * @returns {number[]} Embedding vector
 */
function blobToEmbedding(blob) {
  const embedding = [];
  for (let i = 0; i < blob.length; i += 8) {
    embedding.push(blob.readDoubleLE(i));
  }
  return embedding;
}

/**
 * Add a new command to database
 * @param {Database} db - Database instance
 * @param {Object} commandData - Command data object
 * @returns {Promise<number>} Inserted command ID
 */
export async function addCommand(db, commandData) {
  const {
    command,
    description,
    arguments: args,
    category,
    version,
    keywords,
    mode,
    type,
    device,
    executable_mcp = false,
    impact,
    related_commands
  } = commandData;
  
  // Insert command
  const stmt = db.prepare(`
    INSERT INTO checkpoint_commands (
      command, description, arguments, category, version, keywords,
      mode, type, device, executable_mcp, impact, related_commands
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  const result = stmt.run(
    command,
    description,
    JSON.stringify(args || []),
    category,
    version,
    keywords,
    mode,
    type,
    device,
    executable_mcp ? 1 : 0,
    impact,
    JSON.stringify(related_commands || [])
  );
  
  const commandId = result.lastInsertRowid;
  
  // Generate and store embedding (command + description only)
  const textToEmbed = `${command} ${description || ''}`.trim();
  const embedding = await getEmbedding(textToEmbed);
  const embeddingBlob = embeddingToBlob(embedding);
  
  const embStmt = db.prepare(`
    INSERT INTO command_embeddings (command_id, embedding)
    VALUES (?, ?)
  `);
  embStmt.run(commandId, embeddingBlob);
  
  console.error(`✓ Command added: ${command} (ID: ${commandId})`);
  return commandId;
}

/**
 * Update an existing command
 * @param {Database} db - Database instance
 * @param {number} id - Command ID
 * @param {Object} updates - Fields to update
 * @returns {Promise<boolean>} Success status
 */
export async function updateCommand(db, id, updates) {
  const fields = [];
  const values = [];
  
  // Build dynamic UPDATE query
  for (const [key, value] of Object.entries(updates)) {
    if (key === 'arguments' || key === 'related_commands') {
      fields.push(`${key} = ?`);
      values.push(JSON.stringify(value));
    } else if (key === 'executable_mcp') {
      fields.push(`${key} = ?`);
      values.push(value ? 1 : 0);
    } else {
      fields.push(`${key} = ?`);
      values.push(value);
    }
  }
  
  if (fields.length === 0) {
    throw new Error('No fields to update');
  }
  
  values.push(id);
  
  const stmt = db.prepare(`
    UPDATE checkpoint_commands
    SET ${fields.join(', ')}
    WHERE id = ?
  `);
  
  const result = stmt.run(...values);
  
  // Regenerate embedding if command or description changed
  if (updates.command || updates.description) {
    const cmdStmt = db.prepare('SELECT command, description FROM checkpoint_commands WHERE id = ?');
    const cmd = cmdStmt.get(id);
    
    const textToEmbed = `${cmd.command} ${cmd.description || ''}`.trim();
    const embedding = await getEmbedding(textToEmbed);
    const embeddingBlob = embeddingToBlob(embedding);
    
    const embStmt = db.prepare(`
      UPDATE command_embeddings SET embedding = ? WHERE command_id = ?
    `);
    embStmt.run(embeddingBlob, id);
  }
  
  console.error(`✓ Command updated: ID ${id}`);
  return result.changes > 0;
}

/**
 * Delete a command
 * @param {Database} db - Database instance
 * @param {number} id - Command ID
 * @returns {boolean} Success status
 */
export function deleteCommand(db, id) {
  const stmt = db.prepare('DELETE FROM checkpoint_commands WHERE id = ?');
  const result = stmt.run(id);
  
  console.error(`✓ Command deleted: ID ${id}`);
  return result.changes > 0;
}

/**
 * Search commands using semantic search with keyword pre-filtering
 * @param {Database} db - Database instance
 * @param {string} query - User query/description
 * @param {number} limit - Maximum results to return
 * @param {number} scoreThreshold - Minimum similarity score (0-1)
 * @returns {Promise<Array>} Ranked commands with scores
 */
export async function searchCommands(db, query, limit = 5, scoreThreshold = 0.3) {
  // Step 1: Extract keywords from query
  const keywords = extractKeywords(query);
  
  console.error(`🔍 Query keywords: ${keywords.join(', ')}`);
  
  let candidateIds = [];
  
  // Step 2: Filter by keywords using FTS5
  if (keywords.length > 0) {
    const ftsQuery = keywords.join(' OR ');
    const ftsStmt = db.prepare(`
      SELECT rowid FROM commands_fts 
      WHERE commands_fts MATCH ?
      LIMIT 100
    `);
    
    try {
      const ftsResults = ftsStmt.all(ftsQuery);
      candidateIds = ftsResults.map(r => r.rowid);
      
      console.error(`📋 FTS5 candidates: ${candidateIds.length} commands`);
    } catch (error) {
      console.error(`⚠️  FTS5 search failed: ${error.message}`);
    }
  }
  
  // Step 3: If no FTS matches, use all commands
  if (candidateIds.length === 0) {
    console.error('⚠️  No FTS matches, searching all commands');
    const allStmt = db.prepare('SELECT id FROM checkpoint_commands WHERE deprecated = 0');
    candidateIds = allStmt.all().map(r => r.id);
  }
  
  // Step 4: Generate query embedding
  const queryEmbedding = await getEmbedding(query);
  
  // Step 5: Retrieve candidate embeddings and calculate similarity
  const embStmt = db.prepare(`
    SELECT ce.command_id, ce.embedding, cc.command, cc.description, 
           cc.arguments, cc.category, cc.mode, cc.type, cc.device, cc.impact
    FROM command_embeddings ce
    JOIN checkpoint_commands cc ON ce.command_id = cc.id
    WHERE ce.command_id IN (${candidateIds.map(() => '?').join(',')})
  `);
  
  const candidates = embStmt.all(...candidateIds);
  
  // Calculate similarities
  const results = candidates.map(candidate => {
    const embedding = blobToEmbedding(candidate.embedding);
    const score = cosineSimilarity(queryEmbedding, embedding);
    
    return {
      id: candidate.command_id,
      command: candidate.command,
      description: candidate.description,
      arguments: JSON.parse(candidate.arguments || '[]'),
      category: candidate.category,
      mode: candidate.mode,
      type: candidate.type,
      device: candidate.device,
      impact: candidate.impact,
      score: score
    };
  });
  
  // Step 6: Sort by score and filter by threshold
  const ranked = results
    .filter(r => r.score >= scoreThreshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  
  console.error(`✓ Found ${ranked.length} results above threshold ${scoreThreshold}`);
  
  return ranked;
}

/**
 * Get command by ID
 * @param {Database} db - Database instance
 * @param {number} id - Command ID
 * @returns {Object|null} Command object or null
 */
export function getCommandById(db, id) {
  const stmt = db.prepare(`
    SELECT * FROM checkpoint_commands WHERE id = ?
  `);
  
  const cmd = stmt.get(id);
  
  if (!cmd) return null;
  
  return {
    ...cmd,
    arguments: JSON.parse(cmd.arguments || '[]'),
    related_commands: JSON.parse(cmd.related_commands || '[]'),
    executable_mcp: Boolean(cmd.executable_mcp),
    deprecated: Boolean(cmd.deprecated)
  };
}

/**
 * List all commands with optional filters
 * @param {Database} db - Database instance
 * @param {Object} filters - Optional filters (category, mode, device, etc.)
 * @returns {Array} Array of commands
 */
export function listCommands(db, filters = {}) {
  let query = 'SELECT * FROM checkpoint_commands WHERE 1=1';
  const params = [];
  
  if (filters.category) {
    query += ' AND category = ?';
    params.push(filters.category);
  }
  
  if (filters.mode) {
    query += ' AND mode = ?';
    params.push(filters.mode);
  }
  
  if (filters.device) {
    query += ' AND device = ?';
    params.push(filters.device);
  }
  
  if (filters.deprecated !== undefined) {
    query += ' AND deprecated = ?';
    params.push(filters.deprecated ? 1 : 0);
  }
  
  query += ' ORDER BY category, command';
  
  const stmt = db.prepare(query);
  const results = stmt.all(...params);
  
  return results.map(cmd => ({
    ...cmd,
    arguments: JSON.parse(cmd.arguments || '[]'),
    related_commands: JSON.parse(cmd.related_commands || '[]'),
    executable_mcp: Boolean(cmd.executable_mcp),
    deprecated: Boolean(cmd.deprecated)
  }));
}
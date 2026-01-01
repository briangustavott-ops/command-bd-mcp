// database.js
// SQLite database operations and Ollama embeddings integration

import Database from 'better-sqlite3';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, copyFileSync } from 'fs';
import { extractKeywords } from './stopwords.js';
import { join } from 'path';

const OLLAMA_HOST = "http://localhost:11434";
const EMBEDDING_MODEL = "nomic-embed-text";
const BACKUP_DIR = './backups';

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
 * Add a new command to database with duplicate detection
 * @param {Database} db - Database instance
 * @param {Object} commandData - Command data object
 * @returns {Promise<Object>} Result object with success/error status
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
  
  // CRITICAL: Validate required fields
  if (!command || !category) {
    return {
      error: true,
      message: 'Command and category are required fields'
    };
  }
  
  // CRITICAL: Check for duplicates (same command + category)
  const duplicateStmt = db.prepare(`
    SELECT id, command, category, description 
    FROM checkpoint_commands 
    WHERE command = ? AND category = ?
  `);
  
  const existingCommand = duplicateStmt.get(command, category);
  
  if (existingCommand) {
    return {
      error: true,
      message: `Command '${command}' already exists in category '${category}' with ID ${existingCommand.id}. Please use update_command tool with id=${existingCommand.id} to modify it.`,
      existing_command_id: existingCommand.id,
      command: command,
      category: category,
      existing_description: existingCommand.description
    };
  }
  
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
  
  return {
    error: false,
    id: commandId,
    command: command,
    category: category
  };
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
 * List all commands with enhanced filters (regex, category, keyword, version, etc.)
 * @param {Database} db - Database instance
 * @param {Object} filters - Optional filters
 * @returns {Array} Array of commands
 */
export function listCommands(db, filters = {}) {
  let query = 'SELECT * FROM checkpoint_commands WHERE 1=1';
  const params = [];
  
  // Category filter (exact match)
  if (filters.category) {
    query += ' AND category = ?';
    params.push(filters.category);
  }
  
  // Mode filter
  if (filters.mode) {
    query += ' AND mode = ?';
    params.push(filters.mode);
  }
  
  // Device filter
  if (filters.device) {
    query += ' AND device = ?';
    params.push(filters.device);
  }
  
  // Deprecated filter
  if (filters.deprecated !== undefined) {
    query += ' AND deprecated = ?';
    params.push(filters.deprecated ? 1 : 0);
  }
  
  // Version filter (exact match)
  if (filters.version) {
    query += ' AND version = ?';
    params.push(filters.version);
  }
  
  query += ' ORDER BY category, command';
  
  const stmt = db.prepare(query);
  let results = stmt.all(...params);
  
  // Post-processing filters (regex and keyword)
  
  // Regex filter on command name
  if (filters.regex) {
    try {
      const regex = new RegExp(filters.regex);
      results = results.filter(cmd => regex.test(cmd.command));
    } catch (error) {
      console.error(`⚠️  Invalid regex: ${filters.regex}`);
    }
  }
  
  // Keyword filter (search in keywords field)
  if (filters.keyword) {
    const keywordLower = filters.keyword.toLowerCase();
    results = results.filter(cmd => {
      if (!cmd.keywords) return false;
      return cmd.keywords.toLowerCase().includes(keywordLower);
    });
  }
  
  return results.map(cmd => ({
    ...cmd,
    arguments: JSON.parse(cmd.arguments || '[]'),
    related_commands: JSON.parse(cmd.related_commands || '[]'),
    executable_mcp: Boolean(cmd.executable_mcp),
    deprecated: Boolean(cmd.deprecated)
  }));
}

// ============================================================================
// NEW FUNCTIONS - HIGH PRIORITY
// ============================================================================

/**
 * Bulk add commands from array
 * @param {Database} db - Database instance
 * @param {Array} commands - Array of command objects
 * @returns {Promise<Object>} Result with added/skipped counts
 */
export async function bulkAddCommands(db, commands) {
  const results = {
    added: [],
    skipped: [],
    errors: []
  };
  
  for (const cmd of commands) {
    try {
      const result = await addCommand(db, cmd);
      
      if (result.error) {
        results.skipped.push({
          command: cmd.command,
          category: cmd.category,
          reason: result.message,
          existing_id: result.existing_command_id
        });
      } else {
        results.added.push({
          id: result.id,
          command: result.command,
          category: result.category
        });
      }
    } catch (error) {
      results.errors.push({
        command: cmd.command,
        error: error.message
      });
    }
  }
  
  console.error(`✓ Bulk add complete: ${results.added.length} added, ${results.skipped.length} skipped, ${results.errors.length} errors`);
  
  return results;
}

/**
 * Export commands to JSON
 * @param {Database} db - Database instance
 * @param {Object} filters - Optional filters
 * @returns {Array} Array of commands
 */
export function exportCommandsJSON(db, filters = {}) {
  const commands = listCommands(db, filters);
  console.error(`✓ Exported ${commands.length} commands to JSON`);
  return commands;
}

/**
 * Import commands from JSON array
 * @param {Database} db - Database instance
 * @param {Array} commands - Array of command objects
 * @param {boolean} skipDuplicates - Skip duplicates instead of updating
 * @returns {Promise<Object>} Import results
 */
export async function importCommandsJSON(db, commands, skipDuplicates = true) {
  if (skipDuplicates) {
    return await bulkAddCommands(db, commands);
  } else {
    // TODO: Implement update mode
    throw new Error('Update mode not implemented yet');
  }
}

/**
 * Get database statistics
 * @param {Database} db - Database instance
 * @returns {Object} Statistics object
 */
export function getDatabaseStats(db) {
  const stats = {};
  
  // Total commands
  const totalStmt = db.prepare('SELECT COUNT(*) as count FROM checkpoint_commands');
  stats.total_commands = totalStmt.get().count;
  
  // Active vs deprecated
  const activeStmt = db.prepare('SELECT COUNT(*) as count FROM checkpoint_commands WHERE deprecated = 0');
  stats.active_commands = activeStmt.get().count;
  stats.deprecated_commands = stats.total_commands - stats.active_commands;
  
  // By category
  const categoryStmt = db.prepare(`
    SELECT category, COUNT(*) as count 
    FROM checkpoint_commands 
    GROUP BY category 
    ORDER BY count DESC
  `);
  stats.by_category = categoryStmt.all();
  
  // By device
  const deviceStmt = db.prepare(`
    SELECT device, COUNT(*) as count 
    FROM checkpoint_commands 
    WHERE device IS NOT NULL
    GROUP BY device
  `);
  stats.by_device = deviceStmt.all();
  
  // By mode
  const modeStmt = db.prepare(`
    SELECT mode, COUNT(*) as count 
    FROM checkpoint_commands 
    WHERE mode IS NOT NULL
    GROUP BY mode
  `);
  stats.by_mode = modeStmt.all();
  
  // By version
  const versionStmt = db.prepare(`
    SELECT version, COUNT(*) as count 
    FROM checkpoint_commands 
    WHERE version IS NOT NULL
    GROUP BY version
    ORDER BY count DESC
  `);
  stats.by_version = versionStmt.all();
  
  // Embeddings count
  const embStmt = db.prepare('SELECT COUNT(*) as count FROM command_embeddings');
  stats.total_embeddings = embStmt.get().count;
  
  console.error(`✓ Database stats generated`);
  
  return stats;
}

/**
 * Rebuild all embeddings
 * @param {Database} db - Database instance
 * @returns {Promise<Object>} Rebuild results
 */
export async function rebuildAllEmbeddings(db) {
  const commands = db.prepare('SELECT id, command, description FROM checkpoint_commands').all();
  
  let success = 0;
  let failed = 0;
  
  for (const cmd of commands) {
    try {
      const textToEmbed = `${cmd.command} ${cmd.description || ''}`.trim();
      const embedding = await getEmbedding(textToEmbed);
      const embeddingBlob = embeddingToBlob(embedding);
      
      // Delete old embedding if exists
      db.prepare('DELETE FROM command_embeddings WHERE command_id = ?').run(cmd.id);
      
      // Insert new embedding
      db.prepare('INSERT INTO command_embeddings (command_id, embedding) VALUES (?, ?)').run(cmd.id, embeddingBlob);
      
      success++;
      console.error(`✓ Rebuilt embedding for ID ${cmd.id}: ${cmd.command}`);
    } catch (error) {
      failed++;
      console.error(`✗ Failed to rebuild embedding for ID ${cmd.id}: ${error.message}`);
    }
  }
  
  console.error(`✓ Rebuild complete: ${success} success, ${failed} failed`);
  
  return {
    total: commands.length,
    success,
    failed
  };
}

/**
 * Rebuild embedding for specific command
 * @param {Database} db - Database instance
 * @param {number} id - Command ID
 * @returns {Promise<boolean>} Success status
 */
export async function rebuildEmbeddingById(db, id) {
  const cmd = db.prepare('SELECT command, description FROM checkpoint_commands WHERE id = ?').get(id);
  
  if (!cmd) {
    throw new Error(`Command with ID ${id} not found`);
  }
  
  const textToEmbed = `${cmd.command} ${cmd.description || ''}`.trim();
  const embedding = await getEmbedding(textToEmbed);
  const embeddingBlob = embeddingToBlob(embedding);
  
  // Delete old embedding
  db.prepare('DELETE FROM command_embeddings WHERE command_id = ?').run(id);
  
  // Insert new embedding
  db.prepare('INSERT INTO command_embeddings (command_id, embedding) VALUES (?, ?)').run(id, embeddingBlob);
  
  console.error(`✓ Rebuilt embedding for ID ${id}: ${cmd.command}`);
  
  return true;
}

/**
 * Create database backup
 * @param {Database} db - Database instance
 * @returns {Object} Backup info
 */
export function createBackup(db) {
  // Ensure backup directory exists
  if (!existsSync(BACKUP_DIR)) {
    mkdirSync(BACKUP_DIR, { recursive: true });
  }
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = join(BACKUP_DIR, `commands_backup_${timestamp}.db`);
  
  // Use SQLite backup API
  db.backup(backupFile);
  
  console.error(`✓ Backup created: ${backupFile}`);
  
  return {
    backup_file: backupFile,
    timestamp: new Date().toISOString()
  };
}

/**
 * List all backups
 * @returns {Array} Array of backup files
 */
export function listBackups() {
  if (!existsSync(BACKUP_DIR)) {
    return [];
  }
  
  const files = readdirSync(BACKUP_DIR)
    .filter(f => f.endsWith('.db'))
    .map(f => join(BACKUP_DIR, f));
  
  console.error(`✓ Found ${files.length} backup(s)`);
  
  return files;
}

/**
 * Restore database from backup
 * @param {Database} db - Database instance
 * @param {string} backupFile - Backup file path
 * @returns {boolean} Success status
 */
export function restoreBackup(db, backupFile) {
  if (!existsSync(backupFile)) {
    throw new Error(`Backup file not found: ${backupFile}`);
  }
  
  // Close current database
  const dbPath = db.name;
  db.close();
  
  // Copy backup to database file
  copyFileSync(backupFile, dbPath);
  
  console.error(`✓ Database restored from: ${backupFile}`);
  
  return true;
}

// ============================================================================
// NEW FUNCTIONS - MEDIUM PRIORITY
// ============================================================================

/**
 * Advanced search with multiple filters
 * @param {Database} db - Database instance
 * @param {Object} searchParams - Search parameters
 * @returns {Promise<Array>} Search results
 */
export async function advancedSearch(db, searchParams) {
  const {
    query,
    category,
    device,
    mode,
    version,
    impact,
    limit = 10,
    score_threshold = 0.3
  } = searchParams;
  
  // Start with semantic search
  let results = await searchCommands(db, query, limit * 2, score_threshold);
  
  // Apply additional filters
  if (category) {
    results = results.filter(r => r.category === category);
  }
  
  if (device) {
    results = results.filter(r => r.device === device);
  }
  
  if (mode) {
    results = results.filter(r => r.mode === mode);
  }
  
  if (version) {
    const cmd = db.prepare('SELECT id FROM checkpoint_commands WHERE id = ? AND version = ?');
    results = results.filter(r => cmd.get(r.id, version));
  }
  
  if (impact) {
    results = results.filter(r => r.impact === impact);
  }
  
  console.error(`✓ Advanced search complete: ${results.length} results`);
  
  return results.slice(0, limit);
}

/**
 * List all unique categories
 * @param {Database} db - Database instance
 * @returns {Array} Array of categories
 */
export function listCategories(db) {
  const stmt = db.prepare(`
    SELECT DISTINCT category, COUNT(*) as count 
    FROM checkpoint_commands 
    WHERE category IS NOT NULL
    GROUP BY category 
    ORDER BY category
  `);
  
  const categories = stmt.all();
  
  console.error(`✓ Found ${categories.length} categories`);
  
  return categories;
}

/**
 * Get statistics for a specific category
 * @param {Database} db - Database instance
 * @param {string} category - Category name
 * @returns {Object} Category statistics
 */
export function getCategoryStats(db, category) {
  const stats = {};
  
  // Total commands in category
  const totalStmt = db.prepare('SELECT COUNT(*) as count FROM checkpoint_commands WHERE category = ?');
  stats.total_commands = totalStmt.get(category).count;
  
  // Active vs deprecated
  const activeStmt = db.prepare('SELECT COUNT(*) as count FROM checkpoint_commands WHERE category = ? AND deprecated = 0');
  stats.active_commands = activeStmt.get(category).count;
  stats.deprecated_commands = stats.total_commands - stats.active_commands;
  
  // Commands list
  const commandsStmt = db.prepare('SELECT command FROM checkpoint_commands WHERE category = ? ORDER BY command');
  stats.commands = commandsStmt.all(category).map(c => c.command);
  
  console.error(`✓ Category stats for '${category}': ${stats.total_commands} commands`);
  
  return stats;
}

/**
 * Rename a category
 * @param {Database} db - Database instance
 * @param {string} oldName - Old category name
 * @param {string} newName - New category name
 * @returns {number} Number of commands updated
 */
export function renameCategory(db, oldName, newName) {
  const stmt = db.prepare('UPDATE checkpoint_commands SET category = ? WHERE category = ?');
  const result = stmt.run(newName, oldName);
  
  console.error(`✓ Renamed category '${oldName}' to '${newName}': ${result.changes} commands updated`);
  
  return result.changes;
}

/**
 * Find duplicate commands (same command name in same category)
 * @param {Database} db - Database instance
 * @returns {Array} Array of duplicate groups
 */
export function findDuplicates(db) {
  const stmt = db.prepare(`
    SELECT command, category, COUNT(*) as count, GROUP_CONCAT(id) as ids
    FROM checkpoint_commands
    GROUP BY command, category
    HAVING count > 1
    ORDER BY count DESC, category, command
  `);
  
  const duplicates = stmt.all().map(dup => ({
    command: dup.command,
    category: dup.category,
    count: dup.count,
    ids: dup.ids.split(',').map(id => parseInt(id))
  }));
  
  console.error(`✓ Found ${duplicates.length} duplicate groups`);
  
  return duplicates;
}

/**
 * Validate database integrity
 * @param {Database} db - Database instance
 * @returns {Object} Validation results
 */
export function validateDatabase(db) {
  const issues = [];
  
  // Check for commands without embeddings
  const noEmbStmt = db.prepare(`
    SELECT cc.id, cc.command 
    FROM checkpoint_commands cc
    LEFT JOIN command_embeddings ce ON cc.id = ce.command_id
    WHERE ce.command_id IS NULL
  `);
  const noEmbeddings = noEmbStmt.all();
  
  if (noEmbeddings.length > 0) {
    issues.push({
      type: 'missing_embeddings',
      count: noEmbeddings.length,
      commands: noEmbeddings
    });
  }
  
  // Check for orphaned embeddings
  const orphanStmt = db.prepare(`
    SELECT ce.command_id 
    FROM command_embeddings ce
    LEFT JOIN checkpoint_commands cc ON ce.command_id = cc.id
    WHERE cc.id IS NULL
  `);
  const orphanedEmbeddings = orphanStmt.all();
  
  if (orphanedEmbeddings.length > 0) {
    issues.push({
      type: 'orphaned_embeddings',
      count: orphanedEmbeddings.length,
      command_ids: orphanedEmbeddings.map(e => e.command_id)
    });
  }
  
  // Check for commands without required fields
  const noRequiredStmt = db.prepare(`
    SELECT id, command, category 
    FROM checkpoint_commands 
    WHERE command IS NULL OR command = '' OR category IS NULL OR category = ''
  `);
  const noRequired = noRequiredStmt.all();
  
  if (noRequired.length > 0) {
    issues.push({
      type: 'missing_required_fields',
      count: noRequired.length,
      commands: noRequired
    });
  }
  
  const isValid = issues.length === 0;
  
  console.error(isValid ? '✓ Database validation passed' : `⚠️  Database validation found ${issues.length} issue(s)`);
  
  return {
    valid: isValid,
    issues: issues,
    total_issues: issues.reduce((sum, issue) => sum + issue.count, 0)
  };
}

/**
 * Optimize database (VACUUM and ANALYZE)
 * @param {Database} db - Database instance
 * @returns {boolean} Success status
 */
export function optimizeDatabase(db) {
  console.error('🔧 Optimizing database...');
  
  db.exec('VACUUM');
  db.exec('ANALYZE');
  
  console.error('✓ Database optimized');
  
  return true;
}
// api-server.js
// HTTP API Server for Checkpoint commands database

import express from 'express';
import cors from 'cors';
import {
  initDatabase,
  addCommand,
  updateCommand,
  deleteCommand,
  searchCommands,
  getCommandById,
  listCommands,
  // High priority functions
  bulkAddCommands,
  exportCommandsJSON,
  importCommandsJSON,
  getDatabaseStats,
  rebuildAllEmbeddings,
  rebuildEmbeddingById,
  createBackup,
  listBackups,
  restoreBackup,
  // Medium priority functions
  advancedSearch,
  listCategories,
  getCategoryStats,
  renameCategory,
  findDuplicates,
  validateDatabase,
  optimizeDatabase
} from './database.js';

const app = express();
const PORT = process.env.PORT || 5679;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Database instance
let db = null;

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'checkpoint-commands-api',
    version: '2.0.0',
    database: db ? 'connected' : 'not initialized'
  });
});

// ============================================================================
// EXISTING ENDPOINTS (UPDATED)
// ============================================================================

// Search commands
app.post('/api/commands/search', async (req, res) => {
  try {
    const { query, limit = 5, score_threshold = 0.3 } = req.body;
    
    if (!query) {
      return res.status(400).json({ 
        status: 'error', 
        message: 'Query parameter is required' 
      });
    }
    
    const results = await searchCommands(db, query, limit, score_threshold);
    
    res.json({
      status: 'success',
      query,
      results,
      count: results.length
    });
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message,
      stack: error.stack
    });
  }
});

// Add command (UPDATED - handles duplicates)
app.post('/api/commands', async (req, res) => {
  try {
    const commandData = req.body;
    
    if (!commandData.command || !commandData.description) {
      return res.status(400).json({
        status: 'error',
        message: 'command and description are required'
      });
    }
    
    const result = await addCommand(db, commandData);
    
    // Handle duplicate detection
    if (result.error) {
      return res.status(409).json({
        status: 'error',
        message: result.message,
        existing_command_id: result.existing_command_id,
        command: result.command,
        category: result.category
      });
    }
    
    res.json({
      status: 'success',
      message: 'Command added successfully',
      id: result.id,
      command: result.command,
      category: result.category
    });
  } catch (error) {
    console.error('Add command error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message,
      stack: error.stack
    });
  }
});

// Update command
app.put('/api/commands/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const updates = req.body;
    
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        status: 'error',
        message: 'No fields to update'
      });
    }
    
    const success = await updateCommand(db, id, updates);
    
    if (!success) {
      return res.status(404).json({
        status: 'error',
        message: `Command with ID ${id} not found`
      });
    }
    
    res.json({
      status: 'success',
      message: 'Command updated successfully',
      id,
      updated_fields: Object.keys(updates)
    });
  } catch (error) {
    console.error('Update command error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message,
      stack: error.stack
    });
  }
});

// Delete command
app.delete('/api/commands/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    
    const success = deleteCommand(db, id);
    
    if (!success) {
      return res.status(404).json({
        status: 'error',
        message: `Command with ID ${id} not found`
      });
    }
    
    res.json({
      status: 'success',
      message: 'Command deleted successfully',
      id
    });
  } catch (error) {
    console.error('Delete command error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message,
      stack: error.stack
    });
  }
});

// Get command by ID
app.get('/api/commands/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    
    const command = getCommandById(db, id);
    
    if (!command) {
      return res.status(404).json({
        status: 'error',
        message: `Command with ID ${id} not found`
      });
    }
    
    res.json({
      status: 'success',
      command
    });
  } catch (error) {
    console.error('Get command error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message,
      stack: error.stack
    });
  }
});

// List commands with enhanced filters (UPDATED)
app.get('/api/commands', (req, res) => {
  try {
    const filters = {};
    
    // Existing filters
    if (req.query.category) filters.category = req.query.category;
    if (req.query.mode) filters.mode = req.query.mode;
    if (req.query.device) filters.device = req.query.device;
    if (req.query.deprecated !== undefined) {
      filters.deprecated = req.query.deprecated === 'true';
    }
    
    // NEW filters
    if (req.query.regex) filters.regex = req.query.regex;
    if (req.query.keyword) filters.keyword = req.query.keyword;
    if (req.query.version) filters.version = req.query.version;
    
    const commands = listCommands(db, filters);
    
    res.json({
      status: 'success',
      commands,
      count: commands.length,
      filters
    });
  } catch (error) {
    console.error('List commands error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message,
      stack: error.stack
    });
  }
});

// ============================================================================
// NEW ENDPOINTS - HIGH PRIORITY
// ============================================================================

// Bulk add commands
app.post('/api/commands/bulk', async (req, res) => {
  try {
    const { commands } = req.body;
    
    if (!Array.isArray(commands) || commands.length === 0) {
      return res.status(400).json({
        status: 'error',
        message: 'commands must be a non-empty array'
      });
    }
    
    const results = await bulkAddCommands(db, commands);
    
    res.json({
      status: 'success',
      message: `Bulk add complete: ${results.added.length} added, ${results.skipped.length} skipped, ${results.errors.length} errors`,
      results
    });
  } catch (error) {
    console.error('Bulk add error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message,
      stack: error.stack
    });
  }
});

// Export commands to JSON
app.get('/api/commands/export', (req, res) => {
  try {
    const filters = {};
    
    if (req.query.category) filters.category = req.query.category;
    if (req.query.mode) filters.mode = req.query.mode;
    if (req.query.device) filters.device = req.query.device;
    if (req.query.deprecated !== undefined) {
      filters.deprecated = req.query.deprecated === 'true';
    }
    if (req.query.version) filters.version = req.query.version;
    
    const commands = exportCommandsJSON(db, filters);
    
    res.json({
      status: 'success',
      commands,
      count: commands.length,
      filters
    });
  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message,
      stack: error.stack
    });
  }
});

// Import commands from JSON
app.post('/api/commands/import', async (req, res) => {
  try {
    const { commands, skip_duplicates = true } = req.body;
    
    if (!Array.isArray(commands) || commands.length === 0) {
      return res.status(400).json({
        status: 'error',
        message: 'commands must be a non-empty array'
      });
    }
    
    const results = await importCommandsJSON(db, commands, skip_duplicates);
    
    res.json({
      status: 'success',
      message: `Import complete: ${results.added.length} added, ${results.skipped.length} skipped, ${results.errors.length} errors`,
      results
    });
  } catch (error) {
    console.error('Import error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message,
      stack: error.stack
    });
  }
});

// Get database statistics
app.get('/api/stats', (req, res) => {
  try {
    const stats = getDatabaseStats(db);
    
    res.json({
      status: 'success',
      stats
    });
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message,
      stack: error.stack
    });
  }
});

// Rebuild all embeddings
app.post('/api/embeddings/rebuild', async (req, res) => {
  try {
    const results = await rebuildAllEmbeddings(db);
    
    res.json({
      status: 'success',
      message: `Rebuild complete: ${results.success} success, ${results.failed} failed`,
      results
    });
  } catch (error) {
    console.error('Rebuild embeddings error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message,
      stack: error.stack
    });
  }
});

// Rebuild embedding for specific command
app.post('/api/embeddings/rebuild/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    
    const success = await rebuildEmbeddingById(db, id);
    
    res.json({
      status: 'success',
      message: `Embedding rebuilt for command ID ${id}`,
      id
    });
  } catch (error) {
    console.error('Rebuild embedding error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message,
      stack: error.stack
    });
  }
});

// Create backup
app.post('/api/backup', (req, res) => {
  try {
    const result = createBackup(db);
    
    res.json({
      status: 'success',
      message: 'Backup created successfully',
      backup: result
    });
  } catch (error) {
    console.error('Backup error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message,
      stack: error.stack
    });
  }
});

// List backups
app.get('/api/backups', (req, res) => {
  try {
    const backups = listBackups();
    
    res.json({
      status: 'success',
      backups,
      count: backups.length
    });
  } catch (error) {
    console.error('List backups error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message,
      stack: error.stack
    });
  }
});

// Restore backup
app.post('/api/restore', async (req, res) => {
  try {
    const { backup_file } = req.body;
    
    if (!backup_file) {
      return res.status(400).json({
        status: 'error',
        message: 'backup_file is required'
      });
    }
    
    const success = restoreBackup(db, backup_file);
    
    // Reinitialize database after restore
    db = initDatabase('./commands.db');
    
    res.json({
      status: 'success',
      message: 'Database restored successfully',
      backup_file
    });
  } catch (error) {
    console.error('Restore error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message,
      stack: error.stack
    });
  }
});

// ============================================================================
// NEW ENDPOINTS - MEDIUM PRIORITY
// ============================================================================

// Advanced search
app.post('/api/commands/search/advanced', async (req, res) => {
  try {
    const searchParams = req.body;
    
    if (!searchParams.query) {
      return res.status(400).json({
        status: 'error',
        message: 'query parameter is required'
      });
    }
    
    const results = await advancedSearch(db, searchParams);
    
    res.json({
      status: 'success',
      results,
      count: results.length,
      search_params: searchParams
    });
  } catch (error) {
    console.error('Advanced search error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message,
      stack: error.stack
    });
  }
});

// List categories
app.get('/api/categories', (req, res) => {
  try {
    const categories = listCategories(db);
    
    res.json({
      status: 'success',
      categories,
      count: categories.length
    });
  } catch (error) {
    console.error('List categories error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message,
      stack: error.stack
    });
  }
});

// Get category statistics
app.get('/api/categories/:name/stats', (req, res) => {
  try {
    const category = req.params.name;
    
    const stats = getCategoryStats(db, category);
    
    res.json({
      status: 'success',
      category,
      stats
    });
  } catch (error) {
    console.error('Category stats error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message,
      stack: error.stack
    });
  }
});

// Rename category
app.put('/api/categories/:name/rename', (req, res) => {
  try {
    const oldName = req.params.name;
    const { new_name } = req.body;
    
    if (!new_name) {
      return res.status(400).json({
        status: 'error',
        message: 'new_name is required'
      });
    }
    
    const count = renameCategory(db, oldName, new_name);
    
    res.json({
      status: 'success',
      message: `Category renamed from '${oldName}' to '${new_name}'`,
      old_name: oldName,
      new_name: new_name,
      commands_updated: count
    });
  } catch (error) {
    console.error('Rename category error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message,
      stack: error.stack
    });
  }
});

// Find duplicates
app.get('/api/commands/duplicates', (req, res) => {
  try {
    const duplicates = findDuplicates(db);
    
    res.json({
      status: 'success',
      duplicates,
      count: duplicates.length,
      total_duplicate_commands: duplicates.reduce((sum, d) => sum + d.count, 0)
    });
  } catch (error) {
    console.error('Find duplicates error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message,
      stack: error.stack
    });
  }
});

// Validate database
app.get('/api/maintenance/validate', (req, res) => {
  try {
    const validation = validateDatabase(db);
    
    res.json({
      status: 'success',
      validation
    });
  } catch (error) {
    console.error('Validation error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message,
      stack: error.stack
    });
  }
});

// Optimize database
app.post('/api/maintenance/optimize', (req, res) => {
  try {
    const success = optimizeDatabase(db);
    
    res.json({
      status: 'success',
      message: 'Database optimized successfully'
    });
  } catch (error) {
    console.error('Optimize error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message,
      stack: error.stack
    });
  }
});

// ============================================================================
// SERVER INITIALIZATION
// ============================================================================

// Initialize and start server
async function main() {
  try {
    console.log('📄 Initializing database...');
    db = initDatabase('./commands.db');
    console.log('✓ Database initialized successfully');
    
    app.listen(PORT, () => {
      console.log(`🚀 Checkpoint Commands API Server running on http://localhost:${PORT}`);
      console.log(`📊 Health check: http://localhost:${PORT}/health`);
      console.log(`📚 API Documentation:`);
      console.log(`   - POST /api/commands/search - Search commands`);
      console.log(`   - POST /api/commands - Add command`);
      console.log(`   - PUT /api/commands/:id - Update command`);
      console.log(`   - DELETE /api/commands/:id - Delete command`);
      console.log(`   - GET /api/commands/:id - Get command by ID`);
      console.log(`   - GET /api/commands - List commands (filters: category, mode, device, deprecated, regex, keyword, version)`);
      console.log(`   - POST /api/commands/bulk - Bulk add commands`);
      console.log(`   - GET /api/commands/export - Export to JSON`);
      console.log(`   - POST /api/commands/import - Import from JSON`);
      console.log(`   - GET /api/stats - Database statistics`);
      console.log(`   - POST /api/embeddings/rebuild - Rebuild all embeddings`);
      console.log(`   - POST /api/embeddings/rebuild/:id - Rebuild embedding by ID`);
      console.log(`   - POST /api/backup - Create backup`);
      console.log(`   - GET /api/backups - List backups`);
      console.log(`   - POST /api/restore - Restore backup`);
      console.log(`   - POST /api/commands/search/advanced - Advanced search`);
      console.log(`   - GET /api/categories - List categories`);
      console.log(`   - GET /api/categories/:name/stats - Category stats`);
      console.log(`   - PUT /api/categories/:name/rename - Rename category`);
      console.log(`   - GET /api/commands/duplicates - Find duplicates`);
      console.log(`   - GET /api/maintenance/validate - Validate database`);
      console.log(`   - POST /api/maintenance/optimize - Optimize database`);
    });
  } catch (error) {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  }
}

main();
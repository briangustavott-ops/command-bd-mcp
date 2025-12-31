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
  listCommands
} from './database.js';

const app = express();
const PORT = process.env.PORT || 5679;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Database instance
let dbInfo = null;

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'checkpoint-commands-api',
    version: '1.0.0',
    database: dbInfo ? 'connected' : 'not initialized'
  });
});

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
    
    const results = await searchCommands(dbInfo, query, limit, score_threshold);
    
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

// Add command
app.post('/api/commands', async (req, res) => {
  try {
    const commandData = req.body;
    
    if (!commandData.command || !commandData.description) {
      return res.status(400).json({
        status: 'error',
        message: 'command and description are required'
      });
    }
    
    const commandId = await addCommand(dbInfo, commandData);
    
    res.json({
      status: 'success',
      message: 'Command added successfully',
      id: commandId,
      command: commandData.command
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
    
    const success = await updateCommand(dbInfo, id, updates);
    
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
    
    const success = deleteCommand(dbInfo, id);
    
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
    
    const command = getCommandById(dbInfo, id);
    
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

// List commands with filters
app.get('/api/commands', (req, res) => {
  try {
    const filters = {};
    
    if (req.query.category) filters.category = req.query.category;
    if (req.query.mode) filters.mode = req.query.mode;
    if (req.query.device) filters.device = req.query.device;
    if (req.query.deprecated !== undefined) {
      filters.deprecated = req.query.deprecated === 'true';
    }
    
    const commands = listCommands(dbInfo, filters);
    
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

// Initialize and start server
async function main() {
  try {
    console.log('🔄 Initializing database...');
    dbInfo = await initDatabase('./commands.db');
    console.log('✓ Database initialized successfully');
    
    app.listen(PORT, () => {
      console.log(`🚀 Checkpoint Commands API Server running on http://localhost:${PORT}`);
      console.log(`📊 Health check: http://localhost:${PORT}/health`);
    });
  } catch (error) {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  }
}

main();

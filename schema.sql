-- Checkpoint Commands Database Schema

-- Main commands table
CREATE TABLE IF NOT EXISTS checkpoint_commands (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  command TEXT NOT NULL,
  description TEXT,
  arguments TEXT,  -- JSON array: [{"args": "state", "description": "Shows cluster state"}]
  category TEXT,
  version TEXT,
  keywords TEXT,
  mode TEXT,  -- clish, expert
  type TEXT,  -- config, query
  device TEXT,  -- firewall, management
  executable_mcp BOOLEAN DEFAULT 0,
  impact TEXT,  -- low, medium, high, critical
  related_commands TEXT,  -- JSON array of IDs: [1, 5, 12]
  deprecated BOOLEAN DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Embeddings table (one embedding per command)
CREATE TABLE IF NOT EXISTS command_embeddings (
  command_id INTEGER PRIMARY KEY,
  embedding BLOB NOT NULL,
  FOREIGN KEY (command_id) REFERENCES checkpoint_commands(id) ON DELETE CASCADE
);

-- Full-Text Search virtual table (for keyword filtering)
CREATE VIRTUAL TABLE IF NOT EXISTS commands_fts USING fts5(
  command,
  description,
  keywords,
  category,
  content='checkpoint_commands',
  content_rowid='id'
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_category ON checkpoint_commands(category);
CREATE INDEX IF NOT EXISTS idx_mode ON checkpoint_commands(mode);
CREATE INDEX IF NOT EXISTS idx_device ON checkpoint_commands(device);
CREATE INDEX IF NOT EXISTS idx_executable_mcp ON checkpoint_commands(executable_mcp);
CREATE INDEX IF NOT EXISTS idx_deprecated ON checkpoint_commands(deprecated);

-- Trigger to keep FTS5 table in sync with main table
CREATE TRIGGER IF NOT EXISTS commands_ai AFTER INSERT ON checkpoint_commands BEGIN
  INSERT INTO commands_fts(rowid, command, description, keywords, category)
  VALUES (new.id, new.command, new.description, new.keywords, new.category);
END;

CREATE TRIGGER IF NOT EXISTS commands_ad AFTER DELETE ON checkpoint_commands BEGIN
  DELETE FROM commands_fts WHERE rowid = old.id;
END;

CREATE TRIGGER IF NOT EXISTS commands_au AFTER UPDATE ON checkpoint_commands BEGIN
  UPDATE commands_fts 
  SET command = new.command,
      description = new.description,
      keywords = new.keywords,
      category = new.category
  WHERE rowid = new.id;
END;

-- Trigger to update updated_at timestamp
CREATE TRIGGER IF NOT EXISTS update_timestamp AFTER UPDATE ON checkpoint_commands BEGIN
  UPDATE checkpoint_commands SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

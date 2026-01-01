#!/usr/bin/env node

// server.js
// MCP Server for Checkpoint commands database
// Provides tools for Claude to interact with the commands database via HTTP API

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const API_BASE_URL = "http://localhost:5679";

// Helper function to make API requests
async function apiRequest(endpoint, method = "GET", body = null) {
  const options = {
    method,
    headers: {
      "Content-Type": "application/json",
    },
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(`${API_BASE_URL}${endpoint}`, options);
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || `API error: ${response.statusText}`);
  }

  return await response.json();
}

// Create server instance
const server = new Server(
  {
    name: "command-bd-mcp",
    version: "2.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// ============================================================================
// TOOL DEFINITIONS
// ============================================================================

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      // ========== EXISTING TOOLS (UPDATED) ==========
      {
        name: "search_commands",
        description: "Search for Checkpoint commands using semantic search. Provide a natural language description of what you want to do (e.g., 'check cluster status', 'configure firewall rules'). The system will find the most relevant commands.",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Natural language description of what you want to do or find",
            },
            limit: {
              type: "number",
              description: "Maximum number of results to return",
              default: 5,
            },
            score_threshold: {
              type: "number",
              description: "Minimum similarity score (0-1) to include results",
              default: 0.3,
            },
          },
          required: ["query"],
        },
      },
      {
        name: "add_command",
        description: "Add a new Checkpoint command to the database. The system will automatically generate embeddings for semantic search.",
        inputSchema: {
          type: "object",
          properties: {
            command: {
              type: "string",
              description: "Base command name (e.g., 'cphaprob', 'fw ctl')",
            },
            description: {
              type: "string",
              description: "General description of what the command does",
            },
            arguments: {
              type: "array",
              description: "Array of argument variants with descriptions",
              items: {
                type: "object",
                properties: {
                  args: { type: "string" },
                  description: { type: "string" },
                },
              },
            },
            category: {
              type: "string",
              description: "Command category (e.g., 'clusterxl', 'vpn', 'policy')",
            },
            version: {
              type: "string",
              description: "Checkpoint version (e.g., 'R80+', 'R81.20')",
            },
            keywords: {
              type: "string",
              description: "Comma-separated keywords for searching",
            },
            mode: {
              type: "string",
              enum: ["clish", "expert"],
              description: "Command execution mode",
            },
            type: {
              type: "string",
              enum: ["config", "query"],
              description: "Command type",
            },
            device: {
              type: "string",
              enum: ["firewall", "management"],
              description: "Target device type",
            },
            executable_mcp: {
              type: "boolean",
              description: "Whether this command can be executed via MCP",
              default: false,
            },
            impact: {
              type: "string",
              enum: ["low", "medium", "high", "critical"],
              description: "Risk level of the command",
            },
            related_commands: {
              type: "array",
              description: "Array of related command IDs",
              items: { type: "number" },
            },
          },
          required: ["command", "description"],
        },
      },
      {
        name: "update_command",
        description: "Update an existing command. Only specified fields will be updated. Embeddings are regenerated if command or description changes.",
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "number",
              description: "Command ID to update",
            },
            command: { type: "string" },
            description: { type: "string" },
            arguments: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  args: { type: "string" },
                  description: { type: "string" },
                },
              },
            },
            category: { type: "string" },
            version: { type: "string" },
            keywords: { type: "string" },
            mode: { type: "string", enum: ["clish", "expert"] },
            type: { type: "string", enum: ["config", "query"] },
            device: { type: "string", enum: ["firewall", "management"] },
            executable_mcp: { type: "boolean" },
            impact: { type: "string", enum: ["low", "medium", "high", "critical"] },
            related_commands: {
              type: "array",
              items: { type: "number" },
            },
            deprecated: { type: "boolean" },
          },
          required: ["id"],
        },
      },
      {
        name: "delete_command",
        description: "Delete a command from the database. This will also remove associated embeddings.",
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "number",
              description: "Command ID to delete",
            },
          },
          required: ["id"],
        },
      },
      {
        name: "get_command",
        description: "Get detailed information about a specific command by ID",
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "number",
              description: "Command ID",
            },
          },
          required: ["id"],
        },
      },
      {
        name: "list_commands",
        description: "List all commands with optional filters (category, mode, device, deprecated status, regex, keyword, version)",
        inputSchema: {
          type: "object",
          properties: {
            category: {
              type: "string",
              description: "Filter by category (e.g., 'clusterxl', 'vpn')",
            },
            mode: {
              type: "string",
              enum: ["clish", "expert"],
              description: "Filter by execution mode",
            },
            device: {
              type: "string",
              enum: ["firewall", "management"],
              description: "Filter by device type",
            },
            deprecated: {
              type: "boolean",
              description: "Filter by deprecated status (true/false)",
            },
            regex: {
              type: "string",
              description: "Regex pattern to filter command names (e.g., '^cphaprob.*')",
            },
            keyword: {
              type: "string",
              description: "Keyword to search in keywords field",
            },
            version: {
              type: "string",
              description: "Filter by Checkpoint version (e.g., 'R80+', 'R81.20')",
            },
          },
        },
      },

      // ========== NEW TOOLS - HIGH PRIORITY ==========
      {
        name: "bulk_add_commands",
        description: "Add multiple commands at once. Commands that already exist (same command+category) will be skipped and reported.",
        inputSchema: {
          type: "object",
          properties: {
            commands: {
              type: "array",
              description: "Array of command objects to add",
              items: {
                type: "object",
                properties: {
                  command: { type: "string" },
                  description: { type: "string" },
                  category: { type: "string" },
                  arguments: { type: "array" },
                  version: { type: "string" },
                  keywords: { type: "string" },
                  mode: { type: "string" },
                  type: { type: "string" },
                  device: { type: "string" },
                  executable_mcp: { type: "boolean" },
                  impact: { type: "string" },
                  related_commands: { type: "array" },
                },
                required: ["command", "description", "category"],
              },
            },
          },
          required: ["commands"],
        },
      },
      {
        name: "export_commands",
        description: "Export commands to JSON format. Supports filtering by category, mode, device, deprecated status, and version.",
        inputSchema: {
          type: "object",
          properties: {
            category: { type: "string" },
            mode: { type: "string" },
            device: { type: "string" },
            deprecated: { type: "boolean" },
            version: { type: "string" },
          },
        },
      },
      {
        name: "import_commands",
        description: "Import commands from JSON array. Duplicates will be skipped by default.",
        inputSchema: {
          type: "object",
          properties: {
            commands: {
              type: "array",
              description: "Array of command objects to import",
            },
            skip_duplicates: {
              type: "boolean",
              description: "Skip duplicates instead of updating them",
              default: true,
            },
          },
          required: ["commands"],
        },
      },
      {
        name: "get_database_stats",
        description: "Get comprehensive statistics about the database including total commands, breakdown by category, device, mode, version, and embedding status.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "rebuild_all_embeddings",
        description: "Rebuild embeddings for all commands in the database. This is useful after bulk updates or database migrations. WARNING: This process may take several minutes.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "rebuild_embedding",
        description: "Rebuild embedding for a specific command by ID. Useful when command or description has been updated.",
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "number",
              description: "Command ID to rebuild embedding for",
            },
          },
          required: ["id"],
        },
      },
      {
        name: "create_backup",
        description: "Create a backup of the entire database. The backup is stored in the ./backups directory with a timestamp.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "list_backups",
        description: "List all available database backups with their file paths.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "restore_backup",
        description: "Restore the database from a backup file. WARNING: This will replace the current database.",
        inputSchema: {
          type: "object",
          properties: {
            backup_file: {
              type: "string",
              description: "Path to the backup file to restore from",
            },
          },
          required: ["backup_file"],
        },
      },

      // ========== NEW TOOLS - MEDIUM PRIORITY ==========
      {
        name: "advanced_search",
        description: "Perform advanced search with multiple filters combined (semantic search + category + device + mode + version + impact).",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Search query for semantic search",
            },
            category: { type: "string" },
            device: { type: "string" },
            mode: { type: "string" },
            version: { type: "string" },
            impact: { type: "string" },
            limit: {
              type: "number",
              default: 10,
            },
            score_threshold: {
              type: "number",
              default: 0.3,
            },
          },
          required: ["query"],
        },
      },
      {
        name: "list_categories",
        description: "List all unique categories in the database with command counts for each.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "get_category_stats",
        description: "Get detailed statistics for a specific category including total commands, active vs deprecated, and command list.",
        inputSchema: {
          type: "object",
          properties: {
            category: {
              type: "string",
              description: "Category name to get statistics for",
            },
          },
          required: ["category"],
        },
      },
      {
        name: "rename_category",
        description: "Rename a category across all commands. This updates all commands that belong to the old category.",
        inputSchema: {
          type: "object",
          properties: {
            old_name: {
              type: "string",
              description: "Current category name",
            },
            new_name: {
              type: "string",
              description: "New category name",
            },
          },
          required: ["old_name", "new_name"],
        },
      },
      {
        name: "find_duplicates",
        description: "Find duplicate commands (same command name in the same category). Returns groups of duplicates with their IDs.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "validate_database",
        description: "Validate database integrity. Checks for: commands without embeddings, orphaned embeddings, and missing required fields.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "optimize_database",
        description: "Optimize the database by running VACUUM and ANALYZE. This reclaims space and updates statistics for better query performance.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
    ],
  };
});

// ============================================================================
// TOOL IMPLEMENTATIONS
// ============================================================================

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      // ========== EXISTING TOOLS (UPDATED) ==========
      
      case "search_commands": {
        const result = await apiRequest("/api/commands/search", "POST", {
          query: args.query,
          limit: args.limit || 5,
          score_threshold: args.score_threshold || 0.3,
        });
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case "add_command": {
        try {
          const result = await apiRequest("/api/commands", "POST", args);
          
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        } catch (error) {
          // Handle duplicate error specially
          if (error.message.includes("already exists")) {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    status: "error",
                    error: true,
                    message: error.message,
                    suggestion: "Use update_command tool to modify the existing command"
                  }, null, 2),
                },
              ],
              isError: true,
            };
          }
          throw error;
        }
      }

      case "update_command": {
        const { id, ...updates } = args;
        const result = await apiRequest(`/api/commands/${id}`, "PUT", updates);
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case "delete_command": {
        const result = await apiRequest(`/api/commands/${args.id}`, "DELETE");
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case "get_command": {
        const result = await apiRequest(`/api/commands/${args.id}`, "GET");
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case "list_commands": {
        const params = new URLSearchParams();
        
        if (args.category) params.append("category", args.category);
        if (args.mode) params.append("mode", args.mode);
        if (args.device) params.append("device", args.device);
        if (args.deprecated !== undefined) params.append("deprecated", args.deprecated);
        if (args.regex) params.append("regex", args.regex);
        if (args.keyword) params.append("keyword", args.keyword);
        if (args.version) params.append("version", args.version);
        
        const queryString = params.toString();
        const endpoint = queryString ? `/api/commands?${queryString}` : "/api/commands";
        
        const result = await apiRequest(endpoint, "GET");
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      // ========== NEW TOOLS - HIGH PRIORITY ==========

      case "bulk_add_commands": {
        const result = await apiRequest("/api/commands/bulk", "POST", {
          commands: args.commands,
        });
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case "export_commands": {
        const params = new URLSearchParams();
        
        if (args.category) params.append("category", args.category);
        if (args.mode) params.append("mode", args.mode);
        if (args.device) params.append("device", args.device);
        if (args.deprecated !== undefined) params.append("deprecated", args.deprecated);
        if (args.version) params.append("version", args.version);
        
        const queryString = params.toString();
        const endpoint = queryString ? `/api/commands/export?${queryString}` : "/api/commands/export";
        
        const result = await apiRequest(endpoint, "GET");
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case "import_commands": {
        const result = await apiRequest("/api/commands/import", "POST", {
          commands: args.commands,
          skip_duplicates: args.skip_duplicates !== false,
        });
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case "get_database_stats": {
        const result = await apiRequest("/api/stats", "GET");
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case "rebuild_all_embeddings": {
        const result = await apiRequest("/api/embeddings/rebuild", "POST");
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case "rebuild_embedding": {
        const result = await apiRequest(`/api/embeddings/rebuild/${args.id}`, "POST");
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case "create_backup": {
        const result = await apiRequest("/api/backup", "POST");
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case "list_backups": {
        const result = await apiRequest("/api/backups", "GET");
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case "restore_backup": {
        const result = await apiRequest("/api/restore", "POST", {
          backup_file: args.backup_file,
        });
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      // ========== NEW TOOLS - MEDIUM PRIORITY ==========

      case "advanced_search": {
        const result = await apiRequest("/api/commands/search/advanced", "POST", {
          query: args.query,
          category: args.category,
          device: args.device,
          mode: args.mode,
          version: args.version,
          impact: args.impact,
          limit: args.limit || 10,
          score_threshold: args.score_threshold || 0.3,
        });
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case "list_categories": {
        const result = await apiRequest("/api/categories", "GET");
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case "get_category_stats": {
        const result = await apiRequest(`/api/categories/${args.category}/stats`, "GET");
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case "rename_category": {
        const result = await apiRequest(`/api/categories/${args.old_name}/rename`, "PUT", {
          new_name: args.new_name,
        });
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case "find_duplicates": {
        const result = await apiRequest("/api/commands/duplicates", "GET");
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case "validate_database": {
        const result = await apiRequest("/api/maintenance/validate", "GET");
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case "optimize_database": {
        const result = await apiRequest("/api/maintenance/optimize", "POST");
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: error.message,
            stack: error.stack,
          }, null, 2),
        },
      ],
      isError: true,
    };
  }
});

// ============================================================================
// START SERVER
// ============================================================================

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Checkpoint Commands MCP Server v2.0.0 running on stdio");
  console.error("Available tools: 23 (6 existing + 9 high priority + 8 medium priority)");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
// server.js
// MCP Server for Checkpoint commands (HTTP client to API server)

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fetch from 'node-fetch';

const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:5679";

// Create MCP server
const server = new Server(
  {
    name: "checkpoint-commands",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "search_commands",
        description: "Search for Checkpoint commands using semantic search. Provide a natural language description of what you want to do (e.g., 'check cluster status', 'configure firewall rules'). The system will find the most relevant commands.",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Natural language description of what you want to do or find"
            },
            limit: {
              type: "number",
              default: 5,
              description: "Maximum number of results to return"
            },
            score_threshold: {
              type: "number",
              default: 0.3,
              description: "Minimum similarity score (0-1) to include results"
            }
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
              description: "Base command name (e.g., 'cphaprob', 'fw ctl')"
            },
            description: {
              type: "string",
              description: "General description of what the command does"
            },
            arguments: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  args: { type: "string" },
                  description: { type: "string" }
                }
              },
              description: "Array of argument variants with descriptions"
            },
            category: {
              type: "string",
              description: "Command category (e.g., 'clusterxl', 'vpn', 'policy')"
            },
            version: {
              type: "string",
              description: "Checkpoint version (e.g., 'R80+', 'R81.20')"
            },
            keywords: {
              type: "string",
              description: "Comma-separated keywords for searching"
            },
            mode: {
              type: "string",
              enum: ["clish", "expert"],
              description: "Command execution mode"
            },
            type: {
              type: "string",
              enum: ["config", "query"],
              description: "Command type"
            },
            device: {
              type: "string",
              enum: ["firewall", "management"],
              description: "Target device type"
            },
            executable_mcp: {
              type: "boolean",
              default: false,
              description: "Whether this command can be executed via MCP"
            },
            impact: {
              type: "string",
              enum: ["low", "medium", "high", "critical"],
              description: "Risk level of the command"
            },
            related_commands: {
              type: "array",
              items: { type: "number" },
              description: "Array of related command IDs"
            }
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
              description: "Command ID to update"
            },
            command: { type: "string" },
            description: { type: "string" },
            arguments: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  args: { type: "string" },
                  description: { type: "string" }
                }
              }
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
              items: { type: "number" }
            },
            deprecated: { type: "boolean" }
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
              description: "Command ID to delete"
            }
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
              description: "Command ID"
            }
          },
          required: ["id"],
        },
      },
      {
        name: "list_commands",
        description: "List all commands with optional filters (category, mode, device, deprecated status)",
        inputSchema: {
          type: "object",
          properties: {
            category: {
              type: "string",
              description: "Filter by category (e.g., 'clusterxl', 'vpn')"
            },
            mode: {
              type: "string",
              enum: ["clish", "expert"],
              description: "Filter by execution mode"
            },
            device: {
              type: "string",
              enum: ["firewall", "management"],
              description: "Filter by device type"
            },
            deprecated: {
              type: "boolean",
              description: "Filter by deprecated status (true/false)"
            }
          },
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    // SEARCH COMMANDS
    if (name === "search_commands") {
      const { query, limit = 5, score_threshold = 0.3 } = args;

      const response = await fetch(`${API_BASE_URL}/api/commands/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, limit, score_threshold })
      });

      const data = await response.json();

      if (data.status === 'error') {
        return {
          content: [{
            type: "text",
            text: `Error: ${data.message}`
          }],
          isError: true,
        };
      }

      const results = data.results;

      if (results.length === 0) {
        return {
          content: [{
            type: "text",
            text: `No commands found for query: "${query}"\n\n(Similarity threshold: ${score_threshold})\n\nTry:\n- Using different keywords\n- Lowering the score_threshold\n- Using list_commands to see all available commands`
          }],
        };
      }

      const formatted = results.map((result, index) => {
        const argsText = result.arguments.length > 0
          ? result.arguments.map(a => `    • ${a.args}: ${a.description}`).join('\n')
          : '    (No arguments defined)';

        return `${index + 1}. ${result.command} [ID: ${result.id}] (Score: ${(result.score * 100).toFixed(1)}%)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📝 Description: ${result.description || 'N/A'}
📂 Category: ${result.category || 'N/A'}
🔧 Mode: ${result.mode || 'N/A'} | Type: ${result.type || 'N/A'}
🖥️  Device: ${result.device || 'N/A'}
⚠️  Impact: ${result.impact || 'N/A'}

Arguments:
${argsText}`;
      }).join('\n\n');

      return {
        content: [{
          type: "text",
          text: `🔍 Found ${results.length} command(s) for: "${query}"\n\n${formatted}`
        }],
      };
    }

    // ADD COMMAND
    if (name === "add_command") {
      const response = await fetch(`${API_BASE_URL}/api/commands`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(args)
      });

      const data = await response.json();

      if (data.status === 'error') {
        return {
          content: [{
            type: "text",
            text: `Error: ${data.message}`
          }],
          isError: true,
        };
      }

      return {
        content: [{
          type: "text",
          text: `✓ Command added successfully!\n\nID: ${data.id}\nCommand: ${args.command}\nDescription: ${args.description}\n\nEmbedding generated and indexed for semantic search.`
        }],
      };
    }

    // UPDATE COMMAND
    if (name === "update_command") {
      const { id, ...updates } = args;

      const response = await fetch(`${API_BASE_URL}/api/commands/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });

      const data = await response.json();

      if (data.status === 'error') {
        return {
          content: [{
            type: "text",
            text: `Error: ${data.message}`
          }],
          isError: true,
        };
      }

      return {
        content: [{
          type: "text",
          text: `✓ Command ${id} updated successfully!\n\nUpdated fields: ${Object.keys(updates).join(', ')}`
        }],
      };
    }

    // DELETE COMMAND
    if (name === "delete_command") {
      const { id } = args;

      const response = await fetch(`${API_BASE_URL}/api/commands/${id}`, {
        method: 'DELETE'
      });

      const data = await response.json();

      if (data.status === 'error') {
        return {
          content: [{
            type: "text",
            text: `Error: ${data.message}`
          }],
          isError: true,
        };
      }

      return {
        content: [{
          type: "text",
          text: `✓ Command ${id} deleted successfully!\n\nAssociated embeddings have been removed.`
        }],
      };
    }

    // GET COMMAND
    if (name === "get_command") {
      const { id } = args;

      const response = await fetch(`${API_BASE_URL}/api/commands/${id}`);
      const data = await response.json();

      if (data.status === 'error') {
        return {
          content: [{
            type: "text",
            text: `Error: ${data.message}`
          }],
          isError: true,
        };
      }

      const command = data.command;

      const argsText = command.arguments.length > 0
        ? command.arguments.map(a => `  • ${a.args}: ${a.description}`).join('\n')
        : '  (No arguments)';

      const relatedText = command.related_commands.length > 0
        ? command.related_commands.join(', ')
        : 'None';

      return {
        content: [{
          type: "text",
          text: `📋 Command Details [ID: ${command.id}]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Command: ${command.command}
Description: ${command.description || 'N/A'}

Category: ${command.category || 'N/A'}
Version: ${command.version || 'N/A'}
Keywords: ${command.keywords || 'N/A'}

Mode: ${command.mode || 'N/A'}
Type: ${command.type || 'N/A'}
Device: ${command.device || 'N/A'}

Executable via MCP: ${command.executable_mcp ? 'Yes' : 'No'}
Impact: ${command.impact || 'N/A'}
Deprecated: ${command.deprecated ? 'Yes' : 'No'}

Arguments:
${argsText}

Related Commands: ${relatedText}

Created: ${command.created_at}
Updated: ${command.updated_at}`
        }],
      };
    }

    // LIST COMMANDS
    if (name === "list_commands") {
      const queryParams = new URLSearchParams();
      if (args.category) queryParams.append('category', args.category);
      if (args.mode) queryParams.append('mode', args.mode);
      if (args.device) queryParams.append('device', args.device);
      if (args.deprecated !== undefined) queryParams.append('deprecated', args.deprecated.toString());

      const url = `${API_BASE_URL}/api/commands${queryParams.toString() ? '?' + queryParams.toString() : ''}`;
      const response = await fetch(url);
      const data = await response.json();

      if (data.status === 'error') {
        return {
          content: [{
            type: "text",
            text: `Error: ${data.message}`
          }],
          isError: true,
        };
      }

      const commands = data.commands;

      if (commands.length === 0) {
        return {
          content: [{
            type: "text",
            text: `No commands found matching the specified filters.`
          }],
        };
      }

      const formatted = commands.map(cmd => 
        `${cmd.id}. ${cmd.command} [${cmd.category || 'N/A'}] - ${cmd.description || 'No description'}`
      ).join('\n');

      const filterText = Object.keys(args).length > 0
        ? `\nFilters: ${JSON.stringify(args)}`
        : '';

      return {
        content: [{
          type: "text",
          text: `📚 Commands (${commands.length} found)${filterText}\n\n${formatted}\n\nUse get_command with an ID to see full details.`
        }],
      };
    }

    throw new Error(`Unknown tool: ${name}`);

  } catch (error) {
    // Handle connection errors to API server
    if (error.code === 'ECONNREFUSED' || error.message.includes('fetch failed')) {
      return {
        content: [{
          type: "text",
          text: `❌ Cannot connect to API server at ${API_BASE_URL}\n\nPlease ensure the API server is running:\n  npm run api\n\nOr check if the server is running on a different port.`
        }],
        isError: true,
      };
    }
    
    return {
      content: [{
        type: "text",
        text: `Error: ${error.message}\n\nStack: ${error.stack}`
      }],
      isError: true,
    };
  }
});

// Start server
async function main() {
  try {
    // Check API server availability
    try {
      const response = await fetch(`${API_BASE_URL}/health`);
      const health = await response.json();
      console.error(`✓ Connected to API server: ${health.service} v${health.version}`);
    } catch (error) {
      console.error(`⚠️  Warning: Could not connect to API server at ${API_BASE_URL}`);
      console.error(`   Make sure api-server.js is running: npm run api`);
    }
    
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Checkpoint Commands MCP Server v1.0.0 running");
  } catch (error) {
    console.error("Initialization error:", error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
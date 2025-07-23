#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  TextContent,
  isInitializeRequest,
} from '@modelcontextprotocol/sdk/types.js';
import dotenv from 'dotenv';
import config from './config/index.js';
import { PerplexityService } from './services/perplexity.js';

// Load environment variables
dotenv.config();

class McpServerApp {
  private perplexityService: PerplexityService;
  private systemPrompt = {
    role: 'system',
    content: `You are a helpful AI assistant.

Rules:
1. Provide only the final answer. It is important that you do not include any explanation on the steps below.
2. Do not show the intermediate steps information.

Steps:
1. Decide if the answer should be a brief sentence or a list of suggestions.
2. If it is a list of suggestions, first, write a short brief and natural introduction based on the original query.
3. Followed by a list of suggestions, each suggestion should be split by two newlines.`,
  };

  constructor() {
    this.perplexityService = new PerplexityService();
  }

  private createServer(): McpServer {
    const server = new McpServer({
      name: 'mcp-perplexity-server',
      version: '1.0.0',
    });

    // Register Perplexity Ask tool
    server.tool(
      'perplexity_ask',
      'Engages in a conversation using the Sonar API. Accepts an array of messages (each with a role and content) and returns a chat completion response from the Perplexity model.',
      {
        messages: z
          .array(
            z.object({
              role: z
                .string()
                .describe(
                  'Role of the message (e.g., system, user, assistant)'
                ),
              content: z.string().describe('The content of the message'),
            })
          )
          .describe('Array of conversation messages'),
      },
      async ({ messages }) => {
        try {
          const result = await this.perplexityService.ask([
            this.systemPrompt,
            ...messages,
          ]);
          return {
            content: [
              {
                type: 'text',
                text: result,
              } as TextContent,
            ],
          };
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          throw new Error(`Error executing perplexity_ask: ${errorMessage}`);
        }
      }
    );

    // Register Perplexity Research tool
    server.tool(
      'perplexity_research',
      'Performs deep research using the Perplexity API. Accepts an array of messages (each with a role and content) and returns a comprehensive research response with citations.',
      {
        messages: z
          .array(
            z.object({
              role: z
                .string()
                .describe(
                  'Role of the message (e.g., system, user, assistant)'
                ),
              content: z.string().describe('The content of the message'),
            })
          )
          .describe('Array of conversation messages'),
      },
      async ({ messages }) => {
        try {
          const result = await this.perplexityService.research([
            this.systemPrompt,
            ...messages,
          ]);
          return {
            content: [
              {
                type: 'text',
                text: result,
              } as TextContent,
            ],
          };
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          throw new Error(
            `Error executing perplexity_research: ${errorMessage}`
          );
        }
      }
    );

    // Register Perplexity Reason tool
    server.tool(
      'perplexity_reason',
      'Performs reasoning tasks using the Perplexity API. Accepts an array of messages (each with a role and content) and returns a well-reasoned response using the sonar-reasoning-pro model.',
      {
        messages: z
          .array(
            z.object({
              role: z
                .string()
                .describe(
                  'Role of the message (e.g., system, user, assistant)'
                ),
              content: z.string().describe('The content of the message'),
            })
          )
          .describe('Array of conversation messages'),
      },
      async ({ messages }) => {
        try {
          const result = await this.perplexityService.reason([
            this.systemPrompt,
            ...messages,
          ]);
          return {
            content: [
              {
                type: 'text',
                text: result,
              } as TextContent,
            ],
          };
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          throw new Error(`Error executing perplexity_reason: ${errorMessage}`);
        }
      }
    );

    return server;
  }

  async run() {
    const app = express();
    app.use(express.json());

    // Map to store transports by session ID for stateful connections
    const transports: { [sessionId: string]: StreamableHTTPServerTransport } =
      {};

    // Health check endpoint
    app.get('/health', (req, res) => {
      res.json({ status: 'ok', service: 'mcp-perplexity-server' });
    });

    // Handle POST requests for client-to-server communication
    app.post('/mcp', async (req, res) => {
      try {
        // Check for existing session ID
        const sessionId = req.headers['mcp-session-id'] as string | undefined;
        let transport: StreamableHTTPServerTransport;
        let server: McpServer;

        if (sessionId && transports[sessionId]) {
          // Reuse existing transport
          transport = transports[sessionId];
        } else if (!sessionId && isInitializeRequest(req.body)) {
          // New initialization request
          transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: sessionId => {
              // Store the transport by session ID
              transports[sessionId] = transport;
            },
          });

          // Clean up transport when closed
          transport.onclose = () => {
            if (transport.sessionId) {
              delete transports[transport.sessionId];
            }
          };

          // Create new server instance
          server = this.createServer();

          // Connect to the MCP server
          await server.connect(transport);
        } else {
          // Invalid request
          res.status(400).json({
            jsonrpc: '2.0',
            error: {
              code: -32000,
              message: 'Bad Request: No valid session ID provided',
            },
            id: null,
          });
          return;
        }

        // Handle the request
        await transport.handleRequest(req, res, req.body);
      } catch (error) {
        console.error('Error handling MCP request:', error);
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: '2.0',
            error: {
              code: -32603,
              message: 'Internal server error',
            },
            id: null,
          });
        }
      }
    });

    // Reusable handler for GET and DELETE requests
    const handleSessionRequest = async (
      req: express.Request,
      res: express.Response
    ) => {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      if (!sessionId || !transports[sessionId]) {
        res.status(400).send('Invalid or missing session ID');
        return;
      }

      const transport = transports[sessionId];
      await transport.handleRequest(req, res);
    };

    // Handle GET requests for server-to-client notifications via SSE
    app.get('/mcp', handleSessionRequest);

    // Handle DELETE requests for session termination
    app.delete('/mcp', handleSessionRequest);

    // Start the server
    app.listen(config.server.port, '0.0.0.0', () => {
      console.log(
        `MCP Perplexity Server running on http://0.0.0.0:${config.server.port}`
      );
      console.log(
        `Health check available at http://0.0.0.0:${config.server.port}/health`
      );
      console.log(
        `MCP endpoint available at http://0.0.0.0:${config.server.port}/mcp`
      );
    });
  }
}

// Start the server
const server = new McpServerApp();
server.run().catch(error => {
  console.error('Failed to start server:', error);
  process.exit(1);
});

// Handle server shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down server...');
  process.exit(0);
});

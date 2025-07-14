import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { randomUUID } from "crypto";
import express from "express";
import { Server } from "http";
import * as vscode from "vscode";
import { z } from "zod";
import packageJson from "../package.json";

interface ChoiceOption {
  label: string;
  description: string;
}

interface ChoiceConfig {
  choices: ChoiceOption[];
  multiple: boolean;
}

interface Extension {
  askHuman(question: string, choice?: ChoiceConfig): Promise<string>;
  updateStatusBar(): void;
}

export class HumanMCPServer {
  private extension!: Extension;
  private expressApp: express.Application;
  private httpServer: Server | null = null;
  private instanceId: string;
  private outputChannel: vscode.LogOutputChannel;
  private port: number;

  constructor(outputChannel: vscode.LogOutputChannel, port: number) {
    this.expressApp = express();
    this.instanceId = randomUUID();
    this.outputChannel = outputChannel;
    this.port = port;
  }

  private getToolDescription(): string {
    const config = vscode.workspace.getConfiguration("askHumanVscode");
    return config.get<string>("toolDescription")!;
  }

  private getQuestionDescription(): string {
    const config = vscode.workspace.getConfiguration("askHumanVscode");
    return config.get<string>("questionDescription")!;
  }

  private setupResponseLogging(
    req: express.Request,
    res: express.Response,
  ): void {
    const responseChunks: Buffer[] = [];
    const outputChannel = this.outputChannel;
    let logged = false;

    const addChunk = (chunk: any) => {
      if (typeof chunk === "string") {
        responseChunks.push(Buffer.from(chunk));
      } else if (Buffer.isBuffer(chunk)) {
        responseChunks.push(chunk);
      }
    };

    const originalWrite = res.write.bind(res);
    res.write = function (chunk: any, encoding?: any, callback?: any) {
      addChunk(chunk);
      return originalWrite(chunk, encoding, callback);
    };

    const originalEnd = res.end.bind(res);
    res.end = function (chunk?: any, encoding?: any, callback?: any) {
      if (chunk) {
        addChunk(chunk);
      }
      if (!logged) {
        const fullResponse = Buffer.concat(responseChunks)
          .toString("utf-8")
          .trim();
        outputChannel.info(
          `Response: ${req.method} ${req.path} - ${fullResponse}`,
        );
        logged = true;
      }
      return originalEnd(chunk, encoding, callback);
    };
  }

  private getServer() {
    const server = new McpServer({
      name: "vscode-ask-human-mcp",
      version: packageJson.version,
    });

    server.registerTool(
      "ask-human-vscode",
      {
        title: "Ask Human in VS Code",
        description: this.getToolDescription(),
        inputSchema: {
          question: z.string().describe(this.getQuestionDescription()),
          choice: z
            .object({
              choices: z
                .array(
                  z.object({
                    label: z.string().describe("Choice title"),
                    description: z.string().describe("Markdown description"),
                  }),
                )
                .describe("Available options"),
              multiple: z
                .boolean()
                .default(false)
                .describe("Allow multiple selections"),
            })
            .optional()
            .describe("Optional choice interface"),
        },
      },
      async ({ question, choice }) => {
        try {
          const answer = await this.extension.askHuman(question, choice);

          return {
            content: [
              {
                type: "text",
                text: answer,
              },
            ],
          };
        } catch (error) {
          throw new Error(`Failed to get answer from developer: ${error}`);
        }
      },
    );

    return server;
  }

  public async start(extension: Extension): Promise<void> {
    this.extension = extension;
    this.setupExpressMiddleware();

    return new Promise((resolve, reject) => {
      this.httpServer = this.expressApp.listen(this.port, "127.0.0.1");

      this.httpServer.on("listening", () => {
        this.outputChannel.info(
          `MCP Server started successfully on port ${this.port}`,
        );
        resolve();
      });

      this.httpServer.on("error", (error: NodeJS.ErrnoException) => {
        this.httpServer = null;
        if (error.code === "EADDRINUSE") {
          reject(new Error(`Port ${this.port} is already in use`));
        } else {
          reject(error);
        }
      });
    });
  }

  private setupExpressMiddleware() {
    this.expressApp.use(express.json());

    this.expressApp.use((req, _res, next) => {
      if (
        req.method === "POST" &&
        req.body &&
        Object.keys(req.body).length > 0
      ) {
        this.outputChannel.info(
          `Request: ${req.method} ${req.path} - ${JSON.stringify(req.body)}`,
        );
      } else {
        this.outputChannel.info(`Request: ${req.method} ${req.path}`);
      }
      next();
    });

    this.expressApp.use((req, res, next) => {
      const originalJson = res.json;
      res.json = (data: any) => {
        this.outputChannel.info(
          `Response: ${req.method} ${req.path} - ${JSON.stringify(data)}`,
        );
        return originalJson.call(res, data);
      };
      next();
    });

    this.expressApp.post("/mcp", async (req, res) => {
      try {
        const server = this.getServer();
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
        });

        this.setupResponseLogging(req, res);

        res.on("close", () => {
          transport.close();
          server.close();
        });

        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
      } catch (error) {
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: "2.0",
            error: {
              code: -32603,
              message: "Internal server error",
            },
            id: null,
          });
        }
      }
    });

    this.expressApp.get("/", (_req, res) => {
      res.json({
        name: "VS Code Ask Human MCP Server",
        version: packageJson.version,
        status: "running",
        endpoint: "/mcp",
        instanceId: this.instanceId,
      });
    });

    this.expressApp.post("/shutdown", (_req, res) => {
      this.stop();

      res.json({
        success: true,
      });

      setImmediate(() => {
        this.extension.updateStatusBar();
      });
    });
  }

  public stop() {
    if (this.httpServer) {
      this.httpServer.close();
      this.outputChannel.info("MCP Server stopped successfully");
      this.httpServer = null;
    }
  }

  public isRunning(): boolean {
    return this.httpServer !== null;
  }
}

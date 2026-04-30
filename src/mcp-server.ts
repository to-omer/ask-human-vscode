import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { randomUUID } from "crypto";
import express from "express";
import { Server } from "http";
import type { AddressInfo } from "net";
import * as vscode from "vscode";
import { z } from "zod";
import packageJson from "../package.json";
import { WindowRegistry, type WindowRegistration } from "./window-registry";

export interface ChoiceOption {
  label: string;
  description?: string;
}

export interface QuestionInput {
  id: string;
  prompt: string;
  options?: ChoiceOption[];
  multiple?: boolean;
}

export interface AskHumanRequest {
  title?: string;
  workspacePath?: string;
  questions: QuestionInput[];
}

export interface AskHumanResult {
  [key: string]: unknown;
  answers: Record<string, string>;
  submittedAt: string;
}

interface Extension {
  askHumans(request: AskHumanRequest): Promise<AskHumanResult>;
  getWorkspaceFolders(): string[];
}

export class HumanMCPServer {
  private readonly expressApp = express();
  private readonly instanceId = randomUUID();
  private readonly registry?: WindowRegistry;
  private actualPort: number | undefined;
  private extension!: Extension;
  private httpServer: Server | null = null;
  private middlewareConfigured = false;

  constructor(
    private readonly outputChannel: vscode.LogOutputChannel,
    private readonly preferredPort: number,
    registryStoragePath?: string,
  ) {
    if (registryStoragePath) {
      this.registry = new WindowRegistry(registryStoragePath);
    }
  }

  public async start(
    extension: Extension,
    port = this.preferredPort,
  ): Promise<void> {
    if (this.httpServer) {
      return;
    }

    this.extension = extension;
    this.setupExpressMiddleware();

    return new Promise((resolve, reject) => {
      this.httpServer = this.expressApp.listen(port, "127.0.0.1");

      this.httpServer.once("listening", async () => {
        const address = this.httpServer?.address() as AddressInfo | null;
        this.actualPort = address?.port ?? port;

        try {
          await this.updateRegistration();
        } catch (error) {
          this.stop();
          reject(error);
          return;
        }

        this.outputChannel.info(
          `MCP Server started successfully on port ${this.actualPort}`,
        );
        resolve();
      });

      this.httpServer.once("error", (error: NodeJS.ErrnoException) => {
        this.httpServer = null;
        this.actualPort = undefined;
        reject(error);
      });
    });
  }

  public stop(): void {
    if (!this.httpServer) {
      return;
    }

    this.httpServer.close();
    this.registry?.remove(this.instanceId).catch((error) => {
      this.outputChannel.warn(`Failed to unregister MCP server: ${error}`);
    });
    this.outputChannel.info("MCP Server stopped successfully");
    this.httpServer = null;
    this.actualPort = undefined;
  }

  public async updateRegistration(): Promise<void> {
    if (!this.registry || !this.httpServer || !this.actualPort) {
      return;
    }

    await this.registry.upsert({
      instanceId: this.instanceId,
      port: this.actualPort,
      workspaceFolders: this.extension.getWorkspaceFolders(),
    });
  }

  private getServer(): McpServer {
    const server = new McpServer({
      name: "vscode-ask-human-mcp",
      version: packageJson.version,
    });

    server.registerTool(
      "ask-human-vscode",
      {
        title: "Ask Human in VS Code",
        description: this.getToolDescription(),
        inputSchema: this.getInputSchemaShape(),
        outputSchema: {
          answers: z.record(z.string()).describe("Answers keyed by question id"),
          submittedAt: z.string().describe("ISO timestamp when all answers were submitted"),
        },
      },
      async (input) => {
        try {
          const result = await this.askWithRouting(this.parseInput(input));
          return {
            structuredContent: result,
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        } catch (error) {
          throw new Error(`Failed to get answer from developer: ${error}`);
        }
      },
    );

    return server;
  }

  private getInputSchemaShape() {
    const optionSchema = z.object({
      label: z.string().describe("Choice title"),
      description: z.string().optional().describe("Markdown description"),
    });

    return {
      title: z.string().optional().describe("Optional title for the request"),
      workspacePath: z
        .string()
        .optional()
        .describe("Absolute current working directory or workspace folder"),
      questions: z
        .array(
          z.object({
            id: z.string().min(1).describe("Stable answer key"),
            prompt: z.string().describe(this.getQuestionDescription()),
            options: z
              .array(optionSchema)
              .min(1)
              .optional()
              .describe("Optional selectable answers"),
            multiple: z
              .boolean()
              .optional()
              .describe("Allow multiple selections when options are provided"),
          }),
        )
        .min(1)
        .max(25)
        .describe("Questions to ask in this request"),
    };
  }

  private parseInput(input: unknown): AskHumanRequest {
    const request = z.object(this.getInputSchemaShape()).parse(input);
    const questionIds = new Set<string>();

    for (const question of request.questions) {
      if (questionIds.has(question.id)) {
        throw new Error(`Duplicate question id: ${question.id}`);
      }
      questionIds.add(question.id);
    }

    return request;
  }

  private async askWithRouting(
    request: AskHumanRequest,
  ): Promise<AskHumanResult> {
    const target = await this.findRouteTarget(request.workspacePath);
    if (target && target.instanceId !== this.instanceId) {
      this.outputChannel.info(
        `Routing question to VS Code window ${target.instanceId} on port ${target.port}`,
      );
      try {
        return await this.forwardAskHuman(target, request);
      } catch (error) {
        this.outputChannel.warn(
          `Failed to route question to VS Code window ${target.instanceId}: ${error}`,
        );
        await this.registry?.remove(target.instanceId);
      }
    }

    return this.extension.askHumans(request);
  }

  private async findRouteTarget(
    workspacePath?: string,
  ): Promise<WindowRegistration | undefined> {
    if (!workspacePath || !this.registry) {
      return undefined;
    }
    return this.registry.findByWorkspacePath(workspacePath);
  }

  private async forwardAskHuman(
    target: WindowRegistration,
    request: AskHumanRequest,
  ): Promise<AskHumanResult> {
    const response = await fetch(
      `http://127.0.0.1:${target.port}/internal/ask-human`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
      },
    );

    if (!response.ok) {
      throw new Error(
        `Target VS Code window returned HTTP ${response.status}: ${response.statusText}`,
      );
    }

    return (await response.json()) as AskHumanResult;
  }

  private setupExpressMiddleware(): void {
    if (this.middlewareConfigured) {
      return;
    }
    this.middlewareConfigured = true;

    this.expressApp.use(express.json());

    this.expressApp.post("/mcp", async (req, res) => {
      try {
        const server = this.getServer();
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
        });

        res.on("close", () => {
          transport.close();
          server.close();
        });

        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
      } catch {
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: "2.0",
            error: { code: -32603, message: "Internal server error" },
            id: null,
          });
        }
      }
    });

    this.expressApp.post("/internal/ask-human", async (req, res) => {
      try {
        res.json(await this.extension.askHumans(this.parseInput(req.body)));
      } catch (error) {
        res.status(500).json({
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
  }

  private getToolDescription(): string {
    const config = vscode.workspace.getConfiguration("askHumanVscode");
    return config.get<string>("toolDescription")!;
  }

  private getQuestionDescription(): string {
    const config = vscode.workspace.getConfiguration("askHumanVscode");
    return config.get<string>("questionDescription")!;
  }
}

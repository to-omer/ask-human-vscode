import { randomUUID } from "crypto";
import * as vscode from "vscode";
import { z } from "zod";
import { HumanMCPServer } from "./mcp-server";
import { QuestionWebviewProvider } from "./webview-provider";

const MCPServerResponseSchema = z.object({
  name: z.literal("VS Code Ask Human MCP Server"),
  version: z.string(),
  status: z.literal("running"),
  endpoint: z.literal("/mcp"),
  instanceId: z.string(),
});

export class VSCodeExtension {
  private webviewProvider: QuestionWebviewProvider;
  private mcpServer: HumanMCPServer;
  private questions: Map<
    string,
    {
      question: string;
      resolve: (answer: string) => void;
    }
  > = new Map();
  private statusBarItem: vscode.StatusBarItem;
  private outputChannel: vscode.LogOutputChannel;
  private port: number;

  constructor(context: vscode.ExtensionContext) {
    this.outputChannel = vscode.window.createOutputChannel("Ask Human MCP", {
      log: true,
    });
    this.webviewProvider = new QuestionWebviewProvider(context, this);

    const config = vscode.workspace.getConfiguration("askHumanVscode");
    this.port = config.get<number>("port", 11911);
    this.mcpServer = new HumanMCPServer(this.outputChannel, this.port);

    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100,
    );
    this.statusBarItem.command = "askHumanVscode.toggleMCPServer";

    this.registerCommands(context);
    this.startMCPServer(false);
  }

  private registerCommands(context: vscode.ExtensionContext) {
    context.subscriptions.push(
      vscode.commands.registerCommand("askHumanVscode.toggleMCPServer", () => {
        this.toggleMCPServer();
      }),
    );

    context.subscriptions.push(this.statusBarItem);
  }

  private async startMCPServer(attemptTakeover = true) {
    try {
      await this.mcpServer.start(this);
    } catch {
      await this.handlePortConflict(attemptTakeover);
    }
    this.updateStatusBar();
  }

  private async handlePortConflict(attemptTakeover: boolean) {
    try {
      const response = await fetch(`http://127.0.0.1:${this.port}/`);
      if (response.ok) {
        const data = await response.json();

        if (MCPServerResponseSchema.safeParse(data).success) {
          this.outputChannel.warn(
            `Port ${this.port} in use by another VS Code Ask Human MCP Server instance`,
          );

          if (attemptTakeover) {
            await this.attemptServerTakeover();
          }
        } else {
          this.outputChannel.warn(
            `Port ${this.port} in use by different server`,
          );
        }
      } else {
        this.outputChannel.warn(
          `Port ${this.port} returned HTTP ${response.status}: ${response.statusText}`,
        );
      }
    } catch (error) {
      this.outputChannel.error("Port conflict resolution failed:", error);
    }
  }

  private async attemptServerTakeover() {
    try {
      const response = await fetch(`http://127.0.0.1:${this.port}/shutdown`, {
        method: "POST",
      });

      if (response.ok) {
        const result = (await response.json()) as {
          success: boolean;
          reason?: string;
        };
        if (result.success) {
          await this.mcpServer.start(this);
        }
      }
    } catch (error) {
      this.outputChannel.warn("Server takeover failed:", error);
    }
  }

  private stopMCPServer() {
    this.mcpServer.stop();
    this.updateStatusBar();
  }

  private async toggleMCPServer() {
    if (this.mcpServer.isRunning()) {
      this.stopMCPServer();
    } else {
      await this.startMCPServer();
    }
  }

  public updateStatusBar() {
    const isConnected = this.mcpServer.isRunning();
    this.statusBarItem.text = "$(plug) Ask";

    if (isConnected) {
      this.statusBarItem.tooltip = `Ask Human MCP Server: Connected on port ${this.port} (Click to disconnect)`;
      this.statusBarItem.color = undefined;
    } else {
      this.statusBarItem.tooltip = `Ask Human MCP Server: Port ${this.port} in use by another VS Code (Click to attempt takeover)`;
      this.statusBarItem.color = new vscode.ThemeColor("descriptionForeground");
    }
    this.statusBarItem.show();
  }

  public getQuestions(): Array<{ id: string; question: string }> {
    return Array.from(this.questions.entries()).map(([id, data]) => ({
      id,
      question: data.question,
    }));
  }

  public async askHuman(question: string): Promise<string> {
    this.outputChannel.info(`Question received: ${question}`);
    return new Promise((resolve) => {
      const questionId = randomUUID();
      this.questions.set(questionId, { question, resolve });

      this.webviewProvider.updateQuestions(this.getQuestions());
    });
  }

  public sendAnswer(answer: string, questionId: string) {
    this.outputChannel.info(`Answer sent: ${answer}`);
    const question = this.questions.get(questionId);
    if (question) {
      question.resolve(answer);
      this.questions.delete(questionId);

      this.webviewProvider.updateQuestions(this.getQuestions());
    }
  }

  public dispose() {
    if (this.mcpServer.isRunning()) {
      this.mcpServer.stop();
    }

    for (const data of this.questions.values()) {
      data.resolve("Extension is being disposed");
    }
    this.questions.clear();

    this.webviewProvider.dispose();
    this.statusBarItem.hide();
  }
}

let extensionInstance: VSCodeExtension | undefined;

export function activate(context: vscode.ExtensionContext) {
  extensionInstance = new VSCodeExtension(context);
}

export function deactivate() {
  if (extensionInstance) {
    extensionInstance.dispose();
    extensionInstance = undefined;
  }
}

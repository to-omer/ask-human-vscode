import { randomUUID } from "crypto";
import * as vscode from "vscode";
import { z } from "zod";
import { HumanMCPServer } from "./mcp-server";
import { QuestionWebviewProvider } from "./webview-provider";
import { MarkdownProcessor } from "./markdown-processor";

interface ChoiceOption {
  label: string;
  description: string;
  processedDescription: string;
}

interface ChoiceConfig {
  choices: ChoiceOption[];
  multiple: boolean;
}

export interface QuestionData {
  id: string;
  originalQuestion: string;
  processedQuestion: string;
  choice?: ChoiceConfig;
  resolve: (answer: string) => void;
}

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
  private markdownProcessor: MarkdownProcessor;
  private questions: Map<string, QuestionData> = new Map();
  private statusBarItem: vscode.StatusBarItem;
  private outputChannel: vscode.LogOutputChannel;
  private port: number;

  constructor(context: vscode.ExtensionContext) {
    this.outputChannel = vscode.window.createOutputChannel("Ask Human MCP", {
      log: true,
    });
    this.markdownProcessor = new MarkdownProcessor();
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
      vscode.commands.registerCommand("askHumanVscode.showPanel", () => {
        this.webviewProvider.updateQuestions(this.getQuestions());
      }),
      vscode.commands.registerCommand("askHumanVscode.selectQuestion", () => {
        this.showQuestionPicker();
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

    if (this.questions.size > 0) {
      this.statusBarItem.text = "$(plug) Ask+";
    } else {
      this.statusBarItem.text = "$(plug) Ask";
    }

    this.statusBarItem.color = isConnected
      ? undefined
      : new vscode.ThemeColor("descriptionForeground");

    this.statusBarItem.tooltip = isConnected
      ? `Ask Human MCP Server: Connected on port ${this.port} (Click to disconnect)`
      : `Ask Human MCP Server: Port ${this.port} in use by another VS Code (Click to attempt takeover)`;

    this.statusBarItem.show();
  }

  public getQuestions(): Array<{
    id: string;
    question: string;
    processedQuestion: string;
    choice?: ChoiceConfig;
  }> {
    return Array.from(this.questions.entries()).map(([id, data]) => ({
      id,
      question: data.originalQuestion,
      processedQuestion: data.processedQuestion,
      choice: data.choice,
    }));
  }

  public async askHuman(
    question: string,
    choice?: {
      choices: { label: string; description: string }[];
      multiple: boolean;
    },
  ): Promise<string> {
    this.outputChannel.info(`Question received: ${question}`);
    return new Promise(async (resolve) => {
      const questionId = randomUUID();
      const processedQuestion =
        await this.markdownProcessor.processMarkdown(question);

      let choiceConfig: ChoiceConfig | undefined;
      if (choice) {
        // Process choice descriptions through MarkdownProcessor
        const processedChoices = await Promise.all(
          choice.choices.map(async (choiceOption) => ({
            label: choiceOption.label,
            description: choiceOption.description,
            processedDescription: await this.markdownProcessor.processMarkdown(
              choiceOption.description,
            ),
          })),
        );

        choiceConfig = {
          choices: processedChoices,
          multiple: choice.multiple,
        };
      }

      this.questions.set(questionId, {
        id: questionId,
        originalQuestion: question,
        processedQuestion: processedQuestion,
        choice: choiceConfig,
        resolve,
      });

      this.webviewProvider.updateQuestions(this.getQuestions());
      this.updateStatusBar();
      this.updateContexts();
    });
  }

  public sendAnswer(answer: string, questionId: string) {
    this.outputChannel.info(`Answer sent: ${answer}`);
    const question = this.questions.get(questionId);
    if (question) {
      question.resolve(answer);
      this.questions.delete(questionId);

      this.webviewProvider.updateQuestions(this.getQuestions());
      this.updateContexts();

      if (this.questions.size === 0) {
        this.webviewProvider.closeEditor();
      }

      this.updateStatusBar();
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

  private async showQuestionPicker(): Promise<void> {
    const questions = Array.from(this.questions.entries());

    if (questions.length === 0) {
      vscode.window.showInformationMessage("No questions available");
      return;
    }

    const items = questions.map(([id, q]) => ({
      id,
      label: q.originalQuestion,
    }));

    await vscode.window.showQuickPick(items, {
      title: "Select Question",
      placeHolder: "Choose a question to focus on",
      onDidSelectItem: (item: any) => {
        this.webviewProvider.postMessage({
          type: "selectQuestion",
          questionId: item.id,
        });
      },
    });
  }

  private updateContexts(): void {
    const hasQuestions = this.questions.size > 0;
    vscode.commands.executeCommand(
      "setContext",
      "askHumanVscode.hasQuestions",
      hasQuestions,
    );
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

import { randomUUID } from "crypto";
import * as vscode from "vscode";
import { MarkdownProcessor } from "./markdown-processor";
import {
  HumanMCPServer,
  type AskHumanRequest,
  type AskHumanResult,
  type QuestionInput,
} from "./mcp-server";
import { QuestionWebviewProvider } from "./webview-provider";
import playSound = require("play-sound");

interface ProcessedChoiceOption {
  label: string;
  description?: string;
  processedDescription: string;
}

interface ChoiceConfig {
  choices: ProcessedChoiceOption[];
  multiple: boolean;
}

export interface QuestionData {
  id: string;
  order: number;
  originalQuestion: string;
  processedQuestion: string;
  choice?: ChoiceConfig;
  resolve: (answer: string) => void;
}

export class VSCodeExtension {
  private readonly context: vscode.ExtensionContext;
  private readonly markdownProcessor = new MarkdownProcessor();
  private readonly mcpServer: HumanMCPServer;
  private readonly outputChannel: vscode.LogOutputChannel;
  private readonly port: number;
  private readonly questions = new Map<string, QuestionData>();
  private readonly webviewProvider: QuestionWebviewProvider;
  private nextQuestionOrder = 0;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.outputChannel = vscode.window.createOutputChannel("Ask Human MCP", {
      log: true,
    });
    this.webviewProvider = new QuestionWebviewProvider(context, this);

    const config = vscode.workspace.getConfiguration("askHumanVscode");
    this.port = config.get<number>("port", 11911);
    this.mcpServer = new HumanMCPServer(
      this.outputChannel,
      this.port,
      context.globalStorageUri.fsPath,
    );

    this.registerCommands(context);
    this.startMCPServer();
  }

  public getQuestions(): Array<{
    id: string;
    question: string;
    processedQuestion: string;
    choice?: ChoiceConfig;
  }> {
    return Array.from(this.questions.entries())
      .sort((a, b) => a[1].order - b[1].order)
      .map(([id, data]) => ({
        id,
        question: data.originalQuestion,
        processedQuestion: data.processedQuestion,
        choice: data.choice,
      }));
  }

  public async askHumans(
    request: AskHumanRequest,
  ): Promise<AskHumanResult> {
    this.outputChannel.info(
      `Question request received: ${request.questions.length} questions`,
    );

    const queuedQuestions: Array<{
      answerId: string;
      promise: Promise<string>;
    }> = [];
    for (const question of request.questions) {
      queuedQuestions.push(await this.enqueueQuestion(question, request.title));
    }

    this.notifyQuestionStateChanged();

    const answerEntries = await Promise.all(
      queuedQuestions.map(async (queued) => [
        queued.answerId,
        await queued.promise,
      ]),
    );

    return {
      answers: Object.fromEntries(answerEntries),
      submittedAt: new Date().toISOString(),
    };
  }

  public sendAnswer(answer: string, questionId: string): void {
    this.outputChannel.info(`Answer sent: ${answer}`);
    const question = this.questions.get(questionId);
    if (!question) {
      return;
    }

    this.questions.delete(questionId);
    this.webviewProvider.updateQuestions(this.getQuestions());
    this.updateContexts();

    if (this.questions.size === 0) {
      this.webviewProvider.closeEditor();
    }

    question.resolve(answer);
  }

  public getWorkspaceFolders(): string[] {
    return (
      vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath) ??
      []
    );
  }

  public dispose(): void {
    this.mcpServer.stop();

    for (const data of this.questions.values()) {
      data.resolve("Extension is being disposed");
    }
    this.questions.clear();
    this.webviewProvider.dispose();
  }

  private registerCommands(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
      vscode.commands.registerCommand("askHumanVscode.showPanel", () => {
        this.webviewProvider.show();
      }),
      vscode.commands.registerCommand("askHumanVscode.selectQuestion", () => {
        this.showQuestionPicker();
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        this.mcpServer.updateRegistration().catch((error) => {
          this.outputChannel.warn(`Failed to update window registry: ${error}`);
        });
      }),
    );
  }

  private async startMCPServer(): Promise<void> {
    try {
      await this.mcpServer.start(this);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") {
        this.outputChannel.error("Failed to start MCP server:", error);
        return;
      }
    }

    try {
      await this.mcpServer.start(this, 0);
      this.outputChannel.info(
        `Port ${this.port} is in use; started on an available port`,
      );
    } catch (error) {
      this.outputChannel.error("Failed to start MCP server:", error);
    }
  }

  private async enqueueQuestion(
    question: QuestionInput,
    title?: string,
  ): Promise<{ answerId: string; promise: Promise<string> }> {
    const displayQuestion = title
      ? `**${title}**\n\n${question.prompt}`
      : question.prompt;
    const order = this.nextQuestionOrder++;
    const processedQuestion =
      await this.markdownProcessor.processMarkdown(displayQuestion);
    const questionId = randomUUID();
    let resolveAnswer!: (answer: string) => void;
    const promise = new Promise<string>((resolve) => {
      resolveAnswer = resolve;
    });

    this.questions.set(questionId, {
      id: questionId,
      order,
      originalQuestion: displayQuestion,
      processedQuestion,
      choice: await this.processChoices(question),
      resolve: resolveAnswer,
    });

    return { answerId: question.id, promise };
  }

  private async processChoices(
    question: QuestionInput,
  ): Promise<ChoiceConfig | undefined> {
    if (!question.options?.length) {
      return undefined;
    }

    return {
      choices: await Promise.all(
        question.options.map(async (option) => {
          const description = option.description ?? "";
          return {
            label: option.label,
            description,
            processedDescription:
              await this.markdownProcessor.processMarkdown(description),
          };
        }),
      ),
      multiple: question.multiple ?? false,
    };
  }

  private notifyQuestionStateChanged(): void {
    this.webviewProvider.updateQuestions(this.getQuestions());
    this.playNotificationSound();
    this.updateContexts();
  }

  private playNotificationSound(): void {
    if (
      !vscode.workspace
        .getConfiguration("askHumanVscode")
        .get("notification.enabled", true)
    ) {
      return;
    }

    const soundUri = vscode.Uri.joinPath(
      this.context.extensionUri,
      "media",
      "notify.mp3",
    );
    playSound().play(soundUri.fsPath, (err: unknown) => {
      if (err) {
        this.outputChannel.warn(`Failed to play notification sound: ${err}`);
      }
    });
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
    vscode.commands.executeCommand(
      "setContext",
      "askHumanVscode.hasQuestions",
      this.questions.size > 0,
    );
  }
}

let extensionInstance: VSCodeExtension | undefined;

export function activate(context: vscode.ExtensionContext): void {
  extensionInstance = new VSCodeExtension(context);
}

export function deactivate(): void {
  extensionInstance?.dispose();
  extensionInstance = undefined;
}

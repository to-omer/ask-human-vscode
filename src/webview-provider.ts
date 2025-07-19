import * as vscode from "vscode";
import { VSCodeExtension, QuestionData } from "./extension";

interface ChoiceOption {
  label: string;
  description: string;
  processedDescription: string;
}

interface ChoiceConfig {
  choices: ChoiceOption[];
  multiple: boolean;
}

export class QuestionWebviewProvider implements vscode.WebviewViewProvider {
  private _panel?: vscode.WebviewPanel;
  private _extensionView?: vscode.WebviewView;
  private _currentQuestions: Array<{
    id: string;
    question: string;
    processedQuestion: string;
    choice?: ChoiceConfig;
  }> = [];
  private _currentAnswerText: string = "";
  private _disposables: vscode.Disposable[] = [];
  private _isDisposed = false;

  constructor(
    private context: vscode.ExtensionContext,
    private extension: VSCodeExtension,
  ) {
    this._disposables.push(
      vscode.window.registerWebviewViewProvider(
        "askHumanVscode.extensionView",
        this,
      ),
    );

    this._disposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("askHumanVscode.webviewPosition")) {
          this.onWebviewPositionChanged();
        }
      }),
    );

    context.subscriptions.push(...this._disposables);
  }

  public createOrShowPanel() {
    if (this._panel) {
      this._panel.reveal(vscode.ViewColumn.Two);
      return;
    }

    this._panel = vscode.window.createWebviewPanel(
      "askHumanQuestion",
      "Ask Human",
      vscode.ViewColumn.Two,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      },
    );

    this._panel.iconPath = {
      light: vscode.Uri.joinPath(
        this.context.extensionUri,
        "resources",
        "icon-light.svg",
      ),
      dark: vscode.Uri.joinPath(
        this.context.extensionUri,
        "resources",
        "icon-dark.svg",
      ),
    };

    this._panel.onDidDispose(() => {
      this._panel = undefined;
    });

    this.setupWebview(this._panel.webview);
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    if (webviewView.viewType === "askHumanVscode.extensionView") {
      this._extensionView = webviewView;
    }

    this.setupWebview(webviewView.webview);

    this.sendStateToWebview(webviewView.webview);

    const visibilityDisposable = webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        this.sendStateToWebview(webviewView.webview);
      }
    });

    this._disposables.push(visibilityDisposable);
  }

  private sendStateToWebview(webview: vscode.Webview) {
    webview.postMessage({
      type: "questions",
      questions: this._currentQuestions,
    });

    if (this._currentAnswerText) {
      webview.postMessage({
        type: "restoreAnswerText",
        answerText: this._currentAnswerText,
      });
    }
  }

  public updateQuestions(
    questions: Array<{
      id: string;
      question: string;
      processedQuestion: string;
      choice?: ChoiceConfig;
    }>,
  ) {
    this._currentQuestions = questions;

    const position = this.getWebviewPosition();

    if (position === "editor") {
      this.createOrShowPanel();
      if (this._panel) {
        this.sendStateToWebview(this._panel.webview);
      }
    } else if (position === "extension") {
      if (this._extensionView) {
        this.sendStateToWebview(this._extensionView.webview);
        this._extensionView.show();
      }
    }

    this.updateBadge();
  }

  public closeEditor(): void {
    if (this.getWebviewPosition() === "editor" && this._panel) {
      this._panel.dispose();
      this._panel = undefined;
    }
  }

  private getWebviewPosition(): string {
    return vscode.workspace
      .getConfiguration("askHumanVscode")
      .get("webviewPosition", "editor");
  }

  private async onWebviewPositionChanged(): Promise<void> {
    this.hideCurrentWebView();

    if (this._currentQuestions.length > 0) {
      this.updateQuestions(this._currentQuestions);
    }
  }

  private hideCurrentWebView(): void {
    if (this._panel) {
      this._panel.dispose();
      this._panel = undefined;
    }
    this._extensionView = undefined;
  }

  private async handleOpenFile(message: {
    fileUri: string;
    startLine?: number;
    endLine?: number;
  }) {
    try {
      const uri = vscode.Uri.parse(message.fileUri);
      const document = await vscode.workspace.openTextDocument(uri);

      const isFileOpen = vscode.workspace.textDocuments.some(
        (doc) => doc.uri.fsPath === uri.fsPath,
      );

      const selection = message.startLine
        ? new vscode.Range(
            new vscode.Position(message.startLine - 1, 0),
            message.endLine
              ? new vscode.Position(message.endLine - 1, Number.MAX_VALUE)
              : new vscode.Position(message.startLine - 1, 0),
          )
        : undefined;

      if (isFileOpen) {
        await vscode.window.showTextDocument(document, {
          preserveFocus: false,
          preview: false,
          selection,
        });
      } else {
        const targetViewColumn = this.determineTargetViewColumn();

        await vscode.window.showTextDocument(document, {
          viewColumn: targetViewColumn,
          preserveFocus: false,
          preview: false,
          selection,
        });
      }
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to open file: ${message.fileUri}`);
    }
  }

  private determineTargetViewColumn(): vscode.ViewColumn {
    const position = this.getWebviewPosition();

    if (position === "extension") {
      return vscode.ViewColumn.One;
    } else {
      return this._panel?.viewColumn === vscode.ViewColumn.Two
        ? vscode.ViewColumn.One
        : vscode.ViewColumn.Two;
    }
  }

  private updateBadge(): void {
    if (!this._extensionView) {
      return;
    }

    const questionCount = this._currentQuestions.length;

    if (questionCount === 0) {
      this._extensionView.badge = undefined;
    } else {
      this._extensionView.badge = {
        value: questionCount,
        tooltip: `${questionCount} questions pending`,
      };
    }
  }

  public dispose() {
    if (this._isDisposed) {
      return;
    }

    this._isDisposed = true;

    this._disposables.forEach((disposable) => disposable.dispose());
    this._disposables = [];

    if (this._panel) {
      this._panel.dispose();
      this._panel = undefined;
    }

    this._extensionView = undefined;
    this._currentQuestions = [];
    this._currentAnswerText = "";
  }

  private setupWebview(webview: vscode.Webview) {
    if (this._isDisposed) {
      return;
    }

    webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri],
    };

    const messageDisposable = webview.onDidReceiveMessage((message) => {
      if (this._isDisposed) {
        return;
      }

      if (message.type === "answer") {
        this._currentAnswerText = "";
        this.extension.sendAnswer(message.answer, message.questionId);
      } else if (message.type === "openFile") {
        this.handleOpenFile(message);
      } else if (message.type === "updateAnswerText") {
        this._currentAnswerText = message.answerText || "";
      }
    });

    this._disposables.push(messageDisposable);

    this.setWebviewHTML(webview);
  }

  private setWebviewHTML(webview: vscode.Webview) {
    const nonce = this.getNonce();

    const stylesUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "media", "styles.css"),
    );
    const prismCssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "media", "prism.css"),
    );
    const prismJsUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "media", "prism.js"),
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "media", "main.js"),
    );
    const codiconsUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.context.extensionUri,
        "node_modules",
        "@vscode/codicons",
        "dist",
        "codicon.css",
      ),
    );

    webview.html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; font-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <title>Ask Human</title>
  <link href="${stylesUri}" rel="stylesheet">
  <link href="${prismCssUri}" rel="stylesheet">
  <link href="${codiconsUri}" rel="stylesheet">
</head>
<body>
  <div class="container">
    <div id="no-question" class="no-question">
      <div class="no-question-icon">💭</div>
      <div class="no-question-text">Waiting for AI questions...</div>
    </div>

    <div id="question-container" class="question-panel">
      <div class="question-content">
        <div id="question-text" class="question-text">
          <button id="copy-button" class="copy-button"
                  title="Copy question" aria-label="Copy question to clipboard">
            <i class="codicon codicon-copy"></i>
          </button>
        </div>

        <div id="choices-container" class="choices-container" style="display: none;">
          <div id="choices-list" class="choices-list"></div>
        </div>

        <div class="form-group">
          <textarea id="answer-textarea" class="answer-textarea" placeholder="Type your answer here..."></textarea>
        </div>

        <div class="button-row">
          <span class="keyboard-hint">Ctrl+Enter to send</span>
          <button id="send-button" class="send-button">Send Answer</button>
        </div>
      </div>
    </div>
  </div>

  <script nonce="${nonce}" src="${prismJsUri}" data-manual></script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  public postMessage(message: any): void {
    if (this._panel) {
      this._panel.webview.postMessage(message);
    }

    if (this._extensionView) {
      this._extensionView.webview.postMessage(message);
    }
  }

  private getNonce() {
    let text = "";
    const possible =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }
}

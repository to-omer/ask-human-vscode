import * as vscode from "vscode";
import { VSCodeExtension } from "./extension";

interface ChoiceOption {
  label: string;
  description?: string;
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
  private _answerTextByQuestionId = new Map<string, string>();
  private _selectedChoicesByQuestionId = new Map<string, string[]>();
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

  public show(): void {
    if (this.getWebviewPosition() === "extension") {
      this.revealExtensionView();
      return;
    }

    this.createOrShowPanel();
    if (this._panel) {
      this.sendStateToWebview(this._panel.webview);
    }
  }

  public createOrShowPanel() {
    if (this._panel) {
      try {
        this._panel.reveal(vscode.ViewColumn.Two);
        return;
      } catch (error) {
        this.clearPanel(error);
      }
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

    if (!this.setupWebview(this._panel.webview)) {
      this.clearPanel();
    }
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    if (webviewView.viewType === "askHumanVscode.extensionView") {
      this._extensionView = webviewView;
    }

    const disposeDisposable = webviewView.onDidDispose(() => {
      if (this._extensionView === webviewView) {
        this._extensionView = undefined;
      }
    });
    this._disposables.push(disposeDisposable);

    if (!this.setupWebview(webviewView.webview)) {
      this.clearExtensionView(webviewView);
      return;
    }

    if (!this.sendStateToWebview(webviewView.webview)) {
      this.clearExtensionView(webviewView);
      return;
    }

    const visibilityDisposable = webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        if (!this.sendStateToWebview(webviewView.webview)) {
          this.clearExtensionView(webviewView);
          return;
        }
      }
    });

    this._disposables.push(visibilityDisposable);
  }

  private sendStateToWebview(webview: vscode.Webview): boolean {
    return (
      this.postToWebview(webview, {
        type: "questions",
        questions: this._currentQuestions,
      }) &&
      this.postToWebview(webview, {
        type: "restoreAnswerTextByQuestionId",
        answerTextByQuestionId: Object.fromEntries(
          this._answerTextByQuestionId,
        ),
      }) &&
      this.postToWebview(webview, {
        type: "restoreSelectedChoicesByQuestionId",
        selectedChoicesByQuestionId: Object.fromEntries(
          this._selectedChoicesByQuestionId,
        ),
      })
    );
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
    const questionIds = new Set(questions.map((question) => question.id));
    for (const questionId of this._answerTextByQuestionId.keys()) {
      if (!questionIds.has(questionId)) {
        this._answerTextByQuestionId.delete(questionId);
      }
    }
    for (const questionId of this._selectedChoicesByQuestionId.keys()) {
      if (!questionIds.has(questionId)) {
        this._selectedChoicesByQuestionId.delete(questionId);
      }
    }

    const position = this.getWebviewPosition();
    const hasQuestions = this._currentQuestions.length > 0;

    if (position === "editor") {
      if (hasQuestions) {
        this.createOrShowPanel();
      }
      if (this._panel) {
        if (!this.sendStateToWebview(this._panel.webview)) {
          this.clearPanel();
          if (hasQuestions) {
            this.createOrShowPanel();
          }
          if (this._panel) {
            this.sendStateToWebview(this._panel.webview);
          }
        }
      }
    } else if (position === "extension") {
      let shouldRevealExtensionView = hasQuestions;
      if (this._extensionView) {
        if (!this.sendStateToWebview(this._extensionView.webview)) {
          this.clearExtensionView(this._extensionView);
          if (hasQuestions) {
            this.revealExtensionView();
          }
          return;
        }
        if (hasQuestions) {
          try {
            this._extensionView.show();
            shouldRevealExtensionView = false;
          } catch (error) {
            this.clearExtensionView(this._extensionView, error);
          }
        }
      }
      if (shouldRevealExtensionView) {
        this.revealExtensionView();
      }
    }
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
    this._answerTextByQuestionId.clear();
    this._selectedChoicesByQuestionId.clear();
  }

  private setupWebview(webview: vscode.Webview): boolean {
    if (this._isDisposed) {
      return false;
    }

    try {
      webview.options = {
        enableScripts: true,
        localResourceRoots: [this.context.extensionUri],
      };

      const messageDisposable = webview.onDidReceiveMessage((message) => {
        if (this._isDisposed) {
          return;
        }

        if (message.type === "answer") {
          this._answerTextByQuestionId.delete(message.questionId);
          this._selectedChoicesByQuestionId.delete(message.questionId);
          this.extension.sendAnswer(message.answer, message.questionId);
        } else if (message.type === "openFile") {
          this.handleOpenFile(message);
        } else if (message.type === "updateAnswerText") {
          if (!message.questionId) {
            return;
          }

          const answerText = message.answerText || "";
          if (answerText) {
            this._answerTextByQuestionId.set(message.questionId, answerText);
          } else {
            this._answerTextByQuestionId.delete(message.questionId);
          }
        } else if (message.type === "updateSelectedChoices") {
          if (!message.questionId) {
            return;
          }

          const selectedChoices = Array.isArray(message.selectedChoices)
            ? message.selectedChoices
            : [];
          if (selectedChoices.length > 0) {
            this._selectedChoicesByQuestionId.set(
              message.questionId,
              selectedChoices,
            );
          } else {
            this._selectedChoicesByQuestionId.delete(message.questionId);
          }
        }
      });

      this._disposables.push(messageDisposable);

      this.setWebviewHTML(webview);
      return true;
    } catch (error) {
      this.reportDisposedWebview(error);
      return false;
    }
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
      if (!this.postToWebview(this._panel.webview, message)) {
        this.clearPanel();
      }
    }

    if (this._extensionView) {
      if (!this.postToWebview(this._extensionView.webview, message)) {
        this.clearExtensionView(this._extensionView);
      }
    }
  }

  private postToWebview(webview: vscode.Webview, message: any): boolean {
    try {
      const result = webview.postMessage(message);
      result.then(undefined, (error) => {
        this.reportDisposedWebview(error);
      });
      return true;
    } catch (error) {
      this.reportDisposedWebview(error);
      return false;
    }
  }

  private clearPanel(error?: unknown): void {
    this.reportDisposedWebview(error);
    this._panel = undefined;
  }

  private clearExtensionView(
    webviewView: vscode.WebviewView,
    error?: unknown,
  ): void {
    this.reportDisposedWebview(error);
    if (this._extensionView === webviewView) {
      this._extensionView = undefined;
    }
  }

  private revealExtensionView(): void {
    void vscode.commands
      .executeCommand("askHumanVscode.extensionView.focus")
      .then(undefined, (error) => {
        this.reportDisposedWebview(error);
      });
  }

  private reportDisposedWebview(error?: unknown): void {
    if (!error) {
      return;
    }
    console.debug(`Ask Human webview unavailable: ${error}`);
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

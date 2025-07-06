import * as vscode from "vscode";
import { VSCodeExtension } from "./extension";

export class QuestionWebviewProvider {
  private _panel?: vscode.WebviewPanel;

  constructor(
    private context: vscode.ExtensionContext,
    private extension: VSCodeExtension,
  ) {}

  private createPanel() {
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

    this._panel.webview.onDidReceiveMessage((message) => {
      if (message.type === "answer") {
        this.extension.sendAnswer(message.answer, message.questionId);
      }
    });

    this._panel.onDidDispose(() => {
      this._panel = undefined;
    });

    this.updateHTML();
  }

  public updateQuestions(questions: Array<{ id: string; question: string }>) {
    this.createPanel();

    if (this._panel) {
      this._panel.webview.postMessage({
        type: "questions",
        questions,
      });
      this._panel.reveal(vscode.ViewColumn.Two);
    }
  }

  public dispose() {
    if (this._panel) {
      this._panel.dispose();
      this._panel = undefined;
    }
  }

  private updateHTML() {
    if (this._panel) {
      const webview = this._panel.webview;

      const nonce = this.getNonce();

      const stylesUri = webview.asWebviewUri(
        vscode.Uri.joinPath(this.context.extensionUri, "media", "styles.css"),
      );
      const scriptUri = webview.asWebviewUri(
        vscode.Uri.joinPath(this.context.extensionUri, "media", "main.js"),
      );

      this._panel.webview.html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <title>Ask Human</title>
  <link href="${stylesUri}" rel="stylesheet">
</head>
<body>
  <div class="container">
    <div id="no-question" class="no-question">
      <div class="no-question-icon">💭</div>
      <div class="no-question-text">Waiting for AI questions...</div>
    </div>

    <div id="question-container" class="question-panel">
      <div class="question-content">
        <div class="question-selector" id="question-selector">
          <button class="question-selector-button" id="question-selector-button">
            <span class="add-icon"></span>
          </button>
          <div class="question-dropdown" id="question-dropdown">
          </div>
        </div>

        <div id="question-text" class="question-text"></div>

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

  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
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

import { marked } from "marked";
import sanitizeHtml from "sanitize-html";
import * as vscode from "vscode";

class FileReference {
  constructor(
    public readonly uri: vscode.Uri,
    public readonly startLine?: number,
    public readonly endLine?: number,
  ) {}

  generateDataAttributes(): string {
    const attrs: Record<string, string | number | undefined> = {
      "data-file-uri": this.uri.toString(),
      "data-start-line": this.startLine,
      "data-end-line": this.endLine,
    };

    return Object.entries(attrs)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `${key}="${value}"`)
      .join(" ");
  }
}

export class MarkdownProcessor {
  private filePathMap = new Map<string, FileReference>();

  constructor() {
    this.setupMarked();
  }

  private setupMarked() {
    marked.use({
      walkTokens: async (token: any) => {
        if (token.type === "link") {
          const fileRef = await this.checkFileExists(token.href);
          if (fileRef) {
            this.filePathMap.set(token.href, fileRef);
          }
        }

        if (token.type === "code") {
          const fileRef = await this.checkFileExists(token.text);
          if (fileRef) {
            this.filePathMap.set(token.text, fileRef);
          }
        }
      },
      async: true,
      renderer: {
        link: (token: any): string => {
          const href = token.href;
          const text = token.text;

          if (this.filePathMap.has(href)) {
            const fileRef = this.filePathMap.get(href);
            if (fileRef) {
              return `<a href="#" ${fileRef.generateDataAttributes()}>${text}</a>`;
            }
          }

          return `<a href="${href}">${text}</a>`;
        },

        codespan: (token: any): string => {
          const code = token.text;

          if (this.filePathMap.has(code)) {
            const fileRef = this.filePathMap.get(code);
            if (fileRef) {
              return `<code ${fileRef.generateDataAttributes()}>${code}</code>`;
            }
          }

          return `<code>${code}</code>`;
        },
      },
    });
  }

  public async processMarkdown(markdown: string): Promise<string> {
    try {
      this.filePathMap.clear();

      const html = await marked.parse(markdown, {
        gfm: true,
        breaks: true,
      });

      const sanitizedHtml = sanitizeHtml(html, {
        allowedTags: sanitizeHtml.defaults.allowedTags.concat(["input", "del"]),
        allowedAttributes: {
          ...sanitizeHtml.defaults.allowedAttributes,
          a: [
            "href",
            "class",
            "data-file-uri",
            "data-start-line",
            "data-end-line",
          ],
          input: ["type", "checked", "disabled"],
          code: ["class", "data-file-uri", "data-start-line", "data-end-line"],
        },
        disallowedTagsMode: "escape",
      });
      return sanitizedHtml;
    } catch (error) {
      return sanitizeHtml(markdown, {
        allowedTags: [],
        allowedAttributes: {},
        disallowedTagsMode: "recursiveEscape",
      });
    }
  }

  private parseFilePathWithLine(input: string): {
    filePath: string;
    startLine?: number;
    endLine?: number;
  } {
    const match = input.match(/^(.+):(\d+)(?:-(\d+))?$/);
    if (match) {
      const [, filePath, startLine, endLine] = match;
      return {
        filePath,
        startLine: parseInt(startLine, 10),
        endLine: endLine ? parseInt(endLine, 10) : undefined,
      };
    }
    return { filePath: input };
  }

  private async checkFileExists(input: string): Promise<FileReference | null> {
    const parsed = this.parseFilePathWithLine(input);
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      return null;
    }

    for (const folder of workspaceFolders) {
      const uri = vscode.Uri.joinPath(folder.uri, parsed.filePath);
      try {
        await vscode.workspace.fs.stat(uri);
        return new FileReference(uri, parsed.startLine, parsed.endLine);
      } catch {
        continue;
      }
    }
    return null;
  }
}

import { marked } from "marked";
import sanitizeHtml from "sanitize-html";

export class MarkdownProcessor {
  public processMarkdown(markdown: string): string {
    try {
      const html = marked.parse(markdown, {
        gfm: true,
        breaks: false,
      }) as string;

      return sanitizeHtml(html, {
        allowedTags: sanitizeHtml.defaults.allowedTags.concat(["input", "del"]),
        allowedAttributes: {
          ...sanitizeHtml.defaults.allowedAttributes,
          input: ["type", "checked", "disabled"],
          code: ["class"],
        },
        disallowedTagsMode: "escape",
      });
    } catch (error) {
      return sanitizeHtml(markdown, {
        allowedTags: [],
        allowedAttributes: {},
        disallowedTagsMode: "recursiveEscape",
      });
    }
  }
}

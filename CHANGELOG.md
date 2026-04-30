# Change Log

All notable changes to the "ask-human-vscode" extension will be documented in this file.

## [1.5.0] - 2026-05-01

### Breaking Changes

- Replaced the single-question MCP input (`question`, `choice`) with `questions[]`
- Replaced plain text MCP responses with structured `answers` keyed by question id

### Added

- Multi-question requests in a single tool call
- VS Code window routing based on workspace path
- Registry-backed routing for multiple VS Code windows

### Changed

- Preserved per-question drafts and selected choices while switching questions
- Kept pending questions in request order
- Starts secondary VS Code windows on an available port and forwards matching workspace requests

### Fixed

- Prevented disposed webview errors during question updates
- Escaped choice labels before rendering them in the webview
- Restored the panel reopen command behavior

### Removed

- Activity Bar question count badge to avoid stale badge state
- Status bar MCP server toggle
- Port takeover and shutdown endpoints

## [1.4.0] - 2025-07-19

### Added

- Question count badge in sidebar panel
- Notification sound for new questions
- Multiple choice selection interface
- Example usage for AI agents in documentation

## [1.3.0] - 2025-07-14

### Added

- WebView position switching between extension sidebar and editor views (`askHumanVscode.webviewPosition`)
- Question selection toolbar integration with VS Code QuickPick
- Status bar question notifications with Ask+ indicator
- File path click functionality with line number support
- Auto-close functionality for editor webview when no questions remain

## [1.2.0] - 2025-07-10

### Added

- Copy button to copy questions to clipboard
- Rich markdown support with syntax highlighting

## [1.1.0] - 2025-07-08

### Added

- Configurable tool and question descriptions (`askHumanVscode.toolDescription`, `askHumanVscode.questionDescription`)
- Panel reopen command: "Ask Human: Show Panel" via Command Palette

## [1.0.0] - 2025-07-07

### Added

- Initial release
- MCP server for AI-human communication
- WebView interface for questions and answers
- Multi-instance port conflict resolution

# VS Code Ask Human MCP Server

A VS Code extension that allows AI agents to ask questions directly to developers through the Model Context Protocol (MCP).

## Installation

Install from the VS Code Marketplace.

## Configuration

Configure the extension in VS Code settings:

### Server Settings

```json
{
  "askHumanVscode.port": 11911
}
```

### AI Agent Communication Settings

```json
{
  "askHumanVscode.toolDescription": "Ask the developer when human judgment or context is needed for decision-making",
  "askHumanVscode.questionDescription": "Question with relevant context, current situation, and specific guidance needed"
}
```

## Usage

1. The extension automatically starts when VS Code opens
2. AI agents can connect to `http://127.0.0.1:11911/mcp`
3. Questions from AI agents appear in a dedicated VS Code panel
4. Answer questions directly in the interface

### Commands

- **Ask Human: Show Panel** - Reopen closed panel via Command Palette

## MCP Client Configuration

Add to your MCP client configuration:

```json
{
  "servers": {
    "ask-human": {
      "url": "http://127.0.0.1:11911/mcp"
    }
  }
}
```

## License

MIT - see [LICENSE.txt](LICENSE.txt)

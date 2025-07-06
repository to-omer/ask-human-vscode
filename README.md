# VS Code Ask Human MCP Server

A VS Code extension that allows AI agents to ask questions directly to developers through the Model Context Protocol (MCP).

## Installation

Install from the VS Code Marketplace.

## Configuration

The extension runs an MCP server on port 11911 by default. Configure the port in VS Code settings:

```json
{
  "askHumanVscode.port": 11911
}
```

## Usage

1. The extension automatically starts when VS Code opens
2. AI agents can connect to `http://127.0.0.1:11911/mcp`
3. Questions from AI agents appear in a dedicated VS Code panel
4. Answer questions directly in the interface

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

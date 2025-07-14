# Usage Guide for AI Agents: ask-human-vscode

## Tool Overview

- **Tool Name**: `ask-human-vscode`
- **Purpose**: Query human developers for clarification, decisions, and guidance during development tasks
- **Response**: Text answer from developer via VS Code interface
- **Features**: Supports markdown formatting, file links with line numbers for rich context presentation

## When to Ask Questions

### Core Use Cases

- **Requirements clarification**: When specifications are ambiguous or incomplete
- **Design decisions**: When multiple valid approaches exist and developer preference matters
- **Code review**: When uncertain about code quality, style, or architectural choices
- **Error resolution**: When automated fixes aren't clear or multiple solutions exist
- **Business logic**: When implementation requires domain knowledge or business rules
- **User experience**: When UX/UI decisions affect user workflows
- **Complex problem resolution**: When encountering issues that are difficult to solve independently or would take excessive time to resolve

### Best Practices for Timing

- Ask early when requirements are unclear rather than making assumptions
- Query before implementing complex features with multiple valid approaches
- Seek guidance when refactoring affects critical system components
- Request clarification when error messages or logs are ambiguous
- Ask for priorities when multiple tasks compete for attention

## Question Structure

### Effective Question Format

```
[Context] + [Current Situation] + [Specific Question] + [Options/Constraints]
```

### Essential Components

1. **Context**: Relevant code, file paths, error messages, or system state
2. **Current Situation**: What you're trying to accomplish and current progress
3. **Specific Question**: Clear, actionable question avoiding yes/no when possible
4. **Options**: Present alternatives when multiple solutions exist

### Formatting Features

- **Markdown support**: Use code blocks, lists, tables, headers for clear presentation
- **File links**: Reference files as `src/components/Header.tsx` for direct navigation
- **Line numbers**: Specify locations as `src/utils/helper.ts:45` for precise context
- **Code blocks**: Use syntax highlighting for better code readability

## Parameter Usage

### Basic Question

```json
{
  "question": "I'm implementing user authentication in `src/auth.ts:25`. Should I use JWT tokens or session-based authentication?\n\n**Current context:**\n- Mobile client support required\n- ~1000 concurrent users\n- Existing session middleware in `src/middleware/auth.ts:10`\n\n**Options:**\n1. JWT with refresh tokens\n2. Session-based with Redis store"
}
```

### Multiple Choice Questions

```json
{
  "question": "Which state management approach should I use for the user dashboard in `src/components/Dashboard.tsx`?",
  "choice": {
    "choices": [
      {
        "label": "React Context",
        "description": "**Pros:** Built-in, no dependencies, simple setup. **Cons:** Performance issues with frequent updates, re-renders entire tree. **Best for:** Simple shared state"
      },
      {
        "label": "Redux Toolkit",
        "description": "**Pros:** Predictable state updates, DevTools, time-travel debugging. **Cons:** Boilerplate code, learning curve. **Best for:** Complex state logic"
      },
      {
        "label": "Zustand",
        "description": "**Pros:** Minimal boilerplate, TypeScript support, small bundle. **Cons:** Less ecosystem support, newer library. **Best for:** Medium complexity with simplicity"
      }
    ],
    "multiple": false
  }
}
```

### Multiple Selection

Set `"multiple": true` to allow selecting multiple options from the choice list.

## Best Practices

### Do

- Ask one focused question per tool call that can be fully answered in a single response
- Include complete context: relevant code snippets, file paths, error messages, and current state
- Present multiple options when they exist, showing alternatives you've considered with their trade-offs
- Specify all relevant constraints and requirements upfront
- Define decision criteria: what factors matter most for this specific situation
- Reference existing codebase patterns and conventions
- Show what you've already tried or considered before asking
- Ask for specific, implementable guidance rather than general advice
- Provide sufficient detail so follow-up questions aren't needed

### Don't

- Ask overly broad questions that require multiple rounds of clarification
- Request explanations of basic programming concepts available in documentation
- Ask questions that can be answered by reading existing code or documentation
- Present questions without showing attempted solutions or research
- Start writing code without understanding complete requirements or getting implementation guidance
- Leave out important constraints or context that affect the decision

### Response Handling

- Implement the developer's guidance precisely
- Ask follow-up questions if the response needs clarification
- Document important decisions in code comments or project notes
- Validate assumptions before proceeding with implementation

## Summary

The tool provides direct access to developer expertise—use it strategically to make informed decisions and avoid assumptions that could lead to rework.

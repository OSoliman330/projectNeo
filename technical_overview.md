# Technical Application Overview: Lite Agent

This document provides a detailed technical breakdown of the Lite Agent extension, its architecture, dependencies, and implementation strategy.

## 1. High-Level Architecture

The **Lite Agent** is a VS Code extension that functions as a rich GUI wrapper around the Google Gemini CLI Core engine. Instead of re-implementing LLM logic, it directly integrates the `@google/gemini-cli-core` library to provide a full-featured AI coding assistant that shares the same capabilities as the command-line tool.

### Core Components
1.  **Extension Host (`GeminiService.ts`)**: The backend of the extension. It instantiates the CLI core, manages setting/config loading, and handles tool execution.
2.  **Webview UI (`App.tsx`, `GeminiPanel.ts`)**: A React-based frontend running inside a VS Code webview. It handles user input, message rendering, and slash command auto-completion.
3.  **CLI Core Engine (`@google/gemini-cli-core`)**: The brain of the application. It handles:
    -   Authentication (OAuth2 via `@google/genai`).
    -   Context Management (Session history, system instructions).
    -   Tool Execution (Scheduler, Tool Registry).
    -   MCP (Model Context Protocol) Client Management.
    -   Agents & Skills Discovery.

---

## 2. Key Libraries & Dependencies

We rely on several standardized libraries to avoid reinventing the wheel.

### Primary Dependencies
| Library | Purpose | Implementation Notes |
| :--- | :--- | :--- |
| **`@google/gemini-cli-core`** | **The Engine**. Provides `Config`, `GeminiClient`, `Scheduler`, `ToolRegistry`, and `SkillManager`. | We load this via a dynamic import hack (`new Function(...)`) to bypass Webpack's CommonJS transformation, preserving its native ESM nature. |
| **`@google/gemini-cli`** | **Configuration**. Provides `loadSettings` and `loadCliConfig`. | Used to parse `~/.gemini/settings.json` and project variables, ensuring the extension behaves exactly like the CLI. |
| **`@google/genai`** | **LLM API**. The official SDK for Gemini. | Handled internally by `gemini-cli-core`. |
| **`@modelcontextprotocol/sdk`** | **MCP Standard**. | Used by core to connect to MCP servers. |
| **`react` / `react-dom`** | **UI Framework**. | Renders the chat interface. |
| **`tailwindcss`** | **Styling**. | Utility-first CSS for the webview. |
| **`marked`** | **Markdown Rendering**. | Renders chat responses and artifacts. |

### Why `gemini-cli-core`?
By using the core library instead of calling the standard API directly, we gain:
-   **Unified configuration**: Shared settings with the CLI tool.
-   **Native Tooling**: Built-in support for `run_shell_commands`, `read_file`, `edit_file`, etc.
-   **Ecosystem Compatibility**: Instant support for `GEMINI.md` context files and `SKILL.md` definitions.

---

## 3. Implementation Details & Custom Logic

While we leverage standard libraries, we implemented specific integration logic to make them work within VS Code.

### A. The "GeminiService" Wrapper
Located in `src/extension/GeminiService.ts`, this class acts as the bridge.
-   **Dynamic Loading**: It uses `_nativeImport` to load ESM-only modules from the CLI package at runtime.
-   **Configuration Injection**: It constructs the `Config` object manually, injecting VS Code's workspace path as the `cwd`.
-   **Event Bridging**: It listens to CLI core events (`activity`, `status`, `tool-start`) and forwards them to the Webview via `postMessage`.

### B. Slash Command System
We implemented a custom slash command handler (`_handleCommand`) that intercepts commands before they reach the LLM:
-   `/debug`: Dumps raw session history and memory stats for debugging.
-   `/agents`: Enumerates available agents using `config.getAgentRegistry()`.
-   `/skills`: Enumerates available skills using `config.getSkillManager()`.
-   `/mcp`: Manages MCP server connections.

### C. Specific Workarounds
1.  **Shell Execution Hang Fix**:
    -   *Issue*: The CLI core defaults to using `node-pty` for interactive shell sessions. This native module often hangs or fails in the VS Code Extension Host environment due to process restrictions.
    -   *Fix*: We explicitly set `enableInteractiveShell = false` in the config. This forces the `ShellExecutionService` to fall back to standard Node.js `child_process.spawn`, which is stable and reliable for this use case.

2.  **Webpack ESM Compatibility**:
    -   *Issue*: The extension is compiled with Webpack (CJS), but dependencies are ESM.
    -   *Fix*: `webpack.config.js` is tuned to ignore `node:` built-ins, and `GeminiService` uses the `new Function('return import(...)')` pattern to load the core engine.

---

## 4. Features Implemented

### ✅ Core AI Chat
-   Full multi-turn conversation with context history.
-   Streaming responses.

### ✅ Agents & Skills
-   **Discovery**: Automatically finds agents and skills in `.gemini/` folders or `GEMINI.md` / `SKILL.md` files.
-   **Listing**: Users can view them via `/agents` and `/skills`.

### ✅ Model Context Protocol (MCP)
-   Full client implementation.
-   Connects to local or remote MCP servers defined in settings.
-   Tools exposed by MCP servers are automatically registered with the LLM.

### ✅ Context Management
-   **`GEMINI.md`**: Automatically reads `GEMINI.md` instructions from the project root.
-   **Persistent Memory**: Maintains conversation history (currently being debugged for session persistence).

### ✅ Tool Execution (Safe Mode)
-   **Shell**: Executes commands in the terminal (with non-interactive fallback).
-   **Filesystem**: Read/Write file capabilities.
-   **Browser**: Web search and fetch tools (if enabled).

---

## 5. What We Are NOT Doing
-   **NOT** implementing our own LLM client (we use `GeminiClient`).
-   **NOT** parsing `GEMINI.md` manually (we let `gemini-cli-core` do it).
-   **NOT** managing tool execution loop manually (we use `Scheduler` from core).
-   **NOT** implementing authentication flow manually (we reuse `Config.refreshAuth`).

This architecture ensures high maintainability. As `gemini-cli-core` improves (new tools, better planning), the Lite Agent inherits these features automatically.

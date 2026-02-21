import { EventEmitter } from 'events';

export interface HostEnvironment {
    log(msg: string): void;
    showLog(): void;
    getWorkspacePath(): string;
}

export interface GeminiServiceOptions {
    cliPath: string; // kept for backward compat
    env: HostEnvironment;
}

/**
 * GeminiService — wraps @google/gemini-cli core engine.
 * Uses the same Config, GeminiClient, Scheduler, and ToolRegistry
 * as the Gemini CLI itself, ensuring full compatibility with:
 *   - MCP servers & tools
 *   - SKILLS.md / GEMINI.md
 *   - Agents
 *   - Built-in tools (shell, read-file, edit, etc.)
 *   - Auth (OAuth2 via Code Assist)
 */
export class GeminiService extends EventEmitter {
    private _config: any;            // Config from @google/gemini-cli-core
    private _geminiClient: any;      // GeminiClient 
    private _scheduler: any;         // Scheduler for tool execution
    private _settings: any;          // LoadedSettings
    private _processing = false;
    private _ready = false;
    private _abortController: AbortController | null = null;

    // Lazy-loaded ESM modules
    private _coreModule: any;        // @google/gemini-cli-core
    private _settingsModule: any;    // @google/gemini-cli settings sub-module
    private _configModule: any;      // @google/gemini-cli config sub-module

    get isReady(): boolean { return this._ready; }

    constructor(private readonly _opts: GeminiServiceOptions) {
        super();
        this._opts.env.log('Service created (CLI Core mode).');
    }

    /**
     * Native dynamic import that bypasses webpack's import() → require() conversion.
     * Webpack transforms import() to require() in CommonJS output, but the CLI
     * packages are ESM with top-level await, so require() fails at runtime.
     * Using new Function() creates a truly dynamic import that webpack can't touch.
     */
    private _nativeImport(specifier: string): Promise<any> {
        // eslint-disable-next-line no-new-func
        return new Function('specifier', 'return import(specifier)')(specifier);
    }

    /**
     * Dynamically import ESM modules from @google/gemini-cli
     */
    private async _loadModules(): Promise<void> {
        if (this._coreModule && this._settingsModule && this._configModule) return;

        this._opts.env.log('Loading CLI modules...');

        // Use native import() to load ESM packages (bypasses webpack)
        // @google/gemini-cli-core has top-level exports for everything
        this._coreModule = await this._nativeImport('@google/gemini-cli-core');
        // loadSettings and loadCliConfig are in CLI sub-modules (not top-level)
        this._settingsModule = await this._nativeImport('@google/gemini-cli/dist/src/config/settings.js');
        this._configModule = await this._nativeImport('@google/gemini-cli/dist/src/config/config.js');

        this._opts.env.log('CLI modules loaded.');
    }

    /**
     * Initialize the CLI engine — loads settings, creates Config,
     * initializes GeminiClient and Scheduler.
     */
    async start(): Promise<void> {
        this.emit('status', 'Initializing CLI engine...');
        this.emit('activity', 'Loading settings...');

        try {
            await this._loadModules();

            const { loadSettings } = this._settingsModule;
            const { loadCliConfig } = this._configModule;
            const { sessionId, Scheduler, ROOT_SCHEDULER_ID, AuthType } = this._coreModule;

            // Load settings from ~/.gemini/settings.json etc
            const workspaceDir = this._opts.env.getWorkspacePath();

            this._opts.env.log(`Loading settings for workspace: ${workspaceDir}`);
            this._settings = loadSettings(workspaceDir);

            // Create Config (the central object that holds everything)
            this._opts.env.log('Creating Config...');
            const argv = {
                query: undefined,
                model: undefined,
                sandbox: undefined,
                debug: false,
                prompt: undefined,
                promptInteractive: undefined,
                yolo: undefined,
                approvalMode: 'yolo',  // Auto-approve in extension
                allowedMcpServerNames: undefined,
                allowedTools: undefined,
                experimentalAcp: undefined,
                extensions: undefined,
                listExtensions: undefined,
                resume: undefined,
                listSessions: undefined,
                deleteSession: undefined,
                includeDirectories: undefined,
                screenReader: undefined,
                useWriteTodos: undefined,
                outputFormat: undefined,
                fakeResponses: undefined,
                recordResponses: undefined,
                rawOutput: undefined,
                acceptRawOutputRisk: undefined,
                isCommand: undefined,
            };

            this._config = await loadCliConfig(
                this._settings.merged,
                sessionId,
                argv,
                { cwd: workspaceDir }
            );

            // Force disable interactive shell to prevent PTY usage (which causes hangs in extension)
            (this._config as any).enableInteractiveShell = false;

            // Set IDE mode for better VS Code integration
            this._config.setIdeMode(true);

            this.emit('activity', 'Authenticating...');

            // Refresh auth
            const authType = this._settings.merged?.security?.auth?.selectedType || AuthType.OAUTH;
            try {
                await this._config.refreshAuth(authType);
                this._opts.env.log('Authentication successful.');
            } catch (e: any) {
                this._opts.env.log(`Auth error: ${e.message}`);
                this.emit('error', `Authentication failed: ${e.message}`);
                return;
            }

            // Initialize the full Config (tool registry, MCP, skills, hooks, geminiClient)
            this.emit('activity', 'Initializing tools and MCP...');
            const startTime = Date.now();
            await this._config.initialize();
            const initDuration = Date.now() - startTime;
            this._opts.env.log(`Config/MCP initialization took ${initDuration}ms`);

            // Get the GeminiClient (handles chat, streaming, tools)
            this._geminiClient = this._config.getGeminiClient();

            // Log MCP and tool registry status
            const toolRegistry = this._config.getToolRegistry();
            const toolCount = toolRegistry?.getFunctionDeclarations()?.length || 0;
            this._opts.env.log(`Tool registry initialized: ${toolCount} tools registered.`);

            const mcpManager = this._config.getMcpClientManager();
            const clientsMap = (mcpManager as any).clients;
            const mcpClients = clientsMap ? Array.from(clientsMap.values()) : [];
            this._opts.env.log(`MCP clients: ${mcpClients.length} server(s) configured.`);
            for (const client of mcpClients as any[]) {
                const name = client.serverName || client.name || 'unknown';
                const status = client.getStatus?.() || 'unknown';
                this._opts.env.log(`  MCP server "${name}": status=${status}`);
            }

            // Create Scheduler for tool execution
            this._scheduler = new Scheduler({
                config: this._config,
                messageBus: this._config.getMessageBus(),
                getPreferredEditor: () => undefined,
                schedulerId: ROOT_SCHEDULER_ID,
            });

            this._ready = true;
            const model = this._config.getModel();
            this._opts.env.log(`Ready. Model: ${model}`);
            this.emit('status', 'ready');
            this.emit('activity', `Ready — Model: ${model} | ${toolCount} tools`);

        } catch (e: any) {
            this._opts.env.log(`Initialization error: ${e.message}\n${e.stack}`);
            this.emit('error', `Initialization failed: ${e.message}`);
        }
    }


    /**
     * Handle slash commands locally (e.g. /mcp, /tools, /clear).
     * Returns true if the command was handled, false if it should be sent to the model.
     */
    private _handleCommand(prompt: string): boolean {
        const trimmed = prompt.trim();
        if (!trimmed.startsWith('/')) return false;

        const parts = trimmed.split(/\s+/);
        const command = parts[0].substring(1).toLowerCase(); // remove leading /
        const subCommand = parts.slice(1).join(' '); // keep rest as args

        switch (command) {
            case 'mcp': {
                this._handleMcpCommand(parts[1]?.toLowerCase());
                return true;
            }
            case 'tools': {
                this._handleToolsCommand();
                return true;
            }
            case 'debug': {
                this._debugHistory();
                return true;
            }
            case 'agents': {
                this._listAgents();
                return true;
            }
            case 'skills': {
                this._listSkills();
                return true;
            }
            case 'clear':
            case 'restart':
            case 'status':
            case 'log':
            case 'help': {
                // Forward these to the panel or handle internally if needed
                // For now, these are effectively handled by the panel's pre-check,
                // but if they come through here (e.g. typed in chat), we can emit events
                // that the panel listens to, or just handle logic like restart here.

                // For others, let the panel handle it via a special event or
                // just return false to let it go to model? No, model shouldn't see /clear.
                // We'll emit a special 'slashCommand' event for the panel to pick up.
                this.emit('slashCommand', { command, args: subCommand });
                return true;
            }
            default:
                return false; // Unknown: forward to model
        }
    }

    private async _debugHistory() {
        if (!this._geminiClient) {
            this.emit('data', '\n\n⚠️ *Client not initialized*');
            return;
        }
        try {
            const history: any[] = await this._geminiClient.getHistory();
            const summary = history.map((h: any, i: number) => `[${i}] ${h.role} (${h.parts?.length} parts)`).join('\n');
            this.emit('data', `\n\n🔍 **Debug History** (${history.length} items):\n\`\`\`text\n${summary}\n\`\`\``);

            // Also log approved tools
            const approved = Array.from(this._approvedTools).join(', ');
            this.emit('data', `\n\n🛡️ **Approved Session Tools**: ${approved || 'None'}`);
        } catch (e: any) {
            this.emit('data', `\n\n⚠️ *Error getting history:* ${e.message}`);
        }
    }

    private async _listAgents() {
        if (!this._config) return;
        try {
            const registry = this._config.getAgentRegistry();
            const agents = registry.getAllDefinitions();

            if (agents.length === 0) {
                this.emit('data', '\n\n🤖 **Agents**: No agents found.');
                return;
            }

            const list = agents.map((a: any) => `- **${a.name}**: ${a.description || 'No description'}`).join('\n');
            this.emit('data', `\n\n🤖 **Available Agents**:\n${list}`);
        } catch (e: any) {
            this.emit('data', `\n\n⚠️ Error listing agents: ${e.message}`);
        }
    }

    private async _listSkills() {
        if (!this._config) return;
        try {
            // Force reload to pick up new files
            if (this._config.reloadSkills) {
                await this._config.reloadSkills();
            }

            const manager = this._config.getSkillManager();
            const skills = manager.getDisplayableSkills();

            if (skills.length === 0) {
                this.emit('data', '\n\n🧩 **Skills**: No user skills found.');
                return;
            }

            const list = skills.map((s: any) => `- **${s.name}**: ${s.description || 'No description'} (${s.location})`).join('\n');
            this.emit('data', `\n\n🧩 **Available Skills**:\n${list}`);
        } catch (e: any) {
            this.emit('data', `\n\n⚠️ Error listing skills: ${e.message}`);
        }
    }
    private _handleMcpCommand(subCommand?: string): void {
        const mcpManager = this._config?.getMcpClientManager();
        if (!mcpManager) {
            this.emit('data', '⚠️ MCP client manager not initialized.');
            this.emit('responseComplete');
            return;
        }

        switch (subCommand) {
            case 'list':
            default: {
                // List all configured MCP servers and their tools
                // McpClientManager exposes 'clients' as a Map<string, McpClient>
                // It does NOT have a getClients() method.
                const clientsMap = (mcpManager as any).clients;
                const clients = clientsMap ? Array.from(clientsMap.values()) : [];

                if (clients.length === 0) {
                    this.emit('data', '**MCP Servers:** None connected.\n\nMake sure your `~/.gemini/settings.json` has `mcpServers` configured.');
                    this.emit('responseComplete');
                    return;
                }

                let output = '**Connected MCP Servers:**\n\n';
                const toolRegistry = this._config?.getToolRegistry();

                for (const client of clients as any[]) {
                    const name = client.serverName || client.name || 'Unknown';
                    const status = client.getStatus?.() || 'unknown';
                    const icon = status === 'connected' ? '🟢' : '🔴';
                    output += `${icon} **${name}** (${status})\n`;

                    // List tools for this server
                    const tools = toolRegistry?.getToolsByServer(name) || [];
                    if (tools.length > 0) {
                        for (const tool of tools) {
                            output += `  • \`${tool.name}\`\n`;
                        }
                    } else {
                        output += `  _(no tools discovered)_\n`;
                    }
                    output += '\n';
                }

                this.emit('data', output);
                this.emit('responseComplete');
                break;
            }
        }
    }

    /**
     * Handle /tools command: list all registered tools
     */
    private _handleToolsCommand(): void {
        const toolRegistry = this._config?.getToolRegistry();
        if (!toolRegistry) {
            this.emit('data', '⚠️ Tool registry not initialized.');
            this.emit('responseComplete');
            return;
        }

        const declarations = toolRegistry.getFunctionDeclarations();
        let output = `**Registered Tools (${declarations.length}):**\n\n`;
        for (const decl of declarations) {
            output += `• \`${decl.name}\` — ${decl.description?.substring(0, 80) || 'No description'}\n`;
        }

        this.emit('data', output);
        this.emit('responseComplete');
    }

    /**
     * Send a message and stream the response.
     * Handles the full turn loop: send → stream response → execute tools → repeat.
     */
    async send(prompt: string): Promise<void> {
        if (this._processing) {
            this._opts.env.log('Still processing previous message, ignoring.');
            return;
        }
        if (!this._ready || !this._geminiClient) {
            this.emit('error', 'Not ready yet. Please wait for initialization.');
            return;
        }

        // Handle slash commands locally
        if (this._handleCommand(prompt)) {
            return;
        }

        this._processing = true;
        this._abortController = new AbortController();
        const signal = this._abortController.signal;
        const promptId = `lite-agent-${Date.now()}`;

        const { GeminiEventType, recordToolCallInteractions, debugLogger, promptIdContext } = this._coreModule;

        this._opts.env.log(`send() called. prompt="${prompt.substring(0, 80)}"`);

        // Telemetry Logging Setup (Safe temp directory)
        const telemetryLog: string[] = [];
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        telemetryLog.push(`# AI Execution Trace: ${timestamp}`);
        telemetryLog.push(`\n## User Prompt\n\`\`\`text\n${prompt}\n\`\`\`\n`);

        try {
            await promptIdContext.run(promptId, async () => {
                // DEBUG: Log history size
                try {
                    const history = await this._geminiClient.getHistory();
                    this._opts.env.log(`History size before turn: ${history.length}`);
                } catch (e) {
                    this._opts.env.log(`Could not get history: ${e}`);
                }

                let currentParts: any = [{ text: prompt }];
                let turnCount = 0;
                let isFirstTurn = true;

                while (true) {
                    turnCount++;

                    if (turnCount > 20) {
                        this._opts.env.log('Max turns reached, stopping.');
                        this.emit('data', '\n\n⚠️ *Maximum tool execution turns reached.*');
                        telemetryLog.push(`\n## Error\nMaximum tool execution turns reached.`);
                        break;
                    }

                    if (signal.aborted) {
                        this._opts.env.log('Execution aborted by user.');
                        this.emit('data', '\n\n🛑 *Execution stopped by user.*');
                        telemetryLog.push(`\n## Aborted\nExecution stopped by user.`);
                        break;
                    }

                    const toolCallRequests: any[] = [];
                    let currentThought = '';
                    let currentContent = '';

                    // Send message and stream response
                    const responseStream = this._geminiClient.sendMessageStream(
                        currentParts,
                        signal,
                        promptId,
                        undefined, // turns
                        false,     // isInvalidStreamRetry
                        isFirstTurn ? prompt : undefined // displayContent
                    );
                    isFirstTurn = false;

                    telemetryLog.push(`\n### Turn ${turnCount}`);

                    for await (const event of responseStream) {
                        if (signal.aborted) break;

                        switch (event.type) {
                            case GeminiEventType.Content:
                                this.emit('data', event.value);
                                currentContent += event.value;
                                break;

                            case GeminiEventType.ToolCallRequest:
                                this.emit('activity', `Planning tool call: ${event.value.name}...`);
                                this._opts.env.log(`Tool call requested: ${event.value.name}`);
                                toolCallRequests.push(event.value);
                                break;

                            case GeminiEventType.Thought:
                                // Thinking indicator - handle both string and object formats
                                let thoughtText = '';
                                if (typeof event.value === 'string') {
                                    thoughtText = event.value;
                                } else if (event.value && typeof event.value === 'object') {
                                    if (event.value.subject && event.value.description) {
                                        thoughtText = `**${event.value.subject}**\n${event.value.description}`;
                                    } else {
                                        thoughtText = event.value.description || event.value.subject || JSON.stringify(event.value);
                                    }
                                }

                                if (!thoughtText) {
                                    thoughtText = 'Thinking...';
                                }

                                this.emit('thought', thoughtText);
                                currentThought += thoughtText + '\n\n';
                                break;

                            case GeminiEventType.Error:
                                const errMsg = event.value?.error?.message || 'Unknown error';
                                this._opts.env.log(`Stream error: ${errMsg}`);
                                this.emit('data', `\n\n⚠️ *Error: ${errMsg}*`);
                                telemetryLog.push(`\n**Stream Error**: ${errMsg}`);
                                break;

                            case GeminiEventType.LoopDetected:
                                this._opts.env.log('Loop detected by CLI engine.');
                                this.emit('data', '\n\n⚠️ *Loop detected, stopping.*');
                                telemetryLog.push(`\n**Loop Detected**`);
                                break;

                            case GeminiEventType.AgentExecutionStopped:
                                this._opts.env.log(`Agent stopped: ${event.value?.reason}`);
                                telemetryLog.push(`\n**Agent Stopped**: ${event.value?.reason}`);
                                break;

                            case GeminiEventType.Retry:
                                this.emit('activity', 'Retrying...');
                                telemetryLog.push(`\n*Retrying...*`);
                                break;

                            case GeminiEventType.Finished:
                                // Normal completion
                                break;
                        }
                    }

                    // Log recorded information for this turn
                    if (currentThought) {
                        telemetryLog.push(`\n#### AI Thought\n${currentThought}`);
                    }
                    if (currentContent) {
                        telemetryLog.push(`\n#### AI Response\n${currentContent}`);
                    }

                    if (signal.aborted) {
                        this._opts.env.log('Execution aborted by user.');
                        if (!toolCallRequests.length) this.emit('data', '\n\n🛑 *Execution stopped by user.*');
                        telemetryLog.push(`\n## Aborted\nExecution stopped by user.`);
                        break;
                    }

                    // If there are tool calls, execute them and continue
                    if (toolCallRequests.length > 0) {
                        telemetryLog.push(`\n#### Tool Requests`);
                        for (const req of toolCallRequests) {
                            telemetryLog.push(`- **${req.name}**\n  \`\`\`json\n  ${JSON.stringify(req.args, null, 2).replace(/\n/g, '\n  ')}\n  \`\`\``);
                        }

                        // Check authorization before execution
                        try {
                            await this._checkToolAuthorization(toolCallRequests);
                        } catch (authError: any) {
                            this._opts.env.log(`Authorization denied: ${authError.message}`);
                            this.emit('data', `\n\n🚫 *Authorization Denied:* ${authError.message}`);
                            telemetryLog.push(`\n**Authorization Denied**: ${authError.message}`);
                            break;
                        }

                        if (signal.aborted) break;

                        this.emit('activity', `Executing ${toolCallRequests.length} tool(s)...`);

                        const completedToolCalls = await this._scheduler.schedule(
                            toolCallRequests,
                            signal
                        );

                        const toolResponseParts: any[] = [];
                        telemetryLog.push(`\n#### Tool Responses`);

                        for (const completed of completedToolCalls) {
                            const toolResponse = completed.response;

                            if (toolResponse.error) {
                                this._opts.env.log(`Tool error: ${completed.request.name} — ${toolResponse.error.message}`);
                                telemetryLog.push(`- **${completed.request.name}** Error: ${toolResponse.error.message}`);
                            } else {
                                // Extract just the parts for the log to avoid huge JSONs if possible, or stringify response
                                try {
                                    const responseSnippet = JSON.stringify(toolResponse.responseParts).substring(0, 1000);
                                    telemetryLog.push(`- **${completed.request.name}** Success. Response snippet:\n  \`\`\`json\n  ${responseSnippet}...\n  \`\`\``);
                                } catch (e) {
                                    telemetryLog.push(`- **${completed.request.name}** Success.`);
                                }
                            }

                            if (toolResponse.responseParts) {
                                toolResponseParts.push(...toolResponse.responseParts);
                            }

                            this._opts.env.log(`Tool ${completed.request.name}: ${completed.status}`);
                        }

                        // Record tool calls for session recording
                        try {
                            const currentModel = this._geminiClient.getCurrentSequenceModel() ?? this._config.getModel();
                            this._geminiClient
                                .getChat()
                                .recordCompletedToolCalls(currentModel, completedToolCalls);
                            await recordToolCallInteractions(this._config, completedToolCalls);
                        } catch (error: any) {
                            debugLogger.error(`Error recording tool calls: ${error}`);
                        }

                        // Check if any tool requested to stop
                        const stopTool = completedToolCalls.find(
                            (tc: any) => tc.response.errorType === 'STOP_EXECUTION'
                        );
                        if (stopTool) {
                            this._opts.env.log('Tool requested stop execution.');
                            telemetryLog.push(`\n**Tool Requested Stop Execution**`);
                            break;
                        }

                        // Send tool responses back to model for next turn
                        currentParts = toolResponseParts;
                    } else {
                        // No tool calls = response is complete
                        break;
                    }
                }
            });
        } catch (e: any) {
            if (signal.aborted) {
                this._opts.env.log('Execution aborted (caught in catch).');
                this.emit('data', '\n\n🛑 *Execution stopped by user.*');
                telemetryLog.push(`\n## Aborted\nExecution stopped by user (caught error).`);
            } else {
                this._opts.env.log(`send() error: ${e.message}\n${e.stack}`);
                this.emit('data', `\n\n⚠️ *Error: ${e.message}*`);
                telemetryLog.push(`\n## Error\n${e.message}\n\`\`\`\n${e.stack}\n\`\`\``);
            }
        } finally {
            this._processing = false;
            this._abortController = null;

            // Save telemetry log safely to OS temp directory
            try {
                const fs = require('fs');
                const os = require('os');
                const path = require('path');

                const logsDir = path.join(os.tmpdir(), 'gemini-lite-agent-logs');
                if (!fs.existsSync(logsDir)) {
                    fs.mkdirSync(logsDir, { recursive: true });
                }
                const logFilePath = path.join(logsDir, `run-${timestamp}.md`);
                fs.writeFileSync(logFilePath, telemetryLog.join('\n'), 'utf8');
                this._opts.env.log(`Telemetry safely saved to ${logFilePath}`);
            } catch (err: any) {
                this._opts.env.log(`Failed to write telemetry file: ${err.message}`);
            }

            this.emit('responseComplete');
        }
    }

    /**
     * Stop the current execution immediately.
     */
    stop(): void {
        if (this._abortController) {
            this._opts.env.log('User requested stop.');
            this._abortController.abort();
            this._abortController = null;
        }
    }

    // Authorization state
    private _approvedTools: Set<string> = new Set();
    private _pendingAuthorization: { resolve: (value: any) => void; reject: (reason?: any) => void } | null = null;

    /**
     * Check if tools are authorized. Pauses execution if approval is needed.
     */
    private async _checkToolAuthorization(toolCalls: any[]): Promise<void> {
        for (const tool of toolCalls) {
            if (this._approvedTools.has(tool.name)) continue;

            this._opts.env.log(`Tool requires authorization: ${tool.name}`);

            const promise = new Promise((resolve, reject) => {
                this._pendingAuthorization = { resolve, reject };
            });

            this.emit('requestAuthorization', {
                toolName: tool.name,
                args: tool.args
            });

            await promise;
        }
    }

    /**
     * Handle authorization response from UI.
     */
    authorize(decision: 'once' | 'session' | 'deny', toolName?: string): void {
        if (!this._pendingAuthorization) return;

        this._opts.env.log(`Authorization decision: ${decision}`);

        if (decision === 'deny') {
            this._pendingAuthorization.reject(new Error('User denied tool execution.'));
        } else {
            // If session, we add ALL currently pending tools to the approved list?
            // Or just the one that triggered it? 
            // Simplest UX: "Allow Always" adds the *current* tool name to the set.
            // But we might have multiple pending.
            // We'll trust the user wants to approve the tool *name* that was displayed.
            // But wait, `_checkToolAuthorization` paused at the first unauthorized tool.
            // So we just need to know WHICH tool was being authorized.
            // We can assume it's the one we asked about.

            if (decision === 'session') {
                // Since we don't track *which* tool we asked about in state, we re-check current request?
                // Actually, `_checkToolAuthorization` is waiting on the promise.
                // We need to know the tool name to add it to `_approvedTools`.
                // Let's just assume we add *all* currently requested tool names? 
                // No, that's dangerous.
                // Improving: `_checkToolAuthorization` should store the tools it's waiting on.
            }
            // Wait, we need to handle the 'session' logic correctly.
            // Let's modify `_checkToolAuthorization` to be more robust or `authorize` to take the tool name.
            // For now, simpler: we just resolve. The `_checkToolAuthorization` loop will re-run? 
            // no, it is `await this._checkToolAuthorization(toolCallRequests)`.
            // Inside, it does `const tool = toolsToAuthorize[0];`.
            // If we just resolve, it continues. 
            // We need to add to `_approvedTools` BEFORE resolving if 'session' was chosen.

            // Correction: `authorize` needs the tool name if we want to add it to the set.
            // Let's update `authorize` signature or better yet, store `_authorizingToolName`.
            if (decision === 'session' && toolName) {
                this._approvedTools.add(toolName);
                this._opts.env.log(`Tool "${toolName}" approved for session.`);
            }
        }

        // This is a bit tricky without state. Let's fix in next step.
        // Actually, we can just resolve with the decision, and let `_checkToolAuthorization` handle the logic.
        this._pendingAuthorization.resolve(decision);
        this._pendingAuthorization = null;
    }

    /**
     * Restart: dispose current config and re-initialize.
     */
    restart(): void {
        this._opts.env.log('Restarting...');
        this._ready = false;
        this._processing = false;

        if (this._abortController) {
            this._abortController.abort();
            this._abortController = null;
        }

        // Dispose old config
        if (this._config) {
            this._config.dispose().catch((e: any) => this._opts.env.log(`Dispose error: ${e.message}`));
        }
        this._config = null;
        this._geminiClient = null;
        this._scheduler = null;

        // Re-initialize
        void this.start();
    }

    /**
     * Show the output channel log.
     */
    showLog(): void {
        this._opts.env.showLog();
    }

    /**
     * Dispose: abort any active request and clean up the CLI Config.
     */
    async dispose(): Promise<void> {
        this._opts.env.log('Disposing...');
        if (this._abortController) {
            this._abortController.abort();
            this._abortController = null;
        }
        if (this._config) {
            try {
                await this._config.dispose();
            } catch (e: any) {
                this._opts.env.log(`Dispose error: ${e.message}`);
            }
        }
        this._config = null;
        this._geminiClient = null;
        this._scheduler = null;
        this._ready = false;
    }
}

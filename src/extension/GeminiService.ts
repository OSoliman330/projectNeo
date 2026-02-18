import { EventEmitter } from 'events';
import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

export interface GeminiServiceOptions {
    cliPath: string; // kept for backward compat, unused
}

// ─── Output Channel ───────────────────────────────────────────────────
let _outputChannel: vscode.OutputChannel | null = null;
function getOutputChannel(): vscode.OutputChannel {
    if (!_outputChannel) {
        _outputChannel = vscode.window.createOutputChannel('Lite Agent');
    }
    return _outputChannel;
}

function log(msg: string): void {
    const ts = new Date().toISOString().slice(11, 23);
    getOutputChannel().appendLine(`[${ts}] ${msg}`);
}

import { McpClient } from './McpClient';

// ─── Constants (from CLI source) ─────────────────────────────────────
const OAUTH_CLIENT_ID = Buffer.from(
    'NjgxMjU1ODA5Mzk1LW9vOGZ0Mm9wcmRybnA5ZT' +
    'NhcWY2YXYzaG1kaWIxMzVqLmFwcHMuZ29vZ2xldXNlcmNvbnRlbnQuY29t',
    'base64').toString('utf-8');

const OAUTH_CLIENT_SECRET = Buffer.from(
    'R09DU1BYLTR1SGdNUG0tMW83U2' +
    'stZ2VWNkN1NWNsWEZzeGw=',
    'base64').toString('utf-8');
const OAUTH_CREDS_PATH = path.join(os.homedir(), '.gemini', 'oauth_creds.json');

// The CLI uses Code Assist endpoint with OAuth — NOT the public Gemini API
const CODE_ASSIST_ENDPOINT = 'https://cloudcode-pa.googleapis.com';
const CODE_ASSIST_API_VERSION = 'v1internal';
const MODEL = 'gemini-2.5-flash';

// ─── Types ────────────────────────────────────────────────────────────
interface ChatMessage {
    role: 'user' | 'model' | 'function';
    parts: { text?: string; functionCall?: any; functionResponse?: any }[];
}

/**
 * GeminiService — Direct Code Assist API Integration
 *
 * The Gemini CLI uses the Code Assist endpoint (cloudcode-pa.googleapis.com)
 * with OAuth Bearer auth, NOT the public generativelanguage.googleapis.com API.
 *
 * Flow:
 * 1. Load OAuth creds from ~/.gemini/oauth_creds.json
 * 2. Call loadCodeAssist to get a managed projectId
 * 3. Call streamGenerateContent with projectId + Bearer token
 */
export class GeminiService extends EventEmitter {
    private _isProcessing: boolean = false;
    private _oauthClient: any = null;
    private _projectId: string | undefined;
    private _history: ChatMessage[] = [];
    private _initialized: boolean = false;
    private _mcpClient: McpClient;

    constructor(_options: GeminiServiceOptions) {
        super();
        this._mcpClient = new McpClient(getOutputChannel());
        log('Service created (Code Assist direct mode).');
    }

    /**
     * Initialize OAuth client + get projectId from Code Assist
     */
    public async start(): Promise<void> {
        if (this._initialized) {
            this.emit('status', 'connected');
            this.emit('activity', 'Ready.');
            return;
        }

        try {
            log('Initializing...');
            this.emit('activity', 'Loading credentials...');

            // 1. Load cached OAuth credentials
            if (!fs.existsSync(OAUTH_CREDS_PATH)) {
                throw new Error(
                    `No cached credentials found. Run "gemini" in a terminal first to authenticate.`
                );
            }

            const creds = JSON.parse(fs.readFileSync(OAUTH_CREDS_PATH, 'utf-8'));
            log(`Credentials loaded. Has refresh_token: ${!!creds.refresh_token}`);

            // 2. Create OAuth2Client
            const { OAuth2Client } = await import('google-auth-library');
            this._oauthClient = new OAuth2Client(OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET);
            this._oauthClient.setCredentials(creds);

            // Verify token
            const tokenResponse = await this._oauthClient.getAccessToken();
            if (!tokenResponse.token) {
                throw new Error('Failed to get access token.');
            }
            log(`Access token OK (${tokenResponse.token.substring(0, 20)}...)`);

            // Auto-update cache on token refresh
            this._oauthClient.on('tokens', (tokens: any) => {
                try {
                    const existing = JSON.parse(fs.readFileSync(OAUTH_CREDS_PATH, 'utf-8'));
                    fs.writeFileSync(OAUTH_CREDS_PATH, JSON.stringify({ ...existing, ...tokens }, null, 2), { mode: 0o600 });
                    log('Token cache updated.');
                } catch (e: any) {
                    log(`Warning: token cache update failed: ${e.message}`);
                }
            });

            // 3. Start MCP Client
            await this._mcpClient.start();

            // 4. Get projectId from Code Assist (loadCodeAssist)
            this.emit('activity', 'Setting up Code Assist...');
            const envProject = process.env['GOOGLE_CLOUD_PROJECT'] || process.env['GOOGLE_CLOUD_PROJECT_ID'];
            this._projectId = await this._loadCodeAssist(envProject);
            log(`Project ID: ${this._projectId}`);

            this._initialized = true;
            log(`Ready. Model: ${MODEL}, Project: ${this._projectId}`);
            this.emit('status', 'connected');
            this.emit('activity', `Ready (${MODEL})`);

        } catch (err: any) {
            log(`Init error: ${err.message}`);
            this.emit('error', `Failed to initialize: ${err.message}`);
        }
    }

    // ─── Code Assist API helpers ──────────────────────────────────────

    private _getBaseUrl(): string {
        return `${CODE_ASSIST_ENDPOINT}/${CODE_ASSIST_API_VERSION}`;
    }

    private async _getAccessToken(): Promise<string> {
        const { token } = await this._oauthClient.getAccessToken();
        if (!token) { throw new Error('Failed to get access token'); }
        return token;
    }

    private async _fetchWithRetry(url: string, options: RequestInit, retries = 3, backoff = 2000): Promise<Response> {
        for (let i = 0; i <= retries; i++) {
            try {
                const res = await fetch(url, options);

                if (res.status === 429) {
                    if (i === retries) {
                        log(`Rate limited (429). Max retries reached.`);
                        return res; // let caller handle final failure
                    }

                    const retryAfter = res.headers.get('retry-after');
                    const waitTime = retryAfter ? parseInt(retryAfter, 10) * 1000 : backoff * Math.pow(2, i);

                    log(`Rate limited (429). Retrying in ${waitTime}ms... (Attempt ${i + 1}/${retries})`);
                    this.emit('activity', `Rate limit hit. Retrying in ${Math.ceil(waitTime / 1000)}s...`);

                    await new Promise(resolve => setTimeout(resolve, waitTime));
                    continue;
                }

                return res;
            } catch (err: any) {
                if (i === retries) throw err;
                // Only retry on typical network errors if needed, but here we focus on 429
                throw err;
            }
        }
        throw new Error('Unreachable');
    }

    /**
     * Call loadCodeAssist to get the managed projectId
     */
    private async _loadCodeAssist(envProjectId: string | undefined): Promise<string> {
        const token = await this._getAccessToken();
        const url = `${this._getBaseUrl()}:loadCodeAssist`;

        log(`POST ${url}`);
        const res = await this._fetchWithRetry(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                cloudaicompanionProject: envProjectId,
                metadata: {
                    ideType: 'IDE_UNSPECIFIED',
                    platform: 'PLATFORM_UNSPECIFIED',
                    pluginType: 'GEMINI',
                    duetProject: envProjectId,
                },
            }),
        });

        if (!res.ok) {
            const errText = await res.text();
            throw new Error(`loadCodeAssist error ${res.status}: ${errText.substring(0, 200)}`);
        }

        const data: any = await res.json();
        log(`loadCodeAssist response: tier=${data.currentTier?.name || 'unknown'}`);

        // Get projectId: prefer server-provided, fall back to env
        const projectId = data.cloudaicompanionProject || envProjectId;
        if (!projectId) {
            throw new Error(
                'No project ID available. ' +
                'Set GOOGLE_CLOUD_PROJECT env var or see https://goo.gle/gemini-cli-auth-docs'
            );
        }
        return projectId;
    }

    /**
     * Send a message via Code Assist streaming API
     */
    public async send(prompt: string): Promise<boolean> {
        log(`send() called. prompt="${prompt.substring(0, 100)}" processing=${this._isProcessing}`);

        if (this._isProcessing) {
            this.emit('error', 'Still processing previous message. Please wait.');
            return false;
        }

        if (prompt.startsWith('/')) {
            const handled = await this._handleCommand(prompt);
            if (handled) return true;
        }

        if (!this._initialized) {
            await this.start();
            if (!this._initialized) { return false; }
        }

        this._isProcessing = true;
        this.emit('activity', 'Thinking...');
        const startTime = Date.now();

        try {
            // Add user message to history
            this._history.push({ role: 'user', parts: [{ text: prompt }] });

            let keepGoing = true;
            let turns = 0;
            const MAX_TURNS = 5; // prevent infinite loops

            while (keepGoing && turns < MAX_TURNS) {
                turns++;
                keepGoing = false; // default to stop unless tool call

                const token = await this._getAccessToken();
                const url = `${this._getBaseUrl()}:streamGenerateContent?alt=sse`;

                // Build Code Assist request body
                const body: any = {
                    model: MODEL,
                    project: this._projectId,
                    user_prompt_id: `lite-agent-${Date.now()}`,
                    request: {
                        contents: this._history,
                    },
                };

                // Add tools if available
                const tools = this._mcpClient.getToolsForGemini();
                if (tools.length > 0) {
                    body.request.tools = [{
                        functionDeclarations: tools
                    }];
                }

                log(`POST ${url} (project: ${this._projectId})`);

                const response = await this._fetchWithRetry(url, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(body),
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`API error ${response.status}: ${errorText.substring(0, 300)}`);
                }

                log('Streaming response...');
                let fullText = '';
                let toolCall: any = null;

                // Parse SSE stream
                const reader = response.body?.getReader();
                if (!reader) { throw new Error('No response body'); }

                const decoder = new TextDecoder();
                let buffer = '';

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) { break; }

                    buffer += decoder.decode(value, { stream: true });

                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';

                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            const jsonStr = line.slice(6).trim();
                            if (!jsonStr || jsonStr === '[DONE]') { continue; }

                            try {
                                const data = JSON.parse(jsonStr);
                                const candidates = data?.response?.candidates || data?.candidates;
                                const content = candidates?.[0]?.content;
                                const part = content?.parts?.[0];

                                if (part?.text) {
                                    fullText += part.text;
                                    this.emit('data', part.text);
                                } else if (part?.functionCall) {
                                    toolCall = part.functionCall;
                                    log(`Tool call received: ${toolCall.name}`);
                                }
                            } catch (parseErr: any) {
                                log(`SSE parse warning: ${parseErr.message}`);
                            }
                        }
                    }
                }

                // Add assistant response to history
                if (fullText) {
                    this._history.push({ role: 'model', parts: [{ text: fullText }] });
                }

                // Handle tool call
                if (toolCall) {
                    this._history.push({
                        role: 'model',
                        parts: [{ functionCall: toolCall }]
                    });

                    const result = await this._processToolCall(toolCall);
                    this._history.push({
                        role: 'function',
                        parts: [{
                            functionResponse: {
                                name: toolCall.name,
                                response: result
                            }
                        }]
                    });

                    keepGoing = true; // Loop to send tool result back to model
                    this.emit('activity', `Function ${toolCall.name} executed. Sending result...`);
                } else {
                    this.emit('responseComplete');
                }
            }

            const sec = ((Date.now() - startTime) / 1000).toFixed(1);
            log(`Done. ${turns} turns in ${sec}s`);
            this.emit('activity', `✅ Done in ${sec}s`);

        } catch (err: any) {
            log(`API error: ${err.message}`);
            // Don't pop history blindly, might lose context. Just log.

            if (err.message?.includes('401') || err.message?.includes('403')) {
                this._initialized = false;
                this._oauthClient = null;
                this.emit('error', `Auth error. Please retry. (${err.message})`);
            } else {
                this.emit('error', err.message || 'Unknown API error');
            }
        } finally {
            this._isProcessing = false;
        }

        return true;
    }

    private async _handleCommand(prompt: string): Promise<boolean> {
        const [cmd, ...args] = prompt.trim().split(/\s+/);

        switch (cmd.toLowerCase()) {
            case '/clear':
                this.restart();
                return true;
            case '/restart':
                this.restart();
                // verify config again?
                await this.start();
                return true;
            case '/status':
                this.emit('data', `Status: Connected\nProject: ${this._projectId}\nHistory: ${this._history.length} messages\n`);
                this.emit('responseComplete');
                return true;
            case '/help':
                this.emit('data', `Commands:\n/clear - Clear chat\n/restart - Restart session\n/status - Show connection status\n/mcp list - List MCP tools\n`);
                this.emit('responseComplete');
                return true;
            case '/mcp':
                if (args[0] === 'list') {
                    const tools = this._mcpClient.getToolsForGemini();
                    const list = tools.map(t => `- **${t.name}**: ${t.description}`).join('\n');
                    this.emit('data', `MCP Tools:\n${list || 'No tools found.'}`);
                    this.emit('responseComplete');
                    return true;
                }
                this.emit('data', 'Usage: `/mcp list`\nManage Model Context Protocol (MCP) servers and tools.');
                this.emit('responseComplete');
                return true;
            default:
                return false; // treat as prompt
        }
    }

    private async _processToolCall(call: any): Promise<any> {
        try {
            log(`Executing tool ${call.name} with args: ${JSON.stringify(call.args)}`);
            this.emit('activity', `Executing ${call.name}...`);
            const args = call.args || {};
            const result = await this._mcpClient.callTool(call.name, args);
            return { content: result };
        } catch (e: any) {
            log(`Tool execution failed: ${e.message}`);
            return { error: e.message };
        }
    }

    /**
     * Clear chat history
     */
    public restart(): void {
        log('Restarting — clearing history...');
        this._history = [];
        this._isProcessing = false;
        this.emit('status', 'connected');
        this.emit('activity', 'Session cleared. Ready.');
    }

    public get isReady(): boolean { return this._initialized; }
    public get isProcessing(): boolean { return this._isProcessing; }
    public showLog(): void { getOutputChannel().show(); }

    public dispose(): void {
        log('Disposing...');
        this._oauthClient = null;
        this._history = [];
        this._initialized = false;
        this._isProcessing = false;
    }
}

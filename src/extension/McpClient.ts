import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import * as vscode from 'vscode';

// Use require to bypass TS resolution issues with ESM-only package
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js");

export interface McpTool {
    name: string;
    description?: string;
    parameters: any;
}

interface McpServerConfig {
    command: string;
    args?: string[];
    env?: Record<string, string>;
    disabled?: boolean;
}

export class McpClient {
    private _clients: Map<string, any> = new Map();
    private _tools: Map<string, { server: string, tool: any }> = new Map();
    private _outputChannel: vscode.OutputChannel;

    constructor(outputChannel: vscode.OutputChannel) {
        this._outputChannel = outputChannel;
    }

    private log(msg: string) {
        const ts = new Date().toISOString().slice(11, 23);
        this._outputChannel.appendLine(`[${ts}] [MCP] ${msg}`);
    }

    public async start() {
        this.log('Initializing MCP Client...');

        // Load config from ~/.gemini/settings.json (or config.json?)
        // The CLI standard is ~/.gemini/settings.json or similar?
        // Let's try likely paths.
        const home = os.homedir();
        const configPaths = [
            path.join(home, '.gemini', 'gemini.json'), // common for some
            path.join(home, '.gemini', 'config.json'),
            path.join(home, '.gemini', 'settings.json'), // CLI uses this?
            path.join(process.env.APPDATA || '', 'gemini-cli', 'settings.json')
        ];

        let config: any = {};
        for (const p of configPaths) {
            if (fs.existsSync(p)) {
                try {
                    this.log(`Loading config from ${p}`);
                    const content = fs.readFileSync(p, 'utf-8');
                    // Strip comments if present (simple regex)
                    const json = content.replace(/\/\/.*$/gm, '');
                    config = JSON.parse(json);
                    break;
                } catch (e: any) {
                    this.log(`Error reading ${p}: ${e.message}`);
                }
            }
        }

        const servers: Record<string, McpServerConfig> = config.mcp?.servers || {};

        if (Object.keys(servers).length === 0) {
            this.log('No MCP servers found in config.');
            return;
        }

        for (const [name, srv] of Object.entries(servers)) {
            if (srv.disabled) {
                this.log(`Skipping disabled server: ${name}`);
                continue;
            }

            try {
                this.log(`Connecting to server: ${name} (${srv.command})`);

                const transport = new StdioClientTransport({
                    command: srv.command,
                    args: srv.args || [],
                    env: { ...process.env, ...(srv.env || {}) }
                });

                const client = new Client({
                    name: "LiteAgent",
                    version: "1.0.0",
                }, {
                    capabilities: {
                        tools: {},
                        resources: {},
                        prompts: {},
                    }
                });

                await client.connect(transport);
                this._clients.set(name, client);
                this.log(`Connected to ${name}.`);

                // Discover tools
                const toolsResult = await client.listTools();
                for (const tool of toolsResult.tools) {
                    this._tools.set(tool.name, { server: name, tool });
                    this.log(`  - Discovered tool: ${tool.name}`);
                }

            } catch (e: any) {
                this.log(`Failed to connect to ${name}: ${e.message}`);
            }
        }
    }

    public getToolsForGemini(): any[] {
        const geminiTools: any[] = [];
        for (const [name, info] of this._tools) {
            geminiTools.push({
                name: info.tool.name,
                description: info.tool.description,
                parameters: info.tool.inputSchema
            });
        }
        return geminiTools;
    }

    public async callTool(name: string, args: any): Promise<any> {
        const info = this._tools.get(name);
        if (!info) {
            throw new Error(`Tool ${name} not found.`);
        }

        this.log(`Calling tool ${name} on server ${info.server}...`);
        const client = this._clients.get(info.server);
        if (!client) {
            throw new Error(`Server ${info.server} not connected.`);
        }

        const result = await client.callTool({
            name: name,
            arguments: args
        });

        // Format result for Gemini
        // Gemini expects key "content" usually? or just JSON?
        // The result from MCP SDK is usually { content: [...] }
        return result;
    }

    public async dispose() {
        for (const [name, client] of this._clients) {
            try {
                await client.close(); // or just let transport close?
            } catch (e) {
                // ignore
            }
        }
        this._clients.clear();
        this._tools.clear();
    }
}

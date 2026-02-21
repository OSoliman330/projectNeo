import * as vscode from 'vscode';
import * as path from 'path';
import { GeminiService } from './GeminiService';

export class GeminiPanel implements vscode.WebviewViewProvider {
    public static readonly viewType = 'geminiChat.view';
    private _view?: vscode.WebviewView;
    private _geminiService?: GeminiService;

    constructor(
        private readonly _extensionUri: vscode.Uri,
    ) { }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        // Start the persistent CLI process immediately
        this._initGeminiService();

        // Handle messages from webview
        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
                case 'sendMessage':
                    this._handleUserMessage(data.value, data.attachments || []);
                    break;
                case 'attachFile':
                    this._pickFile();
                    break;
                case 'attachFolder':
                    this._pickFolder();
                    break;
                case 'slashCommand':
                    this._handleSlashCommand(data.command, data.args);
                    break;
                case 'webviewReady':
                    if (this._geminiService?.isReady) {
                        this._view?.webview.postMessage({ type: 'statusUpdate', value: 'connected' });
                    }
                    break;
                case 'stop':
                    this._geminiService?.stop();
                    break;
                case 'authorizationResponse':
                    this._geminiService?.authorize(data.decision, data.toolName);
                    break;
            }
        });

        // Cleanup when view is disposed
        webviewView.onDidDispose(() => {
            this._geminiService?.dispose();
        });
    }

    /*─────────────────────────────────────────────────
     * Gemini SDK Service (direct API, no CLI spawn)
     *────────────────────────────────────────────────*/

    private _initGeminiService() {
        const outputChannel = vscode.window.createOutputChannel('Lite Agent');
        const env = {
            log(msg: string) {
                const ts = new Date().toISOString().slice(11, 23);
                outputChannel.appendLine(`[${ts}] ${msg}`);
            },
            showLog() {
                outputChannel.show(true);
            },
            getWorkspacePath() {
                return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
            }
        };

        this._geminiService = new GeminiService({ cliPath: '', env });

        // Stream data chunks to the webview in real-time
        this._geminiService.on('data', (chunk: string) => {
            this._view?.webview.postMessage({ type: 'streamMessage', value: chunk });
        });

        // When a full response is complete
        this._geminiService.on('responseComplete', () => {
            this._view?.webview.postMessage({ type: 'responseComplete' });
        });

        // Activity steps
        this._geminiService.on('activity', (text: string) => {
            this._view?.webview.postMessage({
                type: 'activityStep',
                value: text,
            });
        });

        // Status updates
        this._geminiService.on('status', (status: string) => {
            this._view?.webview.postMessage({ type: 'statusUpdate', value: status });
        });

        // Errors
        this._geminiService.on('error', (message: string) => {
            this._view?.webview.postMessage({
                type: 'streamMessage',
                value: `\n⚠️ *${message}*\n`,
            });
            this._view?.webview.postMessage({ type: 'responseComplete' });
        });

        // Slash commands from service (e.g. typed in chat)
        this._geminiService.on('slashCommand', (event: { command: string, args?: string }) => {
            this._handleSlashCommand(event.command, event.args);
        });

        // Request authorization from the user for a tool
        this._geminiService.on('requestAuthorization', (data: { toolName: string, prompt: string }) => {
            this._view?.webview.postMessage({ type: 'requestAuthorization', value: data });
        });

        // Start SDK (async, fires 'status' and 'activity' events)
        void this._geminiService.start();
    }

    /*─────────────────────────────────────────────────
     * Message Handling
     *────────────────────────────────────────────────*/

    private async _handleUserMessage(prompt: string, attachments: { path: string; type: string }[]) {
        if (!this._geminiService) {
            this._initGeminiService();
        }

        // Build full prompt with attachment context
        let fullPrompt = prompt;
        if (attachments.length > 0) {
            const attachmentList = attachments.map(a => a.path).join(', ');
            fullPrompt = `[Attached: ${attachmentList}] ${prompt}`;
        }

        await this._geminiService!.send(fullPrompt);
    }

    /*─────────────────────────────────────────────────
     * Slash Commands
     *────────────────────────────────────────────────*/

    private _handleSlashCommand(command: string, args?: string) {
        switch (command) {
            case 'clear':
                // Restart the process to clear context
                this._geminiService?.restart();
                this._view?.webview.postMessage({ type: 'clearChat' });
                this._view?.webview.postMessage({
                    type: 'systemMessage',
                    value: '🔄 Context cleared. Starting fresh session.',
                });
                break;

            case 'restart':
                this._geminiService?.restart();
                this._view?.webview.postMessage({
                    type: 'systemMessage',
                    value: '🔄 CLI process restarted.',
                });
                break;

            case 'status':
                const status = this._geminiService?.isReady ? '🟢 Connected' : '🔴 Disconnected';
                this._view?.webview.postMessage({
                    type: 'systemMessage',
                    value: `Status: ${status}`,
                });
                break;

            case 'help':
                this._view?.webview.postMessage({
                    type: 'systemMessage',
                    value: [
                        '📋 **Available Commands:**',
                        '`/clear` — Clear chat and reset context',
                        '`/restart` — Restart CLI process',
                        '`/status` — Show connection status',
                        '`/mcp` — List connected MCP servers and their tools',
                        '`/tools` — List all available tools',
                        '`/log` — Open debug log output',
                        '`/help` — Show this help message',
                    ].join('\n'),
                });
                break;

            case 'log':
                this._geminiService?.showLog();
                this._view?.webview.postMessage({
                    type: 'systemMessage',
                    value: '📄 Output channel opened. Check the "Lite Agent" tab in the Output panel.',
                });
                break;

            case 'mcp':
                this._geminiService?.send(`/${command} ${args || ''}`.trim());
                break;

            default:
                // Forward unknown commands to service (might be handled there or sent to model)
                this._geminiService?.send(`/${command} ${args || ''}`.trim());
                break;
        }
    }

    /*─────────────────────────────────────────────────
     * File / Folder Picker
     *────────────────────────────────────────────────*/

    private async _pickFile() {
        const uris = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: true,
            title: 'Select files to attach',
        });
        if (uris) {
            for (const uri of uris) {
                this._view?.webview.postMessage({
                    type: 'fileSelected',
                    value: {
                        path: uri.fsPath,
                        type: 'file',
                        name: path.basename(uri.fsPath),
                    },
                });
            }
        }
    }

    private async _pickFolder() {
        const uris = await vscode.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: true,
            title: 'Select folders to attach',
        });
        if (uris) {
            for (const uri of uris) {
                this._view?.webview.postMessage({
                    type: 'fileSelected',
                    value: {
                        path: uri.fsPath,
                        type: 'folder',
                        name: path.basename(uri.fsPath),
                    },
                });
            }
        }
    }

    /*─────────────────────────────────────────────────
     * Webview HTML
     *────────────────────────────────────────────────*/

    private _getHtmlForWebview(webview: vscode.Webview) {
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview.js'));
        const nonce = getNonce();

        return `<!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' 'unsafe-eval'; img-src ${webview.cspSource} https: data:;">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Lite Agent</title>
      </head>
      <body>
        <div id="root"></div>
        <script nonce="${nonce}">
            window.onerror = function(message, source, lineno, colno, error) {
                const root = document.getElementById('root');
                root.innerHTML += '<div style="color: red; padding: 10px; border: 1px solid red; margin: 10px;">' +
                    '<h3>Webview Error</h3>' +
                    '<pre>' + message + '\\n' + source + ':' + lineno + '</pre>' +
                    '</div>';
            };
        </script>
        <script nonce="${nonce}" src="${scriptUri}"></script>
      </body>
      </html>`;
    }
}

export function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}


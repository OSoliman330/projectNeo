import * as vscode from 'vscode';
import { spawn } from 'child_process';
import * as path from 'path';

export class GeminiPanel implements vscode.WebviewViewProvider {
    public static readonly viewType = 'geminiChat.view';
    private _view?: vscode.WebviewView;

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
            localResourceRoots: [
                this._extensionUri
            ]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
                case 'sendMessage':
                    this._runGemini(data.value, data.attachments || []);
                    break;
                case 'attachFile':
                    this._pickFile();
                    break;
                case 'attachFolder':
                    this._pickFolder();
                    break;
            }
        });
    }

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

    private _runGemini(prompt: string, attachments: { path: string; type: string }[] = []) {
        if (!this._view) { return; }

        const config = vscode.workspace.getConfiguration('geminiChat');
        const cliPath = config.get<string>('cliPath') || 'gemini';

        // Build full prompt with attachment context
        let fullPrompt = prompt;
        if (attachments.length > 0) {
            const attachmentList = attachments.map(a => a.path).join(', ');
            fullPrompt = `[Attached: ${attachmentList}] ${prompt}`;
        }

        const process = spawn(cliPath, [fullPrompt], { shell: true });

        process.stdout.on('data', (data) => {
            const output = data.toString();
            this._view?.webview.postMessage({ type: 'streamMessage', value: output });
        });

        process.stderr.on('data', (data) => {
            console.error(`Gemini CLI Error: ${data}`);
            // meaningful errors could be sent to UI
        });

        process.on('close', (code) => {
            if (code !== 0) {
                this._view?.webview.postMessage({ type: 'streamMessage', value: '\n*[Process exited with code ' + code + ']*' });
            }
            // ensure we might signal end of stream if needed, but current UI handles appends
        });

        process.on('error', (err) => {
            this._view?.webview.postMessage({ type: 'streamMessage', value: `\n*Error launching Gemini CLI: ${err.message}*` });
        });
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview.js'));

        // Use a nonce to only allow specific scripts to be run
        const nonce = getNonce();

        return `<!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' 'unsafe-eval'; img-src ${webview.cspSource} https: data:;">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Gemini Chat</title>
      </head>
      <body>
        <div id="root"></div>
        <script nonce="${nonce}">
            window.onerror = function(message, source, lineno, colno, error) {
                const root = document.getElementById('root');
                root.innerHTML += '<div style="color: red; padding: 10px; border: 1px solid red; margin: 10px;">' +
                    '<h3>Webview Error</h3>' +
                    '<pre>' + message + '\n' + source + ':' + lineno + '</pre>' +
                    '</div>';
            };
            console.log('Webview script loaded');
        </script>
        <script nonce="${nonce}" src="${scriptUri}"></script>
      </body>
      </html>`;
    }
}

function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

import * as vscode from 'vscode';
import { GeminiPanel } from './GeminiPanel';

export function activate(context: vscode.ExtensionContext) {
    const provider = new GeminiPanel(context.extensionUri);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(GeminiPanel.viewType, provider)
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('geminiChat.open', () => {
            vscode.commands.executeCommand('workbench.view.extension.gemini-chat-sidebar');
        })
    );
}

export function deactivate() { }

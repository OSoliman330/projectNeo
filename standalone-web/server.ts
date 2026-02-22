import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import { createServer } from 'http';
import * as path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { GeminiService } = require('../src/extension/GeminiService.ts');

const app = express();
app.use(cors());
app.use(express.json());

const server = createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3001;

// Define a simple HostEnvironment for Node.js
const env = {
    log: (msg: string) => {
        const ts = new Date().toISOString().slice(11, 23);
        console.log(`[${ts}] ${msg}`);
    },
    showLog: () => {
        console.log('--- SHOW LOG REQUESTED ---');
    },
    getWorkspacePath: () => {
        return path.resolve(process.cwd(), '..');
    }
};

wss.on('connection', (ws: WebSocket) => {
    env.log('Client connected to WebSocket');

    // Default to the parent folder of standalone-web (the extension root)
    let currentWorkspacePath = path.resolve(process.cwd(), '..');

    const dynamicEnv = {
        ...env,
        getWorkspacePath: () => currentWorkspacePath
    };

    const geminiService = new GeminiService({ cliPath: '', env: dynamicEnv });

    const sendToClient = (type: string, value?: any) => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type, value }));
        }
    };

    geminiService.on('data', (chunk: string) => {
        sendToClient('streamMessage', chunk);
    });

    geminiService.on('responseComplete', () => {
        sendToClient('responseComplete');
    });

    geminiService.on('activity', (text: string) => {
        sendToClient('activityStep', text);
    });

    geminiService.on('thought', (text: string) => {
        sendToClient('thought', text);
    });

    geminiService.on('status', (status: string) => {
        sendToClient('statusUpdate', status);
    });

    geminiService.on('error', (message: string) => {
        sendToClient('streamMessage', `\n⚠️ *${message}*\n`);
        sendToClient('responseComplete');
    });

    geminiService.on('requestAuthorization', (data: any) => {
        geminiService.authorize('session', data.toolName); // auto-authorize for simplicity
    });

    geminiService.start().catch((err) => {
        env.log(`Error starting GeminiService: ${err.message}`);
    });

    if (geminiService.isReady) {
        sendToClient('statusUpdate', 'connected');
    }

    ws.on('message', async (message: string) => {
        try {
            const data = JSON.parse(message);
            switch (data.type) {
                case 'sendMessage':
                    const { prompt, attachments } = data.value;
                    let fullPrompt = prompt;
                    if (attachments && attachments.length > 0) {
                        const attachmentList = attachments.map((a: any) => a.path).join(', ');
                        fullPrompt = `[Attached: ${attachmentList}] ${prompt}`;
                    }
                    await geminiService.send(fullPrompt);
                    break;
                case 'stop':
                    geminiService.stop();
                    break;
                case 'clear':
                case 'restart':
                    geminiService.restart();
                    sendToClient('systemMessage', '🔄 Context cleared / process restarted.');
                    break;
                case 'setConfig':
                    if (data.value && data.value.workspace) {
                        currentWorkspacePath = data.value.workspace;
                        env.log(`Workspace path updated to: ${currentWorkspacePath}`);
                        geminiService.restart();
                        sendToClient('systemMessage', `⚙️ Workspace context updated to: ${currentWorkspacePath}. Process restarted.`);
                    }
                    break;
                case 'showOpenDialog':
                    try {
                        const { exec } = require('child_process');
                        if (process.platform === 'win32') {
                            // Fast PowerShell-based folder picker for Windows
                            const psCommand = `Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.FolderBrowserDialog; $f.Description = 'Select Workspace Folder'; $f.ShowNewFolderButton = $true; if($f.ShowDialog() -eq 'OK'){$f.SelectedPath}`;
                            exec(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${psCommand}"`, (error: any, stdout: string) => {
                                if (!error && stdout) {
                                    const selectedPath = stdout.trim();
                                    if (selectedPath) {
                                        sendToClient('openDialogResult', selectedPath);
                                    }
                                } else if (error) {
                                    env.log(`PowerShell Dialog error: ${error.message}`);
                                }
                            });
                        } else {
                            // Fallback to Python for macOS/Linux if needed
                            const pythonScript = `import tkinter as tk; from tkinter import filedialog; root = tk.Tk(); root.withdraw(); path = filedialog.askdirectory(); print(path)`;
                            exec(`python -c "${pythonScript}"`, (error: any, stdout: string) => {
                                if (!error && stdout) {
                                    const selectedPath = stdout.trim();
                                    if (selectedPath) {
                                        sendToClient('openDialogResult', selectedPath);
                                    }
                                }
                            });
                        }
                    } catch (err: any) {
                        env.log(`Dialog initialization error: ${err.message || err}`);
                    }
                    break;
            }
        } catch (e) {
            env.log(`Error handling message: ${e}`);
        }
    });

    ws.on('close', () => {
        env.log('Client disconnected from WebSocket');
        geminiService.dispose();
    });
});

server.listen(PORT, () => {
    console.log(`Standalone Express server running on port ${PORT}`);
    console.log(`WebSocket server listening on ws://localhost:${PORT}`);
});

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

    const geminiService = new GeminiService({ cliPath: '', env });

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

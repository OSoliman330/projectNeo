class WebSocketAPI {
    private ws: WebSocket | null = null;
    private messageQueue: any[] = [];
    private reconnectTimer: any = null;
    public onMessage: ((event: MessageEvent) => void) | null = null;

    constructor() {
        this.connect();
    }

    private connect() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        this.ws = new WebSocket(`${protocol}//${window.location.hostname}:3001`);

        this.ws.onopen = () => {
            console.log('WebSocket connected');
            while (this.messageQueue.length > 0) {
                const msg = this.messageQueue.shift();
                this.ws?.send(JSON.stringify(msg));
            }
        };

        this.ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (this.onMessage) {
                    this.onMessage(new MessageEvent('message', { data }));
                } else {
                    window.dispatchEvent(new MessageEvent('message', { data }));
                }
            } catch (e) {
                console.error('Failed to parse WS message', e);
            }
        };

        this.ws.onclose = () => {
            console.log('WebSocket disconnected, attempting to reconnect...');
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = setTimeout(() => this.connect(), 2000);
            window.dispatchEvent(new MessageEvent('message', {
                data: { type: 'statusUpdate', value: 'offline' }
            }));
        };

        this.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
        };
    }

    postMessage(message: any) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(message));
        } else {
            this.messageQueue.push(message);
        }
    }
}

export const vscode = new WebSocketAPI();

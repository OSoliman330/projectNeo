declare global {
    function acquireVsCodeApi(): {
        postMessage(message: unknown): void;
        getState(): unknown;
        setState(newState: unknown): void;
    };
}

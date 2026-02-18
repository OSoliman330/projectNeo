declare function acquireVsCodeApi(): any;

export interface WebviewApi<StateType> {
    postMessage(message: unknown): void;
    getState(): StateType | undefined;
    setState(newState: StateType): void;
}

// Singleton to avoid calling acquireVsCodeApi multiple times
class VSCodeWrapper {
    private static _vscode: WebviewApi<unknown> | undefined;

    public static get vscode(): WebviewApi<unknown> {
        if (!this._vscode) {
            if (typeof acquireVsCodeApi === 'function') {
                this._vscode = acquireVsCodeApi();
            } else {
                // Fallback for development in browser (if needed)
                console.warn('acquireVsCodeApi is not defined');
                this._vscode = {
                    postMessage: (msg: any) => console.log('Mock postMessage:', msg),
                    getState: () => ({}),
                    setState: () => { }
                };
            }
        }
        return this._vscode!;
    }
}

export const vscode = VSCodeWrapper.vscode;

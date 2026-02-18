/**
 * Persistent Gemini Wrapper
 *
 * Mirrors nonInteractiveCli.js but runs in a persistent loop.
 * Redirect ALL console output to stderr BEFORE any imports.
 */

// JSON output helpers — ONLY these write to stdout
const jsonOut = (str) => process.stdout.write(str);
const jsonLine = (obj) => process.stdout.write(JSON.stringify(obj) + '\n');

// Redirect ALL console methods to stderr so CLI internals don't pollute stdout
console.log = (...args) => process.stderr.write(args.join(' ') + '\n');
console.warn = (...args) => process.stderr.write('[WARN] ' + args.join(' ') + '\n');
console.info = (...args) => process.stderr.write('[INFO] ' + args.join(' ') + '\n');
console.debug = (...args) => process.stderr.write('[DEBUG] ' + args.join(' ') + '\n');
console.error = (...args) => process.stderr.write('[ERROR] ' + args.join(' ') + '\n');

import { createRequire } from 'module';
import * as readline from 'node:readline';
import path from 'path';

const CLI_SRC_PATH = 'C:/Users/OmarS/AppData/Roaming/npm/node_modules/@google/gemini-cli/dist/src';
const cliRequire = createRequire(path.join(CLI_SRC_PATH, 'index.js'));

const importCli = async (relativePath) => {
    return import(`file://${CLI_SRC_PATH}/${relativePath}`);
}

async function main() {
    try {
        const corePath = cliRequire.resolve('@google/gemini-cli-core');

        const { loadSettings } = await importCli('config/settings.js');
        const { loadCliConfig } = await importCli('config/config.js');
        const {
            GeminiEventType,
            StreamJsonFormatter,
            JsonStreamEventType,
            uiTelemetryService,
            Scheduler,
            ROOT_SCHEDULER_ID,
            promptIdContext,
            coreEvents,
            CoreEvent,
            recordToolCallInteractions,
            debugLogger,
        } = await import(`file://${corePath}`);

        const settings = loadSettings();
        const argv = { warning: false, debug: false };
        let sessionId = 'lite-agent-session-' + Date.now();
        const projectHooks = settings.workspace?.settings?.hooks || {};

        let config = await loadCliConfig(settings.merged, sessionId, argv, { projectHooks });
        await config.initialize();
        let geminiClient = config.getGeminiClient();

        // StreamJsonFormatter writes to stdout by default
        let streamFormatter = new StreamJsonFormatter();

        // Signal ready
        jsonLine({ type: "init", status: "ready", model: config.getModel() });

        const rl = readline.createInterface({
            input: process.stdin,
            terminal: false
        });

        let processing = false;

        rl.on('line', async (line) => {
            if (!line.trim()) return;

            let msg;
            try {
                msg = JSON.parse(line);
            } catch {
                // Incomplete JSON, ignore
                return;
            }

            if (msg.type === 'clear') {
                sessionId = 'lite-agent-session-' + Date.now();
                config = await loadCliConfig(settings.merged, sessionId, argv, { projectHooks });
                await config.initialize();
                geminiClient = config.getGeminiClient();
                streamFormatter = new StreamJsonFormatter();
                jsonLine({ type: "init", status: "ready", model: config.getModel() });
                return;
            }

            if (msg.type === 'message' && !processing) {
                processing = true;
                const prompt = msg.content;
                const promptId = 'p-' + Math.random().toString(16).slice(2);
                const startTime = Date.now();

                try {
                    await promptIdContext.run(promptId, async () => {
                        const abortController = new AbortController();

                        // Setup scheduler for tool calls (mirrors nonInteractiveCli.js)
                        const scheduler = new Scheduler({
                            config,
                            messageBus: config.getMessageBus(),
                            getPreferredEditor: () => undefined,
                            schedulerId: ROOT_SCHEDULER_ID,
                        });

                        // Emit user message
                        streamFormatter.emitEvent({
                            type: JsonStreamEventType.MESSAGE,
                            timestamp: new Date().toISOString(),
                            role: 'user',
                            content: prompt
                        });

                        // The turn loop — handles tool calls just like nonInteractiveCli.js
                        let currentMessages = [{ role: 'user', parts: [{ text: prompt }] }];
                        let turnCount = 0;

                        while (true) {
                            turnCount++;

                            // Safety: max 20 turns
                            if (turnCount > 20) {
                                streamFormatter.emitEvent({
                                    type: JsonStreamEventType.ERROR,
                                    timestamp: new Date().toISOString(),
                                    message: 'Maximum turns exceeded',
                                });
                                break;
                            }

                            const toolCallRequests = [];
                            const responseStream = geminiClient.sendMessageStream(
                                currentMessages[0]?.parts || [],
                                abortController.signal,
                                promptId,
                                undefined,
                                false,
                                turnCount === 1 ? prompt : undefined
                            );

                            for await (const event of responseStream) {
                                if (event.type === GeminiEventType.Content) {
                                    streamFormatter.emitEvent({
                                        type: JsonStreamEventType.MESSAGE,
                                        timestamp: new Date().toISOString(),
                                        role: 'assistant',
                                        content: event.value,
                                        delta: true,
                                    });
                                }
                                else if (event.type === GeminiEventType.ToolCallRequest) {
                                    streamFormatter.emitEvent({
                                        type: JsonStreamEventType.TOOL_USE,
                                        timestamp: new Date().toISOString(),
                                        tool_name: event.value.name,
                                        tool_id: event.value.callId,
                                        parameters: event.value.args,
                                    });
                                    toolCallRequests.push(event.value);
                                }
                                else if (event.type === GeminiEventType.Error) {
                                    throw event.value.error;
                                }
                                else if (event.type === GeminiEventType.AgentExecutionStopped) {
                                    // Agent decided to stop
                                    break;
                                }
                            }

                            if (toolCallRequests.length > 0) {
                                // Execute tool calls via Scheduler
                                const completedToolCalls = await scheduler.schedule(
                                    toolCallRequests,
                                    abortController.signal
                                );

                                const toolResponseParts = [];
                                for (const completedToolCall of completedToolCalls) {
                                    const toolResponse = completedToolCall.response;
                                    const requestInfo = completedToolCall.request;

                                    streamFormatter.emitEvent({
                                        type: JsonStreamEventType.TOOL_RESULT,
                                        timestamp: new Date().toISOString(),
                                        tool_id: requestInfo.callId,
                                        status: completedToolCall.status === 'error' ? 'error' : 'success',
                                        output: typeof toolResponse.resultDisplay === 'string'
                                            ? toolResponse.resultDisplay
                                            : undefined,
                                    });

                                    if (toolResponse.responseParts) {
                                        toolResponseParts.push(...toolResponse.responseParts);
                                    }
                                }

                                // Record tool calls
                                try {
                                    const currentModel = geminiClient.getCurrentSequenceModel() ?? config.getModel();
                                    geminiClient.getChat().recordCompletedToolCalls(currentModel, completedToolCalls);
                                    await recordToolCallInteractions(config, completedToolCalls);
                                } catch (error) {
                                    // Non-fatal
                                }

                                // Feed tool results back for next turn
                                currentMessages = [{ role: 'user', parts: toolResponseParts }];
                            } else {
                                // No tool calls — response is complete
                                break;
                            }
                        }

                        // Emit result
                        const durationMs = Date.now() - startTime;
                        const metrics = uiTelemetryService.getMetrics();
                        streamFormatter.emitEvent({
                            type: JsonStreamEventType.RESULT,
                            timestamp: new Date().toISOString(),
                            status: 'success',
                            stats: streamFormatter.convertToStreamStats
                                ? streamFormatter.convertToStreamStats(metrics, durationMs)
                                : { duration_ms: durationMs },
                        });
                    });
                } catch (err) {
                    jsonLine({ type: 'error', message: err.message || String(err) });
                } finally {
                    processing = false;
                }
            }
        });

    } catch (err) {
        process.stderr.write(`[FATAL] ${err.message}\n${err.stack}\n`);
        jsonLine({ type: 'fatal_error', message: err.message });
        process.exit(1);
    }
}

main();

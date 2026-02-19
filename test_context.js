
const { GeminiClient } = require('@google/gemini-cli-core/dist/src/core/client.js');
const { makeFakeConfig } = require('@google/gemini-cli-core/dist/src/test-utils/config.js');

async function testContext() {
    console.log('Starting context test...');
    try {
        const config = await makeFakeConfig();
        const client = new GeminiClient(config);

        // Mock getChat to expose history
        client.startChat = async () => {
            const chat = {
                getHistory: () => { return this.history || []; },
                addHistory: (item) => { this.history = this.history || []; this.history.push(item); },
                sendMessageStream: async function* (modelKey, message, promptId, signal) {
                    console.log(`sendMessageStream called with: ${JSON.stringify(message)}`);
                    yield { type: 'content', value: 'Response to ' + JSON.stringify(message) };
                }
            };
            return chat;
        };

        await client.resetChat();

        console.log('Initial history:', client.getHistory().length);

        // Simulate turn 1
        const prompt1 = 'Hi, my name is Neo.';
        console.log(`Sending: ${prompt1}`);
        // In GeminiService:
        // const responseStream = this._geminiClient.sendMessageStream([{ text: prompt1 }], ...);
        // We simulate this call
        const stream1 = client.sendMessageStream([{ text: prompt1 }], new AbortController().signal, 'id-1');
        for await (const event of stream1) {
            console.log('Event:', event);
        }

        console.log('History after turn 1:', client.getHistory().length);

        // Simulate turn 2
        const prompt2 = 'What is my name?';
        console.log(`Sending: ${prompt2}`);
        const stream2 = client.sendMessageStream([{ text: prompt2 }], new AbortController().signal, 'id-2');
        for await (const event of stream2) {
            console.log('Event:', event);
        }

        console.log('History after turn 2:', client.getHistory().length);

    } catch (e) {
        console.error(e);
    }
}

testContext();

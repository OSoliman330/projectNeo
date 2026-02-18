import React, { useState, useEffect, useRef } from 'react';
import { Send, Bot, User, Loader2, Paperclip, File, Folder, X, Zap, ChevronDown, ChevronRight, Activity } from 'lucide-react';
import { vscode } from './vscode-api';
import { marked } from 'marked';

interface Attachment {
    path: string;
    type: 'file' | 'folder';
    name: string;
}

interface Message {
    id: string;
    role: 'user' | 'model' | 'system';
    content: string;
    attachments?: Attachment[];
}

const SLASH_COMMANDS = ['/clear', '/restart', '/status', '/help'];

const App: React.FC = () => {
    const [input, setInput] = useState('');
    const [messages, setMessages] = useState<Message[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [attachments, setAttachments] = useState<Attachment[]>([]);
    const [connectionStatus, setConnectionStatus] = useState<string>('connecting');
    const [activitySteps, setActivitySteps] = useState<string[]>([]);
    const [showActivity, setShowActivity] = useState(true);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const message = event.data;
            switch (message.type) {
                case 'addMessage':
                    setMessages(prev => [...prev, { id: Date.now().toString(), role: 'model', content: message.value }]);
                    setIsLoading(false);
                    break;

                case 'streamMessage':
                    setMessages(prev => {
                        const last = prev[prev.length - 1];
                        if (last && last.role === 'model') {
                            return [...prev.slice(0, -1), { ...last, content: last.content + message.value }];
                        } else {
                            return [...prev, { id: Date.now().toString(), role: 'model', content: message.value }];
                        }
                    });
                    setIsLoading(false);
                    break;

                case 'responseComplete':
                    setIsLoading(false);
                    break;

                case 'systemMessage':
                    setMessages(prev => [...prev, { id: Date.now().toString(), role: 'system', content: message.value }]);
                    setIsLoading(false);
                    break;

                case 'clearChat':
                    setMessages([]);
                    setActivitySteps([]);
                    setIsLoading(false);
                    break;

                case 'statusUpdate':
                    setConnectionStatus(message.value);
                    break;

                case 'activityStep':
                    setActivitySteps(prev => [...prev, message.value]);
                    break;

                case 'fileSelected':
                    setAttachments(prev => {
                        if (prev.find(a => a.path === message.value.path)) return prev;
                        return [...prev, message.value];
                    });
                    break;
            }
        };

        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, []);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const handleSend = () => {
        const trimmed = input.trim();
        if (!trimmed && attachments.length === 0) return;

        // Check for slash commands
        if (trimmed.startsWith('/')) {
            const parts = trimmed.split(' ');
            const command = parts[0].slice(1); // remove the /
            const args = parts.slice(1).join(' ');

            // Show the command in chat
            setMessages(prev => [...prev, { id: Date.now().toString(), role: 'user', content: trimmed }]);
            vscode.postMessage({ type: 'slashCommand', command, args });
            setInput('');
            return;
        }

        // Clear activity steps for new message
        setActivitySteps([]);

        const userMessage: Message = {
            id: Date.now().toString(),
            role: 'user',
            content: input,
            attachments: attachments.length > 0 ? [...attachments] : undefined,
        };
        setMessages(prev => [...prev, userMessage]);
        vscode.postMessage({
            type: 'sendMessage',
            value: input,
            attachments: attachments.map(a => ({ path: a.path, type: a.type })),
        });
        setInput('');
        setAttachments([]);
        setIsLoading(true);
    };

    const handleAttachFile = () => {
        vscode.postMessage({ type: 'attachFile' });
    };

    const handleAttachFolder = () => {
        vscode.postMessage({ type: 'attachFolder' });
    };

    const removeAttachment = (path: string) => {
        setAttachments(prev => prev.filter(a => a.path !== path));
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const statusDot = connectionStatus === 'connected'
        ? 'bg-emerald-400 shadow-emerald-400/50'
        : connectionStatus === 'connecting'
            ? 'bg-amber-400 shadow-amber-400/50 animate-pulse'
            : 'bg-red-400 shadow-red-400/50';

    const statusText = connectionStatus === 'connected'
        ? 'Connected'
        : connectionStatus === 'connecting'
            ? 'Connecting...'
            : 'Disconnected';

    return (
        <div className="flex flex-col h-screen bg-[#0d1117] text-gray-100 font-sans overflow-hidden">
            {/* Header */}
            <header className="px-6 py-4 bg-[#161b22] border-b border-[#30363d] flex items-center gap-3 shadow-lg z-10">
                <div className="p-2 bg-gradient-to-br from-blue-500/20 to-purple-500/20 rounded-lg border border-blue-500/20">
                    <Zap className="w-5 h-5 text-blue-400" />
                </div>
                <div className="flex-1">
                    <h1 className="font-bold text-lg tracking-tight bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">Lite Agent</h1>
                    <div className="flex items-center gap-1.5">
                        <div className={`w-1.5 h-1.5 rounded-full shadow-sm ${statusDot}`}></div>
                        <span className="text-[10px] text-gray-400 uppercase tracking-wider font-medium">{statusText}</span>
                    </div>
                </div>
            </header>

            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-6 scroll-smooth custom-scrollbar">
                {messages.length === 0 && (
                    <div className="h-full flex flex-col items-center justify-center text-gray-500 opacity-50 select-none">
                        <Zap size={48} className="mb-4 text-gray-600" />
                        <p className="text-sm">Start a conversation with Lite Agent</p>
                        <p className="text-xs mt-2 text-gray-600">Type /help for available commands</p>
                    </div>
                )}

                {messages.map((msg) => {
                    // System messages
                    if (msg.role === 'system') {
                        return (
                            <div key={msg.id} className="flex justify-center">
                                <div className="max-w-[90%] px-4 py-2.5 rounded-xl bg-[#1c2333] border border-[#30363d] text-xs text-gray-400 text-center">
                                    <div dangerouslySetInnerHTML={{ __html: marked.parse(msg.content) }} className="markdown-body system-msg" />
                                </div>
                            </div>
                        );
                    }

                    return (
                        <div
                            key={msg.id}
                            className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}
                        >
                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 shadow-md ${msg.role === 'user'
                                ? 'bg-blue-600 shadow-blue-900/20'
                                : 'bg-gradient-to-br from-emerald-500 to-teal-600 shadow-emerald-900/20'
                                }`}>
                                {msg.role === 'user' ? <User size={16} className="text-white" /> : <Zap size={16} className="text-white" />}
                            </div>

                            <div
                                className={`max-w-[85%] p-3.5 rounded-2xl shadow-md text-sm leading-7 ${msg.role === 'user'
                                    ? 'bg-blue-600 text-white rounded-tr-md'
                                    : 'bg-[#161b22] text-gray-300 border border-[#30363d] rounded-tl-md'
                                    }`}
                            >
                                {msg.attachments && msg.attachments.length > 0 && (
                                    <div className="flex flex-wrap gap-1.5 mb-2">
                                        {msg.attachments.map((att, i) => (
                                            <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white/10 text-[11px] font-medium border border-white/10">
                                                {att.type === 'file' ? <File size={10} /> : <Folder size={10} />}
                                                {att.name}
                                            </span>
                                        ))}
                                    </div>
                                )}
                                {msg.role === 'model' ? (
                                    <div dangerouslySetInnerHTML={{ __html: marked.parse(msg.content) }} className="markdown-body" />
                                ) : (
                                    <div className="whitespace-pre-wrap font-medium">{msg.content}</div>
                                )}
                            </div>
                        </div>
                    );
                })}

                {isLoading && (
                    <div className="flex gap-3">
                        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500/50 to-teal-600/50 flex items-center justify-center shrink-0">
                            <Zap size={16} className="text-white/50" />
                        </div>
                        <div className="bg-[#161b22] border border-[#30363d] px-4 py-3 rounded-2xl rounded-tl-md flex items-center gap-2">
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />
                            <span className="text-xs text-gray-400">Thinking...</span>
                        </div>
                    </div>
                )}

                {/* Activity Steps */}
                {activitySteps.length > 0 && (
                    <div className="ml-11">
                        <button
                            onClick={() => setShowActivity(!showActivity)}
                            className="flex items-center gap-1.5 text-[11px] text-gray-500 hover:text-gray-300 transition-colors mb-1.5"
                        >
                            {showActivity ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                            <Activity size={12} />
                            <span>{activitySteps.length} step{activitySteps.length !== 1 ? 's' : ''}</span>
                        </button>
                        {showActivity && (
                            <div className="border-l-2 border-[#30363d] pl-3 space-y-1">
                                {activitySteps.map((step, i) => (
                                    <div key={i} className="text-[11px] text-gray-500 font-mono leading-5 flex items-start gap-2">
                                        <span className="text-gray-600 select-none shrink-0">{i + 1}.</span>
                                        <span className="break-all">{step}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <div className="p-4 bg-[#0d1117] border-t border-[#30363d]">
                {/* Attachment Chips */}
                {attachments.length > 0 && (
                    <div className="max-w-4xl mx-auto mb-2 flex flex-wrap gap-2">
                        {attachments.map((att) => (
                            <span
                                key={att.path}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#161b22] border border-[#30363d] text-xs text-gray-300 font-medium group/chip hover:border-blue-500/50 transition-colors"
                            >
                                {att.type === 'file' ? <File size={12} className="text-blue-400" /> : <Folder size={12} className="text-amber-400" />}
                                <span className="max-w-[150px] truncate">{att.name}</span>
                                <button
                                    onClick={() => removeAttachment(att.path)}
                                    className="ml-1 p-0.5 rounded hover:bg-red-500/20 text-gray-500 hover:text-red-400 transition-colors"
                                >
                                    <X size={12} />
                                </button>
                            </span>
                        ))}
                    </div>
                )}

                <div className="max-w-4xl mx-auto relative group">
                    <div className="absolute -inset-0.5 bg-gradient-to-r from-blue-500 to-purple-600 rounded-2xl blur opacity-20 group-hover:opacity-40 transition duration-500"></div>
                    <div className="relative flex items-end bg-[#161b22] rounded-xl border border-[#30363d] shadow-2xl overflow-hidden focus-within:border-blue-500/50 transition-colors">
                        {/* Attach Buttons */}
                        <div className="flex flex-col gap-1 p-2">
                            <button
                                onClick={handleAttachFile}
                                title="Attach file"
                                className="p-2 rounded-lg text-gray-400 hover:text-blue-400 hover:bg-blue-500/10 transition-colors"
                            >
                                <Paperclip size={16} />
                            </button>
                            <button
                                onClick={handleAttachFolder}
                                title="Attach folder"
                                className="p-2 rounded-lg text-gray-400 hover:text-amber-400 hover:bg-amber-500/10 transition-colors"
                            >
                                <Folder size={16} />
                            </button>
                        </div>

                        <textarea
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder="Type a message or /help..."
                            className="w-full bg-transparent text-gray-200 p-4 pl-0 min-h-[60px] max-h-[200px] outline-none resize-none placeholder-gray-500 font-medium"
                            rows={1}
                            style={{ height: 'auto' }}
                        />
                        <button
                            onClick={handleSend}
                            disabled={(!input.trim() && attachments.length === 0) || isLoading}
                            className="m-2 p-3 bg-blue-600 hover:bg-blue-500 text-white rounded-lg disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-200 hover:shadow-lg hover:shadow-blue-500/20 active:scale-95"
                        >
                            <Send size={18} />
                        </button>
                    </div>
                </div>
                <div className="text-[10px] text-center text-gray-600 mt-3 font-medium tracking-wide">
                    POWERED BY CLI
                </div>
            </div>
        </div>
    );
};

// Markdown styles
const markdownStyles = `
.markdown-body { font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }
.markdown-body p { margin-bottom: 0.75em; }
.markdown-body pre { background: #0d1117; padding: 1em; border-radius: 0.5rem; overflow-x: auto; border: 1px solid #30363d; margin: 1em 0; }
.markdown-body code { background: rgba(110, 118, 129, 0.4); padding: 0.2em 0.4em; border-radius: 0.25rem; font-size: 0.85em; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }
.markdown-body pre code { background: transparent; padding: 0; color: #e6edf3; font-size: 0.9em; }
.markdown-body ul { list-style-type: disc; padding-left: 1.5em; margin-bottom: 0.75em; }
.markdown-body ol { list-style-type: decimal; padding-left: 1.5em; margin-bottom: 0.75em; }
.markdown-body h1 { font-size: 1.5em; font-weight: bold; margin-top: 1.5em; margin-bottom: 0.75em; border-bottom: 1px solid #30363d; padding-bottom: 0.3em; }
.markdown-body h2 { font-size: 1.3em; font-weight: bold; margin-top: 1.5em; margin-bottom: 0.75em; border-bottom: 1px solid #30363d; padding-bottom: 0.3em; }
.markdown-body h3 { font-size: 1.1em; font-weight: bold; margin-top: 1.5em; margin-bottom: 0.75em; }
.markdown-body a { color: #58a6ff; text-decoration: none; }
.markdown-body a:hover { text-decoration: underline; }
.markdown-body blockquote { border-left: 4px solid #30363d; padding-left: 1em; color: #8b949e; margin: 1em 0; }
.markdown-body table { border-collapse: collapse; width: 100%; margin: 1em 0; }
.markdown-body th, .markdown-body td { border: 1px solid #30363d; padding: 0.5em; }
.markdown-body th { background: #161b22; }
.system-msg .markdown-body p { margin-bottom: 0.25em; }
.system-msg code { font-size: 0.9em; }
`;

export default App;

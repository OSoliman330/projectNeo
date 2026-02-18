import React, { useState, useEffect, useRef } from 'react';
import { Send, Bot, User, Loader2, Paperclip, File, Folder, X } from 'lucide-react';
import { vscode } from './vscode-api';
import { marked } from 'marked';

interface Attachment {
    path: string;
    type: 'file' | 'folder';
    name: string;
}

interface Message {
    id: string;
    role: 'user' | 'model';
    content: string;
    attachments?: Attachment[];
}

const App: React.FC = () => {
    const [input, setInput] = useState('');
    const [messages, setMessages] = useState<Message[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [attachments, setAttachments] = useState<Attachment[]>([]);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        // Listen for messages from the extension
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
        if (!input.trim() && attachments.length === 0) return;

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

    return (
        <div className="flex flex-col h-screen bg-[#0d1117] text-gray-100 font-sans overflow-hidden">
            {/* Header */}
            <header className="px-6 py-4 bg-[#161b22] border-b border-[#30363d] flex items-center gap-3 shadow-lg z-10">
                <div className="p-2 bg-blue-500/10 rounded-lg">
                    <Bot className="w-6 h-6 text-blue-400" />
                </div>
                <div>
                    <h1 className="font-bold text-lg tracking-tight bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">Gemini Chat</h1>
                    <div className="text-[10px] text-gray-400 uppercase tracking-wider font-medium">Always Active</div>
                </div>
            </header>

            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-6 scroll-smooth custom-scrollbar">
                {messages.length === 0 && (
                    <div className="h-full flex flex-col items-center justify-center text-gray-500 opacity-50 select-none">
                        <Bot size={48} className="mb-4 text-gray-600" />
                        <p>Start a conversation with Gemini</p>
                    </div>
                )}

                {messages.map((msg) => (
                    <div
                        key={msg.id}
                        className={`flex gap-4 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'} animate-in fade-in slide-in-from-bottom-2 duration-300`}
                    >
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 shadow-lg ${msg.role === 'user'
                            ? 'bg-blue-600 shadow-blue-900/20'
                            : 'bg-gradient-to-br from-emerald-500 to-teal-600 shadow-emerald-900/20'
                            }`}>
                            {msg.role === 'user' ? <User size={20} className="text-white" /> : <Bot size={20} className="text-white" />}
                        </div>

                        <div
                            className={`max-w-[85%] p-4 rounded-2xl shadow-md text-sm leading-7 ${msg.role === 'user'
                                ? 'bg-blue-600 text-white rounded-tr-md'
                                : 'bg-[#161b22] text-gray-300 border border-[#30363d] rounded-tl-md'
                                }`}
                        >
                            {msg.attachments && msg.attachments.length > 0 && (
                                <div className="flex flex-wrap gap-2 mb-2">
                                    {msg.attachments.map((att, i) => (
                                        <span key={i} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/10 text-xs font-medium border border-white/10">
                                            {att.type === 'file' ? <File size={12} /> : <Folder size={12} />}
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
                ))}

                {isLoading && (
                    <div className="flex gap-4 animate-pulse">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500/50 to-teal-600/50 flex items-center justify-center shrink-0">
                            <Bot size={20} className="text-white/50" />
                        </div>
                        <div className="bg-[#161b22] border border-[#30363d] p-4 rounded-2xl rounded-tl-md flex items-center gap-2">
                            <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
                            <span className="text-xs text-gray-400">Thinking...</span>
                        </div>
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
                            placeholder="Type a message..."
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
                    POWERED BY GEMINI CLI
                </div>
            </div>
        </div>
    );
};

// Add basic markdown styles if not present in tailwind reset
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
`;

export default App;

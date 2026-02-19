
import React, { useState, useEffect, useRef } from 'react';
import { Send, Bot, User, Loader2, Paperclip, File, Folder, X, Zap, ChevronDown, ChevronRight, Activity, Terminal, RefreshCw, Server, Cpu, FileText, HelpCircle, StopCircle, Octagon, Check, ShieldCheck, ShieldAlert, Ban } from 'lucide-react';
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

interface AuthorizationRequest {
    toolName: string;
    args: any;
}

const COMMANDS = [
    { name: '/clear', description: 'Clear chat history', icon: Terminal },
    { name: '/restart', description: 'Restart agent process', icon: RefreshCw },
    { name: '/status', description: 'Connection status', icon: Activity },
    { name: '/mcp', description: 'List MCP servers', icon: Server },
    { name: '/tools', description: 'List tools', icon: Cpu },
    { name: '/log', description: 'View logs', icon: FileText },
    { name: '/help', description: 'Show help', icon: HelpCircle },
    { name: '/debug', description: 'Debug chat history', icon: Zap },
    { name: '/agents', description: 'List available agents', icon: Bot },
    { name: '/skills', description: 'List available skills', icon: FileText },
];

const App: React.FC = () => {
    const [input, setInput] = useState('');
    const [messages, setMessages] = useState<Message[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [attachments, setAttachments] = useState<Attachment[]>([]);
    const [connectionStatus, setConnectionStatus] = useState<string>('connecting');
    const [activitySteps, setActivitySteps] = useState<string[]>([]);
    const [showActivity, setShowActivity] = useState(true);
    const [authRequest, setAuthRequest] = useState<AuthorizationRequest | null>(null);

    // Slash command menu state
    const [showCommandMenu, setShowCommandMenu] = useState(false);
    const [filteredCommands, setFilteredCommands] = useState(COMMANDS);
    const [selectedIndex, setSelectedIndex] = useState(0);

    const messagesEndRef = useRef<HTMLDivElement>(null);
    // Ref for the selected command item to scroll into view
    const selectedCommandRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        // Notify extension that webview is ready to receive status
        vscode.postMessage({ type: 'webviewReady' });

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

                case 'requestAuthorization':
                    setActivitySteps(prev => [...prev, `Waiting for approval: ${message.value.toolName}`]);
                    setAuthRequest(message.value);
                    setIsLoading(true); // Ensure loading state is active while waiting
                    break;
            }
        };

        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, []);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, authRequest, activitySteps]);

    // Update command menu when input changes
    useEffect(() => {
        if (input.startsWith('/')) {
            const searchTerm = input.toLowerCase();
            const filtered = COMMANDS.filter(cmd =>
                cmd.name.toLowerCase().startsWith(searchTerm)
            );
            setFilteredCommands(filtered);
            setSelectedIndex(0);
            setShowCommandMenu(filtered.length > 0);
        } else {
            setShowCommandMenu(false);
        }
    }, [input]);

    // Scroll selected command into view when selection changes
    useEffect(() => {
        if (showCommandMenu && selectedCommandRef.current) {
            selectedCommandRef.current.scrollIntoView({
                block: 'nearest',
                behavior: 'smooth'
            });
        }
    }, [selectedIndex, showCommandMenu]);

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
            setShowCommandMenu(false);
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
        setShowCommandMenu(false);
    };

    const handleStop = () => {
        vscode.postMessage({ type: 'stop' });
        setIsLoading(false);
        setAuthRequest(null);
        setActivitySteps(prev => [...prev, '🛑 Execution stopped by user.']);
    };

    const handleAuthorization = (decision: 'once' | 'session' | 'deny') => {
        if (!authRequest) return;

        vscode.postMessage({
            type: 'authorizationResponse',
            decision,
            toolName: authRequest.toolName
        });

        setAuthRequest(null);
        if (decision === 'deny') {
            setActivitySteps(prev => [...prev, `🚫 Denied: ${authRequest.toolName}`]);
        } else {
            setActivitySteps(prev => [...prev, `✅ Approved: ${authRequest.toolName} (${decision === 'session' ? 'always' : 'once'})`]);
        }
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
        if (showCommandMenu) {
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSelectedIndex(prev => (prev > 0 ? prev - 1 : filteredCommands.length - 1));
                return;
            }
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSelectedIndex(prev => (prev < filteredCommands.length - 1 ? prev + 1 : 0));
                return;
            }
            if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                const selected = filteredCommands[selectedIndex];
                if (selected) {
                    setInput(selected.name + ' ');
                    setShowCommandMenu(false);
                }
                return;
            }
            if (e.key === 'Escape') {
                setShowCommandMenu(false);
                return;
            }
        }

        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const isConnected = connectionStatus === 'connected' || connectionStatus === 'ready';

    return (
        <div className="flex flex-col h-screen overflow-hidden" style={{ backgroundColor: 'var(--vscode-sideBar-background)', color: 'var(--vscode-foreground)' }}>

            {/* Header (Minimal) */}
            <header className="px-4 py-2 border-b flex items-center justify-between shadow-sm z-10" style={{ borderColor: 'var(--vscode-panel-border)', backgroundColor: 'var(--vscode-sideBar-background)' }}>
                <div className="flex items-center gap-2">
                    <span className="font-semibold text-xs tracking-wide opacity-80" style={{ color: 'var(--vscode-sideBarTitle-foreground)' }}>LITE AGENT</span>
                </div>
                <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full" style={{ backgroundColor: 'var(--vscode-badge-background)', color: 'var(--vscode-badge-foreground)' }}>
                    <div className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-white' : 'bg-red-500 animate-pulse'}`}></div>
                    <span className="text-[9px] font-bold uppercase tracking-wider opacity-90">
                        {isConnected ? 'Ready' : 'Offline'}
                    </span>
                </div>
            </header>

            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-6 scroll-smooth custom-scrollbar">
                {messages.length === 0 && (
                    <div className="h-full flex flex-col items-center justify-center select-none opacity-60">
                        <div className="p-3 rounded-full mb-3" style={{ backgroundColor: 'var(--vscode-button-secondaryBackground)', color: 'var(--vscode-button-secondaryForeground)' }}>
                            <Zap size={24} />
                        </div>
                        <p className="text-sm font-medium opacity-80">How can I help you code today?</p>
                        <div className="mt-4 flex gap-2">
                            <button
                                className="px-3 py-1.5 rounded text-xs border hover:opacity-80 transition-opacity"
                                style={{ borderColor: 'var(--vscode-button-border)', backgroundColor: 'var(--vscode-button-secondaryBackground)', color: 'var(--vscode-button-secondaryForeground)' }}
                                onClick={() => setInput('/help ')}
                            >
                                /help
                            </button>
                            <button
                                className="px-3 py-1.5 rounded text-xs border hover:opacity-80 transition-opacity"
                                style={{ borderColor: 'var(--vscode-button-border)', backgroundColor: 'var(--vscode-button-secondaryBackground)', color: 'var(--vscode-button-secondaryForeground)' }}
                                onClick={() => setInput('/tools ')}
                            >
                                /tools
                            </button>
                        </div>
                    </div>
                )}

                {messages.map((msg) => {
                    // System messages
                    if (msg.role === 'system') {
                        return (
                            <div key={msg.id} className="flex justify-center my-4">
                                <div className="px-3 py-1.5 rounded border text-xs" style={{ backgroundColor: 'var(--vscode-textBlockQuote-background)', borderColor: 'var(--vscode-textBlockQuote-border)', color: 'var(--vscode-foreground)' }}>
                                    <div dangerouslySetInnerHTML={{ __html: marked.parse(msg.content) }} className="markdown-body system-msg inline-block" />
                                </div>
                            </div>
                        );
                    }

                    const isUser = msg.role === 'user';

                    return (
                        <div key={msg.id} className={`flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'} group`}>
                            {/* Avatar */}
                            <div className={`w-6 h-6 rounded flex items-center justify-center shrink-0 mt-0.5`}
                                style={{ backgroundColor: isUser ? 'var(--vscode-button-background)' : 'var(--vscode-activityBar-foreground)', color: isUser ? 'var(--vscode-button-foreground)' : 'var(--vscode-activityBar-background)' }}>
                                {isUser ? <User size={14} /> : <Zap size={14} />}
                            </div>

                            {/* Message Content */}
                            <div className={`max-w-[85%] text-sm leading-relaxed ${isUser ? 'text-right' : 'text-left'}`}>
                                {msg.attachments && msg.attachments.length > 0 && (
                                    <div className={`flex flex-wrap gap-1.5 mb-2 ${isUser ? 'justify-end' : 'justify-start'}`}>
                                        {msg.attachments.map((att, i) => (
                                            <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] border"
                                                style={{ backgroundColor: 'var(--vscode-textCodeBlock-background)', borderColor: 'var(--vscode-widget-border)' }}>
                                                {att.type === 'file' ? <File size={10} /> : <Folder size={10} />}
                                                {att.name}
                                            </span>
                                        ))}
                                    </div>
                                )}

                                {isUser ? (
                                    <div className="inline-block px-3 py-2 rounded-lg text-left"
                                        style={{ backgroundColor: 'var(--vscode-button-secondaryBackground)', color: 'var(--vscode-button-secondaryForeground)' }}>
                                        <div className="whitespace-pre-wrap">{msg.content}</div>
                                    </div>
                                ) : (
                                    <div dangerouslySetInnerHTML={{ __html: marked.parse(msg.content) }} className="markdown-body" />
                                )}
                            </div>
                        </div>
                    );
                })}

                {isLoading && (
                    <div className="flex gap-3">
                        <div className="w-6 h-6 rounded flex items-center justify-center shrink-0"
                            style={{ backgroundColor: 'var(--vscode-activityBar-foreground)', color: 'var(--vscode-activityBar-background)' }}>
                            <Zap size={14} />
                        </div>
                        <div className="px-3 py-2 rounded text-xs flex items-center gap-2"
                            style={{ backgroundColor: 'var(--vscode-textBlockQuote-background)', color: 'var(--vscode-textBlockQuote-border)' }}>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            <span>Thinking...</span>
                        </div>
                        {/* Stop Button (only when loading) */}
                        <button
                            onClick={handleStop}
                            className="w-6 h-6 rounded flex items-center justify-center hover:bg-red-500/20 text-red-500 transition-colors"
                            title="Stop Execution"
                        >
                            <Octagon size={14} fill="currentColor" className="opacity-80" />
                        </button>
                    </div>
                )}

                {/* Authorization Card */}
                {authRequest && (
                    <div className="my-4 mx-auto max-w-sm rounded border shadow-lg animate-in fade-in slide-in-from-bottom-2 duration-300"
                        style={{ backgroundColor: 'var(--vscode-editor-background)', borderColor: 'var(--vscode-inputValidation-warningBorder)' }}>
                        <div className="px-3 py-2 border-b flex items-center gap-2"
                            style={{ backgroundColor: 'var(--vscode-inputValidation-warningBackground)', borderColor: 'var(--vscode-inputValidation-warningBorder)', color: 'var(--vscode-inputValidation-warningForeground)' }}>
                            <ShieldAlert size={14} />
                            <span className="font-bold text-xs uppercase tracking-wide">Permission Required</span>
                        </div>
                        <div className="p-3">
                            <p className="text-sm mb-2">Lite Agent wants to execute:</p>
                            <div className="p-2 mb-3 rounded border font-mono text-xs overflow-x-auto"
                                style={{ backgroundColor: 'var(--vscode-textCodeBlock-background)', borderColor: 'var(--vscode-widget-border)' }}>
                                <div className="font-bold text-blue-400 mb-1">{authRequest.toolName}</div>
                                <div className="opacity-70 break-all">{JSON.stringify(authRequest.args, null, 2)}</div>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                <button
                                    onClick={() => handleAuthorization('once')}
                                    className="px-3 py-1.5 rounded text-xs border font-medium hover:opacity-80 transition-all flex items-center justify-center gap-1.5"
                                    style={{ backgroundColor: 'var(--vscode-button-background)', color: 'var(--vscode-button-foreground)', borderColor: 'transparent' }}
                                >
                                    <Check size={12} />
                                    Allow Once
                                </button>
                                <button
                                    onClick={() => handleAuthorization('session')}
                                    className="px-3 py-1.5 rounded text-xs border font-medium hover:opacity-80 transition-all flex items-center justify-center gap-1.5"
                                    style={{ backgroundColor: 'var(--vscode-button-secondaryBackground)', color: 'var(--vscode-button-secondaryForeground)', borderColor: 'var(--vscode-button-border)' }}
                                >
                                    <ShieldCheck size={12} />
                                    Allow Always
                                </button>
                                <button
                                    onClick={() => handleAuthorization('deny')}
                                    className="col-span-2 px-3 py-1.5 rounded text-xs border font-medium hover:bg-red-500/10 text-red-400 transition-all flex items-center justify-center gap-1.5"
                                    style={{ borderColor: 'var(--vscode-button-border)' }}
                                >
                                    <Ban size={12} />
                                    Deny Execution
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Activity Steps */}
                {activitySteps.length > 0 && (
                    <div className="ml-9 mt-2">
                        <button
                            onClick={() => setShowActivity(!showActivity)}
                            className="flex items-center gap-1 px-2 py-1 rounded text-[11px] opacity-70 hover:opacity-100 transition-opacity"
                            style={{ backgroundColor: 'var(--vscode-editor-inactiveSelectionBackground)' }}
                        >
                            {showActivity ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                            <Activity size={12} />
                            <span>{activitySteps.length} step{activitySteps.length !== 1 ? 's' : ''}</span>
                        </button>
                        {showActivity && (
                            <div className="ml-1 pl-2 border-l mt-1 space-y-1" style={{ borderColor: 'var(--vscode-tree-indentGuidesStroke)' }}>
                                {activitySteps.map((step, i) => (
                                    <div key={i} className="text-[11px] font-mono leading-tight flex items-start gap-2 py-0.5 opacity-80">
                                        <span className="select-none font-bold opacity-50">{i + 1}.</span>
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
            <div className="p-4 border-t relative" style={{ borderColor: 'var(--vscode-panel-border)', backgroundColor: 'var(--vscode-sideBar-background)' }}>
                {/* Command Menu */}
                {showCommandMenu && filteredCommands.length > 0 && (
                    <div className="absolute bottom-full left-4 right-4 mb-2 border rounded shadow-xl overflow-hidden z-50"
                        style={{ backgroundColor: 'var(--vscode-menu-background)', borderColor: 'var(--vscode-menu-border)', color: 'var(--vscode-menu-foreground)' }}>
                        <div className="px-2 py-1.5 text-[10px] font-bold tracking-wider opacity-60 border-b flex items-center gap-2"
                            style={{ borderColor: 'var(--vscode-menu-separatorBackground)' }}>
                            AVAILABLE COMMANDS
                        </div>
                        <div className="max-h-[200px] overflow-y-auto p-1 custom-scrollbar">
                            {filteredCommands.map((cmd, index) => {
                                const Icon = cmd.icon;
                                const isSelected = index === selectedIndex;
                                return (
                                    <button
                                        key={cmd.name}
                                        ref={isSelected ? selectedCommandRef : null}
                                        onClick={() => {
                                            setInput(cmd.name + ' ');
                                            setShowCommandMenu(false);
                                        }}
                                        className={`w-full text-left px-2 py-1.5 rounded flex items-center gap-2 transition-colors ${isSelected ? 'selected' : ''}`}
                                        style={{
                                            backgroundColor: isSelected ? 'var(--vscode-list-activeSelectionBackground)' : 'transparent',
                                            color: isSelected ? 'var(--vscode-list-activeSelectionForeground)' : 'var(--vscode-foreground)'
                                        }}
                                    >
                                        <Icon size={14} className="opacity-80" />
                                        <div className="flex flex-col">
                                            <span className="font-bold text-xs">{cmd.name}</span>
                                            <span className="text-[10px] opacity-70">{cmd.description}</span>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* Attachment Chips */}
                {attachments.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-2">
                        {attachments.map((att) => (
                            <span
                                key={att.path}
                                className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs border group/chip"
                                style={{ backgroundColor: 'var(--vscode-inputOption-activeBackground)', borderColor: 'var(--vscode-inputOption-activeBorder)', color: 'var(--vscode-inputOption-activeForeground)' }}
                            >
                                {att.type === 'file' ? <File size={10} /> : <Folder size={10} />}
                                <span className="max-w-[120px] truncate">{att.name}</span>
                                <button
                                    onClick={() => removeAttachment(att.path)}
                                    className="ml-1 p-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10"
                                >
                                    <X size={10} />
                                </button>
                            </span>
                        ))}
                    </div>
                )}

                <div className="relative">
                    <div className="flex flex-col border rounded focus-within:ring-1 focus-within:ring-[var(--vscode-focusBorder)] transition-all"
                        style={{ backgroundColor: 'var(--vscode-input-background)', borderColor: 'var(--vscode-input-border)' }}>

                        <textarea
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder="Ask anything or type /"
                            className="w-full bg-transparent p-3 min-h-[40px] max-h-[200px] outline-none resize-none text-sm font-sans"
                            style={{ color: 'var(--vscode-input-foreground)' }}
                            rows={1}
                        />

                        <div className="flex justify-between items-center p-1.5 border-t" style={{ borderColor: 'var(--vscode-input-border)' }}>
                            <div className="flex gap-0.5">
                                <button
                                    onClick={handleAttachFile}
                                    title="Attach file"
                                    className="p-1.5 rounded hover:opacity-80 transition-opacity"
                                    style={{ color: 'var(--vscode-icon-foreground)' }}
                                >
                                    <Paperclip size={14} />
                                </button>
                                <button
                                    onClick={handleAttachFolder}
                                    title="Attach folder"
                                    className="p-1.5 rounded hover:opacity-80 transition-opacity"
                                    style={{ color: 'var(--vscode-icon-foreground)' }}
                                >
                                    <Folder size={14} />
                                </button>
                            </div>
                            <button
                                onClick={handleSend}
                                disabled={(!input.trim() && attachments.length === 0) || isLoading}
                                className="p-1.5 rounded disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                                style={{ backgroundColor: 'var(--vscode-button-background)', color: 'var(--vscode-button-foreground)' }}
                            >
                                <Send size={14} />
                            </button>
                        </div>
                    </div>
                </div>
                <div className="flex justify-center items-center gap-1.5 mt-2 opacity-40 select-none">
                    <span className="text-[9px] font-sans tracking-tight">Lite Agent v0.0.1</span>
                </div>
            </div>
        </div>
    );
};

// Markdown styles (Native)
const markdownStyles = `
.markdown-body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); font-size: 13px; line-height: 1.5; }
.markdown-body p { margin-bottom: 0.5em; }
.markdown-body pre { background-color: var(--vscode-textCodeBlock-background); padding: 8px; border-radius: 4px; overflow-x: auto; margin: 0.5em 0; border: 1px solid var(--vscode-widget-border); }
.markdown-body code { font-family: var(--vscode-editor-font-family, monospace); background-color: var(--vscode-textCodeBlock-background); padding: 1px 4px; border-radius: 3px; font-size: 0.9em; }
.markdown-body pre code { background-color: transparent; padding: 0; color: var(--vscode-editor-foreground); }
.markdown-body ul, .markdown-body ol { padding-left: 1.5em; margin-bottom: 0.5em; }
.markdown-body a { color: var(--vscode-textLink-foreground); text-decoration: none; }
.markdown-body a:hover { text-decoration: underline; color: var(--vscode-textLink-activeForeground); }
.markdown-body h1, .markdown-body h2, .markdown-body h3 { font-weight: 600; margin-top: 1em; margin-bottom: 0.5em; color: var(--vscode-foreground); }
.markdown-body h1 { font-size: 1.2em; border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 0.2em; }
.markdown-body h2 { font-size: 1.1em; }
.markdown-body blockquote { border-left: 3px solid var(--vscode-textBlockQuote-border); background: var(--vscode-textBlockQuote-background); padding: 4px 8px; margin: 0.5em 0; opacity: 0.9; }
.markdown-body table { border-collapse: collapse; width: 100%; margin: 0.5em 0; }
.markdown-body th, .markdown-body td { border: 1px solid var(--vscode-widget-border); padding: 6px; text-align: left; }
.markdown-body th { background-color: var(--vscode-keybindingTable-headerBackground); }
`;

export default App;

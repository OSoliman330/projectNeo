import React, { useEffect, useState, useRef } from 'react';
import { vscode } from './vscode-api';
import './index.css';
import { Activity, Square, Settings, Database, Code, RefreshCw, Terminal, Layers, FileText, CheckCircle, ShieldCheck, Briefcase } from 'lucide-react';

const PREDEFINED_PROMPTS = [
    { label: "Analyze Codebase", icon: <Code size={16} />, prompt: "Analyze the current project structure and summarize the main components and their entry points." },
    { label: "Check Database", icon: <Database size={16} />, prompt: "Review any database or data access patterns in this codebase and suggest optimizations if applicable." },
    { label: "Find Bugs", icon: <Activity size={16} />, prompt: "Review the code for any potential bugs, security issues, or performance bottlenecks." },
    { label: "Generate Tests", icon: <RefreshCw size={16} />, prompt: "Write unit tests for the core utility functions found in the context." },
];

const AGENTS = [
    { name: "Architecture", icon: <Layers size={24} />, desc: "Develops software architectural design (SWE.2), allocating requirements to components for safety-critical systems." },
    { name: "Requirement", icon: <FileText size={24} />, desc: "Elicits, analyzes, and traces software requirements (SWE.1) ensuring full traceability across the V-Cycle." },
    { name: "Code", icon: <Code size={24} />, desc: "Constructs detailed designs and software units (SWE.3/4) strictly adhering to MISRA and AUTOSAR standards." },
    { name: "Validation", icon: <CheckCircle size={24} />, desc: "Executes unit, integration, and qualification testing (SWE.5/6) to verify functionality against requirements." },
    { name: "Quality", icon: <ShieldCheck size={24} />, desc: "Ensures process compliance (SUP.1), configuration management, and ISO 26262 functional safety." },
    { name: "Project", icon: <Briefcase size={24} />, desc: "Orchestrates task planning, risk management, and V-Cycle tracking aligned with ASPICE MAN.3." }
];

function AgentGrid() {
    return (
        <div className="flex-1 w-full flex items-center justify-center relative py-12">
            <div className="vite-wrapper">
                <div className="vite-grid">
                    {AGENTS.map((agent, i) => (
                        <div
                            key={agent.name}
                            className="vite-item"
                            tabIndex={0}
                        >
                            <div className="vite-card">
                                <div className="icon-container">
                                    {agent.icon}
                                </div>
                                <div className="agent-details">
                                    <h3 className="agent-title">{agent.name}</h3>
                                    <p className="agent-desc">{agent.desc}</p>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Glowing ambient background representing AI core */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] bg-blue-600/10 blur-[100px] rounded-full pointer-events-none z-0" />
        </div>
    );
}

function App() {
    const [isConnected, setIsConnected] = useState(false);
    const [logs, setLogs] = useState<any[]>([]);
    const [isRunning, setIsRunning] = useState(false);
    const logEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const message = event.data;
            switch (message.type) {
                case 'statusUpdate':
                    setIsConnected(message.value === 'connected' || message.value === 'ready');
                    addLog({ type: 'system', text: `Status: ${message.value}` });
                    break;
                case 'streamMessage':
                    addLog({ type: 'output', text: message.value });
                    break;
                case 'activityStep':
                    addLog({ type: 'activity', text: `> ${message.value}` });
                    break;
                case 'systemMessage':
                    addLog({ type: 'system', text: message.value });
                    break;
                case 'responseComplete':
                    setIsRunning(false);
                    addLog({ type: 'system', text: '--- Execution Complete ---' });
                    break;
            }
        };

        window.addEventListener('message', handleMessage);
        window.dispatchEvent(new MessageEvent('message', { data: { type: 'webviewReady' } }));

        return () => window.removeEventListener('message', handleMessage);
    }, []);

    useEffect(() => {
        logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [logs]);

    const addLog = (log: { type: 'system' | 'output' | 'activity', text: string }) => {
        setLogs(prev => [...prev, { id: Date.now() + Math.random(), ...log }]);
    };

    const sendPrompt = (prompt: string) => {
        if (isRunning) return;
        setIsRunning(true);
        addLog({ type: 'system', text: `--- Executing: ${prompt} ---` });

        vscode.postMessage({
            type: 'sendMessage',
            value: { prompt, attachments: [] },
            attachments: []
        });
    };

    const stopExecution = () => {
        vscode.postMessage({ type: 'stop' });
        setIsRunning(false);
        addLog({ type: 'system', text: '🛑 Stop requested.' });
    };

    const clearLogs = () => {
        vscode.postMessage({ type: 'clear' });
        setLogs([]);
    };

    return (
        <div className="flex w-screen h-screen bg-[#0a0a0a] text-gray-200 font-sans selection:bg-blue-500/30 overflow-hidden relative">

            {/* Background effects */}
            <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
                <div className="absolute -top-[40%] -left-[10%] w-[70%] h-[70%] rounded-full bg-blue-900/10 blur-[120px]" />
                <div className="absolute top-[60%] -right-[10%] w-[50%] h-[50%] rounded-full bg-purple-900/10 blur-[100px]" />
            </div>

            <div className="flex w-full h-full z-10">

                {/* Left Section: Controls & Animation (w-2/3) */}
                <div className="w-2/3 h-full flex flex-col pt-8 overflow-y-auto custom-scrollbar relative">

                    {/* Header */}
                    <div className="flex px-10 justify-between items-center mb-6 shrink-0">
                        <h1 className="text-3xl font-bold tracking-tight text-white flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 shadow-lg shadow-purple-500/30 flex items-center justify-center">
                                <Terminal size={18} className="text-white" />
                            </div>
                            Lite Agent
                        </h1>
                        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 backdrop-blur-md">
                            <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-400 shadow-[0_0_8px_rgba(74,222,128,0.8)]' : 'bg-red-500 animate-pulse'}`} />
                            <span className="text-xs uppercase tracking-wider font-semibold text-gray-300">
                                {isConnected ? 'System Ready' : 'Connecting...'}
                            </span>
                        </div>
                    </div>

                    {/* Predefined Prompts (Horizontal Layout) */}
                    <div className="shrink-0 px-10 mb-4 border-b border-white/5 pb-6">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-widest">Quick Workflows</h2>
                            <div className="flex gap-2">
                                <button
                                    onClick={stopExecution}
                                    disabled={!isRunning}
                                    className="px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-all disabled:opacity-30 disabled:cursor-not-allowed font-medium text-xs flex items-center gap-1.5"
                                >
                                    <Square size={12} fill="currentColor" /> Stop
                                </button>
                                <button
                                    onClick={clearLogs}
                                    disabled={isRunning}
                                    className="px-3 py-1.5 rounded-lg bg-white/5 text-gray-300 border border-white/10 hover:bg-white/10 transition-all disabled:opacity-30 disabled:cursor-not-allowed font-medium text-xs flex items-center gap-1.5"
                                >
                                    <Settings size={12} /> Reset
                                </button>
                            </div>
                        </div>

                        {/* Compact Wrapping Area for Buttons */}
                        <div className="flex flex-wrap gap-3 pb-2">
                            {PREDEFINED_PROMPTS.map((action, i) => (
                                <button
                                    key={i}
                                    disabled={!isConnected || isRunning}
                                    onClick={() => sendPrompt(action.prompt)}
                                    title={action.prompt}
                                    className="group/btn relative flex-1 min-w-[130px] max-w-[200px] flex justify-center items-center gap-2 p-2.5 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 hover:shadow-[0_4px_15px_rgba(59,130,246,0.15)] transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed overflow-hidden transform hover:-translate-y-0.5"
                                >
                                    <div className="absolute inset-0 bg-gradient-to-br from-blue-500/0 via-white/5 to-purple-500/0 opacity-0 group-hover/btn:opacity-100 transition-opacity duration-500" />

                                    <div className="text-blue-400 group-hover/btn:text-blue-300 transition-colors drop-shadow-[0_0_8px_rgba(59,130,246,0.3)] shrink-0">
                                        {action.icon}
                                    </div>
                                    <div className="font-semibold text-gray-200 group-hover/btn:text-white transition-colors text-xs whitespace-nowrap overflow-hidden text-ellipsis">
                                        {action.label}
                                    </div>

                                    {/* Animated bottom border on hover */}
                                    <div className="absolute bottom-0 left-0 w-0 h-[1px] bg-gradient-to-r from-blue-500 to-purple-500 group-hover/btn:w-full transition-all duration-500" />
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Fun Animation Area below buttons */}
                    <div className="flex-1 w-full relative flex flex-col">
                        <div className="px-10 mt-2 shrink-0 mb-0">
                            <h2 className="text-lg font-bold text-white"><span className="text-blue-400">Multi-Agent</span> System</h2>
                            <p className="text-gray-400 text-[13px] mt-1">Select an AI agent below to view its specific capabilities and role in the ecosystem.</p>
                        </div>
                        <AgentGrid />
                    </div>

                </div>

                {/* Right Section: Full Height Glassmorphism Terminal (w-1/3) */}
                <div className="w-1/3 h-full p-6 pl-0">
                    <div className={`w-full h-full bg-black/60 backdrop-blur-3xl border ${isRunning ? 'border-blue-500/30' : 'border-white/10'} rounded-3xl shadow-[0_0_50px_rgba(0,0,0,0.8)] flex flex-col overflow-hidden relative transition-colors duration-700`}>

                        {/* Terminal Header */}
                        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5 bg-white/[0.03] shrink-0 z-10 w-full">
                            <div className="flex items-center gap-2">
                                <div className="flex gap-1.5 mr-2">
                                    <div className="w-2.5 h-2.5 rounded-full bg-[#ff5f56]" />
                                    <div className="w-2.5 h-2.5 rounded-full bg-[#ffbd2e]" />
                                    <div className="w-2.5 h-2.5 rounded-full bg-[#27c93f]" />
                                </div>
                                <span className="text-[10px] font-mono text-gray-500 tracking-wider">~/logs</span>
                            </div>
                            {isRunning && (
                                <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-blue-500/10 border border-blue-500/20 text-blue-400 text-[10px] uppercase font-bold tracking-widest animate-pulse">
                                    <Activity size={10} /> Running
                                </div>
                            )}
                        </div>

                        {/* Terminal Output Body */}
                        <div className="flex-1 overflow-y-auto p-5 font-mono text-[11px] leading-relaxed custom-scrollbar relative bg-black/20">
                            {logs.length === 0 && (
                                <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-600 pointer-events-none transition-opacity duration-1000">
                                    <Terminal size={48} className="mb-4 opacity-10" />
                                    <p className="opacity-40 tracking-widest uppercase text-[10px]">Awaiting Instructions</p>
                                </div>
                            )}

                            <div className="space-y-2 pb-4">
                                {logs.map((log) => (
                                    <div key={log.id} className="whitespace-pre-wrap break-words inline-block w-full">
                                        {log.type === 'system' && (
                                            <div className="text-blue-400/90 font-bold mt-2 mb-1 flex items-center gap-1.5 border-b border-blue-500/10 pb-0.5 text-xs">
                                                <span className="text-blue-500/50">❯</span> {log.text}
                                            </div>
                                        )}
                                        {log.type === 'activity' && (
                                            <div className="text-purple-400/80 tracking-wide flex items-center gap-2 ml-3 border-l-2 border-purple-500/30 pl-2 py-0.5 my-0.5">
                                                {log.text}
                                            </div>
                                        )}
                                        {log.type === 'output' && (
                                            <div className="text-gray-300 ml-3 font-normal mt-0.5 mb-1.5">
                                                {log.text}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                            <div ref={logEndRef} className="h-4" />
                        </div>

                        {/* Animated scanning line effect (visible only when running) */}
                        {isRunning && (
                            <div className="absolute top-12 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-blue-400/80 to-transparent animate-scan z-0 pointer-events-none shadow-[0_0_10px_rgba(96,165,250,0.8)]" />
                        )}

                        {/* Subtle ambient glow at bottom of terminal */}
                        <div className="absolute bottom-0 left-0 w-full h-24 bg-gradient-to-t from-blue-900/10 to-transparent pointer-events-none" />
                    </div>
                </div>
            </div>
        </div>
    );
}

export default App;

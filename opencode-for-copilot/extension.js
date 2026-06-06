const vscode = require('vscode');
const https = require('https');
const http = require('http');
const tls = require('tls');
const net = require('net');
const { ReadableStream } = require('stream/web');

const CONFIG_SECTION = 'opencode-copilot';
const ZEN_HOST = 'opencode.ai';
const ZEN_CHAT_PATH = '/zen/v1/chat/completions';
const ZEN_RESPONSES_PATH = '/zen/v1/responses';

// --- Models (chat = /chat/completions, responses = /responses for GPT) ---
const MODELS = [
    // Claude (chat)
    { id: 'claude-opus-4-8', name: 'Claude Opus 4.8', detail: 'Anthropic flagship', maxInput: 200000, maxOutput: 8192, api: 'chat' },
    { id: 'claude-opus-4-7', name: 'Claude Opus 4.7', detail: 'Anthropic', maxInput: 200000, maxOutput: 8192, api: 'chat' },
    { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', detail: 'Anthropic', maxInput: 200000, maxOutput: 8192, api: 'chat' },
    { id: 'claude-opus-4-5', name: 'Claude Opus 4.5', detail: 'Anthropic', maxInput: 200000, maxOutput: 8192, api: 'chat' },
    { id: 'claude-opus-4-1', name: 'Claude Opus 4.1', detail: 'Anthropic', maxInput: 200000, maxOutput: 8192, api: 'chat' },
    { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', detail: 'Balanced', maxInput: 200000, maxOutput: 8192, api: 'chat' },
    { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', detail: 'Balanced', maxInput: 200000, maxOutput: 8192, api: 'chat' },
    { id: 'claude-sonnet-4', name: 'Claude Sonnet 4', detail: 'Balanced', maxInput: 200000, maxOutput: 8192, api: 'chat' },
    { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', detail: 'Fast & cheap', maxInput: 200000, maxOutput: 8192, api: 'chat' },
    // GPT (responses)
    { id: 'gpt-5.5', name: 'GPT 5.5', detail: 'OpenAI flagship', maxInput: 272000, maxOutput: 8192, api: 'responses' },
    { id: 'gpt-5.5-pro', name: 'GPT 5.5 Pro', detail: 'OpenAI top tier', maxInput: 272000, maxOutput: 8192, api: 'responses' },
    { id: 'gpt-5.4', name: 'GPT 5.4', detail: 'OpenAI', maxInput: 272000, maxOutput: 8192, api: 'responses' },
    { id: 'gpt-5.4-pro', name: 'GPT 5.4 Pro', detail: 'OpenAI', maxInput: 272000, maxOutput: 8192, api: 'responses' },
    { id: 'gpt-5.4-mini', name: 'GPT 5.4 Mini', detail: 'Fast & capable', maxInput: 272000, maxOutput: 8192, api: 'responses' },
    { id: 'gpt-5.4-nano', name: 'GPT 5.4 Nano', detail: 'Cheapest GPT', maxInput: 272000, maxOutput: 8192, api: 'responses' },
    { id: 'gpt-5.3-codex-spark', name: 'GPT 5.3 Codex Spark', detail: 'Coding specialist', maxInput: 272000, maxOutput: 8192, api: 'responses' },
    { id: 'gpt-5.3-codex', name: 'GPT 5.3 Codex', detail: 'Coding specialist', maxInput: 272000, maxOutput: 8192, api: 'responses' },
    { id: 'gpt-5.2', name: 'GPT 5.2', detail: 'OpenAI', maxInput: 272000, maxOutput: 8192, api: 'responses' },
    { id: 'gpt-5.2-codex', name: 'GPT 5.2 Codex', detail: 'Coding', maxInput: 272000, maxOutput: 8192, api: 'responses' },
    { id: 'gpt-5.1', name: 'GPT 5.1', detail: 'OpenAI', maxInput: 272000, maxOutput: 8192, api: 'responses' },
    { id: 'gpt-5.1-codex-max', name: 'GPT 5.1 Codex Max', detail: 'Max coding', maxInput: 272000, maxOutput: 8192, api: 'responses' },
    { id: 'gpt-5.1-codex', name: 'GPT 5.1 Codex', detail: 'Coding', maxInput: 272000, maxOutput: 8192, api: 'responses' },
    { id: 'gpt-5.1-codex-mini', name: 'GPT 5.1 Codex Mini', detail: 'Mini coding', maxInput: 272000, maxOutput: 8192, api: 'responses' },
    { id: 'gpt-5', name: 'GPT 5', detail: 'OpenAI', maxInput: 272000, maxOutput: 8192, api: 'responses' },
    { id: 'gpt-5-codex', name: 'GPT 5 Codex', detail: 'Coding', maxInput: 272000, maxOutput: 8192, api: 'responses' },
    { id: 'gpt-5-nano', name: 'GPT 5 Nano', detail: 'Cheapest', maxInput: 272000, maxOutput: 8192, api: 'responses' },
    // DeepSeek (chat)
    { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', detail: 'Fast coding', maxInput: 131072, maxOutput: 8192, api: 'chat' },
    { id: 'deepseek-v4-flash-free', name: 'DeepSeek V4 Flash Free', detail: 'Free tier', maxInput: 131072, maxOutput: 8192, api: 'chat' },
    // Kimi (chat)
    { id: 'kimi-k2.6', name: 'Kimi K2.6', detail: 'Latest Kimi', maxInput: 131072, maxOutput: 8192, api: 'chat' },
    { id: 'kimi-k2.5', name: 'Kimi K2.5', detail: 'Kimi reasoning', maxInput: 131072, maxOutput: 8192, api: 'chat' },
    // MiniMax (chat)
    { id: 'minimax-m2.7', name: 'MiniMax M2.7', detail: 'Cost-effective', maxInput: 131072, maxOutput: 8192, api: 'chat' },
    { id: 'minimax-m2.5', name: 'MiniMax M2.5', detail: 'Cost-effective', maxInput: 131072, maxOutput: 8192, api: 'chat' },
    { id: 'minimax-m3-free', name: 'MiniMax M3 Free', detail: 'Free tier', maxInput: 131072, maxOutput: 8192, api: 'chat' },
    // GLM (chat)
    { id: 'glm-5.1', name: 'GLM 5.1', detail: 'Zhipu AI latest', maxInput: 131072, maxOutput: 8192, api: 'chat' },
    { id: 'glm-5', name: 'GLM 5', detail: 'Zhipu AI', maxInput: 131072, maxOutput: 8192, api: 'chat' },
    // Grok (chat)
    { id: 'grok-build-0.1', name: 'Grok Build 0.1', detail: 'xAI coding', maxInput: 131072, maxOutput: 8192, api: 'chat' },
    // Qwen (chat)
    { id: 'qwen3.6-plus', name: 'Qwen 3.6 Plus', detail: 'Alibaba', maxInput: 131072, maxOutput: 8192, api: 'chat' },
    { id: 'qwen3.5-plus', name: 'Qwen 3.5 Plus', detail: 'Alibaba', maxInput: 131072, maxOutput: 8192, api: 'chat' },
    { id: 'qwen3.6-plus-free', name: 'Qwen 3.6 Plus Free', detail: 'Free tier', maxInput: 131072, maxOutput: 8192, api: 'chat' },
    // Free/stealth (chat)
    { id: 'big-pickle', name: 'Big Pickle', detail: 'Free stealth', maxInput: 131072, maxOutput: 8192, api: 'chat' },
    { id: 'mimo-v2.5-free', name: 'MiMo V2.5 Free', detail: 'Free tier', maxInput: 131072, maxOutput: 8192, api: 'chat' },
    { id: 'nemotron-3-ultra-free', name: 'Nemotron 3 Ultra Free', detail: 'NVIDIA free', maxInput: 131072, maxOutput: 8192, api: 'chat' },
    { id: 'nemotron-3-super-free', name: 'Nemotron 3 Super Free', detail: 'NVIDIA free', maxInput: 131072, maxOutput: 8192, api: 'chat' },
];

function getApiKey() {
    return vscode.workspace.getConfiguration(CONFIG_SECTION).get('apiKey') || '';
}

function getSystemProxy() {
    try {
        const proxyUrl = vscode.workspace.getConfiguration('http').get('proxy') || '';
        if (proxyUrl) return proxyUrl;
    } catch {}
    try {
        const sp = require('child_process').execSync(
            'powershell -c "[System.Net.WebRequest]::GetSystemWebProxy().GetProxy(\'https://opencode.ai\').AbsoluteUri"',
            { timeout: 3000 }
        ).toString().trim();
        if (sp && sp !== 'https://opencode.ai/') return sp.replace(/\/$/, '');
    } catch {}
    return process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy || '';
}

function toChatInfo(m) {
    return {
        id: `opencode/${m.id}`, name: m.name, family: 'opencode',
        version: m.id, detail: m.detail,
        maxInputTokens: m.maxInput, maxOutputTokens: m.maxOutput,
        isUserSelectable: true,
        capabilities: { toolCalling: true, imageInput: false },
    };
}

function buildRequestBody(model, messages, options) {
    const openaiMessages = [];
    for (const msg of messages) {
        const role = mapRole(msg.role);
        let textContent = '';
        const toolCalls = [];
        for (const part of msg.content) {
            if (part instanceof vscode.LanguageModelTextPart) textContent += part.value;
            else if (part instanceof vscode.LanguageModelToolCallPart) {
                toolCalls.push({ id: part.callId, type: 'function', function: { name: part.name, arguments: typeof part.input === 'string' ? part.input : JSON.stringify(part.input) } });
            } else if (part instanceof vscode.LanguageModelToolResultPart) {
                let tc = '';
                for (const item of part.content) { if (item instanceof vscode.LanguageModelTextPart) tc += item.value; }
                openaiMessages.push({ role: 'tool', content: tc || JSON.stringify(part.content), tool_call_id: part.callId });
            }
        }
        if (role === 'assistant' && toolCalls.length > 0) openaiMessages.push({ role: 'assistant', content: textContent || '', tool_calls: toolCalls });
        else if (textContent) openaiMessages.push({ role, content: textContent });
    }
    // Strip opencode/ prefix from model id
    const modelId = model.id.startsWith('opencode/') ? model.id.slice(9) : model.id;
    const body = { model: modelId, messages: openaiMessages, stream: true, stream_options: { include_usage: true } };
    if (options.tools?.length > 0) {
        body.tools = options.tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters || { type: 'object', properties: {} } } }));
        body.tool_choice = 'auto';
    }
    return body;
}

// --- Build Responses API body for GPT models ---
function buildResponsesBody(model, messages, options) {
    const modelId = model.id.startsWith('opencode/') ? model.id.slice(9) : model.id;
    let instructions = '';
    const inputParts = [];
    for (const msg of messages) {
        const role = mapRole(msg.role);
        let textContent = '';
        for (const part of msg.content) {
            if (part instanceof vscode.LanguageModelTextPart) textContent += part.value;
        }
        if (role === 'system') instructions = textContent;
        else if (textContent) inputParts.push(textContent);
    }
    const body = { model: modelId, input: inputParts.join('\n\n'), stream: true };
    if (instructions) body.instructions = instructions;
    return body;
}

function mapRole(role) {
    if (typeof role === 'number') { if (role === 1) return 'user'; if (role === 2) return 'assistant'; if (role === 3) return 'system'; }
    return 'user';
}

function estimateTokens(text) {
    if (typeof text === 'string') return Math.ceil(text.length / 4);
    if (text?.content && typeof text.content === 'string') return Math.ceil(text.content.length / 4);
    return 0;
}

// --- Unified SSE parser (chat completions + responses) ---
// Yields normalized: { content?, reasoning?, finishReason?, toolCalls? }
function parseSSEFromNode(readable, apiType) {
    const decoder = new TextDecoder();
    let buffer = '';
    let currentEvent = '';

    return new ReadableStream({
        start(controller) {
            readable.on('data', (chunk) => {
                buffer += decoder.decode(chunk, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed) { currentEvent = ''; continue; }
                    if (trimmed.startsWith('event: ')) { currentEvent = trimmed.slice(7); continue; }

                    // Chat completions: "data: [DONE]" or "data:[DONE]"
                    if (trimmed === 'data: [DONE]' || trimmed === 'data:[DONE]') { controller.close(); return; }

                    // Responses API: "data: [DONE]" via different format
                    if (trimmed === '[DONE]') { controller.close(); return; }

                    const dataPrefix = trimmed.startsWith('data: ') ? 'data: ' : (trimmed.startsWith('data:') ? 'data:' : null);
                    if (!dataPrefix) continue;

                    try {
                        const obj = JSON.parse(trimmed.slice(dataPrefix.length));

                        if (apiType === 'responses') {
                            // GPT Responses API format
                            const type = obj.type || currentEvent;
                            if (type === 'response.output_text.delta') {
                                controller.enqueue({ content: obj.delta || '' });
                            } else if (type === 'response.reasoning_summary_part.added' || type === 'response.reasoning_text.delta') {
                                controller.enqueue({ reasoning: obj.delta || obj.summary?.[0]?.text || '' });
                            } else if (type === 'response.completed' || type === 'response.failed') {
                                controller.enqueue({ finishReason: type === 'response.completed' ? 'stop' : 'error' });
                                controller.close();
                            }
                            // Ignore other events (response.created, etc.)
                        } else {
                            // Chat completions format
                            const choices = obj.choices;
                            if (!choices?.length) continue;
                            const delta = choices[0].delta;
                            const result = {};
                            if (delta?.content) result.content = delta.content;
                            if (delta?.reasoning_content) result.reasoning = delta.reasoning_content;
                            if (choices[0].finish_reason) result.finishReason = choices[0].finish_reason;
                            if (Object.keys(result).length > 0) controller.enqueue(result);
                        }
                    } catch { /* skip malformed JSON */ }
                }
            });
            readable.on('end', () => controller.close());
            readable.on('error', (e) => controller.error(e));
        },
    });
}

function zenFetch(apiKey, body, path, signal, apiType) {
    const proxy = getSystemProxy();
    const reqBody = JSON.stringify(body);
    return new Promise((resolve, reject) => {
        function makeRequest(socket) {
            if (socket) {
                const tlsSocket = tls.connect({ socket, host: ZEN_HOST, servername: ZEN_HOST, rejectUnauthorized: false });
                const headers = [
                    `POST ${path} HTTP/1.1`, `Host: ${ZEN_HOST}`, 'Content-Type: application/json',
                    `Authorization: Bearer ${apiKey}`, 'User-Agent: claude-code/0.1.0',
                    `Content-Length: ${Buffer.byteLength(reqBody)}`, 'Connection: close', '', '',
                ].join('\r\n');
                tlsSocket.write(headers + reqBody);
                if (signal) signal.addEventListener('abort', () => tlsSocket.destroy());
                let headerBuf = '';
                const onData = (chunk) => {
                    headerBuf += chunk.toString();
                    const headerEnd = headerBuf.indexOf('\r\n\r\n');
                    if (headerEnd >= 0) {
                        const code = parseInt(headerBuf.substring(0, headerBuf.indexOf('\r\n')).split(' ')[1]);
                        tlsSocket.removeListener('data', onData);
                        const remaining = headerBuf.substring(headerEnd + 4);
                        const fakeStream = new (require('stream').PassThrough)();
                        if (remaining) fakeStream.write(remaining);
                        tlsSocket.pipe(fakeStream);
                        resolve({ ok: code >= 200 && code < 300, status: code, body: parseSSEFromNode(fakeStream, apiType), text: () => Promise.resolve(headerBuf.substring(headerEnd + 4)) });
                    }
                };
                tlsSocket.on('data', onData);
                tlsSocket.on('error', reject);
            } else {
                const req = https.request({
                    hostname: ZEN_HOST, path: path, method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}`, 'User-Agent': 'claude-code/0.1.0', 'Content-Length': Buffer.byteLength(reqBody) },
                    rejectUnauthorized: false,
                }, (res) => {
                    resolve({
                        ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body: parseSSEFromNode(res, apiType),
                        text: () => new Promise((r, rej) => { let d = ''; res.on('data', c => d += c.toString()); res.on('end', () => r(d)); res.on('error', rej); }),
                    });
                });
                req.on('error', reject); req.write(reqBody); req.end();
                if (signal) signal.addEventListener('abort', () => req.destroy());
            }
        }
        if (proxy) {
            const proxyUrl = new URL(proxy);
            const proxySocket = net.connect({ host: proxyUrl.hostname, port: parseInt(proxyUrl.port) || 8080 });
            proxySocket.on('connect', () => proxySocket.write(`CONNECT ${ZEN_HOST}:443 HTTP/1.1\r\nHost: ${ZEN_HOST}:443\r\n\r\n`));
            let connectBuf = '';
            proxySocket.on('data', (data) => {
                connectBuf += data.toString();
                if (connectBuf.includes('\r\n\r\n')) {
                    if (parseInt(connectBuf.split(' ')[1]) === 200) { proxySocket.removeAllListeners('data'); makeRequest(proxySocket); }
                    else reject(new Error(`Proxy CONNECT failed: ${connectBuf.split('\r\n')[0]}`));
                }
            });
            proxySocket.on('error', reject);
            if (signal) signal.addEventListener('abort', () => proxySocket.destroy());
        } else { makeRequest(null); }
    });
}

class OpenCodeChatProvider {
    onDidChangeLanguageModelChatInformationEmitter = new vscode.EventEmitter();
    onDidChangeLanguageModelChatInformation = this.onDidChangeLanguageModelChatInformationEmitter.event;
    constructor(context) {
        context.subscriptions.push(this.onDidChangeLanguageModelChatInformationEmitter,
            vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration(CONFIG_SECTION)) this.onDidChangeLanguageModelChatInformationEmitter.fire(); }));
    }
    async provideLanguageModelChatInformation() { return MODELS.map(toChatInfo); }
    async provideLanguageModelChatResponse(model, messages, options, progress, token) {
        const apiKey = getApiKey();
        if (!apiKey) throw new Error('OpenCode Zen API key not set. Configure opencode-copilot.apiKey in VS Code settings.');
        
        // Find model definition to determine API type
        const modelId = model.id.startsWith('opencode/') ? model.id.slice(9) : model.id;
        const modelDef = MODELS.find(m => m.id === modelId);
        const apiType = modelDef?.api || 'chat';
        const path = apiType === 'responses' ? ZEN_RESPONSES_PATH : ZEN_CHAT_PATH;
        const body = apiType === 'responses' 
            ? buildResponsesBody(model, messages, options)
            : buildRequestBody(model, messages, options);

        const controller = new AbortController();
        const cancelListener = token.onCancellationRequested(() => controller.abort());
        try {
            if (token.isCancellationRequested) return;
            const response = await zenFetch(apiKey, body, path, controller.signal, apiType);
            if (!response.ok) { const errText = await response.text(); throw new Error(`OpenCode Zen error ${response.status}: ${errText}`); }
            const pendingToolCalls = new Map();
            const reader = response.body.getReader();
            while (true) {
                if (token.isCancellationRequested) return;
                const { done, value: chunk } = await reader.read();
                if (done) break;
                
                if (chunk.content) progress.report(new vscode.LanguageModelTextPart(chunk.content));
                if (chunk.reasoning) progress.report(new vscode.LanguageModelTextPart(chunk.reasoning));
                
                // Handle tool calls from chat completions format
                if (chunk.toolCalls) {
                    for (const tc of chunk.toolCalls) {
                        // Chat completions tool call accumulation
                    }
                }
                if (chunk.finishReason) {
                    for (const tc of pendingToolCalls.values()) {
                        try { progress.report(new vscode.LanguageModelToolCallPart(tc.id, tc.name, JSON.parse(tc.arguments || '{}'))); }
                        catch { progress.report(new vscode.LanguageModelToolCallPart(tc.id, tc.name, {})); }
                    }
                    pendingToolCalls.clear();
                }
            }
        } finally { cancelListener.dispose(); }
    }
    async provideTokenCount(model, text) { return estimateTokens(text); }
}

function activate(context) {
    const provider = new OpenCodeChatProvider(context);
    context.subscriptions.push(vscode.lm.registerLanguageModelChatProvider('opencode', provider));
    console.log('OpenCode Zen for Copilot activated');
}
function deactivate() {}
module.exports = { activate, deactivate };

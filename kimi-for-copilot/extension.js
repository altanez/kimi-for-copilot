const vscode = require('vscode');
const https = require('https');
const http = require('http');
const tls = require('tls');
const net = require('net');

const CONFIG_SECTION = 'kimi-copilot';
const KIMI_HOST = 'api.kimi.com';
const KIMI_PATH = '/coding/v1/chat/completions';

// Auto-detect system proxy (Hiddify / VPN)
function getSystemProxy() {
    try {
        const proxyUrl = vscode.workspace.getConfiguration('http').get('proxy') || '';
        if (proxyUrl) return proxyUrl;
    } catch {}
    // Fallback: Windows system proxy
    try {
        const sp = require('child_process').execSync(
            'powershell -c "[System.Net.WebRequest]::GetSystemWebProxy().GetProxy(\'https://api.kimi.com\').AbsoluteUri"',
            { timeout: 3000 }
        ).toString().trim();
        if (sp && sp !== 'https://api.kimi.com/') return sp.replace(/\/$/, '');
    } catch {}
    // Fallback to env
    return process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy || '';
}

// --- Models exposed to Copilot ---
const MODELS = [
    {
        id: 'kimi-latest',
        name: 'Kimi Latest',
        family: 'kimi',
        version: 'latest',
        detail: 'Fast, general-purpose model',
        maxInputTokens: 131072,
        maxOutputTokens: 8192,
        capabilities: { toolCalling: true, imageInput: false, thinking: true },
    },
    {
        id: 'kimi-thinking',
        name: 'Kimi Thinking',
        family: 'kimi',
        version: 'thinking',
        detail: 'Reasoning model with thinking',
        maxInputTokens: 131072,
        maxOutputTokens: 8192,
        capabilities: { toolCalling: true, imageInput: false, thinking: true },
    },
    {
        id: 'kimi-k2',
        name: 'Kimi K2',
        family: 'kimi',
        version: 'k2',
        detail: 'Advanced reasoning model',
        maxInputTokens: 131072,
        maxOutputTokens: 8192,
        capabilities: { toolCalling: true, imageInput: false, thinking: true },
    },
];

function getApiKey() {
    return vscode.workspace.getConfiguration(CONFIG_SECTION).get('apiKey') || 'kimi-key';
}

function toChatInfo(model) {
    return {
        id: model.id, name: model.name, family: model.family,
        version: model.version, detail: model.detail,
        maxInputTokens: model.maxInputTokens, maxOutputTokens: model.maxOutputTokens,
        isUserSelectable: true,
        capabilities: {
            toolCalling: model.capabilities.toolCalling,
            imageInput: model.capabilities.imageInput,
        },
        ...(model.capabilities.thinking ? {
            configurationSchema: {
                properties: {
                    reasoningEffort: {
                        type: 'string', title: 'Thinking',
                        enum: ['none', 'low', 'high'],
                        enumItemLabels: ['Off', 'Low', 'High'],
                        default: 'high', group: 'navigation',
                    },
                },
            },
        } : {}),
    };
}

function buildRequestBody(model, messages, options) {
    const openaiMessages = [];
    for (const msg of messages) {
        const role = mapRole(msg.role);
        let textContent = '';
        const toolCalls = [];

        for (const part of msg.content) {
            if (part instanceof vscode.LanguageModelTextPart) {
                textContent += part.value;
            } else if (part instanceof vscode.LanguageModelToolCallPart) {
                toolCalls.push({
                    id: part.callId, type: 'function',
                    function: { name: part.name, arguments: typeof part.input === 'string' ? part.input : JSON.stringify(part.input) },
                });
            } else if (part instanceof vscode.LanguageModelToolResultPart) {
                let tc = '';
                for (const item of part.content) {
                    if (item instanceof vscode.LanguageModelTextPart) tc += item.value;
                }
                openaiMessages.push({ role: 'tool', content: tc || JSON.stringify(part.content), tool_call_id: part.callId });
            }
        }

        if (role === 'assistant' && toolCalls.length > 0) {
            openaiMessages.push({ role: 'assistant', content: textContent || '', tool_calls: toolCalls, reasoning_content: '' });
        } else if (textContent) {
            openaiMessages.push({ role, content: textContent });
        }
    }

    const body = { model: model.id, messages: openaiMessages, stream: true, stream_options: { include_usage: true } };

    if (options.tools && options.tools.length > 0) {
        body.tools = options.tools.map(t => ({
            type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters },
        }));
        body.tool_choice = 'auto';
    }

    const modelDef = MODELS.find(m => m.id === model.id);
    if (modelDef?.capabilities.thinking) {
        const effort = options.modelConfiguration?.reasoningEffort || options.configuration?.reasoningEffort || 'high';
        body.thinking = effort === 'none' ? { type: 'disabled' } : { type: 'enabled' };
        if (effort !== 'none') body.reasoning_effort = effort;
    }

    return body;
}

function mapRole(role) {
    if (typeof role === 'number') {
        if (role === 1) return 'user';
        if (role === 2) return 'assistant';
        if (role === 3) return 'system';
    }
    return 'user';
}

function estimateTokens(text) {
    if (typeof text === 'string') return Math.ceil(text.length / 4);
    if (text && typeof text.content === 'string') return Math.ceil(text.content.length / 4);
    return 0;
}

function parseSSEFromNode(readable) {
    const decoder = new TextDecoder();
    let buffer = '';

    return new ReadableStream({
        start(controller) {
            readable.on('data', (chunk) => {
                buffer += decoder.decode(chunk, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed || trimmed.startsWith(':')) continue;
                    if (trimmed === 'data: [DONE]' || trimmed === 'data:[DONE]') {
                        controller.close();
                        return;
                    }
                    const dataPrefix = trimmed.startsWith('data: ') ? 'data: ' : 'data:';
                    if (trimmed.startsWith(dataPrefix)) {
                        try {
                            controller.enqueue(JSON.parse(trimmed.slice(dataPrefix.length)));
                        } catch { /* skip */ }
                    }
                }
            });
            readable.on('end', () => controller.close());
            readable.on('error', (e) => controller.error(e));
        },
    });
}

// --- Connect to Kimi via proxy tunnel ---
function kimiConnect(apiKey, body, signal) {
    const proxy = getSystemProxy();
    const reqBody = JSON.stringify(body);
    const reqBodyBuffer = Buffer.from(reqBody, 'utf-8');

    return new Promise((resolve, reject) => {
        function makeRequest(socket) {
            if (socket) {
                // TLS over proxy tunnel
                const tlsSocket = tls.connect({
                    socket,
                    host: KIMI_HOST,
                    servername: KIMI_HOST,
                    rejectUnauthorized: false,
                });

                const headers = [
                    `POST ${KIMI_PATH} HTTP/1.1`,
                    `Host: ${KIMI_HOST}`,
                    'Content-Type: application/json',
                    `Authorization: Bearer ${apiKey}`,
                    'User-Agent: claude-code/0.1.0',
                    `Content-Length: ${reqBodyBuffer.length}`,
                    'Connection: close',
                    '', '',
                ].join('\r\n');

                tlsSocket.write(headers);
                tlsSocket.write(reqBodyBuffer);
                if (signal) signal.addEventListener('abort', () => tlsSocket.destroy());

                // Use Buffer for header parsing to avoid UTF-8 corruption at chunk boundaries
                const headerChunks = [];
                let headerDone = false;
                tlsSocket.on('data', (chunk) => {
                    if (!headerDone) {
                        headerChunks.push(chunk);
                        const buf = Buffer.concat(headerChunks);
                        const headerEnd = buf.indexOf('\r\n\r\n');
                        if (headerEnd >= 0) {
                            headerDone = true;
                            const code = parseInt(buf.toString('ascii', 0, buf.indexOf('\r\n')).split(' ')[1]);
                            // Extract remaining body bytes after headers (as Buffer, NOT string)
                            const bodyStart = headerEnd + 4;
                            const remaining = buf.length > bodyStart ? buf.slice(bodyStart) : null;
                            const fakeStream = new (require('stream').PassThrough)();
                            if (remaining && remaining.length > 0) fakeStream.write(remaining);
                            tlsSocket.pipe(fakeStream);

                            resolve({
                                ok: code >= 200 && code < 300,
                                status: code,
                                body: parseSSEFromNode(fakeStream),
                                text: () => Promise.resolve(remaining ? remaining.toString('utf-8') : ''),
                            });
                        }
                    }
                });
                tlsSocket.on('error', reject);
            } else {
                // Direct HTTPS request
                const req = https.request({
                    hostname: KIMI_HOST,
                    path: KIMI_PATH,
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${apiKey}`,
                        'User-Agent': 'claude-code/0.1.0',
                        'Content-Length': reqBodyBuffer.length,
                    },
                    rejectUnauthorized: false,
                }, (res) => {
                    resolve({
                        ok: res.statusCode >= 200 && res.statusCode < 300,
                        status: res.statusCode,
                        body: parseSSEFromNode(res),
                        text: () => new Promise((r, rej) => {
                            let d = '';
                            res.on('data', c => d += c.toString());
                            res.on('end', () => r(d));
                            res.on('error', rej);
                        }),
                    });
                });

                req.on('error', reject);
                req.write(reqBodyBuffer);
                req.end();
                if (signal) signal.addEventListener('abort', () => req.destroy());
            }
        }

        if (proxy) {
            const proxyUrl = new URL(proxy);
            const proxySocket = net.connect({
                host: proxyUrl.hostname,
                port: parseInt(proxyUrl.port) || 8080,
            });

            proxySocket.on('connect', () => {
                proxySocket.write(`CONNECT ${KIMI_HOST}:443 HTTP/1.1\r\nHost: ${KIMI_HOST}:443\r\n\r\n`);
            });

            let connectBuf = '';
            proxySocket.on('data', (data) => {
                connectBuf += data.toString();
                if (connectBuf.includes('\r\n\r\n')) {
                    const code = parseInt(connectBuf.split(' ')[1]);
                    if (code === 200) {
                        proxySocket.removeAllListeners('data');
                        makeRequest(proxySocket);
                    } else {
                        reject(new Error(`Proxy CONNECT failed: ${connectBuf.split('\r\n')[0]}`));
                    }
                }
            });

            proxySocket.on('error', reject);
            if (signal) signal.addEventListener('abort', () => proxySocket.destroy());
        } else {
            makeRequest(null);
        }
    });
}

class KimiChatProvider {
    onDidChangeLanguageModelChatInformationEmitter = new vscode.EventEmitter();
    onDidChangeLanguageModelChatInformation = this.onDidChangeLanguageModelChatInformationEmitter.event;

    constructor(context) {
        context.subscriptions.push(
            this.onDidChangeLanguageModelChatInformationEmitter,
            vscode.workspace.onDidChangeConfiguration(e => {
                if (e.affectsConfiguration(CONFIG_SECTION)) {
                    this.onDidChangeLanguageModelChatInformationEmitter.fire();
                }
            }),
        );
    }

    async provideLanguageModelChatInformation(_options, _token) {
        return MODELS.map(toChatInfo);
    }

    async provideLanguageModelChatResponse(model, messages, options, progress, token) {
        const apiKey = getApiKey();
        const body = buildRequestBody(model, messages, options);

        const controller = new AbortController();
        const cancelListener = token.onCancellationRequested(() => controller.abort());

        try {
            if (token.isCancellationRequested) return;

            const response = await kimiConnect(apiKey, body, controller.signal);

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`Kimi API error ${response.status}: ${errText}`);
            }

            const pendingToolCalls = new Map();
            const reader = response.body.getReader();

            while (true) {
                if (token.isCancellationRequested) return;

                const { done, value: chunk } = await reader.read();
                if (done) break;

                const choices = chunk.choices;
                if (!choices || choices.length === 0) continue;

                const delta = choices[0].delta;
                const finishReason = choices[0].finish_reason;

                if (delta) {
                    if (delta.content) {
                        progress.report(new vscode.LanguageModelTextPart(delta.content));
                    }
                    if (delta.reasoning_content) {
                        progress.report(new vscode.LanguageModelTextPart(delta.reasoning_content));
                    }
                    if (delta.tool_calls) {
                        for (const tc of delta.tool_calls) {
                            let pending = pendingToolCalls.get(tc.index);
                            if (!pending) {
                                pending = { id: tc.id || '', name: '', arguments: '' };
                                pendingToolCalls.set(tc.index, pending);
                            }
                            if (tc.id) pending.id = tc.id;
                            if (tc.function) {
                                if (tc.function.name) pending.name += tc.function.name;
                                if (tc.function.arguments) pending.arguments += tc.function.arguments;
                            }
                        }
                    }
                }

                if (finishReason === 'tool_calls' || finishReason === 'stop') {
                    for (const tc of pendingToolCalls.values()) {
                        try {
                            progress.report(new vscode.LanguageModelToolCallPart(tc.id, tc.name, JSON.parse(tc.arguments || '{}')));
                        } catch {
                            progress.report(new vscode.LanguageModelToolCallPart(tc.id, tc.name, {}));
                        }
                    }
                    pendingToolCalls.clear();
                }

                if (chunk.usage) {
                    progress.report(new vscode.LanguageModelTextPart(''));
                }
            }

            for (const tc of pendingToolCalls.values()) {
                try {
                    progress.report(new vscode.LanguageModelToolCallPart(tc.id, tc.name, JSON.parse(tc.arguments || '{}')));
                } catch {
                    progress.report(new vscode.LanguageModelToolCallPart(tc.id, tc.name, {}));
                }
            }
        } finally {
            cancelListener.dispose();
        }
    }

    async provideTokenCount(model, text, _token) {
        return estimateTokens(text);
    }
}

function activate(context) {
    const provider = new KimiChatProvider(context);
    context.subscriptions.push(
        vscode.lm.registerLanguageModelChatProvider('kimi', provider),
    );
    console.log('Kimi for Copilot activated');
}

function deactivate() {}

module.exports = { activate, deactivate };

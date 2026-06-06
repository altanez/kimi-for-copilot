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
const USAGE_STATS_KEY = 'opencode.usageStats';

function getConfiguration() {
    return vscode.workspace.getConfiguration(CONFIG_SECTION);
}

function getWorkspaceId() {
    return getConfiguration().get('workspaceId') || '';
}

function getUsageDashboardUrl(workspaceId) {
    return `https://opencode.ai/workspace/${workspaceId}/usage`;
}

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
    // gpt-5.3-codex-spark removed: provider returns model_not_found for this id.
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
    // Free/stealth (chat)
    { id: 'big-pickle', name: 'Big Pickle', detail: 'Free stealth', maxInput: 131072, maxOutput: 8192, api: 'chat' },
    { id: 'mimo-v2.5-free', name: 'MiMo V2.5 Free', detail: 'Free tier', maxInput: 131072, maxOutput: 8192, api: 'chat' },
    { id: 'nemotron-3-super-free', name: 'Nemotron 3 Super Free', detail: 'NVIDIA free', maxInput: 131072, maxOutput: 8192, api: 'chat' },
];

function numberOrZero(value) {
    return Number.isFinite(value) ? value : 0;
}

function createEmptyUsageStats() {
    return {
        totalRequests: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalReasoningTokens: 0,
        totalTokens: 0,
        lastRequest: null,
        byModel: {},
    };
}

function normalizeUsage(usage, apiType) {
    if (!usage || typeof usage !== 'object') return null;

    const inputTokens = numberOrZero(usage.prompt_tokens ?? usage.input_tokens ?? usage.promptTokens ?? usage.inputTokens);
    const outputTokens = numberOrZero(usage.completion_tokens ?? usage.output_tokens ?? usage.completionTokens ?? usage.outputTokens);
    const reasoningTokens = numberOrZero(
        usage.completion_tokens_details?.reasoning_tokens
        ?? usage.output_tokens_details?.reasoning_tokens
        ?? usage.reasoning_tokens
        ?? usage.reasoningTokens
    );
    const totalTokens = numberOrZero(usage.total_tokens ?? usage.totalTokens) || (inputTokens + outputTokens);

    if (!inputTokens && !outputTokens && !reasoningTokens && !totalTokens) return null;

    return {
        apiType,
        inputTokens,
        outputTokens,
        reasoningTokens,
        totalTokens,
        raw: usage,
    };
}

function sanitizeUsageStats(value) {
    const base = createEmptyUsageStats();
    if (!value || typeof value !== 'object') return base;

    const byModel = {};
    if (value.byModel && typeof value.byModel === 'object') {
        for (const [modelId, modelStats] of Object.entries(value.byModel)) {
            byModel[modelId] = {
                requests: numberOrZero(modelStats?.requests),
                inputTokens: numberOrZero(modelStats?.inputTokens),
                outputTokens: numberOrZero(modelStats?.outputTokens),
                reasoningTokens: numberOrZero(modelStats?.reasoningTokens),
                totalTokens: numberOrZero(modelStats?.totalTokens),
                lastUsedAt: typeof modelStats?.lastUsedAt === 'string' ? modelStats.lastUsedAt : null,
            };
        }
    }

    return {
        totalRequests: numberOrZero(value.totalRequests),
        totalInputTokens: numberOrZero(value.totalInputTokens),
        totalOutputTokens: numberOrZero(value.totalOutputTokens),
        totalReasoningTokens: numberOrZero(value.totalReasoningTokens),
        totalTokens: numberOrZero(value.totalTokens),
        lastRequest: value.lastRequest && typeof value.lastRequest === 'object'
            ? {
                modelId: value.lastRequest.modelId || '',
                apiType: value.lastRequest.apiType || '',
                timestamp: value.lastRequest.timestamp || '',
                inputTokens: numberOrZero(value.lastRequest.inputTokens),
                outputTokens: numberOrZero(value.lastRequest.outputTokens),
                reasoningTokens: numberOrZero(value.lastRequest.reasoningTokens),
                totalTokens: numberOrZero(value.lastRequest.totalTokens),
            }
            : null,
        byModel,
    };
}

function formatCompactNumber(value) {
    return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(numberOrZero(value));
}

function formatUsageDetails(usage) {
    if (!usage) return 'No usage data captured yet.';
    const parts = [
        `total ${usage.totalTokens} tok`,
        `in ${usage.inputTokens}`,
        `out ${usage.outputTokens}`,
    ];
    if (usage.reasoningTokens) parts.push(`reasoning ${usage.reasoningTokens}`);
    return parts.join(' | ');
}

class OpenCodeUsageTracker {
    constructor(context) {
        this.context = context;
        this.outputChannel = vscode.window.createOutputChannel('OpenCode Zen Usage');
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 90);
        this.statusBarItem.command = 'opencode-copilot.showUsageStats';
        this.statusBarItem.name = 'OpenCode Zen Usage';
        this.statusBarItem.show();
        this.render();

        context.subscriptions.push(this.outputChannel, this.statusBarItem);
    }

    getStats() {
        return sanitizeUsageStats(this.context.globalState.get(USAGE_STATS_KEY));
    }

    async recordUsage(modelId, usage) {
        if (!usage) return;

        const stats = this.getStats();
        const timestamp = new Date().toISOString();
        const modelStats = stats.byModel[modelId] || {
            requests: 0,
            inputTokens: 0,
            outputTokens: 0,
            reasoningTokens: 0,
            totalTokens: 0,
            lastUsedAt: null,
        };

        modelStats.requests += 1;
        modelStats.inputTokens += usage.inputTokens;
        modelStats.outputTokens += usage.outputTokens;
        modelStats.reasoningTokens += usage.reasoningTokens;
        modelStats.totalTokens += usage.totalTokens;
        modelStats.lastUsedAt = timestamp;
        stats.byModel[modelId] = modelStats;

        stats.totalRequests += 1;
        stats.totalInputTokens += usage.inputTokens;
        stats.totalOutputTokens += usage.outputTokens;
        stats.totalReasoningTokens += usage.reasoningTokens;
        stats.totalTokens += usage.totalTokens;
        stats.lastRequest = {
            modelId,
            apiType: usage.apiType,
            timestamp,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            reasoningTokens: usage.reasoningTokens,
            totalTokens: usage.totalTokens,
        };

        await this.context.globalState.update(USAGE_STATS_KEY, stats);
        this.render(stats);
    }

    async reset() {
        const emptyStats = createEmptyUsageStats();
        await this.context.globalState.update(USAGE_STATS_KEY, emptyStats);
        this.render(emptyStats);
    }

    render(stats = this.getStats()) {
        if (!stats.totalRequests) {
            this.statusBarItem.text = 'OpenCode: no usage';
            this.statusBarItem.tooltip = 'OpenCode Zen usage is empty. Run a chat request to capture local stats.';
            return;
        }

        const lastRequest = stats.lastRequest;
        this.statusBarItem.text = `OpenCode: ${formatCompactNumber(stats.totalTokens)} tok`;
        this.statusBarItem.tooltip = [
            `Requests: ${stats.totalRequests}`,
            `Tokens: ${stats.totalTokens}`,
            `Input: ${stats.totalInputTokens}`,
            `Output: ${stats.totalOutputTokens}`,
            `Reasoning: ${stats.totalReasoningTokens}`,
            lastRequest ? `Last: ${lastRequest.modelId} | ${formatUsageDetails(lastRequest)}` : '',
            'Click to open the detailed local usage report.',
        ].filter(Boolean).join('\n');
    }

    showReport() {
        const stats = this.getStats();
        const lines = [
            'OpenCode Zen local usage report',
            '',
            `Remaining credits: unavailable. No documented OpenCode Zen billing endpoint is integrated in this extension.`,
            `Total requests: ${stats.totalRequests}`,
            `Total tokens: ${stats.totalTokens}`,
            `Input tokens: ${stats.totalInputTokens}`,
            `Output tokens: ${stats.totalOutputTokens}`,
            `Reasoning tokens: ${stats.totalReasoningTokens}`,
        ];

        if (stats.lastRequest) {
            lines.push('');
            lines.push(`Last request: ${stats.lastRequest.timestamp}`);
            lines.push(`Last model: ${stats.lastRequest.modelId}`);
            lines.push(`Last usage: ${formatUsageDetails(stats.lastRequest)}`);
        }

        const modelEntries = Object.entries(stats.byModel).sort((left, right) => right[1].totalTokens - left[1].totalTokens);
        if (modelEntries.length > 0) {
            lines.push('');
            lines.push('Per-model totals:');
            for (const [modelId, modelStats] of modelEntries) {
                lines.push(`- ${modelId}: ${modelStats.requests} req | ${modelStats.totalTokens} tok | in ${modelStats.inputTokens} | out ${modelStats.outputTokens}`);
            }
        }

        this.outputChannel.clear();
        this.outputChannel.appendLine(lines.join('\n'));
        this.outputChannel.show(true);
    }
}

function getApiKey() {
    return getConfiguration().get('apiKey') || '';
}

async function ensureWorkspaceId() {
    const existingWorkspaceId = getWorkspaceId().trim();
    if (existingWorkspaceId) return existingWorkspaceId;

    const enteredWorkspaceId = await vscode.window.showInputBox({
        title: 'OpenCode Zen Workspace ID',
        prompt: 'Enter the workspace ID from the usage URL',
        placeHolder: 'wrk_XXXXXXXXXXXXXXXXXXXXXXXXXX',
        ignoreFocusOut: true,
        validateInput(value) {
            if (!value.trim()) return 'Workspace ID is required.';
            if (!/^wrk_[A-Za-z0-9]+$/.test(value.trim())) return 'Expected an OpenCode workspace ID like wrk_...';
            return null;
        },
    });

    if (!enteredWorkspaceId) return '';

    const workspaceId = enteredWorkspaceId.trim();
    await getConfiguration().update('workspaceId', workspaceId, vscode.ConfigurationTarget.Global);
    return workspaceId;
}

async function openUsageDashboard() {
    const workspaceId = await ensureWorkspaceId();
    if (!workspaceId) return;

    const usageUrl = getUsageDashboardUrl(workspaceId);
    await vscode.env.openExternal(vscode.Uri.parse(usageUrl));
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
        id: m.id, name: m.name, family: 'opencode',
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
        const modelId = model.id;
    const body = { model: modelId, messages: openaiMessages, stream: true, stream_options: { include_usage: true } };
    if (options.tools?.length > 0) {
        body.tools = options.tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters || { type: 'object', properties: {} } } }));
        body.tool_choice = 'auto';
    }
    console.log('[opencode-buildRequestBody]', JSON.stringify(body));
    return body;
}

// --- Build Responses API body for GPT models ---
function buildResponsesBody(model, messages, options) {
    const modelId = model.id;
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
    console.log('[opencode-buildResponsesBody]', JSON.stringify(body));
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
            let closed = false;
            function closeOnce() {
                if (!closed) { closed = true; controller.close(); }
            }
            readable.on('data', (chunk) => {
                buffer += decoder.decode(chunk, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';
                for (const line of lines) {
                    const trimmed = line.trim();
                    console.log('[opencode-raw-sse]', trimmed);
                    if (!trimmed) { currentEvent = ''; continue; }
                    if (trimmed.startsWith('event: ')) { currentEvent = trimmed.slice(7); continue; }

                    // Chat completions: "data: [DONE]" or "data:[DONE]"
                    if (trimmed === 'data: [DONE]' || trimmed === 'data:[DONE]') { closeOnce(); return; }

                    // Responses API: "data: [DONE]" via different format
                    if (trimmed === '[DONE]') { closeOnce(); return; }

                    const dataPrefix = trimmed.startsWith('data: ') ? 'data: ' : (trimmed.startsWith('data:') ? 'data:' : null);
                    if (!dataPrefix) continue;

                    try {
                        const obj = JSON.parse(trimmed.slice(dataPrefix.length));

                        if (apiType === 'responses') {
                            // GPT Responses API format
                            const type = obj.type || currentEvent;
                            const result = {};
                            const usage = normalizeUsage(obj.usage || obj.response?.usage, apiType);
                            if (usage) result.usage = usage;
                            // Stream-level errors (e.g. model_not_found) come as an
                            // explicit "error" event before response.failed.
                            const errorPayload = obj.error || obj.response?.error;
                            if (type === 'error' || errorPayload) {
                                const message = errorPayload?.message || obj.message || 'OpenCode Zen stream error';
                                const code = errorPayload?.code || errorPayload?.type || '';
                                result.errorMessage = code ? `${code}: ${message}` : message;
                            }
                            if (type === 'response.output_text.delta') {
                                result.content = obj.delta || '';
                            } else if (type === 'response.output_text.done') {
                                // Fallback: some models emit only the final text without per-token deltas.
                                if (obj.text) result.fallbackText = obj.text;
                            } else if (type === 'response.refusal.delta') {
                                result.content = obj.delta || '';
                            } else if (
                                type === 'response.reasoning_summary_part.added'
                                || type === 'response.reasoning_summary_text.delta'
                                || type === 'response.reasoning_text.delta'
                            ) {
                                result.reasoning = obj.delta || obj.summary?.[0]?.text || obj.text || '';
                            } else if (type === 'response.completed' || type === 'response.failed') {
                                result.finishReason = type === 'response.completed' ? 'stop' : 'error';
                                // Pull final text from response.output if no deltas arrived.
                                const outputItems = obj.response?.output;
                                if (Array.isArray(outputItems)) {
                                    const collected = [];
                                    for (const item of outputItems) {
                                        const parts = item?.content;
                                        if (!Array.isArray(parts)) continue;
                                        for (const part of parts) {
                                            if (part?.type === 'output_text' && typeof part.text === 'string') {
                                                collected.push(part.text);
                                            }
                                        }
                                    }
                                    if (collected.length > 0) result.fallbackText = collected.join('');
                                }
                                if (type === 'response.failed') {
                                    const failMessage = obj.response?.error?.message || obj.error?.message || '';
                                    if (failMessage) result.errorMessage = failMessage;
                                }
                            }
                            if (Object.keys(result).length > 0) {
                                controller.enqueue(result);
                            }
                            if (type === 'response.completed' || type === 'response.failed') {
                                closeOnce();
                            }
                            // Ignore other events (response.created, etc.)
                        } else {
                            // Chat completions format
                            const result = {};
                            const usage = normalizeUsage(obj.usage, apiType);
                            if (usage) result.usage = usage;
                            const choices = obj.choices;
                            if (choices?.length) {
                                const delta = choices[0].delta;
                                if (delta?.content) result.content = delta.content;
                                if (delta?.reasoning_content) result.reasoning = delta.reasoning_content;
                                if (delta?.tool_calls) result.toolCalls = delta.tool_calls;
                                if (choices[0].finish_reason) result.finishReason = choices[0].finish_reason;
                            }
                            if (Object.keys(result).length > 0) controller.enqueue(result);
                        }
                    } catch { /* skip malformed JSON */ }
                }
            });
            readable.on('end', () => closeOnce());
            readable.on('error', (e) => { if (!closed) { closed = true; controller.error(e); } });
        },
    });
}

// --- Chunked transfer encoding decoder (for proxy path) ---
function createChunkedDecoder() {
    const { Transform } = require('stream');
    let buf = Buffer.alloc(0);
    return new Transform({
        transform(chunk, _encoding, callback) {
            buf = Buffer.concat([buf, chunk]);
            while (buf.length > 0) {
                const rnIdx = buf.indexOf('\r\n');
                if (rnIdx === -1) break;
                const sizeStr = buf.toString('ascii', 0, rnIdx);
                const semiIdx = sizeStr.indexOf(';');
                const chunkSize = parseInt(semiIdx >= 0 ? sizeStr.slice(0, semiIdx) : sizeStr, 16);
                if (isNaN(chunkSize)) { callback(new Error('Bad chunk size: ' + sizeStr)); return; }
                if (chunkSize === 0) { buf = Buffer.alloc(0); break; }
                const dataStart = rnIdx + 2;
                const dataEnd = dataStart + chunkSize;
                if (buf.length < dataEnd + 2) break;
                this.push(buf.slice(dataStart, dataEnd));
                buf = buf.slice(dataEnd + 2);
            }
            callback();
        },
        flush(callback) {
            if (buf.length > 0) this.push(buf);
            callback();
        },
    });
}

function zenFetch(apiKey, body, path, signal, apiType) {
    const proxy = getSystemProxy();
    const reqBody = JSON.stringify(body);
    console.log('[opencode-request]', path, reqBody);
    const reqBodyBuffer = Buffer.from(reqBody, 'utf-8');
    return new Promise((resolve, reject) => {
        function makeRequest(socket) {
            if (socket) {
                const tlsSocket = tls.connect({ socket, host: ZEN_HOST, servername: ZEN_HOST, rejectUnauthorized: false });
                const headers = [
                    `POST ${path} HTTP/1.1`, `Host: ${ZEN_HOST}`, 'Content-Type: application/json',
                    `Authorization: Bearer ${apiKey}`, 'User-Agent: claude-code/0.1.0',
                    `Content-Length: ${reqBodyBuffer.length}`, 'Connection: close', '', '',
                ].join('\r\n');
                tlsSocket.write(headers);
                tlsSocket.write(reqBodyBuffer);
                if (signal) signal.addEventListener('abort', () => tlsSocket.destroy());
                // Use Buffer for header parsing to avoid UTF-8 corruption at chunk boundaries
                const headerChunks = [];
                let headerDone = false;
                const onHeaderData = (chunk) => {
                    if (headerDone) return;
                    headerChunks.push(chunk);
                    const buf = Buffer.concat(headerChunks);
                    const headerEnd = buf.indexOf('\r\n\r\n');
                    if (headerEnd < 0) return;

                    headerDone = true;
                    // CRITICAL: stop receiving data via this listener BEFORE piping,
                    // otherwise body bytes get split between this handler and the pipe
                    // (Node still calls every 'data' listener, but our handler ignores
                    // them once headerDone is true → data is silently dropped).
                    tlsSocket.removeListener('data', onHeaderData);

                    const code = parseInt(buf.toString('ascii', 0, buf.indexOf('\r\n')).split(' ')[1]);
                    const headerStr = buf.toString('ascii', 0, headerEnd);
                    const isChunked = /transfer-encoding:\s*chunked/i.test(headerStr);
                    // Extract remaining body bytes after headers (as Buffer, NOT string)
                    const bodyStart = headerEnd + 4;
                    const remaining = buf.length > bodyStart ? buf.slice(bodyStart) : null;
                    const fakeStream = new (require('stream').PassThrough)();
                    if (isChunked) {
                        const chunkedDecoder = createChunkedDecoder();
                        // The remaining bytes are still chunk-encoded, so they MUST go
                        // through the decoder, not directly into fakeStream.
                        if (remaining && remaining.length > 0) chunkedDecoder.write(remaining);
                        chunkedDecoder.pipe(fakeStream);
                        tlsSocket.pipe(chunkedDecoder);
                    } else {
                        if (remaining && remaining.length > 0) fakeStream.write(remaining);
                        tlsSocket.pipe(fakeStream);
                    }
                    resolve({
                        ok: code >= 200 && code < 300,
                        status: code,
                        body: parseSSEFromNode(fakeStream, apiType),
                        text: () => Promise.resolve(remaining ? remaining.toString('utf-8') : ''),
                    });
                };
                tlsSocket.on('data', onHeaderData);
                tlsSocket.on('error', reject);
            } else {
                const req = https.request({
                    hostname: ZEN_HOST, path: path, method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}`, 'User-Agent': 'claude-code/0.1.0', 'Content-Length': reqBodyBuffer.length },
                    rejectUnauthorized: false,
                }, (res) => {
                    resolve({
                        ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body: parseSSEFromNode(res, apiType),
                        text: () => new Promise((r, rej) => { let d = ''; res.on('data', c => d += c.toString()); res.on('end', () => r(d)); res.on('error', rej); }),
                    });
                });
                req.on('error', reject); req.write(reqBodyBuffer); req.end();
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
    constructor(context, usageTracker) {
        this.usageTracker = usageTracker;
        context.subscriptions.push(this.onDidChangeLanguageModelChatInformationEmitter,
            vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration(CONFIG_SECTION)) this.onDidChangeLanguageModelChatInformationEmitter.fire(); }));
    }
    async provideLanguageModelChatInformation() { return MODELS.map(toChatInfo); }
    async provideLanguageModelChatResponse(model, messages, options, progress, token) {
        const apiKey = getApiKey();
        if (!apiKey) throw new Error('OpenCode Zen API key not set. Configure opencode-copilot.apiKey in VS Code settings.');
        
        // Find model definition to determine API type
        const modelId = model.id;
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
            let lastUsage = null;
            let streamErrorMessage = null;
            let producedAnyText = false;
            let fallbackText = '';
            const reader = response.body.getReader();
            while (true) {
                if (token.isCancellationRequested) return;
                const { done, value: chunk } = await reader.read();
                console.log('[opencode-chunk]', JSON.stringify(chunk));
if (done) break;
                
                if (chunk.errorMessage) streamErrorMessage = chunk.errorMessage;
                if (chunk.content) {
                    progress.report(new vscode.LanguageModelTextPart(chunk.content));
                    producedAnyText = true;
                }
                if (chunk.reasoning) {
                    progress.report(new vscode.LanguageModelTextPart(chunk.reasoning));
                    producedAnyText = true;
                }
                if (chunk.fallbackText) fallbackText = chunk.fallbackText;
                if (chunk.usage) lastUsage = chunk.usage;
                
                // Handle tool calls from chat completions format
                if (chunk.toolCalls) {
                    for (const tc of chunk.toolCalls) {
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
                if (chunk.finishReason) {
                    for (const tc of pendingToolCalls.values()) {
                        try { progress.report(new vscode.LanguageModelToolCallPart(tc.id, tc.name, JSON.parse(tc.arguments || '{}'))); }
                        catch { progress.report(new vscode.LanguageModelToolCallPart(tc.id, tc.name, {})); }
                    }
                    pendingToolCalls.clear();
                }
            }
            await this.usageTracker.recordUsage(modelId, lastUsage);

            if (streamErrorMessage) {
                throw new Error(`OpenCode Zen (${modelId}): ${streamErrorMessage}`);
            }
            if (!producedAnyText && fallbackText) {
                progress.report(new vscode.LanguageModelTextPart(fallbackText));
                producedAnyText = true;
            }
            if (!producedAnyText && apiType === 'responses') {
                throw new Error(
                    `OpenCode Zen (${modelId}) returned no text. The model likely produced only an empty reasoning trace.`
                    + ' Try another GPT model (e.g. gpt-5.4-mini) or check your OpenCode plan.'
                );
            }
        } finally { cancelListener.dispose(); }
    }
    async provideTokenCount(model, text) { return estimateTokens(text); }
}

function activate(context) {
    const usageTracker = new OpenCodeUsageTracker(context);
    const provider = new OpenCodeChatProvider(context, usageTracker);
    context.subscriptions.push(
        vscode.lm.registerLanguageModelChatProvider('opencode', provider),
        vscode.commands.registerCommand('opencode-copilot.openUsageDashboard', () => openUsageDashboard()),
        vscode.commands.registerCommand('opencode-copilot.showUsageStats', () => usageTracker.showReport()),
        vscode.commands.registerCommand('opencode-copilot.resetUsageStats', async () => {
            const choice = await vscode.window.showWarningMessage('Reset saved OpenCode Zen usage statistics?', { modal: true }, 'Reset');
            if (choice === 'Reset') {
                await usageTracker.reset();
            }
        }),
    );
    console.log('OpenCode Zen for Copilot activated');
}
function deactivate() {}
module.exports = { activate, deactivate };

# OpenCode Zen for Copilot

Добавляет 40 моделей из подписки OpenCode Zen в выпадающий список GitHub Copilot Chat.

## Быстрая установка

```powershell
powershell -ExecutionPolicy Bypass -File install.ps1
```

## Ручная установка

1. Скопируй папку `opencode-for-copilot` в:
   ```
   %USERPROFILE%\.vscode\extensions\local.opencode-for-copilot\
   ```

2. В VS Code `settings.json` (`Ctrl+Shift+P` → `Preferences: Open User Settings (JSON)`) добавь:

   ```json
   {
     "opencode-copilot.apiKey": "твой-ключ-из-opencode-ai-auth"
   }
   ```

   > Ключ: https://opencode.ai/auth → скопировать API key.

3. Перезагрузи VS Code: `Ctrl+Shift+P` → `Developer: Reload Window`

## Модели (40)

### Claude (9) — через `/zen/v1/chat/completions`
`claude-opus-4-8`, `claude-opus-4-7`, `claude-opus-4-6`, `claude-opus-4-5`, `claude-opus-4-1`, `claude-sonnet-4-6`, `claude-sonnet-4-5`, `claude-sonnet-4`, `claude-haiku-4-5`

### GPT (17) — через `/zen/v1/responses`
`gpt-5.5`, `gpt-5.5-pro`, `gpt-5.4`, `gpt-5.4-pro`, `gpt-5.4-mini`, `gpt-5.4-nano`, `gpt-5.3-codex-spark`, `gpt-5.3-codex`, `gpt-5.2`, `gpt-5.2-codex`, `gpt-5.1`, `gpt-5.1-codex-max`, `gpt-5.1-codex`, `gpt-5.1-codex-mini`, `gpt-5`, `gpt-5-codex`, `gpt-5-nano`

### DeepSeek (2)
`deepseek-v4-flash`, `deepseek-v4-flash-free` (бесплатно)

### Kimi (2)
`kimi-k2.6`, `kimi-k2.5`

### MiniMax (3)
`minimax-m2.7`, `minimax-m2.5`, `minimax-m3-free` (бесплатно)

### GLM (2)
`glm-5.1`, `glm-5`

### Grok (1)
`grok-build-0.1`

### Qwen (2)
`qwen3.6-plus`, `qwen3.5-plus`

### Бесплатные (2)
`big-pickle`, `mimo-v2.5-free`, `nemotron-3-super-free`

## Для пользователей из России

Расширение автоматически идёт через системный прокси (Hiddify, VPN) через HTTP CONNECT туннель.

## Устранение неполадок

| Ошибка | Решение |
|--------|---------|
| `fetch failed` | Проверь VPN/прокси |
| `401` | Проверь API ключ `opencode-copilot.apiKey` |
| `400 tools...input_schema` | Должно быть исправлено в последней версии |
| Модели не видны | `Developer: Reload Window` |

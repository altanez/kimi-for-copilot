# Kimi for Copilot

Добавляет модели Kimi (Kimi Latest, Kimi Thinking, Kimi K2) в выпадающий список моделей GitHub Copilot Chat.

## Быстрая установка

```powershell
# Из папки kimi-for-copilot:
powershell -ExecutionPolicy Bypass -File install.ps1
```

Скрипт скопирует расширение, запросит API-ключ и проверит доступ.

## Ручная установка

1. Скопируй папку `kimi-for-copilot` в:
   ```
   %USERPROFILE%\.vscode\extensions\local.kimi-for-copilot\
   ```

2. В VS Code `settings.json` (`Ctrl+Shift+P` → `Preferences: Open User Settings (JSON)`) добавь:

   ```json
   {
     "kimi-copilot.apiKey": "sk-kimi-твой-ключ-сюда"
   }
   ```

   > Ключ можно получить в личном кабинете Kimi → API Keys.

3. Перезагрузи VS Code: `Ctrl+Shift+P` → `Developer: Reload Window`

## Модели

| Модель | Мышление | Описание |
|--------|----------|----------|
| kimi-latest | Off / Low / High | Быстрая, общего назначения |
| kimi-thinking | Off / Low / High | С улучшенным мышлением |
| kimi-k2 | Off / Low / High | Продвинутая модель |

## Для пользователей из России

Расширение автоматически использует системный прокси (Hiddify, VPN) через HTTP CONNECT туннель. Прямой доступ к `api.kimi.com` блокирован, но расширение обойдёт это, если в системе настроен прокси.

## Устранение неполадок

| Ошибка | Решение |
|--------|---------|
| fetch failed | Проверь, запущен ли VPN/прокси. Расширение использует системный прокси Windows |
| 401 invalid_authentication_error | Проверь API-ключ в `kimi-copilot.apiKey` |
| 403 access_terminated | Должно работать с User-Agent `claude-code/0.1.0`. Если нет — пиши |
| Модели не видны | `Ctrl+Shift+P` → `Developer: Reload Window`, проверь консоль (`Help → Toggle Developer Tools`) |
| Порт занят | Расширение не использует порты (работает напрямую через HTTPS) |

## Файлы

- `extension.js` — код расширения (чистый Node.js, без зависимостей)
- `package.json` — манифест VS Code
- `install.ps1` — скрипт установки

"""
Diagnostics for OpenCode Zen GPT models via the /zen/v1/responses endpoint.

What it does:
  1. Reads the OpenCode API key from your VS Code settings.json
     (no need to paste the key by hand).
  2. Picks up the same system proxy your VS Code extension uses
     (Hiddify / VPN HTTP proxy, http.proxy setting, HTTPS_PROXY env).
  3. Sends a small chat probe to ALL Claude models via /zen/v1/chat/completions
     and ALL GPT models via /zen/v1/responses (as the extension does).
  4. Prints, for each model:
       - HTTP status
       - first few SSE events (raw)
       - total bytes received
       - any error body
  5. Writes a full log to diag_opencode.log next to this script.

Run:
    python diag_opencode.py
    python diag_opencode.py --only gpt-5-nano
    python diag_opencode.py --only gpt-5,claude-haiku-4-5 --timeout 30
"""

from __future__ import annotations

import argparse
import json
import os
import socket
import ssl
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Iterable
from urllib.parse import urlparse

ZEN_HOST = "opencode.ai"
ZEN_PORT = 443
ZEN_CHAT_PATH = "/zen/v1/chat/completions"
ZEN_RESPONSES_PATH = "/zen/v1/responses"

# Same list the extension exposes (subset is enough; we cover both APIs).
GPT_MODELS = [
    "gpt-5.5", "gpt-5.5-pro",
    "gpt-5.4", "gpt-5.4-pro", "gpt-5.4-mini", "gpt-5.4-nano",
    "gpt-5.3-codex-spark", "gpt-5.3-codex",
    "gpt-5.2", "gpt-5.2-codex",
    "gpt-5.1", "gpt-5.1-codex-max", "gpt-5.1-codex", "gpt-5.1-codex-mini",
    "gpt-5", "gpt-5-codex", "gpt-5-nano",
]

CLAUDE_MODELS = [
    "claude-haiku-4-5",
    "claude-sonnet-4-5",
    "claude-opus-4-7",
]


# ---------- settings / proxy helpers ----------

def read_api_key() -> str:
    """Read opencode-copilot.apiKey from VS Code user settings.json (best effort)."""
    candidates = [
        Path(os.environ.get("APPDATA", "")) / "Code" / "User" / "settings.json",
        Path(os.environ.get("APPDATA", "")) / "Code - Insiders" / "User" / "settings.json",
    ]
    for path in candidates:
        if path.is_file():
            try:
                # settings.json may contain JSONC comments; strip simple line comments.
                raw = path.read_text(encoding="utf-8")
                cleaned_lines = []
                for line in raw.splitlines():
                    stripped = line.lstrip()
                    if stripped.startswith("//"):
                        continue
                    cleaned_lines.append(line)
                data = json.loads("\n".join(cleaned_lines))
                key = data.get("opencode-copilot.apiKey", "").strip()
                if key:
                    return key
            except Exception as exc:
                print(f"[warn] failed to parse {path}: {exc}")
    return os.environ.get("OPENCODE_API_KEY", "").strip()


def detect_proxy() -> str | None:
    """Mirror the extension's getSystemProxy behavior (best effort)."""
    for var in ("HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"):
        value = os.environ.get(var)
        if value:
            return value

    # Fallback: ask Windows for the system proxy.
    try:
        import subprocess  # noqa: WPS433
        completed = subprocess.run(
            [
                "powershell",
                "-NoProfile",
                "-Command",
                "[System.Net.WebRequest]::GetSystemWebProxy().GetProxy('https://opencode.ai').AbsoluteUri",
            ],
            capture_output=True,
            text=True,
            timeout=5,
        )
        out = (completed.stdout or "").strip()
        if out and out != "https://opencode.ai/":
            return out.rstrip("/")
    except Exception:
        pass
    return None


# ---------- low-level HTTP/SSE over a raw socket ----------

def open_socket(proxy: str | None, timeout: float) -> ssl.SSLSocket:
    """Open a TLS socket to opencode.ai, optionally via HTTP CONNECT proxy."""
    if proxy:
        parsed = urlparse(proxy if "://" in proxy else f"http://{proxy}")
        phost = parsed.hostname
        pport = parsed.port or 8080
        raw = socket.create_connection((phost, pport), timeout=timeout)
        connect_req = (
            f"CONNECT {ZEN_HOST}:{ZEN_PORT} HTTP/1.1\r\n"
            f"Host: {ZEN_HOST}:{ZEN_PORT}\r\n\r\n"
        ).encode("ascii")
        raw.sendall(connect_req)
        buf = b""
        while b"\r\n\r\n" not in buf:
            chunk = raw.recv(4096)
            if not chunk:
                raise RuntimeError("Proxy closed connection during CONNECT")
            buf += chunk
        status_line = buf.split(b"\r\n", 1)[0].decode("ascii", "replace")
        if " 200 " not in status_line and not status_line.endswith(" 200"):
            raise RuntimeError(f"Proxy CONNECT failed: {status_line!r}")
        ctx = ssl._create_unverified_context()  # noqa: S323 — match extension behavior
        return ctx.wrap_socket(raw, server_hostname=ZEN_HOST)

    raw = socket.create_connection((ZEN_HOST, ZEN_PORT), timeout=timeout)
    ctx = ssl._create_unverified_context()  # noqa: S323
    return ctx.wrap_socket(raw, server_hostname=ZEN_HOST)


def send_request(sock: ssl.SSLSocket, path: str, api_key: str, payload: dict) -> None:
    body = json.dumps(payload).encode("utf-8")
    headers = (
        f"POST {path} HTTP/1.1\r\n"
        f"Host: {ZEN_HOST}\r\n"
        "Content-Type: application/json\r\n"
        f"Authorization: Bearer {api_key}\r\n"
        "User-Agent: claude-code/0.1.0\r\n"
        f"Content-Length: {len(body)}\r\n"
        "Connection: close\r\n\r\n"
    ).encode("ascii")
    sock.sendall(headers + body)


def read_response(sock: ssl.SSLSocket, deadline: float, log) -> tuple[int, dict, bytes]:
    """Read headers + body until close or deadline. Returns (status, headers, body)."""
    buf = b""
    while b"\r\n\r\n" not in buf:
        if time.time() > deadline:
            raise TimeoutError("Timed out waiting for response headers")
        sock.settimeout(max(0.5, deadline - time.time()))
        chunk = sock.recv(4096)
        if not chunk:
            raise RuntimeError("Connection closed before headers")
        buf += chunk

    header_blob, _, rest = buf.partition(b"\r\n\r\n")
    head_lines = header_blob.decode("iso-8859-1").split("\r\n")
    status_line = head_lines[0]
    try:
        status = int(status_line.split()[1])
    except (IndexError, ValueError):
        status = -1
    headers = {}
    for line in head_lines[1:]:
        if ":" in line:
            k, _, v = line.partition(":")
            headers[k.strip().lower()] = v.strip()

    is_chunked = headers.get("transfer-encoding", "").lower() == "chunked"

    body = rest
    try:
        while True:
            if time.time() > deadline:
                log("[warn] read deadline reached while streaming body")
                break
            sock.settimeout(max(0.5, deadline - time.time()))
            chunk = sock.recv(8192)
            if not chunk:
                break
            body += chunk
    except (TimeoutError, socket.timeout):
        log("[warn] socket timeout while streaming body")
    except OSError as exc:
        log(f"[warn] socket error while streaming: {exc}")

    if is_chunked:
        body = decode_chunked(body)
    return status, headers, body


def decode_chunked(data: bytes) -> bytes:
    out = bytearray()
    i = 0
    while i < len(data):
        crlf = data.find(b"\r\n", i)
        if crlf < 0:
            break
        size_str = data[i:crlf].split(b";", 1)[0].strip()
        try:
            size = int(size_str, 16)
        except ValueError:
            break
        i = crlf + 2
        if size == 0:
            break
        if i + size > len(data):
            out += data[i:]
            break
        out += data[i:i + size]
        i += size + 2
    return bytes(out)


# ---------- test orchestration ----------

def make_chat_payload(model: str) -> dict:
    return {
        "model": model,
        "messages": [
            {"role": "system", "content": "You are a probe. Reply with the single word PONG."},
            {"role": "user", "content": "ping"},
        ],
        "stream": True,
        "stream_options": {"include_usage": True},
    }


def make_responses_payload(model: str) -> dict:
    return {
        "model": model,
        "input": "ping",
        "instructions": "You are a probe. Reply with the single word PONG.",
        "stream": True,
    }


def probe_model(model: str, api: str, api_key: str, proxy: str | None, timeout: float, log, full_dump_dir: Path | None = None) -> dict:
    path = ZEN_RESPONSES_PATH if api == "responses" else ZEN_CHAT_PATH
    payload = make_responses_payload(model) if api == "responses" else make_chat_payload(model)
    result = {
        "model": model,
        "api": api,
        "status": None,
        "ok": False,
        "bytes": 0,
        "first_sse_events": [],
        "error": None,
        "duration_ms": 0,
    }
    started = time.time()
    deadline = started + timeout
    try:
        sock = open_socket(proxy, timeout)
        try:
            send_request(sock, path, api_key, payload)
            status, headers, body = read_response(sock, deadline, log)
        finally:
            try:
                sock.close()
            except Exception:
                pass
        result["status"] = status
        result["bytes"] = len(body)
        result["headers"] = {k: v for k, v in headers.items() if k in (
            "content-type", "transfer-encoding", "server", "x-request-id",
            "x-amzn-requestid", "cf-ray", "x-ratelimit-remaining-requests",
            "x-ratelimit-remaining-tokens",
        )}

        text = body.decode("utf-8", "replace")
        if full_dump_dir is not None:
            dump_path = full_dump_dir / f"{model.replace('/', '_')}.{api}.sse.txt"
            dump_path.write_text(text, encoding="utf-8")
            log(f"   full body written to {dump_path}")
        if status and 200 <= status < 300:
            # Pull first few SSE events for sanity.
            events = []
            for line in text.split("\n"):
                line = line.rstrip("\r")
                if not line:
                    continue
                events.append(line[:200])
                if len(events) >= 8:
                    break
            result["first_sse_events"] = events
            result["ok"] = any(line.startswith("data:") or line.startswith("event:") for line in events)
            if not result["ok"]:
                result["error"] = f"no SSE frames in {len(body)} bytes; first: {text[:300]!r}"
        else:
            result["error"] = text[:1000] or f"HTTP {status} without body"
    except Exception as exc:  # noqa: BLE001
        result["error"] = f"{type(exc).__name__}: {exc}"
    finally:
        result["duration_ms"] = int((time.time() - started) * 1000)
    return result


def filter_models(only: str | None) -> Iterable[tuple[str, str]]:
    if only:
        wanted = {m.strip() for m in only.split(",") if m.strip()}
    else:
        wanted = None
    for m in CLAUDE_MODELS:
        if wanted is None or m in wanted:
            yield m, "chat"
    for m in GPT_MODELS:
        if wanted is None or m in wanted:
            yield m, "responses"


def main() -> int:
    parser = argparse.ArgumentParser(description="OpenCode Zen GPT/Claude diagnostics")
    parser.add_argument("--only", help="Comma-separated model ids to probe (default: all)")
    parser.add_argument("--timeout", type=float, default=20.0, help="Per-request timeout seconds")
    parser.add_argument("--no-proxy", action="store_true", help="Ignore detected system proxy")
    parser.add_argument("--log", default="diag_opencode.log", help="Log file path")
    parser.add_argument("--full", action="store_true", help="Dump full SSE body per probed model into ./diag_full/")
    args = parser.parse_args()

    api_key = read_api_key()
    if not api_key:
        print("ERROR: no OpenCode API key found in settings.json or OPENCODE_API_KEY env.")
        return 2

    proxy = None if args.no_proxy else detect_proxy()

    log_path = Path(__file__).with_name(args.log)
    log_file = log_path.open("w", encoding="utf-8")

    def log(msg: str) -> None:
        ts = datetime.now().strftime("%H:%M:%S")
        line = f"[{ts}] {msg}"
        print(line)
        log_file.write(line + "\n")
        log_file.flush()

    log(f"host        : {ZEN_HOST}")
    log(f"proxy       : {proxy or '(direct)'}")
    log(f"key length  : {len(api_key)} chars")
    log(f"timeout     : {args.timeout:.1f}s per request")
    log("")

    dump_dir = None
    if args.full:
        dump_dir = Path(__file__).with_name("diag_full")
        dump_dir.mkdir(exist_ok=True)
        log(f"full dumps -> {dump_dir}")

    results = []
    for model, api in filter_models(args.only):
        log(f"-> probing {api:>9}  {model}")
        result = probe_model(model, api, api_key, proxy, args.timeout, log, dump_dir)
        results.append(result)
        ok = "OK " if result["ok"] else "FAIL"
        log(
            f"   {ok}  status={result['status']}  bytes={result['bytes']}"
            f"  in {result['duration_ms']} ms"
        )
        if result["error"]:
            log(f"   error: {result['error'][:500]}")
        if result["first_sse_events"]:
            log("   first SSE lines:")
            for line in result["first_sse_events"]:
                log(f"     | {line}")
        log("")

    log("=" * 60)
    log("Summary:")
    by_api = {"chat": [], "responses": []}
    for r in results:
        by_api[r["api"]].append(r)
    for api, group in by_api.items():
        good = sum(1 for r in group if r["ok"])
        log(f"  {api:>9}: {good}/{len(group)} OK")
        for r in group:
            mark = "ok" if r["ok"] else "FAIL"
            log(f"    {mark:>4}  {r['model']:<25}  status={r['status']}  {r['error'] or ''}".rstrip())

    log_file.close()
    print(f"\nLog written to {log_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

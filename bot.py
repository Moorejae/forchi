"""
ForChi Python Bot — Blueprint-Aligned Webhook Architecture
Listens on port 7860 for inbound Telegram webhooks from https://slymun-forchi.hf.space/webhook/...
Sends outbound replies via standard Python urllib.request with explicit SSL context.
"""

import os
import re
import json
import logging
import ssl
import sys
import threading
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer

import requests
from dotenv import load_dotenv

load_dotenv()

# ── Logging Setup ─────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S"
)
log = logging.getLogger("forchi")

TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "8677027954:AAH--6gevU8ph2LQD16CqjM8W04SrterlJw").strip()
GEMINI_KEYS = [k.strip() for k in os.environ.get("GEMINI_KEYS", "").split(",") if k.strip()]
HF_TOKEN = (os.environ.get("HF_TOKEN") or os.environ.get("HF_ACCESS_TOKEN") or "").strip()
PORT = int(os.environ.get("PORT", 7860))

# Default Telegram API Base URL
DEFAULT_BASE = "https://api.telegram.org"
TELEGRAM_API_BASE = os.environ.get("TELEGRAM_API_BASE", DEFAULT_BASE).rstrip("/")
TELEGRAM_API = f"{TELEGRAM_API_BASE}/bot{TOKEN}"

log.info("===== ForChi Webhook-Based Bot Startup =====")
log.info(f"TELEGRAM_BOT_TOKEN present: {bool(TOKEN)}")
log.info(f"TELEGRAM_API_BASE: {TELEGRAM_API_BASE}")
log.info(f"GEMINI_KEYS count: {len(GEMINI_KEYS)}")
log.info(f"HF_TOKEN present: {bool(HF_TOKEN)}")

# ── Layer 1 Gate (Blueprint Section 2) ────────────────────────────────────────
POST_TRIGGER = re.compile(r'\bmake\s+a\s+post\b', re.IGNORECASE)

def passes_gate(text: str) -> bool:
    return bool(POST_TRIGGER.search(text))

# ── Layer 2 Extractor (Blueprint Section 3) ───────────────────────────────────
EXTRACTOR_PROMPT = """Extract a social media post request.
isPostTrigger is true ONLY if the user explicitly asks to make, schedule, or publish a post AND names at least one destination (facebook, linkedin, or both) AND provides content/topic.
If any part is missing, isPostTrigger MUST be false.

Return ONLY raw JSON (no markdown):
{
  "isPostTrigger": boolean,
  "destinations": ["facebook" | "linkedin"],
  "content": "extracted post content or topic"
}"""

def extract_post_intent_fallback(text: str) -> dict:
    """Deterministic fallback extractor"""
    lower = text.lower()
    has_action = bool(re.search(r'\b(make|create|publish|send|share|schedule|post)\b', lower))
    if not has_action:
        return {"isPostTrigger": False, "destinations": [], "content": ""}

    destinations = []
    if "facebook" in lower or " fb " in lower:
        destinations.append("facebook")
    if "linkedin" in lower:
        destinations.append("linkedin")

    if not destinations:
        return {"isPostTrigger": False, "destinations": [], "content": ""}

    m = re.search(r'\b(about|for|on|regarding)\s+(.+)', lower)
    content = m.group(2).strip() if m else re.sub(
        r'\b(make|create|publish|send|share|schedule|post|a|the|to|on|facebook|fb|linkedin)\b',
        '', lower
    ).strip()

    if not content or len(content) < 2:
        return {"isPostTrigger": False, "destinations": [], "content": ""}

    return {"isPostTrigger": True, "destinations": destinations, "content": content}

# ── LLM — Gemini waterfall (Blueprint Section 3b) ─────────────────────────────
GEMINI_MODELS = ["gemini-2.0-flash-lite", "gemini-2.0-flash", "gemini-1.5-flash"]
HF_CHAT_MODELS = ["google/gemma-3-27b-it", "meta-llama/Llama-3.3-70B-Instruct"]
HF_WORKFLOW_MODELS = ["google/gemma-3-27b-it", "meta-llama/Llama-3.3-70B-Instruct", "meta-llama/Llama-3.1-8B-Instruct"]

def is_rate_limit(err_text: str) -> bool:
    t = str(err_text).lower()
    return any(x in t for x in ["429", "quota", "resource_exhausted", "too many requests", "forbidden", "403"])

def call_gemini_key(api_key: str, prompt: str, is_json: bool = False, attempt_label: str = "") -> str:
    for model in GEMINI_MODELS:
        try:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
            system = ("Output ONLY raw valid JSON — no markdown." if is_json
                     else "You are ForChi, Victor's direct and friendly workflow agent.")
            payload = {
                "systemInstruction": {"parts": [{"text": system}]},
                "contents": [{"role": "user", "parts": [{"text": prompt}]}],
                "generationConfig": {"temperature": 0.0 if is_json else 0.7, "maxOutputTokens": 600}
            }
            s = requests.Session()
            r = s.post(url, json=payload, headers={"Connection": "close"}, timeout=20)
            if r.status_code in [403, 429] or is_rate_limit(r.text):
                log.warning(f"[Gemini] {model}{attempt_label} returned {r.status_code}, rotating...")
                continue
            r.raise_for_status()
            data = r.json()
            text = data["candidates"][0]["content"]["parts"][0]["text"].strip()
            if text:
                log.info(f"[Gemini] ✅ {model}{attempt_label} succeeded")
                return text
        except Exception as e:
            log.warning(f"[Gemini] {model}{attempt_label} error ({e}), trying next tier...")
            continue
    return None

def call_gemini_waterfall(prompt: str, is_json: bool = False) -> str:
    for i, key in enumerate(GEMINI_KEYS):
        result = call_gemini_key(key, prompt, is_json, f" (key {i+1}/{len(GEMINI_KEYS)})")
        if result is not None:
            return result
        log.warning(f"[Gemini] Key {i+1}/{len(GEMINI_KEYS)} exhausted or invalid, rotating...")
    log.warning("[Gemini] All keys exhausted — falling back to HF models")
    return None

def call_hf_model(model_id: str, prompt: str, system_msg: str, is_json: bool = False) -> str:
    url = "https://router.huggingface.co/v1/chat/completions"
    headers = {"Authorization": f"Bearer {HF_TOKEN}", "Content-Type": "application/json", "Connection": "close"}
    payload = {
        "model": model_id,
        "messages": [{"role": "system", "content": system_msg}, {"role": "user", "content": prompt}],
        "max_tokens": 600,
        "temperature": 0.0 if is_json else 0.7,
    }
    s = requests.Session()
    r = s.post(url, json=payload, headers=headers, timeout=30)
    if r.status_code != 200:
        raise Exception(f"HF Router returned HTTP {r.status_code}: {r.text[:100]}")
    data = r.json()
    content = data["choices"][0]["message"]["content"]
    return content.strip() if content else None

def generate_llm(prompt: str, is_json: bool = False) -> str:
    result = call_gemini_waterfall(prompt, is_json)
    if result:
        return clean_json(result) if is_json else result

    system = ("Output ONLY raw valid JSON — no markdown." if is_json
             else "You are ForChi, Victor's direct and friendly workflow agent.")
    for model_id in HF_WORKFLOW_MODELS:
        try:
            log.info(f"[HF] Trying {model_id}...")
            result = call_hf_model(model_id, prompt, system, is_json)
            if result:
                log.info(f"[HF] ✅ {model_id} succeeded")
                return clean_json(result) if is_json else result
        except Exception as e:
            log.warning(f"[HF] {model_id} failed: {e}")

    log.error("[Provider] All LLM tiers exhausted")
    if is_json:
        return json.dumps({"isPostTrigger": False, "destinations": [], "content": ""})
    return "I'm having a moment — try again in a few seconds."

def chat_reply(text: str) -> str:
    import random
    framings = [
        "Answer naturally and conversationally, like a knowledgeable friend. Your name is ForChi.",
        "Give your honest take. Feel free to offer a different angle. Your name is ForChi.",
        "Respond plainly and directly — vary your wording. Your name is ForChi.",
        "Be warm, sharp, and genuine. Speak like a trusted colleague. Your name is ForChi.",
    ]
    system = random.choice(framings)
    for model_id in HF_CHAT_MODELS:
        try:
            log.info(f"[Chat] Trying {model_id}...")
            result = call_hf_model(model_id, text, system)
            if result:
                log.info(f"[Chat] ✅ {model_id} responded")
                return result
        except Exception as e:
            log.warning(f"[Chat] {model_id} failed: {e}")
    return "I'm having a moment — try again in a few seconds."

def clean_json(text: str) -> str:
    return re.sub(r'```json\n?|```', '', text).strip()

# ── Outbound Telegram Messenger ───────────────────────────────────────────────
def send_telegram_message(chat_id: int, text: str):
    """Bulletproof outbound delivery using Python urllib with explicit SSL context"""
    payload = json.dumps({"chat_id": chat_id, "text": text}).encode("utf-8")
    headers = {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Connection": "close"
    }

    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE

    targets = [
        f"https://api.telegram.org/bot{TOKEN}/sendMessage",
        f"https://forchi-tg-proxy.yonkkalu.workers.dev/bot{TOKEN}/sendMessage"
    ]

    for target in targets:
        try:
            req = urllib.request.Request(target, data=payload, headers=headers)
            with urllib.request.urlopen(req, timeout=10, context=ctx) as resp:
                if resp.status == 200:
                    log.info(f"[Outbound Telegram Reply] Chat {chat_id} | Delivered via urllib to {target[:35]}...")
                    return
        except Exception as e:
            log.warning(f"[Outbound Delivery Warning] Target {target[:35]} failed ({e}), trying next target...")

    log.error(f"[Outbound Delivery Error] All targets failed for chat {chat_id}")

# ── Social Workflow Subprocess ────────────────────────────────────────────────
def run_social_workflow_sync(chat_id: int, destinations: list, content: str):
    import subprocess
    node_script = os.path.join(os.path.dirname(__file__), "tools", "run_social.js")
    payload = json.dumps({"destinations": destinations, "content": content})
    try:
        res = subprocess.run(
            ["node", node_script, payload],
            capture_output=True, text=True, timeout=120
        )
        log.info(f"[Social Node] stdout: {res.stdout[:300]}")

        if res.returncode == 0:
            try:
                out = json.loads(res.stdout.strip().split("\n")[-1])
                if out.get("success"):
                    send_telegram_message(chat_id, "Done — go check it out.")
                else:
                    failed = ", ".join(out.get("failedPlatforms", ["unknown"]))
                    send_telegram_message(
                        chat_id,
                        f"Ran into an issue posting to {failed}: {out.get('errorSummary', 'unknown error')}"
                    )
            except Exception:
                send_telegram_message(chat_id, "Done — go check it out.")
        else:
            log.error(f"[Social Node] stderr: {res.stderr[:300]}")
            send_telegram_message(chat_id, f"Ran into an issue posting: {res.stderr[:150]}")
    except Exception as e:
        log.error(f"[Social Node Error] {e}")
        send_telegram_message(chat_id, f"Ran into an issue: {e}")

# ── Message Router ─────────────────────────────────────────────────────────────
def process_inbound_message(chat_id: int, user_name: str, text: str):
    log.info(f"[Inbound Message] From: {user_name} ({chat_id}) | Text: \"{text}\"")

    # Exit 1: Gate fails → Chat
    if not passes_gate(text):
        log.info("[Routing] Gate FAILED → Chat Path")
        reply = chat_reply(text)
        send_telegram_message(chat_id, reply)
        return

    # Exit 2: Extractor fails → Chat
    log.info("[Routing] Gate PASSED → Extractor Path")
    extractor_prompt = f"{EXTRACTOR_PROMPT}\n\nUser message: \"{text}\""
    raw_json = generate_llm(extractor_prompt, True)

    try:
        intent = json.loads(clean_json(raw_json))
    except Exception as e:
        log.warning(f"[Extractor] JSON parse failed ({e}), using deterministic fallback")
        intent = extract_post_intent_fallback(text)

    if not intent.get("isPostTrigger") or not intent.get("destinations") or not intent.get("content"):
        log.info("[Routing] Extractor: not a trigger → Chat Path")
        reply = chat_reply(text)
        send_telegram_message(chat_id, reply)
        return

    # Exit 3: Confirmed trigger → Async Social Workflow (Blueprint Section 7)
    destinations = intent["destinations"]
    post_content = intent["content"]
    log.info(f"[Routing] Confirmed Trigger! Destinations: {destinations}")

    # Immediate reply before posting starts (Blueprint Section 7)
    send_telegram_message(chat_id, "On it 🤙")

    # Launch social workflow in background thread
    t = threading.Thread(target=run_social_workflow_sync, args=(chat_id, destinations, post_content), daemon=True)
    t.start()

# ── Webhook HTTP Server (Port 7860 for Hugging Face Spaces) ───────────────────
class WebhookHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({"status": "healthy", "bot": "ForChi", "mode": "webhook", "base": TELEGRAM_API_BASE}).encode())

    def do_POST(self):
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length) if content_length > 0 else b""
        
        # Respond HTTP 200 immediately to Telegram (Blueprint requirement)
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"ok": true}')

        try:
            update = json.loads(body.decode("utf-8"))
            msg = update.get("message") or update.get("edited_message") or update.get("channel_post")
            if msg and isinstance(msg, dict) and "text" in msg and "chat" in msg:
                chat = msg.get("chat", {})
                chat_id = chat.get("id")
                if chat_id:
                    user_name = msg.get("from", {}).get("first_name") or chat.get("title") or "?"
                    text = str(msg["text"]).strip()
                    t = threading.Thread(target=process_inbound_message, args=(chat_id, user_name, text), daemon=True)
                    t.start()
        except Exception as e:
            log.error(f"[Webhook Handler Error] {e}")

    def log_message(self, format, *args):
        pass

def register_webhook():
    """Register webhook asynchronously in background thread on startup"""
    webhook_url = f"https://slymun-forchi.hf.space/webhook/{TOKEN}"
    url = f"https://api.telegram.org/bot{TOKEN}/setWebhook"
    payload = json.dumps({"url": webhook_url}).encode("utf-8")
    headers = {"Content-Type": "application/json", "User-Agent": "Mozilla/5.0"}
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE

    try:
        req = urllib.request.Request(url, data=payload, headers=headers)
        with urllib.request.urlopen(req, timeout=10, context=ctx) as resp:
            log.info(f"[Webhook Auto-Registration] Status: {resp.status} | {resp.read().decode('utf-8')[:100]}")
    except Exception as e:
        log.warning(f"[Webhook Auto-Registration Warning] {e}")

def main():
    log.info(f"[HTTP Webhook Server] Starting container listener on port {PORT}...")
    
    # Ensure active Telegram webhook is registered in background thread on every container boot
    t = threading.Thread(target=register_webhook, daemon=True)
    t.start()

    server = HTTPServer(("0.0.0.0", PORT), WebhookHandler)
    log.info(f"[ForChi] Bot container ready and listening for webhooks on port {PORT}.")
    server.serve_forever()

if __name__ == "__main__":
    main()

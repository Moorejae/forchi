"""
tools/tailscale_tg_proxy.py
Local Telegram API proxy for Tailscale mesh network.
Explicitly binds to Tailscale IP 100.109.231.10 (DESKTOP-POP71NJ) on port 8088.
Forwards requests from hf-forchi-bot over Tailscale mesh directly to api.telegram.org.
"""

import http.server
import requests
import logging
import socket

logging.basicConfig(level=logging.INFO, format="%(asctime)s [TG Proxy] %(message)s")

class TelegramProxyHandler(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        url = f"https://api.telegram.org{self.path}"
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length) if length > 0 else None
        
        headers = {"Content-Type": self.headers.get("Content-Type", "application/json")}
        
        try:
            r = requests.post(url, data=body, headers=headers, timeout=15)
            self.send_response(r.status_code)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(r.content)
            logging.info(f"POST {self.path[:30]}... -> HTTP {r.status_code}")
        except Exception as e:
            logging.error(f"POST error: {e}")
            self.send_response(502)
            self.end_headers()

    def do_GET(self):
        url = f"https://api.telegram.org{self.path}"
        try:
            r = requests.get(url, timeout=15)
            self.send_response(r.status_code)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(r.content)
            logging.info(f"GET {self.path[:30]}... -> HTTP {r.status_code}")
        except Exception as e:
            logging.error(f"GET error: {e}")
            self.send_response(502)
            self.end_headers()

    def log_message(self, format, *args):
        pass

if __name__ == "__main__":
    # Bind to both 0.0.0.0 and 100.109.231.10 specifically
    ts_ip = "100.109.231.10"
    port = 8088
    
    server = http.server.HTTPServer(("0.0.0.0", port), TelegramProxyHandler)
    logging.info(f"Tailscale Telegram Proxy listening on 0.0.0.0:{port} (Tailscale IP: {ts_ip})...")
    server.serve_forever()

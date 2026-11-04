#!/usr/bin/env python3
"""
FastPix Stream QA - local test server.

Run on your main computer, in the folder that holds fastpix-stream-qa.html:
    python3 qa_server.py
Then open the address it prints. Phones, tablets and TVs on the same Wi-Fi open the
"other devices" address (or scan the QR code on the page). Every device's results land
in one shared report on this computer.

It also relays the stream (/proxy) when FastPix refuses requests from a local page.
Stop it with Ctrl+C. Results are kept in qa_state.json next to this file.
"""
import json, os, socket, sys, threading, urllib.parse, urllib.request, re
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

PORT = int(os.environ.get("PORT", "8000"))
HERE = os.path.dirname(os.path.abspath(__file__))
PAGE = os.path.join(HERE, "fastpix-stream-qa.html")
STATE_FILE = os.path.join(HERE, "qa_state.json")
LOCK = threading.Lock()


def load_state():
    try:
        with open(STATE_FILE) as f:
            return json.load(f)
    except Exception:
        return {"form": None, "devices": [], "plays": [], "rev": 0}


STATE = load_state()


def save_state():
    STATE["rev"] = STATE.get("rev", 0) + 1
    with open(STATE_FILE, "w") as f:
        json.dump(STATE, f)


def lan_ips():
    ips = set()
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ips.add(s.getsockname()[0])
        s.close()
    except Exception:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if not ip.startswith("127."):
                ips.add(ip)
    except Exception:
        pass
    return sorted(ips)


def key(x):
    return f"{x.get('label')}|{x.get('ua') or (x.get('env') or {}).get('browser')}"


URI_ATTR = re.compile(r'URI="([^"]+)"')


def rewrite_playlist(text, base):
    def prox(u):
        return "/proxy?u=" + urllib.parse.quote(urllib.parse.urljoin(base, u), safe="")
    out = []
    for line in text.splitlines():
        if line and not line.startswith("#"):
            out.append(prox(line.strip()))
        elif "URI=\"" in line:
            out.append(URI_ATTR.sub(lambda m: f'URI="{prox(m.group(1))}"', line))
        else:
            out.append(line)
    return "\n".join(out) + "\n"


class H(BaseHTTPRequestHandler):
    server_version = "StreamQA/1"

    def log_message(self, fmt, *args):
        pass

    def send(self, code, body, ctype="application/json", extra=None):
        if isinstance(body, (dict, list)):
            body = json.dumps(body).encode()
        elif isinstance(body, str):
            body = body.encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(n) or b"{}")

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        if u.path in ("/", "/index.html", "/fastpix-stream-qa.html"):
            try:
                with open(PAGE, "rb") as f:
                    return self.send(200, f.read(), "text/html; charset=utf-8")
            except FileNotFoundError:
                return self.send(404, "Put fastpix-stream-qa.html next to qa_server.py", "text/plain")
        if u.path == "/api/state":
            with LOCK:
                return self.send(200, {**STATE, "server": True,
                                       "lan": [f"http://{ip}:{PORT}/" for ip in lan_ips()]})
        if u.path == "/proxy":
            target = urllib.parse.parse_qs(u.query).get("u", [""])[0]
            if not target.startswith(("http://", "https://")):
                return self.send(400, "bad url", "text/plain")
            hdrs = {"User-Agent": self.headers.get("User-Agent", "StreamQA")}
            if self.headers.get("Range"):
                hdrs["Range"] = self.headers["Range"]
            try:
                with urllib.request.urlopen(urllib.request.Request(target, headers=hdrs), timeout=30) as r:
                    data, code, ctype = r.read(), r.status, r.headers.get("Content-Type", "application/octet-stream")
            except urllib.error.HTTPError as e:
                return self.send(e.code, e.read(), e.headers.get("Content-Type", "text/plain"))
            except Exception as e:
                return self.send(502, f"upstream error: {e}", "text/plain")
            if b"#EXTM3U" in data[:64]:
                data = rewrite_playlist(data.decode("utf-8", "replace"), target).encode()
                ctype = "application/vnd.apple.mpegurl"
            return self.send(code, data, ctype)
        return self.send(404, "not found", "text/plain")

    def do_POST(self):
        u = urllib.parse.urlparse(self.path)
        try:
            b = self.body()
        except Exception:
            return self.send(400, {"error": "bad json"})
        with LOCK:
            if u.path == "/api/form":
                STATE["form"] = b.get("form")
                STATE["targets"] = b.get("targets", STATE.get("targets"))
            elif u.path == "/api/result":
                for d in b.get("devices", []):
                    STATE["devices"] = [x for x in STATE["devices"] if key(x) != key(d)] + [d]
                for p in b.get("playback", []):
                    STATE["plays"] = [x for x in STATE["plays"] if key(x) != key(p)] + [p]
            elif u.path == "/api/reset":
                STATE["devices"], STATE["plays"] = [], []
            else:
                return self.send(404, {"error": "not found"})
            save_state()
            return self.send(200, {"ok": True, "rev": STATE["rev"]})

    def do_OPTIONS(self):
        self.send(204, b"", "text/plain", {"Access-Control-Allow-Methods": "GET,POST", "Access-Control-Allow-Headers": "Content-Type,Range"})


def main():
    if not os.path.exists(PAGE):
        print("fastpix-stream-qa.html must be in the same folder as qa_server.py")
        sys.exit(1)
    srv = ThreadingHTTPServer(("0.0.0.0", PORT), H)
    print(f"\nFastPix Stream QA is running.\n\n  On this computer:   http://localhost:{PORT}/")
    for ip in lan_ips():
        print(f"  On other devices:   http://{ip}:{PORT}/   (same Wi-Fi)")
    print("\nKeep this window open while testing. Press Ctrl+C to stop.\n")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()

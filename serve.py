#!/usr/bin/env python3
"""Serve the app over HTTPS so a VR headset on your LAN can open it.

WebXR only works in a secure context (https:// or localhost). This script
creates a self-signed certificate on first run (in ./certs) and serves the
project directory on https://<your-lan-ip>:8443.

Usage:  python3 serve.py [--port 8443] [--host 0.0.0.0]
"""
import argparse
import functools
import http.server
import socket
import ssl
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CERT_DIR = ROOT / "certs"
CERT = CERT_DIR / "cert.pem"
KEY = CERT_DIR / "key.pem"


def lan_ip() -> str:
    # No packets are sent; this just asks the OS which interface it would route through.
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
        try:
            s.connect(("10.255.255.255", 1))
            return s.getsockname()[0]
        except OSError:
            return "127.0.0.1"


def ensure_cert(ip: str) -> None:
    if CERT.exists() and KEY.exists():
        return
    CERT_DIR.mkdir(exist_ok=True)
    subprocess.run(
        [
            "openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes",
            "-keyout", str(KEY), "-out", str(CERT), "-days", "365",
            "-subj", "/CN=brock-string-vr",
            "-addext", f"subjectAltName=DNS:localhost,IP:127.0.0.1,IP:{ip}",
        ],
        check=True,
    )
    KEY.chmod(0o600)


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Always serve fresh files while iterating.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def send_head(self):
        # Never serve the TLS private key or anything else under certs/.
        target = Path(self.translate_path(self.path)).resolve()
        if target == CERT_DIR or CERT_DIR in target.parents:
            self.send_error(404)
            return None
        return super().send_head()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8443)
    args = parser.parse_args()

    ip = lan_ip()
    ensure_cert(ip)

    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.minimum_version = ssl.TLSVersion.TLSv1_2
    ctx.load_cert_chain(CERT, KEY)

    handler = functools.partial(Handler, directory=str(ROOT))
    httpd = http.server.ThreadingHTTPServer((args.host, args.port), handler)
    httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)

    print(f"Serving {ROOT}")
    print(f"  On this computer: https://localhost:{args.port}")
    print(f"  On your headset:  https://{ip}:{args.port}")
    print("The certificate is self-signed: accept the browser warning once (Advanced -> Proceed).")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()

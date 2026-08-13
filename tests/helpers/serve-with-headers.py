"""Serveur statique local qui renvoie exactement les en-têtes de sécurité
du .htaccess.

Apache n'est pas installé sur ce poste : sans cela, la politique de sécurité
du contenu ne serait vérifiée qu'en la relisant. Ici, le navigateur la reçoit
pour de bon et signale la moindre ressource bloquée dans la console.

L'en-tête est extrait du .htaccess plutôt que recopié : les deux ne peuvent
donc pas diverger.
"""

import http.server
import re
import socketserver
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 5500

htaccess = (ROOT / ".htaccess").read_text(encoding="utf-8")


def extract(directive):
    match = re.search(
        r'Header (?:always )?set ' + directive + r' "((?:[^"\\]|\\.)*)"', htaccess)
    return match.group(1) if match else None


CSP = extract("Content-Security-Policy")
HEADERS = {
    "Content-Security-Policy": CSP,
    "X-Content-Type-Options": extract("X-Content-Type-Options"),
    "Referrer-Policy": extract("Referrer-Policy"),
    "X-Frame-Options": extract("X-Frame-Options"),
    "Permissions-Policy": extract("Permissions-Policy"),
}

if not CSP:
    raise SystemExit("Content-Security-Policy introuvable dans .htaccess")


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        for name, value in HEADERS.items():
            if value:
                self.send_header(name, value)
        super().end_headers()

    def log_message(self, *args):
        pass


socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(("127.0.0.1", PORT), Handler) as httpd:
    print(f"En-têtes appliqués sur http://127.0.0.1:{PORT}")
    print(f"CSP : {CSP[:120]}…")
    httpd.serve_forever()

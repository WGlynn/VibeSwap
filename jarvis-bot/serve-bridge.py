"""HTTPS server for voice bridge (self-signed cert for Chrome Speech API)"""
import http.server
import ssl
import os
import subprocess
import sys

PORT = 8766
DIR = os.path.dirname(os.path.abspath(__file__))

# Generate self-signed cert if not exists
CERT = os.path.join(DIR, 'cert.pem')
KEY = os.path.join(DIR, 'key.pem')

if not os.path.exists(CERT):
    print("Generating self-signed certificate...")
    subprocess.run([
        'openssl', 'req', '-x509', '-newkey', 'rsa:2048',
        '-keyout', KEY, '-out', CERT,
        '-days', '365', '-nodes',
        '-subj', '/CN=localhost'
    ], check=True)
    print("Certificate generated.")

os.chdir(DIR)

handler = http.server.SimpleHTTPRequestHandler
httpd = http.server.HTTPServer(('localhost', PORT), handler)

ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
ctx.load_cert_chain(CERT, KEY)
httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)

print(f"Voice bridge HTTPS server: https://localhost:{PORT}/voice-bridge.html")
print("Accept the self-signed cert warning in Chrome, then test.")
httpd.serve_forever()

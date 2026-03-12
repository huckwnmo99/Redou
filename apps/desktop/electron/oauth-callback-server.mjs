// OAuth Callback Server — temporary localhost HTTP server for handling OAuth redirects in Electron
// Listens on http://127.0.0.1:8914/auth/callback, extracts tokens from the URL fragment,
// and passes them back to the Electron main process.

import http from "node:http";

const CALLBACK_PORT = 8914;
const CALLBACK_PATH = "/auth/callback";

/**
 * Start a temporary HTTP server to receive the OAuth callback.
 * Returns a promise that resolves with the full callback URL (including hash fragment).
 * The server shuts itself down after receiving the callback or after a timeout.
 */
export function waitForOAuthCallback(timeoutMs = 120_000) {
  return new Promise((resolve, reject) => {
    let settled = false;

    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${CALLBACK_PORT}`);

      if (url.pathname === CALLBACK_PATH) {
        // Supabase sends tokens in the URL hash fragment, which the browser doesn't send to the server.
        // Serve a small HTML page that extracts the fragment and sends it via a query string redirect.
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<!DOCTYPE html>
<html>
<head><title>Redou - Sign in</title></head>
<body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f8fafc">
<div style="text-align:center;max-width:400px;padding:40px">
<h2 style="margin-bottom:12px">Signing you in...</h2>
<p style="color:#64748b;font-size:14px">This window will close automatically.</p>
</div>
<script>
  const hash = window.location.hash.substring(1);
  if (hash) {
    fetch('/auth/token?' + hash, { method: 'POST' }).then(() => {
      document.querySelector('h2').textContent = 'Signed in!';
      document.querySelector('p').textContent = 'You can close this window now.';
      setTimeout(() => window.close(), 1200);
    });
  } else {
    const params = new URLSearchParams(window.location.search);
    if (params.get('error')) {
      document.querySelector('h2').textContent = 'Sign-in failed';
      document.querySelector('p').textContent = params.get('error_description') || params.get('error');
    }
  }
</script>
</body>
</html>`);
        return;
      }

      if (url.pathname === "/auth/token" && req.method === "POST") {
        // The browser-side JS redirected the hash fragment here as query params
        const accessToken = url.searchParams.get("access_token");
        const refreshToken = url.searchParams.get("refresh_token");

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));

        if (!settled && accessToken) {
          settled = true;
          cleanup();
          resolve({ accessToken, refreshToken });
        }
        return;
      }

      res.writeHead(404);
      res.end("Not found");
    });

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(new Error("OAuth callback timed out after " + (timeoutMs / 1000) + " seconds."));
      }
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timeout);
      try {
        server.close();
      } catch {
        // ignore
      }
    }

    server.on("error", (err) => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(err);
      }
    });

    server.listen(CALLBACK_PORT, "127.0.0.1", () => {
      // Server ready
    });
  });
}

export function getOAuthCallbackUrl() {
  return `http://127.0.0.1:${CALLBACK_PORT}${CALLBACK_PATH}`;
}

export { CALLBACK_PORT, CALLBACK_PATH };

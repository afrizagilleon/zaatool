# Running it, including from your phone

## The normal case

```bash
pnpm dev
```

Two servers come up: the engine on `4000`, the app on `5173`. The engine prints every
address it can be reached at, not just `localhost`:

```
✅ Server listening on http://localhost:4000
   also on http://192.168.1.7:4000
```

Open `http://localhost:5173`.

## From your phone

Open `http://<your-laptop's-LAN-address>:5173` on the phone. That is the address Vite
prints as **Network**, and the same one the engine prints as **also on**.

Nothing else to configure. That was not true before: the bundle named
`http://localhost:4000` outright, and on a phone `localhost` is the phone — every request
after the login screen failed with `failed to fetch`. The app and the engine now share one
origin in development, the same arrangement the deployed build has always had, with Vite
proxying `/api`, `/hooks`, `/mcp`, `/storage` and `/ws` through.

Both devices have to be on the same network, and a laptop firewall will happily block
ports 5173 and 4000 without telling either side. On Windows, allow Node through the
private network when the prompt appears — if it was dismissed once, it does not come back.

### If the engine is somewhere else

```bash
ENGINE_ORIGIN=http://192.168.1.20:4000 pnpm dev:web
```

## Recording audio from a phone

This is the one thing plain HTTP cannot do. `getUserMedia` is refused outside a **secure
context**, and `http://192.168.1.7:5173` is not one — the browser does not even expose
`navigator.mediaDevices`. No amount of network configuration changes that.

**The easy way, with no certificates:** use the file picker. An input declaring
`accept: "audio/*"` shows **Choose a file**, and a phone's picker offers its own recorder
— Sound Recorder on Android, Voice Memos on iOS. The file arrives through exactly the same
path a recorded one would. For most testing this is the answer.

**The in-page record button** needs HTTPS. Point the dev server at a certificate:

```bash
mkcert -install
mkcert -cert-file dev-cert.pem -key-file dev-key.pem localhost 192.168.1.7
HTTPS_KEY=dev-key.pem HTTPS_CERT=dev-cert.pem pnpm dev:web
```

Put your own LAN address in that second command — a certificate names the addresses it is
valid for, and a phone will refuse one that does not list the address it dialled.

The step everyone forgets: **`mkcert -install` trusts the CA on the laptop, not on the
phone.** Copy the root CA to the phone and install it there too:

```bash
mkcert -CAROOT   # prints the folder holding rootCA.pem
```

- **Android** — Settings → Security → Encryption & credentials → Install a certificate →
  CA certificate.
- **iOS** — AirDrop or mail `rootCA.pem` to the phone, install the profile, then Settings →
  General → About → Certificate Trust Settings and switch it on. iOS needs both steps.

Since the engine is proxied through the dev server, one certificate covers both.

No certificate tooling is installed by this repository. A plugin that downloads a binary
on first run is a supply-chain decision, and a build config should not make it for you.

## Ports

| what | port | who reaches it |
|---|---|---|
| app (Vite) | 5173 | you, your phone |
| engine | 4000 | the Vite proxy; agents over `/mcp`; webhooks |

The engine binds `0.0.0.0`. Set `HOST=127.0.0.1` to make it local-only — worth doing on a
network you do not trust, since `/hooks` and `/mcp` guard themselves with tokens rather
than with a session.

## Cross-origin requests

There are none, by design: one origin in development and one in production. `CORS_ORIGINS`
exists for the deployment that serves the bundle from somewhere other than the engine, and
it is a comma-separated list:

```
CORS_ORIGINS=https://app.example.com,https://staging.example.com
```

Unset in production, only same-origin requests are accepted. Unset outside production, any
origin is — because the LAN address a phone uses is not something anyone can predict, and
refusing it would make every first attempt fail.

## Tests

```bash
pnpm test
```

Engine and web, in that order. The web half renders real components in jsdom; it is the
half that exists because reading source and reporting what it *should* draw is how a
dropdown went four milestones without the one type it needed.

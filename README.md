# Sock puppet

One TypeScript monorepo. Packages live under `src/`:

- **`src/robot`** — `@sock-puppet/robot`: version-2 creature actions, portrait eyes, validation, configuration, OLED renderer, and simulator.
- **`src/digital-twin`** — React/Three.js robot simulator and manual controls.
- **`src/puppeteer`** — GPT Live 1 conversation, microphone/speaker console, motion harness, WebSocket and serial transports.

Requires Node.js 22.12+ and npm.

```sh
npm install
cp src/puppeteer/.env.example src/puppeteer/.env
# Edit src/puppeteer/.env to set OPENAI_API_KEY.
```

In separate terminals:

```sh
npm run dev:twin
```

```sh
npm start
```

Open the twin at **http://127.0.0.1:5173**, connect it to **ws://127.0.0.1:8787**, then open the puppeteer at **http://127.0.0.1:8788**. Click **Start listening** and allow microphone access. The twin's fixture server must be stopped because it uses the same robot port.

Without an OpenAI key, you can still connect either robot transport, inspect telemetry, send manual commands, and run the automated tests.

```sh
npm test
npm run build
npm run test:pty
npm run test:browser
```

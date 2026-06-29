# ZaaTool

A self-hosted visual automation platform for building, running, and publishing workflow pipelines — built as a full-stack portfolio project.

![Hero](packages/web/src/assets/hero.png)

---

## Overview

ZaaTool is a node-based workflow engine similar in spirit to n8n or Zapier, but built from scratch. You design automation flows on a visual canvas, execute them in real time, and optionally publish them as interactive dashboards with password protection.

The project covers a broad surface area: a custom DAG execution engine, real-time WebSocket event streaming, multi-runtime code evaluation (Node.js + Python), AI-assisted code generation, a drag-and-drop dashboard builder, file storage, secrets management, and JWT authentication — all packaged in a monorepo.

---

## Features

### Flow Editor
- Drag-and-drop canvas powered by React Flow
- Auto-layout (LR / TB) using the Dagre graph layout algorithm
- Node palette with all available node types
- Monaco Editor for in-canvas code editing with syntax highlighting
- Real-time run console — execution logs stream over WebSocket as nodes fire

### Node Types

| Node | Description |
|---|---|
| `Code (JS)` | Executes JavaScript in an isolated VM with access to injected secrets |
| `Code (Python)` | Runs Python scripts; auto-installs pip packages declared in node config |
| `If` | Conditional branching *(executor disabled — use if/else inside a Code node)* |
| `Loop` | Array iteration *(executor disabled — use array.map() inside a Code node)* |
| `HTTP` | Makes outbound HTTP requests |
| `File` | Reads files from MinIO object storage |
| `UI: Input` | Renders a configurable form (text, select, multi-select, password, etc.) |
| `UI: Table` | Displays tabular data with sorting, pagination, and row selection |
| `UI: Chart` | Renders bar, line, area, or pie charts via Recharts |
| `UI: Text` | Displays Markdown or plain text output |
| `UI: Image` | Renders images from URLs or storage |
| `Trigger: Start` | Manual entry point |
| `Trigger: Cron` | Scheduled entry point — fires on a cron expression |

### Execution Engine
- Topological sort (Kahn's algorithm) ensures correct DAG execution order
- Nested sub-flow execution for loop bodies
- Scoped variable passing between nodes
- EventEmitter-based lifecycle events (`node:start`, `node:log`, `node:done`, `node:error`, `flow:done`)

### Cron Scheduler
- Built-in scheduler ticks every minute, aligned to the wall clock
- Supports standard 5-part cron expressions (`* * * * *`) with ranges, steps, and lists
- Triggers can be inline visual nodes or database-backed entries

### AI Code Assistant
- AI panel for generating node code from natural language instructions
- Supports OpenRouter, Google Gemini, and Anthropic as providers
- Context-aware: passes upstream node schemas and connected form nodes to the prompt
- Skills library — store reusable code snippets that the AI can reference

### Dashboard Builder
- Drag-and-drop grid layout (react-grid-layout) for composing UI nodes into a dashboard
- Publish a flow as a public shareable dashboard at `/share/:id` *(one-click Deploy button coming soon)*
- Optional password protection with bcrypt verification and rate-limiting (locks after 5 failed attempts)
- Published dashboards can trigger flow re-runs from the UI (form submit, table row click)

### Resources
- **Secrets Manager** — key/value store for API keys and credentials; values marked as secrets are masked in the UI
- **File Storage** — MinIO-backed object store; files uploaded via multipart form
- **Skills** — reusable code snippets surfaced to the AI assistant and editable in the UI

### Auth
- JWT-based login; tokens verified on every `/api/*` route via Express middleware
- Session auto-verified on app mount

---

## Tech Stack

### Frontend
- **React 19** + **TypeScript** + **Vite 8**
- **@xyflow/react** — flow canvas
- **Monaco Editor** — in-browser code editor
- **Recharts** — charts
- **react-grid-layout** — dashboard drag-and-drop
- **Zustand** — client state management
- **shadcn/ui** + **Radix UI** + **Tailwind CSS 4** — UI components and styling
- **@dnd-kit** — drag-and-drop in node palette and sortable lists

### Backend
- **Node.js** + **TypeScript** + **Express 5**
- **PostgreSQL** (via `pg`) — flow persistence, triggers, secrets, skills
- **MinIO** — S3-compatible object storage for files
- **WebSockets** (`ws`) — real-time execution event streaming
- **bcrypt** — password hashing
- **jsonwebtoken** — JWT auth
- Custom Python runner — spawns `python3` subprocess, communicates over stdin/stdout JSON

### Infrastructure
- **Docker Compose** — spins up PostgreSQL and MinIO locally
- **pnpm workspaces** — monorepo with `engine`, `web`, and `shared` packages

---

## Project Structure

```
zaatool/
├── packages/
│   ├── engine/          # Express API + flow execution engine
│   │   ├── src/
│   │   │   ├── core/        # Flow runner, DAG analyzer, node executor, JS/Python runners
│   │   │   ├── executors/   # Per-node-type executor classes
│   │   │   ├── services/    # Flows, AI, secrets, skills, scheduler, storage, auth
│   │   │   ├── controllers/ # Request handlers
│   │   │   ├── routes/      # Express routers
│   │   │   ├── middleware/  # JWT auth middleware
│   │   │   ├── db/          # PostgreSQL connection and schema initializer
│   │   │   └── server/      # App factory + WebSocket manager
│   ├── web/             # React SPA
│   │   └── src/
│   │       ├── components/  # Canvas, nodes, panels, layout, pages, dashboard
│   │       ├── hooks/       # useWorkflows, useAiGeneration, useDashboardBuilder, etc.
│   │       ├── store/       # Zustand stores (flow, engine, ui, auth)
│   │       └── lib/         # API clients, flow serializer, WebSocket event handler
│   └── shared/          # Shared TypeScript types (GraphJson, NodeDef, SchemaField, etc.)
├── docker-compose.yml
└── pnpm-workspace.yaml
```

---

## Getting Started

### Prerequisites
- Node.js 20+
- pnpm 11+
- Docker (for PostgreSQL + MinIO)
- Python 3 (for Python code nodes)

### 1. Start infrastructure

```bash
docker compose up -d
```

### 2. Install dependencies

```bash
pnpm install
```

### 3. Configure environment

Create `packages/engine/.env`:

```env
# PostgreSQL — match these to docker-compose.yml or your own instance
POSTGRES_USER=<db-user>
POSTGRES_PASSWORD=<db-password>
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=zaa_tool

JWT_SECRET=<random-secret>

# MinIO
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_ACCESS_KEY=<minio-user>
MINIO_SECRET_KEY=<minio-password>
```

Optionally create `packages/web/.env` to override API endpoints (defaults to `localhost:4000`):

```env
VITE_API_URL=http://localhost:4000
VITE_WS_URL=ws://localhost:4000
```

### 4. Run

```bash
pnpm dev
```

- Web UI: `http://localhost:5173`
- API: `http://localhost:4000`
- MinIO Console: `http://localhost:9001`

---

## Architecture Notes

**Flow execution** works by first topologically sorting the DAG (Kahn's algorithm), then iterating nodes in order. Each node is skipped if none of its incoming edges are "active" — edges become active only when their source node runs successfully. This naturally implements conditional branching: only the branches reachable from an If node's true or false output get executed.

**Loop nodes** are handled specially: the graph analyzer identifies all nodes inside a loop body (reachable from the `body` handle but not the `exit` handle) and excludes them from the top-level sort. The sub-flow infrastructure is in place, though the loop executor is currently disabled in favour of using `array.map()` inside a Code node.

**Real-time streaming** uses a single long-lived WebSocket connection. The server emits lifecycle events from each node execution through an `EventEmitter`; the WebSocket manager fans those out to all connected clients. The React client updates node status and appends log lines in the run console as events arrive.

**Published dashboards** are rendered from the same `GraphJson` that powers the editor, but filtered to only UI nodes. The dashboard builder lets you arrange those nodes in a grid and lock the layout before publishing. Public endpoints bypass JWT auth but optionally require a dashboard-specific password.

---

## License

MIT

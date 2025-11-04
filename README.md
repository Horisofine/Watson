# Dr. Watson — Personal Ops Assistant

Dr. Watson is a personality-driven agent that lives on Telegram, remembers what matters, keeps track of tasks, and can delegate “gofer” jobs to automation scripts or lightweight human helpers.

## Why this project exists

| Requirement | Status | Notes |
|-------------|--------|-------|
| Way to communicate | 🧑‍💻 Telegram bot | Updates delivered via chats; inline keyboard for quick actions |
| Agent Dr. Watson | 🤵‍♂️ LLM persona | System prompt + memory; routed through OpenAI (or other) |
| Gofers | 🐝 Task runners | Human helpers or automation hooks triggered from the agent |
| Tools | 🛠️ API/CLI connectors | Weather, calendar, files, payments, etc. exposed as agent tools |
| Storage | 📚 Memory + notebook | Postgres/pgvector for long-term + Redis for short-term context |

## High-level architecture

```
Telegram <-> Bot Service (aiogram) -> Agent API (FastAPI)
                                   -> Memory Layer (Postgres + pgvector, Redis)
                                   -> Tool Router (LangChain tools / custom scripts)
                                   -> Gofer Task Queue (Celery/RQ + workers)
                                   -> Object Storage (notes, files)
```

1. **Telegram Bot Service** handles webhook updates, user auth, rate limits, and forwards messages to the Agent API.
2. **Agent API** wraps an LLM (e.g., GPT-4o-mini for cost / GPT-4o for depth) with system prompts that establish the Dr. Watson persona.
3. **Memory Layer** provides:
   - *Short-term*: Redis conversation buffer to avoid amnesia.
   - *Long-term*: Postgres + pgvector store for facts, Todo items, preferences, and transcripts.
4. **Tool Router** exposes functions (calendar, search, payments, gofer creation, etc.) and is accessible to the agent via structured tool-calls.
5. **Gofer Task Queue** takes “delegate” instructions and either (a) runs automation scripts, or (b) produces a human-readable task summary sent to a helper (email/telegram group).

## Components and tech choices

| Layer | Suggested stack | Reasoning |
|-------|-----------------|-----------|
| Telegram bot | `aiogram` + webhook endpoint | Modern async, good middleware support |
| Agent service | FastAPI + LangChain / Instructor | Simple deployment, schema validation |
| LLM provider | OpenAI GPT-4o-mini / GPT-4o | Tool-calling, strong reasoning, persona control |
| Memory | Postgres + `pgvector`, Redis | Durable knowledge + fast context windows |
| Task queue (“gofers”) | Celery + Redis broker | Mature ecosystem, scheduling, retries |
| Object/file storage | Supabase storage or S3 | Attachments, notes, exported summaries |
| Observability | OpenTelemetry + PostHog | Track latency, failures, user satisfaction |

## Persona + memory strategy

- **System prompt**: codify tone (“steadfast assistant”, “keeps receipts”).
- **Memory writing**: after every session, summarise key facts and store as embeddings.
- **Recall**: before responding, retrieve top-N memories + relevant notes, feed into context.
- **Notebook**: allow `/note`, `/task`, `/bookmark` commands to push information straight into storage without full conversation.

## Tooling & gofers concept

1. **First-party tools** (code-defined):
   - Calendar CRUD
   - Knowledge search (Notion/Confluence)
   - Expense logging / small payments (Stripe Payment Links)
   - File fetch/upload
2. **Automation gofers** (scripts):
   - Runbooks triggered via job queue (e.g., scrape availability, order food, send emails).
3. **Human gofers**:
   - Generate structured task briefs (`title`, `description`, `deadline`, `budget`) and post to a helpers channel or marketplace API.

Each tool is described in JSON schema so the LLM can call it deterministically.

## Storage model

Tables (Postgres):

| Table | Purpose |
|-------|---------|
| `users` | Telegram users with preferences and auth metadata |
| `sessions` | Conversation sessions, tokens, timestamps |
| `memories` | Long-term facts (vector + metadata) |
| `tasks` | Gofer tasks with status, assignee, cost |
| `notes` | Free-form notes/notebook entries |

Redis keys handle session buffers, rate limiting, and Celery queues.

## Implementation roadmap

1. **MVP (Milestone 1)**  
   - Register Telegram bot + webhook endpoint.  
   - Basic FastAPI service that relays messages to GPT-4o-mini with persona prompt.  
   - In-memory conversation buffer per user.
2. **Persistent memory (Milestone 2)**  
   - Add Postgres + pgvector, nightly summarization job, `/note` command.  
   - Store/retrieve user preferences and tasks.
3. **Tools & gofers (Milestone 3)**  
   - Implement tool router with at least 3 functions (calendar, search, HTTP fetch).  
   - Spin up Celery worker for automation tasks, integrate notifications.  
   - Build human-gofer handoff template + channel.
4. **Polish & safety (Milestone 4)**  
   - Auth, rate limits, logging, analytics.  
   - Add monitoring dashboard and alerting if Watson fails.

## Next steps

1. Create a `backend/` directory with FastAPI + aiogram scaffold.  
2. Provision Postgres (Supabase/Neon) and Redis; add connection secrets to `.env`.  
3. Draft the Dr. Watson system prompt + memory formatting instructions.  
4. Ship Milestone 1 end-to-end, then iterate on memory and gofer tooling.

Once the scaffold exists we can hook up CI, tests, and deployment (Railway/Fly/Render). Let’s build!

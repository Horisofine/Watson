# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Watson is a Telegram bot serving as a personal operations assistant powered by AI. It implements a personality-driven agent modeled after Dr. John Watson from BBC's "Sherlock" series, running on Bun with LangChain and Ollama.

**Current State**: This is an MVP implementation. The README describes an ambitious production architecture with FastAPI, Postgres, pgvector, Redis, and Celery, but the current codebase is a simplified TypeScript/Bun version with in-memory storage.

## Development Commands

**Run the bot**:
```bash
bun run index.ts
```

**Install dependencies**:
```bash
bun install
```

**Environment setup**: Create `.env` with:
- `TELEGRAM_BOT_TOKEN`: Bot token from BotFather
- `OLLAMA_REMOTE_URL`: Ollama server URL (currently 192.168.0.114:11434)
- `OLLAMA_REMOTE_MODEL`: Model name (e.g., qwen3:8b)
- `GOOGLE_CLIENT_ID`: Google Cloud OAuth2 client ID for Calendar API
- `GOOGLE_CLIENT_SECRET`: Google Cloud OAuth2 client secret
- `GOOGLE_CREDENTIALS_PATH`: Path to credentials.json (optional)
- `CALENDAR_TOKENS_PATH`: Path to calendar tokens storage (default: ./data/calendar_tokens.json)

**Important**: Always use Bun instead of Node.js, npm, or other tooling:
- Use `bun <file>` instead of `node <file>`
- Use `bun test` instead of jest/vitest
- Use `bun install` instead of npm/yarn/pnpm
- Bun automatically loads .env files (no dotenv package needed)
- Prefer Bun APIs: `Bun.file` over `fs`, `Bun.sql` over `pg`, `Bun.redis` over `ioredis`

## Architecture Overview

### Tech Stack
- **Runtime**: Bun (JavaScript runtime)
- **Language**: TypeScript with strict mode
- **Bot Framework**: Grammy v1.38.3 with Files plugin
- **AI Framework**: LangGraph v1.0.1 (agentic workflow orchestration)
- **LLM**: Ollama with Qwen3:8b model (supports tool calling and structured outputs)
- **Embeddings**: Ollama with nomic-embed-text model
- **Vector Store**: Custom SimpleVectorStore with JSON persistence
- **Document Processing**: unpdf for PDF text extraction
- **Calendar Integration**: Google Calendar API v3 with OAuth2
- **Validation**: Zod for runtime type checking

### Data Flow

**Text Conversation:**
```
User (Telegram)
    ↓
telegram.ts (Grammy Bot)
    ↓
agent.ts (LangGraph StateGraph)
    ↓
┌─────────────────────────────┐
│ LangGraph Agentic Loop:     │
│  agent → should_continue?    │
│    ↓ (tool_calls detected)  │
│  tools → agent (loop)        │
│    ↓ (no tool_calls)         │
│  END                         │
└─────────────────────────────┘
    ↓
├─ prompt.ts (Watson personality)
├─ tools.ts (Available tools)
│   ├─ weather.ts
│   ├─ searchDocuments.ts → vectorStore.ts
│   ├─ listFiles.ts → vectorStore.ts
│   ├─ createEvent.ts → calendarService.ts
│   ├─ listEvents.ts → calendarService.ts
│   └─ deleteEvent.ts → calendarService.ts
└─ rag.ts (In-memory conversation buffer)
```

**File Upload:**
```
User uploads PDF/text file (Telegram)
    ↓
telegram.ts (message:document handler)
    ↓
fileHandler.ts (download & extract text)
    ↓
vectorStore.ts (chunk & embed)
    ↓
MemoryVectorStore (with persistence to data/vectors.json)
```

1. **Text messages**: User sends message via Telegram → Grammy bot receives in `telegram.ts` → Agent retrieves conversation history as message objects → LangGraph receives [SystemMessage, ...previousMessages, HumanMessage] → LLM processes with full structured context → Response sent back and saved to memory
2. **File uploads**: User sends PDF/text file → Downloaded to `uploads/{userId}/` → Text extracted → Chunked (1000 chars) → Embedded using Ollama → Stored in vector database with per-user metadata

### Vision vs Reality Gap

**README Vision** (not implemented):
- FastAPI backend
- Postgres + pgvector for long-term memory
- Redis for short-term context
- Celery task queue for "gofer" jobs
- Object storage for files
- Human helper delegation system

**Current Implementation**:
- Pure TypeScript/Bun
- In-memory storage (no persistence)
- Single process application
- Local development only
- Basic tool support (mock weather tool only)

## Key Files

### index.ts
Entry point that bootstraps the Telegram bot.

### telegram.ts
Telegram interface layer handling:
- Bot commands: `/showthinking`, `/hidethinking`, `/contextsize`, `/listfiles`, `/deletefile`
- Message routing to agent
- File upload handling (PDFs and text files)
- Chain-of-thought filtering based on user preference
- Error handling for Grammy/HTTP errors
- Grammy Files plugin integration for file downloads

### agent.ts
AI agent orchestration using LangGraph:
- **StateGraph Architecture**: Implements agentic loop with explicit state management
- **Nodes**:
  - `agent`: Calls LLM with tools bound, generates responses or tool calls
  - `tools`: Executes tool calls using ToolNode
- **Edges**:
  - `__start__ → agent`: Entry point
  - `agent → should_continue`: Conditional routing based on tool calls
  - `tools → agent`: Loop back for multi-step reasoning
  - `agent → END`: Finish when no more tool calls
- **State**: Tracks messages array and userId
- **Benefits**: True agentic loops enable Watson to use tools iteratively until task completion
- Manages conversation context injection from memory
- Passes userId metadata for per-user document filtering
- Stores messages in conversation buffer

### prompt.ts
Defines Watson's personality and behavioral guidelines:
- Character: Dr. John Watson (BBC Sherlock version)
- Tone: warm, grounded, dry British wit
- Style: concise, practical, no markdown
- Behavioral constraints and communication guidelines

### tools.ts
Re-exports all available tools:
- `tools/weather.ts` - Mock weather tool
- `tools/searchDocuments.ts` - RAG document search tool
- `tools/listFiles.ts` - List user's uploaded documents
- `tools/createEvent.ts` - Create Google Calendar events
- `tools/listEvents.ts` - List Google Calendar events
- `tools/deleteEvent.ts` - Delete Google Calendar events
- `tools/finish.ts` - Mark agent task completion

### tools/searchDocuments.ts
RAG search tool for user-uploaded documents:
- Searches vector store for relevant chunks
- Filters by userId for per-user isolation
- Returns formatted results with metadata
- Used by Watson when user asks about their files

### tools/weather.ts
Mock weather tool (placeholder).

### rag.ts
Conversation memory management:
- In-memory storage (Map of chat IDs to message arrays)
- Sliding window: keeps last 20 messages per chat
- Context formatting for agent consumption
- **No persistence**: all memory lost on restart

### fileHandler.ts
File upload and processing:
- Downloads files from Telegram to `uploads/{userId}/`
- Extracts text from PDFs using unpdf
- Reads text from .txt, .md, .log files
- File management: list and delete user files
- Security: path validation to prevent directory traversal

### vectorStore.ts
Vector database management:
- Custom SimpleVectorStore with JSON persistence to `data/vectors.json`
- Implements cosine similarity search from scratch
- Document chunking (1000 chars, 200 overlap)
- Per-user metadata tracking
- Search with userId filtering
- Add/remove documents
- Stats and listing functions
- Built custom due to LangChain MemoryVectorStore compatibility issues with Bun

### embeddings.ts
Centralized embedding configuration:
- OllamaEmbeddings with nomic-embed-text model
- Configurable via OLLAMA_EMBEDDING_MODEL env var
- Shared across vector store operations

### services/calendar/
Google Calendar integration with OAuth2 authentication:

**calendarTypes.ts**:
- TypeScript interfaces for calendar operations
- UserTokens, EventInput, EventOutput, ListEventsParams
- ISO 8601 date/time format

**calendarStorage.ts**:
- Per-user OAuth token persistence to `data/calendar_tokens.json`
- Token loading, saving, and validation functions
- Bun.file() based JSON storage

**calendarAuth.ts**:
- OAuth2 flow implementation ("out of band" for desktop apps)
- Authorization URL generation
- Token exchange and automatic refresh
- Token expiry handling (auto-refresh when <5 min remaining)

**calendarService.ts**:
- Google Calendar API v3 operations
- createEvent, listEvents, deleteEvent, findEventByTitle
- Per-user authentication with automatic token refresh
- Timezone support (defaults to UTC)
- Reminder configuration (popup notifications)

**reminderService.ts**:
- Background polling service (checks every 15 minutes)
- Sends Telegram notifications for events within 30 minutes
- Deduplication to prevent duplicate reminders
- Automatic cleanup of old reminder tracking data

### contracts.ts
TypeScript type definitions for Telegram API types (Chat, Message, Update).

## Memory Strategy

### Conversation Memory (rag.ts)
Persistent sliding window for recent conversation:
- **Storage**: JavaScript Map keyed by chat ID + disk persistence to `data/conversations.json`
- **Window Size**: Last 50 messages per conversation (~25 exchanges)
- **Format**: Proper LangChain message objects (HumanMessage/AIMessage)
- **Lifecycle**: Persists across bot restarts via JSON file
- **Context Injection**: Passed as structured message history to LangGraph (not as text in system prompt)

### Document Memory (vectorStore.ts)
Persistent vector storage for uploaded documents:
- **Storage**: Custom SimpleVectorStore with JSON persistence (`data/vectors.json`)
- **Similarity Search**: Cosine similarity implemented from scratch
- **Chunking**: RecursiveCharacterTextSplitter (1000 chars, 200 overlap)
- **Embeddings**: Ollama nomic-embed-text model
- **Metadata**: userId, filename, uploadDate, chunkIndex, totalChunks, fileType
- **Isolation**: Per-user filtering via metadata
- **Persistence**: Automatically saved to disk after add/remove operations
- **Lifecycle**: Persists across bot restarts

### Files on Disk
- **Location**: `uploads/{userId}/{timestamp}_{filename}`
- **Types**: PDF, TXT, MD, LOG
- **Size Limit**: 20MB
- **Security**: Path validation prevents directory traversal

## Bot Commands

- `/showthinking` - Show chain-of-thought reasoning in responses
- `/hidethinking` - Hide chain-of-thought reasoning (default)
- `/contextsize` - Display current conversation context size
- `/listfiles` - List all uploaded documents for the current user
- `/deletefile <filename>` - Delete a specific uploaded document and remove from vector store
- `/calendar_auth` - Connect your Google Calendar account (initiates OAuth flow)
- `/auth_code <code>` - Complete OAuth by providing authorization code from browser

**File Upload**: Send a PDF or text file (.txt, .md, .log) to Watson via Telegram. The file will be:
1. Downloaded to `uploads/{userId}/`
2. Text extracted
3. Chunked and embedded
4. Stored in vector database for future searches
5. Maximum file size: 20MB (Telegram bot API limit)

## Watson Personality Guidelines

When modifying prompts or agent behavior, maintain these characteristics:

- **Tone**: Warm, steadfast, grounded, with dry British wit
- **Communication**: Concise, practical, no fluff
- **Format**: Plain text only, no markdown formatting
- **Character**: Loyal assistant who "keeps receipts" and remembers context
- **Constraints**: Defined in `prompt.ts` - review before making personality changes

## Extension Points

### Adding New Tools
1. Define tool schema in `tools.ts` using Zod
2. Implement tool function
3. Add to tools array exported from `tools.ts`
4. Tools automatically available to agent via LangChain integration

### Modifying Personality
Edit the system prompt in `prompt.ts` - this is injected into every agent invocation.

### Adding Bot Commands
Extend command handlers in `telegram.ts` using Grammy's command middleware.

### Implementing Persistence
Replace the in-memory Map in `rag.ts` with database storage. The interface (`addMessage`, `getRecentMessages`) should remain consistent to avoid changes in `agent.ts`.

## Current Limitations

- **Limited conversation window**: Only last 50 messages kept (older messages dropped without summarization)
- **File size limit**: 20MB maximum (Telegram bot API limitation)
- **Supported file types**: Only PDF and text files (.txt, .md, .log)
- **No tests**: No test framework or test files
- **No deployment config**: Local development only
- **Basic observability**: Console logging only
- **No rate limiting**: No protection against abuse
- **No authentication**: Relies solely on Telegram's user identification
- **Linear search**: SimpleVectorStore uses linear search (fine for <10k documents)

## Model Configuration

The bot uses Ollama running on a local network (192.168.0.114:11434):

**Chat Model** (Qwen3:8b):
- Supports tool calling
- Supports structured outputs
- Runs locally (no external API costs)
- Used for Watson's conversational responses

**Embedding Model** (nomic-embed-text):
- Generates embeddings for document chunks
- Lightweight and effective for RAG
- Must be pulled: `ollama pull nomic-embed-text`
- Used for vector search similarity

**Requirements**:
- Ollama server must be running and accessible
- Both models must be pulled locally
- If unavailable, bot will fail to respond or process documents

## File Upload & RAG Features

### Supported File Types
- **PDF** (.pdf) - Extracted using unpdf
- **Text files** (.txt, .md, .log) - Read directly

### Processing Pipeline
1. User sends document via Telegram
2. File validated (type, size)
3. Downloaded to `uploads/{userId}/{timestamp}_{filename}`
4. Text extracted (PDF parsing or direct read)
5. Text split into chunks (1000 chars, 200 overlap)
6. Each chunk embedded using Ollama
7. Chunks stored in vector database with metadata
8. Confirmation sent to user

### Document Search
- Watson can use `search_my_documents` tool when user asks about their files
- Semantic search finds relevant chunks
- Results include filename, upload date, chunk position
- Per-user isolation ensures privacy

### Commands
- `/listfiles` - Shows all uploaded documents
- `/deletefile <filename>` - Removes document from storage and vector DB
- Direct file upload - Send PDF/text file to Watson

## Google Calendar Integration

### Setup
1. **Google Cloud Console**:
   - Create project at console.cloud.google.com
   - Enable Google Calendar API
   - Create OAuth 2.0 credentials (Desktop app)
   - Copy Client ID and Client Secret to `.env.development`

2. **Environment Variables** (in `.env`):
   ```bash
   GOOGLE_CLIENT_ID="your-client-id.apps.googleusercontent.com"
   GOOGLE_CLIENT_SECRET="your-client-secret"
   LANGFUSE_HOST="http://localhost:3000"
   LANGFUSE_PUB_KEY="pk-lf-..."
   LANGFUSE_SEC_KEY="sk-lf-..."
   ```

3. **User Authentication**:
   - Each user must authenticate via `/calendar_auth`
   - OAuth "out of band" flow (manual code entry)
   - Tokens stored per-user in `data/calendar_tokens.json`
   - Automatic token refresh when expiring

### Features

**Create Events**:
- Natural language: "Schedule meeting tomorrow at 3pm for 1 hour"
- Watson extracts: title, date/time, duration, description
- Optional reminder notifications (popup)
- Timezone support (defaults to UTC)

**List Events**:
- "What's on my calendar today?"
- "Show my schedule for next week"
- Configurable time ranges and result limits

**Delete Events**:
- "Cancel my dentist appointment"
- Search by title or delete by event ID
- Confirmation feedback

**Reminders**:
- Background service polls every 15 minutes
- Sends Telegram notifications 30 minutes before events
- Deduplication prevents duplicate reminders
- Automatic cleanup of old tracking data

### OAuth Flow
1. User sends `/calendar_auth` in Telegram
2. Bot replies with Google authorization URL
3. User opens URL in browser, signs in with Google
4. User grants calendar access permissions
5. Google provides authorization code
6. User sends `/auth_code <code>` to bot
7. Bot exchanges code for access/refresh tokens
8. Tokens stored and auto-refreshed as needed

### Tools Available to Watson
- `create_calendar_event` - Create events with title, time, description, reminders
- `list_calendar_events` - Query events with date filters
- `delete_calendar_event` - Remove events by ID or title search

### Data Storage
- **Tokens**: `data/calendar_tokens.json` (per-user OAuth credentials)
- **Format**: JSON with userId keys
- **Security**: Tokens are sensitive, ensure proper file permissions
- **Lifecycle**: Persists across bot restarts, auto-refreshed when expiring

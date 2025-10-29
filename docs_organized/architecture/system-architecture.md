# Context Selection Architecture Diagram

> Visual representation of intelligent context selection system

---

## System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        USER QUERY + WORKSPACE                        │
│                    "Fix authentication bug"                          │
│             Current file: src/auth/login.py                          │
└───────────────────────────┬─────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     CONTEXT SELECTOR PIPELINE                        │
│                                                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐             │
│  │ Stage 1:     │→ │ Stage 2:     │→ │ Stage 3:     │             │
│  │ RETRIEVAL    │  │ RANKING      │  │ OPTIMIZATION │             │
│  │ (Fast)       │  │ (Accurate)   │  │ (Efficient)  │             │
│  └──────────────┘  └──────────────┘  └──────────────┘             │
│                                                                      │
└───────────────────────────┬─────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     SELECTED CONTEXT (8K tokens)                     │
│  - Repository Map (1K tokens)                                        │
│  - Current File + Dependencies (5K tokens)                           │
│  - Related Files (2K tokens)                                         │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Stage 1: Retrieval (Candidate Generation)

**Goal**: Cast wide net, gather ~50-100 candidates (optimize for RECALL)

```
┌─────────────────────────────────────────────────────────────────┐
│                    MULTI-SOURCE RETRIEVAL                        │
└─────────────────────────────────────────────────────────────────┘
           │
           ├─► Workspace Context ──────────────► High Priority
           │   ├─ Current file
           │   ├─ Open tabs (5% improvement - Copilot)
           │   ├─ Files with errors
           │   ├─ Uncommitted changes
           │   └─ Breakpoint files
           │
           ├─► Temporal Context ───────────────► Medium-High Priority
           │   ├─ Recently changed (24h)
           │   ├─ Frecency scored files
           │   ├─ Files in current branch
           │   └─ Recently closed tabs
           │
           ├─► Dependency Graph ───────────────► Medium Priority
           │   ├─ Direct dependencies (depth=1)
           │   ├─ Transitive dependencies (depth=2)
           │   ├─ Reverse dependencies (who imports this)
           │   └─ PageRank top files
           │
           ├─► Semantic Search ────────────────► Medium Priority
           │   ├─ Vector similarity (embeddings)
           │   ├─ Keyword search (BM25)
           │   └─ Hybrid fusion (RRF)
           │
           ├─► LSP Queries ────────────────────► High Accuracy
           │   ├─ Find references
           │   ├─ Go to definition
           │   ├─ Call hierarchy
           │   └─ Type definitions
           │
           └─► Co-Change Analysis ─────────────► Medium Priority
               ├─ Files changed together
               ├─ Association rules (Apriori)
               └─ 70%+ prediction accuracy

                            │
                            ▼
                   [~50-100 Candidates]
```

---

## Stage 2: Ranking (Relevance Scoring)

**Goal**: Score and rank candidates (optimize for PRECISION)

```
┌─────────────────────────────────────────────────────────────────┐
│                    COMBINED RELEVANCE SCORING                    │
└─────────────────────────────────────────────────────────────────┘

For each candidate file:

┌──────────────────────────────────────────────────────────────────┐
│  Score = Σ (Signal × Weight)                                     │
│                                                                   │
│  Signals:                                                         │
│  ┌────────────────────────────────────────────────────────┐     │
│  │ 1. Frecency Score              × 0.25                  │     │
│  │    - Frequency × Recency                               │     │
│  │    - Visit type bonuses                                │     │
│  │    - Age bucket weights                                │     │
│  ├────────────────────────────────────────────────────────┤     │
│  │ 2. PageRank Score              × 0.20                  │     │
│  │    - Dependency graph centrality                       │     │
│  │    - Transitive importance                             │     │
│  ├────────────────────────────────────────────────────────┤     │
│  │ 3. Co-Change Probability       × 0.15                  │     │
│  │    - Historical change patterns                        │     │
│  │    - Association rule confidence                       │     │
│  ├────────────────────────────────────────────────────────┤     │
│  │ 4. Semantic Similarity         × 0.20                  │     │
│  │    - Cosine similarity to query                        │     │
│  │    - Embedding-based or BM25                           │     │
│  ├────────────────────────────────────────────────────────┤     │
│  │ 5. Current Context Boost       × 0.20                  │     │
│  │    - Is open tab: +0.5                                 │     │
│  │    - Is active file: +0.8                              │     │
│  │    - Has errors: +0.6                                  │     │
│  │    - Uncommitted changes: +0.9                         │     │
│  │    - Same directory: +0.2                              │     │
│  └────────────────────────────────────────────────────────┘     │
│                                                                   │
│  Total Score: 0.0 to 1.0+                                        │
└──────────────────────────────────────────────────────────────────┘

                            │
                            ▼
                  [Ranked Candidates]
                  Sorted by score ↓

Optional: Reranking with Cross-Encoder
┌──────────────────────────────────────────┐
│  For top 20 candidates:                  │
│  - Feed (query, file) pairs to          │
│    cross-encoder model                   │
│  - More accurate but slower              │
│  - 10-20% improvement in precision       │
└──────────────────────────────────────────┘
```

---

## Stage 3: Optimization (Token Budget)

**Goal**: Select optimal subset within token budget (8K tokens)

```
┌─────────────────────────────────────────────────────────────────┐
│                    TOKEN BUDGET OPTIMIZATION                     │
│                  (Knapsack Problem Variant)                      │
└─────────────────────────────────────────────────────────────────┘

Algorithm: Greedy by Value Density (fast, ~90% optimal)

┌──────────────────────────────────────────────────────────────────┐
│  For each file:                                                   │
│    value_density = relevance_score / token_count                 │
│                                                                   │
│  Sort by value_density (descending)                              │
│                                                                   │
│  Select greedily:                                                │
│    while tokens_used < budget:                                   │
│      - Add next highest density file                             │
│      - If doesn't fit: try truncating                            │
│                                                                   │
│  Truncation strategies:                                          │
│    - Full file (highest relevance)                               │
│    - Signatures only (95% token reduction)                       │
│    - Diff hunks (70-90% reduction for changed)                   │
│    - Just file name (reference)                                  │
└──────────────────────────────────────────────────────────────────┘

Progressive Detail Levels:
┌──────────────────────────────────────────────────────────────────┐
│  Tier 1 (Top 3 files, 60% budget):                               │
│    Full content with comments                                    │
│                                                                   │
│  Tier 2 (Next 10 files, 30% budget):                             │
│    Signatures + key implementations                              │
│                                                                   │
│  Tier 3 (Remaining files, 10% budget):                           │
│    File names + brief description                                │
└──────────────────────────────────────────────────────────────────┘

                            │
                            ▼
                  [Final Selection]
                  Within token budget
```

---

## Data Flow Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         DATA SOURCES                             │
└─────────────────────────────────────────────────────────────────┘
           │
           ├─► File System
           │   └─ Watches: file changes, creation, deletion
           │
           ├─► Git Repository
           │   └─ Hooks: commit, checkout, pull
           │
           ├─► IDE/Editor
           │   └─ Events: file open, edit, close, errors
           │
           └─► Language Server
               └─ Queries: references, definitions, hierarchy

                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                      INDEXING LAYER                              │
│                   (Incremental Updates)                          │
└─────────────────────────────────────────────────────────────────┘

┌────────────────┐  ┌────────────────┐  ┌────────────────┐
│ Dependency     │  │ Vector Index   │  │ BM25 Index     │
│ Graph          │  │ (Embeddings)   │  │ (Keywords)     │
│                │  │                │  │                │
│ - Merkle tree  │  │ - FAISS/       │  │ - Inverted     │
│ - Change       │  │   Qdrant       │  │   index        │
│   detection    │  │ - Batch        │  │ - TF-IDF       │
│ - Incremental  │  │   updates      │  │ - Doc freq     │
│   PageRank     │  │                │  │                │
└────────────────┘  └────────────────┘  └────────────────┘

┌────────────────┐  ┌────────────────┐  ┌────────────────┐
│ Tree-Sitter    │  │ Git Mining     │  │ Frecency       │
│ Parse Cache    │  │ Results        │  │ Scores         │
│                │  │                │  │                │
│ - AST per file │  │ - Co-change    │  │ - Access       │
│ - Symbol map   │  │   rules        │  │   history      │
│ - Invalidate   │  │ - Update       │  │ - Real-time    │
│   on change    │  │   nightly      │  │   updates      │
└────────────────┘  └────────────────┘  └────────────────┘

                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                       CACHING LAYER                              │
│                    (LRU with TTL + Hash)                         │
└─────────────────────────────────────────────────────────────────┘

Cache Strategy:
- File contents: 5 min TTL, hash validation
- AST results: 1 hour TTL
- Embeddings: 24 hour TTL
- PageRank: 1 hour TTL, incremental update
- Search results: 5 min TTL

                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    CONTEXT SELECTOR API                          │
└─────────────────────────────────────────────────────────────────┘
```

---

## Component Interaction Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                          USER                                    │
└────────────┬────────────────────────────────────────────────────┘
             │ Query: "Fix auth bug"
             │ Context: current_file, workspace_state
             ▼
┌─────────────────────────────────────────────────────────────────┐
│                   CONTEXT SELECTOR                               │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Orchestrator                                              │  │
│  │  - Coordinates all components                             │  │
│  │  - Manages pipeline stages                                │  │
│  │  - Handles caching                                         │  │
│  └──┬───────────────────────────────────────────────────────┘  │
│     │                                                            │
│     ├──► Candidate Generator                                    │
│     │     ├─► Workspace Context Provider                        │
│     │     ├─► Temporal Context Provider                         │
│     │     ├─► Dependency Graph Manager                          │
│     │     ├─► Semantic Search Engine                            │
│     │     ├─► LSP Client                                        │
│     │     └─► Co-Change Analyzer                                │
│     │                                                            │
│     ├──► Relevance Scorer                                       │
│     │     ├─► Frecency Calculator                               │
│     │     ├─► PageRank Computer                                 │
│     │     ├─► Semantic Similarity Scorer                        │
│     │     └─► Context Boost Evaluator                           │
│     │                                                            │
│     └──► Budget Optimizer                                       │
│           ├─► Token Counter                                     │
│           ├─► Knapsack Solver                                   │
│           └─► Content Formatter                                 │
│                                                                   │
└───────────────────────┬───────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│               STORAGE & INDEXING LAYER                           │
│                                                                   │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐    │
│  │ Graph DB       │  │ Vector Store   │  │ Cache          │    │
│  │ (Dependencies) │  │ (Embeddings)   │  │ (LRU+TTL)      │    │
│  └────────────────┘  └────────────────┘  └────────────────┘    │
│                                                                   │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐    │
│  │ BM25 Index     │  │ AST Cache      │  │ Git Mining DB  │    │
│  └────────────────┘  └────────────────┘  └────────────────┘    │
└───────────────────────┬───────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│                    EXTERNAL SERVICES                             │
│                                                                   │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐    │
│  │ Git            │  │ Language       │  │ IDE/Editor     │    │
│  │ Repository     │  │ Server (LSP)   │  │ API            │    │
│  └────────────────┘  └────────────────┘  └────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

---

## Example: Authentication Bug Scenario

**Input**:
- Query: "Fix the authentication bug where users can't login"
- Current file: `src/auth/login.py`
- Open files: `login.py`, `user.py`
- Files with errors: `login.py`
- Recent changes: `session.py` (2 hours ago)

**Stage 1: Retrieval** (generates ~50 candidates)

```
Workspace Context:
  ✓ src/auth/login.py (current, has errors)      Priority: HIGHEST
  ✓ src/models/user.py (open tab)                Priority: HIGH
  ✓ src/auth/session.py (recently changed)       Priority: HIGH

Dependency Graph:
  ✓ src/auth/session.py (imported by login.py)   Priority: MEDIUM
  ✓ src/db/user_repo.py (imported by user.py)    Priority: MEDIUM
  ✓ src/utils/crypto.py (imported by login.py)   Priority: MEDIUM

Semantic Search (query: "authentication login bug"):
  ✓ src/auth/oauth.py (similar keywords)         Priority: MEDIUM
  ✓ tests/test_auth.py (similar keywords)        Priority: LOW
  ✓ docs/auth.md (similar keywords)              Priority: LOW

LSP Queries (from login.py):
  ✓ src/models/user.py (User class definition)   Priority: HIGH
  ✓ src/auth/decorators.py (@require_auth)       Priority: MEDIUM

Co-Change Analysis (files changed with login.py):
  ✓ src/auth/session.py (85% co-change rate)     Priority: HIGH
  ✓ tests/test_auth.py (70% co-change rate)      Priority: MEDIUM
```

**Stage 2: Ranking** (scores each candidate)

```
Scored Candidates:
1. src/auth/login.py         Score: 0.95  (current + errors + uncommitted)
2. src/models/user.py        Score: 0.82  (open + dependency + high PageRank)
3. src/auth/session.py       Score: 0.78  (recent + co-change + dependency)
4. tests/test_auth.py        Score: 0.65  (co-change + semantic match)
5. src/db/user_repo.py       Score: 0.58  (dependency + PageRank)
6. src/auth/oauth.py         Score: 0.45  (semantic match)
7. src/utils/crypto.py       Score: 0.42  (dependency)
8. src/auth/decorators.py    Score: 0.38  (LSP reference)
9. docs/auth.md              Score: 0.15  (semantic match, low priority)
...
```

**Stage 3: Optimization** (fits within 8K token budget)

```
Token Budget Allocation (8000 tokens total):

Repository Map (1000 tokens):
  - Top 20 most important symbols (PageRank)
  - Function signatures only
  - Provides high-level context

Tier 1 - Full Content (3500 tokens):
  ✓ src/auth/login.py         (1200 tokens)  [Current file with errors]
  ✓ src/models/user.py        (1100 tokens)  [Open tab, high dependency]
  ✓ src/auth/session.py       (1200 tokens)  [Recent + co-change]

Tier 2 - Signatures Only (2000 tokens):
  ✓ tests/test_auth.py        (500 tokens)   [Test coverage info]
  ✓ src/db/user_repo.py       (500 tokens)   [Database layer]
  ✓ src/auth/oauth.py         (500 tokens)   [Related auth code]
  ✓ src/utils/crypto.py       (500 tokens)   [Utility functions]

Tier 3 - File References (500 tokens):
  ✓ src/auth/decorators.py
  ✓ docs/auth.md
  ✓ config/auth_config.yaml

Total: 7000 tokens (reserve 1000 for query/system prompt)
```

**Output Format**:

```markdown
# Repository Structure (signatures only)
class UserAuthenticator:
    def authenticate(username: str, password: str) -> bool
    def validate_token(token: str) -> User | None
    def create_session(user: User) -> Session
...

# src/auth/login.py (full content)
```python
from src.models.user import User
from src.auth.session import SessionManager

def login(username: str, password: str):
    # BUG: Not handling None return from authenticate
    user = authenticate(username, password)
    session = create_session(user)  # Crashes if user is None!
    return session
...
\```

# src/models/user.py (full content)
```python
class User:
    def __init__(self, username, password_hash):
        self.username = username
        ...
\```

# src/auth/session.py (full content)
...

# tests/test_auth.py (signatures only)
```python
def test_login_success(): ...
def test_login_failure(): ...
def test_invalid_credentials(): ...
\```

# Other relevant files:
- src/auth/decorators.py
- docs/auth.md
```

---

## Performance Characteristics

### Latency Breakdown (Target: <1s total)

```
Stage 1: Retrieval
├─ Workspace context:        10ms  (read from IDE API)
├─ Git queries:              50ms  (git log, diff)
├─ Dependency graph:         100ms (cached, incremental)
├─ Semantic search:          200ms (vector search)
├─ LSP queries:              150ms (language server)
└─ Co-change analysis:       50ms  (pre-computed rules)
                            ─────
                            560ms

Stage 2: Ranking
├─ Score computation:        100ms (50 files × 2ms each)
├─ Optional reranking:       300ms (cross-encoder, if enabled)
└─ Sorting:                  5ms
                            ─────
                            405ms (105ms without reranking)

Stage 3: Optimization
├─ Token counting:           20ms  (tiktoken)
├─ Knapsack selection:       30ms  (greedy algorithm)
└─ Content formatting:       10ms
                            ─────
                            60ms

Total (without reranking):   725ms  ✓ Under 1s target
Total (with reranking):      1025ms  ~ At target
```

### Token Efficiency

```
Naive Approach (all dependencies, full files):
- 15 files × 500 tokens average = 7,500 tokens
- Information density: ~40 unique symbols
- Density score: 40 / 7500 = 0.0053

Optimized Approach (intelligent selection + progressive detail):
- Repository map: 1000 tokens → 200 symbols
- 3 full files: 3500 tokens → 150 symbols
- 4 signatures: 2000 tokens → 100 symbols
- 3 references: 500 tokens → 50 symbols
- Total: 7000 tokens → 500 unique symbols
- Density score: 500 / 7000 = 0.071

Improvement: 13.4x better information density
```

### Cache Hit Rates (Typical)

```
Component               Cache Hit Rate    Impact
─────────────────────  ────────────────  ──────────────
File contents          60%               -300ms avg
AST parse results      80%               -150ms avg
Embeddings             90%               -180ms avg
PageRank scores        85%               -80ms avg
BM25 index             95%               -40ms avg
                                        ────────────
                                         -750ms avg

Effective latency with cache: 725ms - 750ms × 0.75 = ~163ms
(Assuming 75% overall cache hit rate)
```

---

## Scaling Considerations

### Small Projects (<100 files)

```
┌─────────────────────────────────────┐
│ Simple, In-Memory Implementation    │
├─────────────────────────────────────┤
│ ✓ In-memory graph                   │
│ ✓ No vector DB needed               │
│ ✓ BM25 on-the-fly                   │
│ ✓ Minimal caching                   │
│                                      │
│ Latency: <200ms                     │
│ Memory: <100MB                      │
└─────────────────────────────────────┘
```

### Medium Projects (100-1000 files)

```
┌─────────────────────────────────────┐
│ Optimized with Caching              │
├─────────────────────────────────────┤
│ ✓ Cached dependency graph           │
│ ✓ Local vector search (FAISS)      │
│ ✓ Indexed BM25                      │
│ ✓ LRU caching                       │
│                                      │
│ Latency: <500ms                     │
│ Memory: <500MB                      │
└─────────────────────────────────────┘
```

### Large Projects (1000-10000 files)

```
┌─────────────────────────────────────┐
│ Incremental + Background Processing │
├─────────────────────────────────────┤
│ ✓ Incremental updates only          │
│ ✓ Background indexing               │
│ ✓ Distributed vector DB             │
│ ✓ Redis caching                     │
│ ✓ Parallel processing               │
│                                      │
│ Latency: <1s                        │
│ Memory: <2GB                        │
└─────────────────────────────────────┘
```

### Very Large Projects (>10000 files)

```
┌─────────────────────────────────────┐
│ Cloud-Based with Preprocessing      │
├─────────────────────────────────────┤
│ ✓ Cloud vector DB (Pinecone)       │
│ ✓ Elasticsearch for BM25            │
│ ✓ Nightly batch processing          │
│ ✓ CDN for static results            │
│ ✓ Aggressive caching                │
│                                      │
│ Latency: <2s                        │
│ Memory: Distributed                 │
└─────────────────────────────────────┘
```

---

**This architecture enables**:
- ✅ High accuracy (75-85% Recall@5)
- ✅ Low latency (<1s for most cases)
- ✅ Efficient token usage (7K tokens, 13x density improvement)
- ✅ Scalable to large codebases
- ✅ Privacy-preserving (can run locally)
- ✅ Extensible (easy to add new sources/signals)


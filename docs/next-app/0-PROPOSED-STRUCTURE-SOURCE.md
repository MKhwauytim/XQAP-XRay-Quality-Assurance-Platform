# Single-HTML Shared-Folder Department Application
## Technical Architecture, Concurrency, Optimization, UI, Export, Backup, and Delivery Study

**Study date:** 2026-09-06
**Target environment:** Managed Windows PCs, modern Chromium-based browser (Microsoft Edge or Google Chrome recommended), Windows shared folder / SMB / UNC storage
**Runtime installation requirement:** **None**
**Final application artifact:** **Exactly one self-contained `.html` file**

---

# 1. Executive Decision

The application is viable under the stated constraints, but it must not be designed as a normal web application and it must not treat the Windows shared folder as a normal database.

The recommended architecture is a **local-first, event-driven, conflict-aware browser application** with the following characteristics:

1. The final deployed application is one HTML file only.
2. All JavaScript, CSS, libraries, Web Workers, icons, schemas, templates, and optional WASM modules are embedded into that HTML at build time.
3. Employee PCs require no Node.js, Python, Java, SQL Server, local service, browser extension, executable, installer, or external runtime.
4. The Windows shared folder is the durable shared data layer.
5. The app must avoid multiple computers rewriting the same large file.
6. Shared changes are represented primarily as immutable events written into per-writer streams.
7. The browser maintains a fast local cache using IndexedDB and in-memory state.
8. The UI reads from local state, not repeatedly from the UNC folder.
9. Synchronization is incremental and adaptive.
10. Chat and active collaborative pages use fast polling and optionally `FileSystemObserver` when supported.
11. Large tabular imports and snapshots use compact columnar representations and compression.
12. Operational events use compact binary serialization and batched compression.
13. Backups use consistent event cut-points, compression, integrity hashes, and optional encryption.
14. HTML reports and editable PowerPoint exports are generated from one shared report/layout model rather than converting arbitrary HTML after rendering.
15. The application is developed as a normal modular TypeScript project but built into one final HTML file.

The primary engineering objective should be:

> **No silent data loss, no uncontrolled last-writer-wins behavior, very low network traffic, deterministic conflict handling, and UI responsiveness that does not depend on the network share for every interaction.**

Absolute "zero issues" cannot be guaranteed in a system exposed to network outages, browser crashes, Windows permission changes, or hardware failures. The correct engineering target is **zero silent overwrite, recoverable failures, idempotent synchronization, deterministic conflict detection, and verified persistence**.

---

# 2. Non-Negotiable Runtime Constraints

## 2.1 Final deployment

The final deployment directory should contain:

```text
DepartmentApp.html
```

Nothing else is required to run the application.

There must be no runtime dependency on:

```text
Node.js
npm
Python
Java
.NET application services
SQL Server
SQLite installation
browser extensions
Electron
local web server
REST API
GraphQL API
cloud service
CDN
external JavaScript
external CSS
external fonts
external image assets required for operation
```

Development is different. During development, the team may use TypeScript, Vite, npm, test frameworks, bundlers, linting tools, source files, and as many development dependencies as necessary. The build pipeline must collapse those resources into the final single HTML artifact.

## 2.2 Data files are not application dependencies

The application necessarily creates and manages data inside the shared folder. Those files are **system data**, not runtime application dependencies.

Therefore this is valid:

```text
DepartmentApp.html
        v
user selects / reconnects
        v
\\SERVER\DepartmentApp\Data\
        |-- writers\
        |-- snapshots\
        |-- attachments\
        |-- backups\
        +-- archive\
```

The distinction is:

- **Application code:** exactly one HTML file.
- **Application data:** files created and controlled by that HTML inside the approved shared folder.

---

# 3. Browser and File-System Baseline

The File System API can work with files on the local machine and user-accessible network file systems. The application should target a controlled browser baseline rather than attempting universal browser compatibility.

Recommended operational baseline:

```text
Windows 10/11
Microsoft Edge or Google Chrome
Organization-managed current/stable browser version
Windows SMB / UNC share
```

A UNC path typically looks like:

```text
\\SERVER-NAME\DepartmentShare\ApplicationData
```

The File System Access picker APIs still have browser-support and secure-context constraints. The existing working application demonstrates viability in the real organization, but the new system should include an explicit compatibility gate and test harness.

## 3.1 Startup capability gate

Before entering the app, check at least:

```text
showDirectoryPicker
FileSystemDirectoryHandle
FileSystemFileHandle.createWritable
IndexedDB
Web Workers
crypto.subtle
CompressionStream
DecompressionStream
BroadcastChannel
Web Locks
FileSystemObserver (optional)
```

The UI should report:

```text
Required capability: supported / unsupported
Optional capability: enabled / fallback active
```

## 3.2 First-launch folder connection

A typical first-launch sequence:

```text
Open DepartmentApp.html
        v
[Connect Department Data Folder]
        v
Select \\SERVER\DepartmentApp\Data
        v
Validate expected folder structure and permissions
        v
Store the FileSystemDirectoryHandle locally when possible
        v
Start sync
```

File handles can be stored in IndexedDB. On later launches, the app should retrieve the handle, call the relevant permission checks, and request user permission only when required by the browser.

---

# 4. Core Architecture

```text
+-----------------------------------------------------------+
|                    DepartmentApp.html                     |
|                                                           |
|  +-----------------------------------------------------+  |
|  | UI / Application Components                         |  |
|  | Lit + Web Components + Web Awesome Core             |  |
|  +------------------------+----------------------------+  |
|                           |                               |
|  +------------------------v----------------------------+  |
|  | Application / Domain Layer                          |  |
|  | Commands, permissions, workflows, validation        |  |
|  +------------------------+----------------------------+  |
|                           |                               |
|  +------------------------v----------------------------+  |
|  | Local Data Engine                                   |  |
|  | Memory + IndexedDB + indexes + outbox               |  |
|  +------------------------+----------------------------+  |
|                           |                               |
|  +------------------------v----------------------------+  |
|  | Sync / Conflict Engine                              |  |
|  | Deltas, heads, versions, idempotency, merge rules   |  |
|  +------------------------+----------------------------+  |
|                           |                               |
|  +------------------------v----------------------------+  |
|  | File Adapter                                        |  |
|  | File System Access API + retries + verification     |  |
|  +------------------------+----------------------------+  |
+---------------------------+-------------------------------+
                            |
                            v
                  Windows SMB / UNC Share
                            |
        +-------------------+--------------------+
        |                   |                    |
      Events             Snapshots           Attachments
        |                   |                    |
   per-writer            immutable             original
    streams              materialized          files
```

---

# 5. The Most Important Concurrency Rule

## 5.1 Do not make 40 users write the same physical file

Avoid this architecture:

```text
40 users
   v
Tasks.json
   v
read -> modify -> overwrite
```

Even with file locking, this creates unnecessary contention, large rewrites, slow network operations, and opportunities for data loss.

Use this rule instead:

> **A mutable physical file should normally have exactly one logical writer. Shared business state is reconstructed from immutable changes written by many independent writers.**

## 5.2 Why this matters

File System Access writes are commonly implemented using a temporary/swap file, with the replacement becoming visible when the writable stream closes. The API supports an `exclusive` mode, but locking must be treated as a defensive mechanism, not the entire distributed-concurrency architecture.

The default `siloed` write mode can allow multiple writers, with each using its own swap file. That is precisely why the app should not depend on uncontrolled concurrent rewriting of shared files.

---

# 6. Event-Driven Shared Data Model

The durable shared model should use **domain events**.

Examples:

```text
TASK_CREATED
TASK_ASSIGNED
TASK_UPDATE_ADDED
TASK_STATUS_CHANGED
TASK_DUE_DATE_CHANGED
TASK_ATTACHMENT_ADDED
CHAT_MESSAGE_CREATED
CHAT_MESSAGE_EDITED
NOTIFICATION_CREATED
NOTIFICATION_ACKNOWLEDGED
USER_CREATED
USER_ROLE_CHANGED
PERMISSION_CHANGED
REQUEST_APPROVED
REQUEST_REJECTED
FILE_ATTACHED
FILE_REPLACED
REPORT_EXPORTED
BACKUP_CREATED
LOGIN
LOGOUT
```

Example logical event:

```json
{
  "eventId": "01K...",
  "writerId": "EMP001:DEVICE4:INSTANCE2",
  "sequence": 1938,
  "entityType": "task",
  "entityId": "TASK-00451",
  "operation": "TASK_UPDATE_ADDED",
  "baseVersion": 17,
  "createdAt": 1788715334491,
  "payload": {
    "text": "Initial review completed"
  }
}
```

This JSON is illustrative. The recommended on-disk event serialization is MessagePack or another compact binary representation rather than verbose object-per-row JSON.

---

# 7. How 10 Employees Update the Same Task

Assume `TASK-00451` is assigned to 10 employees.

## 7.1 Updates are append operations

Employee A adds: "Initial review completed"
Employee B simultaneously adds: "Supporting document reviewed"
Employee C adds: "Waiting for supervisor feedback"

These are not conflicts. They are independent append events:

```text
TASK_UPDATE_ADDED by A
TASK_UPDATE_ADDED by B
TASK_UPDATE_ADDED by C
```

All three survive.

## 7.2 A real conflict

A real conflict occurs when two users change the same logically exclusive field from the same base version.

```text
Task version: 17

Employee A: status -> Completed, baseVersion = 17
Employee B: status -> Cancelled, baseVersion = 17
```

Both events may be safely persisted. No event is discarded.

The merge engine later detects that the two changes are incompatible and produces a conflict record.

There must be no silent last-writer-wins behavior for business-critical fields.

---

# 8. Conflict Rules by Data Type

One generic conflict algorithm is not sufficient.

| Data / Operation | Recommended behavior |
|---|---|
| Add chat message | Append, no conflict |
| Add task update | Append, no conflict |
| Add comment | Append, no conflict |
| Add attachment | Append/version |
| Notification read receipt | Set union |
| Add assignee | Set-add operation |
| Remove assignee | Set-remove operation |
| Counter increment | Operation-based increment |
| Change title | Field version check |
| Change due date | Field version check |
| Change status | Strict version/workflow validation |
| Approval/rejection | Strict workflow conflict detection |
| Replace attachment | Version check |
| Delete | Tombstone event |
| Permission change | Strict version check + audit |
| Rich collaborative document text | Optional CRDT subsystem |

## 8.1 CRDT use

Automerge or Yjs can be evaluated for a very specific feature such as simultaneous editing of a long policy document.

Do **not** use a CRDT library as the entire application database unless a prototype proves that the additional complexity is justified.

Tasks, chats, notifications, approvals, assignments, and activity logs are better represented as explicit business/domain events.

---

# 9. Writer Isolation

Each running app instance receives a unique writer identity.

Do not use only employee ID because one employee can open: PC A, PC B, two browser tabs.

Use something like:

```text
writerId = employeeId + deviceId + instanceId
```

Example: `EMP001:9F3A:01`, `EMP001:9F3A:02`, `EMP001:C821:01`, `EMP014:112B:01`

Each writer owns its own stream. No other writer modifies that stream.

---

# 10. Proposed Shared-Folder Structure

```text
\\SERVER\DepartmentApp\Data\
|
|-- system\
|   |-- format.meta
|   |-- migrations\
|   +-- reference\
|
|-- writers\
|   |-- 2026-09\
|   |   |-- EMP001\
|   |   |   |-- 9F3A-01\
|   |   |   |   |-- head.bin
|   |   |   |   +-- segments\
|   |   |   |       |-- 000001.evtz
|   |   |   |       |-- 000002.evtz
|   |   |   |       +-- ...
|   |   |   +-- 9F3A-02\
|   |   |-- EMP002\
|   |   +-- ...
|   +-- ...
|
|-- snapshots\
|   |-- tasks\
|   |-- users\
|   |-- permissions\
|   |-- reports\
|   +-- imports\
|
|-- attachments\
|   |-- tasks\
|   |-- policies\
|   |-- chat\
|   +-- requests\
|
|-- backups\
|
|-- quarantine\
|
+-- archive\
```

File extensions are implementation details; custom extensions are useful because users are discouraged from manually editing internal system data.

---

# 11. Event Segments

Do not create a permanent separate file for every single click if the system will eventually generate millions of events.

Use **micro-batched immutable segments**: 20 / 100 / 250 events, or a bounded size such as 64-256 KB before compression. The exact threshold must be determined by benchmarking the real network share.

## 11.1 Chat exception

Chat needs low latency, so chat/event flushing should use a shorter time window.

```text
normal activity: flush every 1-3 seconds or at size threshold
chat message:    flush immediately or within 100-500 ms
```

The app can later compact thousands of tiny historical segments into larger archive blocks.

---

# 12. Writer Head Files

Each writer maintains a tiny mutable head file it alone owns.

```json
{
  "writer": "EMP001:9F3A:01",
  "sequence": 1938,
  "segment": 122,
  "lastEvent": "01K...",
  "updatedAt": 1788715334491
}
```

In production this can be stored as compact MessagePack without compression because it should be extremely small.

Other clients use heads as change beacons. If a client previously saw `sequence = 1938` and still sees `1938`, it performs no expensive synchronization work. If the sequence becomes `1944`, it retrieves only the missing segment/event range.

---

# 13. Ordering and Clock Safety

Do not depend on Windows wall-clock timestamps alone for correctness. PCs may have clock drift.

Use:

1. globally unique event ID;
2. per-writer monotonic sequence number;
3. entity base version / causal information;
4. timestamp for human display;
5. optionally a Hybrid Logical Clock (HLC) if deterministic cross-writer ordering becomes necessary.

A timestamp can order the activity log visually, but business conflict decisions should use versions/causality rather than assuming all PC clocks are perfectly synchronized.

---

# 14. Local-First Performance Model

The shared folder must **not** be the UI's working memory.

```text
UNC shared folder
       v incremental changes only
Local cache / indexes
       v
In-memory application state
       v
UI
```

Page changes should not trigger large network reads.

## 14.1 Recommended local cache

```text
IndexedDB + idb or Dexie wrapper embedded into HTML
```

The cache is disposable and reconstructable. The UNC share remains the durable source of truth. If browser cache is deleted, the app rebuilds its local state from the latest snapshots + newer event segments.

## 14.2 Why SQLite-WASM is not the default

SQLite-WASM + OPFS can be technically embedded into one HTML and requires no installed SQL engine. However:

- it adds WASM complexity and bundle weight;
- some OPFS SQLite modes have multi-tab or header-related constraints;
- the user explicitly wants to avoid a database dependency mindset;
- IndexedDB is enough for the first architecture.

SQLite-WASM should be a later benchmark option only if local querying/report workloads prove IndexedDB insufficient.

---

# 15. Local Cache Library Recommendation

## Default: `idb`

Very small, mature wrapper around IndexedDB; simple abstraction; modern TypeScript support; no database server; ISC license; easy to embed.

## Alternative: Dexie

Use Dexie if the local cache needs substantially more sophisticated query/index convenience. Mature; strong IndexedDB abstraction; bulk operations; schema versioning; Apache-2.0.

> Start with `idb`. Upgrade to Dexie only if the data-access layer becomes materially simpler with Dexie's higher-level API.

---

# 16. Synchronization Engine

The SyncEngine should be a first-class subsystem, not miscellaneous functions scattered throughout the UI.

```text
SyncEngine
|-- WriterManager
|-- Outbox
|-- Inbox
|-- HeadScanner
|-- SegmentReader
|-- SegmentWriter
|-- EventDeduplicator
|-- VersionTracker
|-- ConflictResolver
|-- RetryPolicy
|-- ConnectivityState
|-- ObserverAdapter
+-- Metrics
```

## 16.1 Send flow

```text
User action -> Permission check -> Validate command -> Create event ID
-> Apply optimistic local state -> Persist to local outbox
-> Write immutable shared segment -> close() -> verify persisted bytes/hash
-> advance writer head -> mark local event committed -> notify local UI/tabs
```

The UI should become responsive before the network round trip completes.

Possible status states: `Local`, `Syncing`, `Synced`, `Conflict`, `Failed / retrying`.

## 16.2 Receive flow

```text
Detect writer head changed -> Read only missing segments -> Validate binary envelope
-> Decrypt if enabled -> Decompress -> Decode MessagePack / Parquet -> Validate schema
-> Verify integrity -> Ignore duplicate event IDs -> Apply deterministic merge rules
-> Update IndexedDB -> Patch in-memory state -> Render affected components only
```

---

# 17. Semi-Real-Time Chat and Task Collaboration

Without a server there is no WebSocket/message broker that can push directly from one machine to another. The target is **near-real-time filesystem synchronization**.

| Context | Suggested starting interval |
|---|---:|
| Chat open and focused | 1-2 s |
| Shared task actively open | 2-4 s |
| Normal application page | 8-15 s |
| Application idle | 30 s |
| Hidden/background tab | 30-60 s |
| Immediately after local send | immediate write + immediate local render |
| Errors / share unavailable | exponential backoff |

These are initial targets only. The real UNC share must be benchmarked.

## 17.1 `FileSystemObserver`

`FileSystemObserver` can detect file/directory changes without polling, but it remains experimental/non-standard.

```text
if FileSystemObserver exists and passes UNC compatibility test:
    use observer as wake-up accelerator
else:
    adaptive polling
```

Never make correctness depend on `FileSystemObserver`.

## 17.2 Same-PC coordination

- `BroadcastChannel` to notify other tabs/workers on the same origin;
- Web Locks to coordinate same-origin local work such as one active sync leader per PC/origin.

Do not assume Web Locks coordinate different employee computers. They are origin-scoped browser locks, not distributed SMB locks.

---

# 18. Data-Size Optimization Strategy

Optimization has three separate dimensions:

```text
1. Bytes transferred
2. Number of filesystem operations
3. CPU/RAM required to decode and materialize data
```

Reducing only file size is not enough.

---

# 19. Why Excel Can Be 20 MB but JSON Becomes 250-300 MB

`.xlsx` is already a ZIP-compressed OOXML package. When parsed and converted to normal row-object JSON, repeated field names and repeated text values can expand dramatically.

Bad large-data representation:

```json
[
  { "movementNumber": "12345", "portName": "Riyadh", "departmentName": "Compliance", "status": "Completed" },
  { "movementNumber": "12346", "portName": "Riyadh", "departmentName": "Compliance", "status": "Completed" }
]
```

Column names and categorical strings repeat for every row.

---

# 20. Recommended Data Formats

No single format should be used for everything.

| Data category | Preferred format | Compression |
|---|---|---|
| Small application metadata | compact MessagePack or JSON | none |
| Writer heads | MessagePack | none |
| Operational event segments | MessagePack | native ZSTD; GZIP fallback |
| Chat/task event microsegments | MessagePack | compress only when batch size justifies it |
| Large immutable Excel-derived datasets | Parquet candidate | ZSTD |
| Large snapshots | Parquet or compact columnar binary candidate | ZSTD |
| Attachments | original binary format | do not recompress blindly |
| Full backup | versioned archive/container | compression + optional AES-GCM |
| Human export | XLSX / CSV / PPTX | format-native |

---

# 21. JSON Optimization If JSON Is Used

## 21.1 Array rows

```json
{ "columns": ["movement", "port", "status"], "rows": [["12345","Riyadh","Completed"],["12346","Riyadh","Completed"]] }
```

## 21.2 Dictionary encoding

```json
{ "dict": { "port": ["Riyadh","Jeddah","Dammam"], "status": ["Completed","Pending"] },
  "rows": [["12345",0,0],["12346",0,0],["12347",1,1]] }
```

## 21.3 Numeric dates

Avoid repeatedly storing `2026-09-06T14:30:25.000Z` when an epoch integer is sufficient.

## 21.4 Omit unused/null properties

## 21.5 Never embed binary attachments as Base64 inside large JSON data

---

# 22. MessagePack Recommendation

Use MessagePack for operational events because it is structurally similar to JSON but binary and compact.

Good use cases: chat events, task events, activity events, notification receipts, permission changes, small metadata envelopes, writer heads, sync segments.

Do not assume MessagePack automatically beats JSON in every CPU benchmark. Native `JSON.parse()` is heavily optimized. The real advantage is compact typed binary storage.

Always benchmark: raw size, compressed size, encode time, decode time, peak memory.

---

# 23. Compression Recommendation

The browser Compression Streams API now includes gzip, deflate, deflate-raw, brotli, zstd. Individual codec support must be feature-tested on the managed browser version.

```text
1. ZSTD for active app data when natively supported
2. GZIP fallback for maximum compatibility
3. Brotli for cold/archive data only when benchmarks justify the slower compression cost
```

## 23.1 Do not compress tiny records individually

A 200-byte chat message should not necessarily become its own compressed blob. Use micro-batching or a minimum size threshold.

## 23.2 Compression order with encryption

```text
serialize -> compress -> encrypt
```

Do not encrypt and then try to compress encrypted bytes.

---

# 24. Parquet for Large Excel-Derived Data

Parquet provides typed columns, columnar layout, dictionary encoding, run-length/bit-packed encodings, built-in compression including ZSTD, and a mature interoperable format.

Recommended uses: monthly population datasets, large reference datasets, historical imports, large reporting snapshots, analytics source tables.

Do **not** use Parquet as the mutable operational event log.

## 24.1 Browser implementation

`parquet-wasm` can read/write Parquet in WebAssembly in browsers. If adopted, the WASM binary must be embedded into the single HTML file as part of the build. WebAssembly executes inside the browser and can be embedded as Base64/bytes in the HTML.

Parquet/WASM should be adopted only after a real benchmark against the actual Excel datasets.

## 24.2 Mandatory benchmark

For the known ~20 MB Excel case, compare:

| Test | Format |
|---|---|
| A | naive row-object JSON |
| B | JSON + GZIP |
| C | compact row-array JSON + ZSTD |
| D | columnar/dictionary JSON + ZSTD |
| E | MessagePack + ZSTD |
| F | Parquet + ZSTD |

Measure: stored size, UNC read time, decode/decompress time, peak RAM, worker CPU time, time until UI is usable, query/filter speed.

---

# 25. Excel Import / Export

## Recommended library: SheetJS Community Edition

Mature XLSX support; runs in the browser; Apache-2.0 CE; no employee-machine installation; bundleable.

```text
User selects XLSX -> Web Worker -> SheetJS parse -> Schema/type normalization
-> Validation -> Dictionary/column optimization -> Parquet or MessagePack snapshot
-> Compressed shared storage -> Local cache/index update
```

Do not convert the workbook into giant JavaScript row objects on the UI thread and then stringify them into one huge JSON file.

---

# 26. Web Workers Are Mandatory

```text
DataWorker    -- parsing, schema validation, merge/application, indexing
SyncWorker    -- head scans, segment reads, retries, compression/decompression
ImportWorker  -- Excel parsing, transformations, dataset encoding
ReportWorker  -- aggregation, analytics, export data preparation
BackupWorker  -- hashing, compression, archive preparation
```

Vite can inline worker code into the production bundle. The final HTML still remains one file.

---

# 27. UI / UX Architecture

## 27.1 Application component layer: Lit

Lightweight; fast reactive rendering; standard Web Components; TypeScript-friendly; low framework lock-in; BSD-3-Clause; works well for a single-file browser application.

---

# 28. UI Component Library

## Recommended: Web Awesome Core only

Buttons, dialogs, drawers, dropdowns, inputs, checkboxes, alerts, badges, tabs, tooltips, menus, progress controls. Core is MIT licensed.

> Use **Web Awesome Core only**. Do not accidentally depend on Web Awesome Pro components, patterns, or assets if the application must remain 100% free.

Import only components actually used.

---

# 29. Table / Data Grid

## Default recommendation: Tabulator 6.5

Sorting; filtering; header filters; smart filters; editing; validation; column calculations; selection; range selection; menus; movable rows/columns; virtual DOM rendering; browser-side CSV/JSON/XLSX/HTML/PDF export integration; accessibility features; MIT license.

### Why Tabulator over TanStack Table as the default

TanStack Table is headless: table logic, not the full rendered grid. For this project the priority is less custom table code, fewer visualization bugs, faster development, higher maintainability.

```text
Default: Tabulator
Alternative for unusual custom grids: TanStack Table + TanStack Virtual
```

---

# 30. Charts and Dashboards

## Recommended: Apache ECharts

Apache-2.0; mature; rich chart set; interactive; Canvas and SVG renderers; strong performance; configurable and themeable; runs entirely in the browser.

---

# 31. Icons

## Recommended: Lucide

Lightweight SVG icons; consistent visual system; tree-shakable; ISC license. Avoid external icon CDNs.

---

# 32. Runtime Schema Validation

## Recommended: Zod 4

Use Zod for validation at trust boundaries: shared segment decode, Excel normalization, backup restore, imported configuration, migration output, user-generated structured records.

Never accept decoded shared data and directly apply it to application state without schema validation.

---

# 33. ZIP / Archive Utility

## Recommended: fflate

Small pure-JavaScript package; MIT; streaming ZIP support; asynchronous compression; browser support.

Use native `CompressionStream` / `DecompressionStream` for ZSTD/GZIP where possible, and `fflate` when an actual ZIP container is required.

---

# 34. Proposed Free Runtime Library Stack

| Purpose | Default | License | Runtime external dependency? |
|---|---|---|---|
| UI component model | Lit | BSD-3-Clause | No; embedded |
| UI controls | Web Awesome Core | MIT | No; embedded |
| Tables/grid | Tabulator | MIT | No; embedded |
| Charts | Apache ECharts | Apache-2.0 | No; embedded |
| Icons | Lucide | ISC | No; embedded |
| Excel | SheetJS CE | Apache-2.0 | No; embedded |
| PPTX | PptxGenJS | MIT | No; embedded |
| Schema validation | Zod | MIT | No; embedded |
| IndexedDB wrapper | idb | ISC | No; embedded |
| ZIP/GZIP archive | fflate | MIT | No; embedded |
| Event serialization | @msgpack/msgpack or equivalent | ISC | No; embedded |
| Large columnar data | parquet-wasm, only if benchmarked | permissive OSS | No installation; embedded WASM |

All dependencies must be pinned in the development lockfile and reviewed before releases.

---

# 35. PowerPoint Export - Requirement

> An HTML report looks excellent in the browser. Export the same report to PowerPoint with the same layout/design while keeping text, tables, shapes, and charts editable rather than exporting screenshots.

The correct strategy is **not arbitrary HTML screenshot conversion**.

---

# 36. Why Arbitrary HTML -> Editable PPTX Is Difficult

HTML uses the CSS box model, Flexbox, Grid, flow layout, browser font metrics, CSS filters/transforms, responsive rules. PowerPoint uses absolute positioned OOXML objects, text boxes, shapes, native tables, native charts, images, slide masters.

There is no general conversion algorithm that can take arbitrary modern HTML/CSS and always reproduce it perfectly as separately editable PowerPoint objects.

A better method is to generate PowerPoint OOXML objects directly using a specialized library.

---

# 37. Recommended PowerPoint Library: PptxGenJS

Runs directly in the browser and creates standards-compatible PowerPoint OOXML packages. Supports editable text, shapes, tables, charts, slide masters, lines, media. Supports RTL presentation configuration, relevant for Arabic reporting. MIT licensed; browser bundle includes its ZIP dependency.

No PowerPoint installation is required to **generate** the PPTX file.

---

# 38. Do Not Convert the Finished HTML Page

```text
                 Report Data Model
                       |
                 Report Layout Model
                       |
              Shared Design Tokens
                 +-----+-----+
                 |           |
          HTML Renderer   PPTX Renderer
                 |           |
            Browser UI   PptxGenJS
                             |
                             v
                       Editable PPTX
```

This is the critical design decision.

---

# 39. Shared Report Scene Model

Define a report as abstract editable blocks rather than arbitrary DOM.

```ts
type ReportBlock = TextBlock | ShapeBlock | TableBlock | ChartBlock | ImageBlock;

interface TextBlock { kind: 'text'; x: number; y: number; w: number; h: number; text: string; style: TextStyle; }
interface ShapeBlock { kind: 'shape'; shape: 'rect'|'roundRect'|'line'|'ellipse'; x: number; y: number; w: number; h: number; style: ShapeStyle; }
```

Coordinates can use a normalized coordinate system, for example 0-1000 horizontal, 0-562.5 vertical for 16:9. The HTML renderer converts the model to CSS coordinates. The PowerPoint renderer converts the same model to slide inches.

---

# 40. Shared Design Tokens

One report theme: colors, font families, font sizes, font weights, line heights, spacing, border widths, corner radii, chart palette, table header styles, card padding, page/slide dimensions.

```ts
const reportTheme = {
  page: { width: 1000, height: 562.5 },
  typography: { title: { size: 32, weight: 700 }, body: { size: 15, weight: 400 } },
  spacing: { xs: 4, sm: 8, md: 16, lg: 24 }
};
```

Both renderers consume the same theme.

---

# 41. Editable PowerPoint Fidelity Rules

| Report element | HTML | PPTX | Editable in PPTX? |
|---|---|---|---|
| Text | DOM/CSS | native text box | Yes |
| Rectangular card | CSS box | PowerPoint shape | Yes |
| Line/divider | CSS border | PowerPoint line | Yes |
| Table | HTML/Tabulator view | PowerPoint table | Yes |
| Standard bar/line/pie chart | ECharts | native PPT chart | Yes |
| Complex custom ECharts graphic | Canvas/SVG | may require image/vector | Not necessarily |
| Photo/logo | image | image | Image object only |
| Complex CSS filter/blur | CSS | no direct equivalent | No exact mapping |

If exact editable PowerPoint fidelity is a hard requirement, the report design system should avoid browser-only effects that PowerPoint cannot represent natively.

---

# 42. Chart Strategy for HTML + PowerPoint

```text
ChartModel: type, series, categories, labels, colors, title, axis options
HTML:       ChartModel -> Apache ECharts
PowerPoint: ChartModel -> PptxGenJS addChart()
```

Complex chart types should have one of three policies: simplify to an editable PowerPoint-native equivalent; recreate using editable PowerPoint shapes if practical; explicitly mark as a non-editable SVG/image exception.

---

# 43. HTML Table -> PowerPoint

PptxGenJS has an HTML-table-to-slide capability, but it should not be the primary report architecture.

```text
Tabulator data + column model -> Report Table Model -> { HTML grid | PptxGenJS addTable() }
```

---

# 44. Backup Architecture

Three separate features: disaster-recovery backup (restore entire application state); business-data export (Excel, CSV, PowerPoint, other authorized reporting); secure portable archive (authorized transfer / long-term archive).

Do not mix these concepts.

---

# 45. Consistent Backup While Users Continue Working

Because event segments are immutable, a backup does not need to freeze all 40 users.

At backup start, capture a **writer cut vector**:

```text
EMP001 writer A: sequence 1938
EMP002 writer B: sequence 440
EMP003 writer C: sequence 711
```

Then the backup contains: latest valid snapshot + all required segments up to each captured sequence + attachments referenced by that logical state + format/schema metadata + integrity manifest.

Events created after the captured cut are part of the next backup.

---

# 46. Backup File Format

```text
DepartmentApp_2026-09-06.deptbackup
```

Internal logical structure: manifest, schema version, backup timestamp, writer cut vector, snapshot metadata, event chunks, attachment manifest, integrity hashes, encryption metadata if enabled.

For very large backups, use streaming/chunking so the browser does not need to allocate the entire archive in RAM at once.

---

# 47. Integrity Verification

Every important persisted segment should include integrity metadata: formatVersion, writerId, sequenceStart, sequenceEnd, payloadHash, previousSegmentHash (optional hash chain), createdAt.

Use Web Crypto SHA-256.

```text
read -> verify envelope -> verify hash -> decrypt if needed -> decompress -> decode -> schema validate -> accept
```

Invalid data goes to a quarantine workflow rather than silently contaminating the local state.

---

# 48. Encryption

## 48.1 Web Crypto

Recommended symmetric encryption primitive: **AES-GCM** (confidentiality plus authentication/integrity).

## 48.2 Critical limitation: key management

Never embed a permanent shared encryption key in `DepartmentApp.html`. If the key is inside the HTML, every employee who has the HTML can extract it. Storing shared data + key.txt in the same folder does not provide meaningful cryptographic separation.

## 48.3 Live shared-data recommendation

Primary security boundary: Windows identity, SMB share permissions, NTFS ACLs, organization access controls + application role/permission checks.

Application-level encryption for all shared live data is possible only if the organization accepts a key-distribution model such as a passphrase entered each session or another managed secret mechanism.

## 48.4 Backup encryption

```text
backup chunks -> compress -> AES-GCM -> encrypted .deptbackup
```

A user/admin passphrase can derive a wrapping key using a browser-supported KDF. PBKDF2 exists natively in Web Crypto; an embedded Argon2id WASM library can be considered.

---

# 49. Authentication and Permissions

Without a trusted server, application login is not equivalent to a server-enforced security boundary.

The app can implement users, roles, permissions, module access, approval authority, export authority, admin capabilities - but any user who has direct Windows filesystem access outside the app may theoretically manipulate accessible files.

Real security must combine Windows/SMB/NTFS permissions + application authorization + audit trails + integrity validation.

Permission changes themselves should be immutable audited events.

---

# 50. Activity Log

The event architecture naturally produces a complete activity log: login/logout, file upload, file replacement, comment, chat message, permission change, user creation, assignment, status change, approval/rejection, report export, backup creation, restore attempt, configuration change.

This removes the need to separately remember to add logging code to every UI screen.

A command should not be considered complete until its audit event has been created.

---

# 51. Attachments

Never store file contents as Base64 inside operational MessagePack/JSON events.

```text
attachments/tasks/2026-09/...
attachments/policies/2026-09/...
```

Events store only metadata: attachmentId, logical entity ID, original filename, MIME type, size, SHA-256, uploader, createdAt, version.

Already-compressed formats such as PDF, XLSX, PPTX, JPEG, PNG, and ZIP should not be blindly recompressed.

---

# 52. Heavy-App Bundle Optimization

1. tree-shake every library;
2. import individual Web Awesome components only;
3. import individual Lucide icons only;
4. use custom ECharts builds/imports when practical;
5. exclude source maps from production;
6. minify JavaScript and CSS;
7. remove development assertions/logging where safe;
8. inline workers;
9. initialize heavy subsystems only when required;
10. benchmark application startup parse time.

Heavy export libraries such as PowerPoint and Excel should not perform work during startup.

---

# 53. Development and Single-HTML Build Pipeline

```text
TypeScript, Vite, Vitest, Playwright, ESLint / formatter, normal multi-file source tree
        v
Vite production build -> tree-shake, minify, inline workers, inline CSS, inline JS, inline binary/WASM
        v
DepartmentApp.html
```

## 53.1 `vite-plugin-singlefile`

Specifically designed to inline JavaScript and CSS into one HTML file and actively compatible with modern Vite releases. Vite also supports inlining workers using worker imports with the inline option.

## 53.2 WASM if adopted

```text
.wasm -> build step -> Base64 / embedded byte payload -> DepartmentApp.html -> WebAssembly.instantiate(...)
```

## 53.3 Production artifact verification

The build must fail unless: /dist contains exactly one .html; no external `<script src>`; no external stylesheet dependency; no required remote URLs; no required runtime fetch of JS/CSS/WASM; all workers inline; all required icons/assets inline; license notices retained.

Create an automated `verify-single-file-build` script.

---

# 54. Suggested Development Source Structure

```text
src/
|-- app/
|   |-- bootstrap.ts
|   |-- router.ts
|   +-- state.ts
|
|-- core/
|   |-- commands/
|   |-- events/
|   |-- permissions/
|   |-- validation/
|   +-- migrations/
|
|-- data/
|   |-- file-adapter/
|   |-- event-store/
|   |-- cache/
|   |-- sync/
|   |-- conflicts/
|   |-- compression/
|   |-- encryption/
|   +-- backup/
|
|-- workers/
|   |-- sync.worker.ts
|   |-- import.worker.ts
|   |-- report.worker.ts
|   +-- backup.worker.ts
|
|-- ui/
|   |-- components/
|   |-- design-tokens/
|   |-- layouts/
|   +-- tables/
|
|-- reports/
|   |-- model/
|   |-- html-renderer/
|   +-- pptx-renderer/
|
|-- modules/
|   |-- tasks/
|   |-- chat/
|   |-- users/
|   |-- permissions/
|   +-- ...
|
+-- exports/
    |-- excel/
    |-- powerpoint/
    +-- backup/
```

---

# 55. Data-Layer API Rule

Feature code must never directly call File System APIs throughout the app.

Bad:

```ts
// inside 50 different UI components
await directoryHandle.getFileHandle(...)
await fileHandle.createWritable(...)
```

Correct:

```ts
await TaskService.addUpdate(taskId, text)
```

which becomes:

```text
TaskService -> CommandBus -> EventFactory -> LocalStore -> SyncEngine -> FileAdapter
```

---

# 56. Performance Budgets

| Metric | Target |
|---|---:|
| Warm app startup from local cache | < 1 s perceived |
| Initial interactive shell | < 500 ms on target PCs |
| Typical page navigation | < 100 ms perceived |
| Local task update | immediate optimistic render |
| Chat local send render | < 50 ms perceived |
| Chat cross-PC visibility | median 1-3 s while chat active |
| Normal sync payload | delta only |
| UI long-list DOM | only visible rows + buffer |
| Main-thread blocking task | preferably < 50 ms |
| Data parsing > threshold | Worker only |
| Report calculations | Worker / cached aggregate |

---

# 57. Import Performance Rules

1. parse in a Web Worker;
2. normalize column types once;
3. remove unused columns early;
4. dictionary-encode repeated categories;
5. avoid duplicate data copies;
6. avoid giant object-per-row arrays;
7. compress before writing to UNC;
8. create role/module-scoped indexes/snapshots;
9. update UI incrementally with progress;
10. store the normalized compact result so the Excel file is not reparsed every time.

---

# 58. Reporting Performance

```text
Raw imported population -> (once) Worker aggregation -> report index / snapshot -> Dashboard
```

When events change only 10 records, update only affected aggregates rather than recomputing the entire month if the calculation supports incremental updates.

---

# 59. Backup / Compaction Maintenance

Maintenance runs only while an authorized app instance is open. Provide admin actions: System Health, Optimize Storage, Compact Historical Events, Create Snapshot, Create Backup, Verify Integrity, Repair Local Cache, Archive Old Period.

Never delete old events until a new snapshot/archive has been fully written and verified.

---

# 60. Testing Strategy

## 60.1 Unit tests

event encoding/decoding, version calculations, merge rules, conflict detection, idempotency, schema migrations, hash verification, retry algorithms, backup manifests, restore validation, permission decisions.

## 60.2 Property/fuzz tests

reorder events, duplicate events, remove segments, corrupt bytes, clock skew, concurrent field updates, repeated reconnects. The final materialized state must remain deterministic or produce an explicit conflict.

## 60.3 Concurrency simulation

1 / 5 / 10 / 20 / 40 / 60 users. Scenarios: all users sending chat messages; 10 users updating same task; multiple supervisors approving different records; same user in two tabs; same user on two PCs; backup running during writes; network share disconnect/reconnect; browser closed during write; Windows PC sleeps/resumes; old browser cache deleted; stale local snapshot; corrupted segment.

## 60.4 Real UNC benchmark

Synthetic local-folder testing is not enough. Run final performance testing on the actual organization SMB/UNC share with realistic latency, file counts, permissions, antivirus scanning, and bandwidth constraints.

---

# 61. Required Reliability Guarantees

```text
unique event IDs, idempotent replay, per-writer sequences, hash validation, schema versioning,
migration versioning, write verification, retry/backoff, outbox persistence, conflict records,
quarantine, backup restore verification, local cache rebuild
```

A successful UI toast must mean the chosen persistence level has actually succeeded.

Statuses: `Saved locally`, `Synced`, `Conflict requires review`, `Sync pending`, `Sync failed - retrying`.

---

# 62. Recommended Implementation Phases

**Phase 0 - Environment proof.** Tiny one-file compatibility harness. Test: open HTML directly; select UNC directory; store/retrieve handle; read/write; create nested files/directories; worker access; IndexedDB; compression codecs; same-file exclusive mode; FileSystemObserver; network disconnect/reconnect. Deliverable: Browser + UNC compatibility report. Do not build the department application before this baseline is confirmed.

**Phase 1 - Single-file build foundation.** Vite build, single-file plugin, inlined workers, license collection, artifact verifier, DepartmentApp.html proof.

**Phase 2 - Data foundation.** FileAdapter, Zod schemas, event IDs, writer IDs, MessagePack codec, segment format, integrity hashes, writer heads, outbox, inbox, local IndexedDB. Deliverable: reliable write/read/replay prototype.

**Phase 3 - Concurrency and sync.** Adaptive polling, optional FileSystemObserver, BroadcastChannel, same-PC Web Locks, idempotency, version tracker, field merge policies, conflict queue, network retry/backoff. Deliverable: 40-client synthetic synchronization test.

**Phase 4 - Task + Chat proof-of-architecture.** Task, assignments, updates, status conflict, chat room, read receipts, activity log. Acceptance: 10 users update one task without lost updates; 40 users exchange chat messages; same user can open two sessions safely; network outage queues and later syncs.

**Phase 5 - Data optimization / Excel pipeline.** SheetJS Worker import, column/type normalization, compact encoding, ZSTD/GZIP strategy, Parquet prototype, snapshot strategy, role-scoped loading. Select the actual format using benchmark results.

**Phase 6 - Design system and enterprise UI.** Lit application shell, Web Awesome Core controls, design tokens, RTL support, Tabulator grid system, ECharts dashboard system, Lucide icon rules, accessibility baseline.

**Phase 7 - Reporting and exports.** ReportModel, ReportLayoutModel, HTML renderer, PptxGenJS renderer, SheetJS Excel export, print/PDF strategy. Acceptance: HTML report and PPTX share layout tokens; PPTX text/shapes/tables editable; standard charts are native editable charts.

**Phase 8 - Backup, integrity, security.** Backup cut vectors, backup manifest, streaming/chunked archive, SHA-256 integrity, restore validator, optional AES-GCM backup encryption, Windows ACL deployment model, export audit events.

**Phase 9 - Business modules.** Only after the platform is proven. Every module must use the platform APIs: CommandBus, EventStore, Permissions, SyncEngine, Grid component, Report engine, Attachment service. No module-specific direct filesystem code.

**Phase 10 - Hardening and release.** 40-60 client load test, fault injection, cache deletion test, UNC interruption test, large import test, backup/restore test, permission matrix test, browser-version test, performance budget test, single-file artifact verification.

---

# 63. Technology Recommendation Matrix

| Area | Recommended | Status |
|---|---|---|
| Final runtime | Single HTML | Required |
| Development language | TypeScript | Recommended |
| Build | Vite | Recommended |
| Single-file packaging | vite-plugin-singlefile + custom verifier | Recommended |
| UI framework | Lit | Recommended |
| Controls | Web Awesome Core | Recommended |
| Grid | Tabulator | Strong recommendation |
| Custom grid alternative | TanStack Table + Virtual | Optional |
| Charts | Apache ECharts | Strong recommendation |
| Icons | Lucide | Recommended |
| Excel | SheetJS CE | Strong recommendation |
| PPTX | PptxGenJS | Strong recommendation |
| Validation | Zod 4 | Strong recommendation |
| Local cache wrapper | idb | Recommended |
| Higher-level local cache | Dexie | Optional |
| Event serialization | MessagePack | Recommended |
| Active compression | native ZSTD | Preferred when supported |
| Compression fallback | native GZIP | Required fallback |
| ZIP archives | fflate | Recommended |
| Large tabular storage | Parquet + ZSTD | Benchmark candidate |
| Shared SQLite | No | Reject |
| Giant shared JSON | No | Reject |
| Web Locks across PCs | No | Not applicable |
| FileSystemObserver | Optional accelerator | Experimental |
| CRDT entire database | No | Reject initially |
| CRDT specific document editor | Automerge/Yjs benchmark | Optional |

---

# 64. Explicit Rejections

```text
one giant master.json
one giant tasks.json
one database file rewritten by everyone
shared SQLite on UNC
all UI components directly accessing File System APIs
last writer wins
full network reload on every page change
full network reload every sync tick
one file per click forever with no compaction
Base64 attachments inside JSON
Excel -> massive row-object JSON
main-thread Excel parsing
main-thread report aggregation
CDN runtime dependencies
external JavaScript at runtime
external CSS at runtime
external fonts required for app startup
server-only PowerPoint converters
PowerPoint screenshots as the normal editable-report solution
```

---

# 65. Key Risk: File-System Picker / Browser Compatibility

Mitigation: standardize the organization on tested Edge/Chrome versions; build a capability check into startup; preserve the known-working browser configuration from the existing app; run regression tests after browser updates; maintain fallbacks for optional features such as FileSystemObserver and ZSTD.

---

# 66. Key Risk: No Trusted Server

Without a server: no central lock coordinator; no WebSocket broker; no trusted authentication authority inside the app; no always-on background compaction service; no always-on backup scheduler; no central key vault.

The proposed architecture compensates with per-writer files, immutable events, local-first state, version conflicts, adaptive polling, Windows ACLs, admin-triggered maintenance, consistent backup cut vectors.

---

# 67. Key Risk: Large Single HTML

Measure: HTML file size, browser parse time, startup memory, startup CPU, worker initialization, first interaction time.

A larger single HTML is preferable to violating the no-install requirement, but it should still be aggressively tree-shaken and minified.

---

# 68. PowerPoint Final Recommendation

Do **not** implement HTML screenshot -> PPTX, and do not build a custom HTML -> XML -> PowerPoint converter unless no maintained library can satisfy a very specific missing feature.

Implement: ReportData + ReportLayout + DesignTokens -> { HTML | PptxGenJS } -> Browser / Editable OOXML PPTX.

---

# 69. Final Recommended Stack

```text
DEVELOPMENT ONLY
TypeScript, Vite, Vitest, Playwright, vite-plugin-singlefile, npm packages pinned in lockfile
                     BUILD -> DepartmentApp.html

RUNTIME INSIDE THE HTML
Lit, Web Awesome Core, Tabulator, Apache ECharts, Lucide, Zod, idb, SheetJS CE, PptxGenJS,
MessagePack, fflate, optional embedded Parquet WASM, native Web APIs

NATIVE BROWSER APIs
File System Access API, IndexedDB, Web Workers, CompressionStream / DecompressionStream,
Web Crypto, BroadcastChannel, Web Locks, FileSystemObserver (optional)

DURABLE SHARED DATA
Windows SMB / UNC shared folder, per-writer immutable event segments, snapshots,
attachments, backups, archives
```

---

# 70. Final Architecture Principle

```text
Open HTML -> UI appears from local cache -> background delta sync -> new changes merge
-> user works instantly -> changes save locally immediately
-> changes persist to writer-owned shared segments -> other employees receive them within seconds
```

not:

```text
open page -> read entire network database -> wait -> open another tab -> read entire database again -> wait
```

The shared folder must become an **event transport + durable archive**, while the browser becomes the **interactive application engine**.

---

# 71. Immediate Next Engineering Deliverable

Architecture Validation Prototype containing only: login/user selector simulation; one task assigned to 10 users; shared task updates; conflicting status changes; one department chat; activity log; local cache; MessagePack events; ZSTD/GZIP compression; adaptive sync; backup button; single HTML build.

Benchmark report: 1 / 5 / 10 / 20 / 40 concurrent clients; chat sync latency; bytes read/write per client; files opened per minute; event loss = 0; silent overwrites = 0; conflict detection rate; network outage recovery; startup time; warm navigation time; peak browser memory; backup size; Excel format comparison.

---

# 72. Research Sources

MDN File System API / showDirectoryPicker / createWritable / FileSystemObserver / Web Locks /
BroadcastChannel / CompressionStream / DecompressionStream; Chrome persistent File System Access
permissions; Vite worker inlining; vite-plugin-singlefile; Lit; Web Awesome Core (+license);
Tabulator 6.x (+license); Apache ECharts; Lucide; idb; Dexie; Zod; SheetJS CE license;
MessagePack JavaScript; Apache Parquet encodings/compression; fflate; MDN Zstandard;
PptxGenJS (introduction, browser integration, shapes, tables, charts, html-to-powerpoint, license).

---

## Study conclusion

**Recommended direction:** proceed with a dedicated architecture prototype using per-writer immutable events, MessagePack, native ZSTD/GZIP, IndexedDB local caching, adaptive filesystem sync, Lit/Web Awesome, Tabulator, ECharts, SheetJS CE, and PptxGenJS, while benchmarking Parquet for the large Excel-derived datasets. Package all runtime resources into one verified HTML artifact.

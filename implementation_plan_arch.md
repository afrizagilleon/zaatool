# UI Nodes & Deployment — Feature Plan

Fitur baru: menambahkan **UI nodes** ke flow editor (`ui:input`, `ui:table`, `ui:text`, `ui:image`, `file`) yang merender UI langsung di canvas dan menjadi fondasi untuk fitur **deployment** (layout builder + trigger system).

## Diskusi & Saran

Sebelum ke detail implementasi, saya ingin berdiskusi beberapa poin penting:

### 🧩 Tentang `ui:table` — Saran Saya

Ide kamu sudah baik, tapi saya sarankan pendekatan yang lebih simpel dan fleksibel:

```
ui:table node:
├── Input Handle: "data" (array of objects) ← data sumber
├── Config (di CodePanel):
│   ├── columns[] → { key, header, width?, sortable?, format? }
│   ├── pagination: boolean
│   ├── pageSize: number
│   └── striped/bordered/compact: styling options
└── Output Handle: "selectedRow" (object) ← row yang diklik/diselect
```

**Kenapa lebih baik?**
- Header & column config **cukup didefinisikan di `data.config`** (tidak perlu handle terpisah untuk header/column/config — terlalu granular)
- Data masuk lewat **satu handle `data`** (array of objects) → lebih clean
- Bisa auto-detect columns dari data jika user tidak define manual
- Config bisa diedit di CodePanel (bukan lewat handle)
- Output handle `selectedRow` berguna kalau user mau chain ke node lain setelah klik row

### 🖼️ Tentang Render UI di Canvas

Untuk menampilkan render UI langsung di node editor, kita akan render UI **di luar area node utama (floating)**.

- Untuk layout **LR (horizontal)**: render UI tepat di **bawah** node.
- Untuk layout **TB (vertical)**: render UI di **samping kanan/kiri** node.

Pendekatan teknis: kita akan buat container absolute/relative di dalam Custom Node, memposisikannya di luar border node, sehingga tidak mengganggu handle dan struktur node utama.

### 🎯 Tentang CodePanel — Transformasi ke "Properties Panel"

CodePanel saat ini hanya menangani node `code`, `if`, `loop`. Saya sarankan **rename + extend** jadi **PropertiesPanel** yang bersifat **polymorphic**:

```
PropertiesPanel
├── Node type: code/if/loop → tampilkan code editor + schema (seperti sekarang)
├── Node type: ui:input → tampilkan JSON schema editor + layout config + AI builder
├── Node type: ui:table → tampilkan column config + styling
├── Node type: ui:text → tampilkan format selector (markdown/txt/json)
├── Node type: ui:image → tampilkan source selector (storage/handle)
└── Node type: file → tampilkan file picker + config
```

### 🚀 Tentang Deployment & Trigger

Ini konsep besar yang memerlukan beberapa komponen:

**1. Trigger System (Engine-side)**
```
Triggers:
├── manual     → tombol "Start" → jalankan flow dari awal
├── cron       → jadwal berulang (cron expression)
├── schedule   → satu kali di waktu tertentu
└── ui:input   → perubahan pada UI node memicu re-run downstream
```

**2. Deploy Layout Builder (Web-side, fase terpisah)**
```
Deploy View:
├── react-grid-layout canvas
├── Drag UI nodes dari flow ke layout grid
├── Resizable, snappable, responsive breakpoints
├── Menu/page/navigation builder
└── Shareable URL → orang lain melihat rendered layout saja
```

---

## Proposed Changes

Perubahan dikelompokkan per fase. **Fase 1** adalah UI Nodes (yang kita bangun sekarang).

### Fase 1A: Shared Types & Schema Extension

#### [MODIFY] [graph.ts](file:///d:/Projects/zaa-tool/packages/shared/src/graph.ts)

Extend `NodeDef.type` untuk mendukung tipe UI baru dan tambah interface untuk UI node data:

```typescript
// Extend node types
type: "code" | "if" | "loop" | "http" | "input" | "output" 
    | "ui:input" | "ui:table" | "ui:text" | "ui:image" | "file";

// New: UI-specific data interfaces
export interface UiInputField {
  id: string;
  type: 'text' | 'textarea' | 'select' | 'multi-select' | 'radio' | 'password' | 'number' | 'email';
  label: string;
  placeholder?: string;
  required?: boolean;
  defaultValue?: unknown;
  options?: { value: string; label: string }[];  // for select/radio
  props?: {
    maxLength?: number;
    minLength?: number;
    disabled?: boolean;
    rows?: number;        // for textarea
    min?: number;         // for number
    max?: number;         // for number
    step?: number;        // for number
    searchable?: boolean; // for select
    [key: string]: unknown;
  };
}

export interface UiInputLayout {
  columns?: 1 | 2 | 3 | 4;
  gap?: 'sm' | 'md' | 'lg';
  submitLabel?: string;
  showSubmit?: boolean;
  triggerOn?: 'submit' | 'change';
}

export interface UiInputSchema {
  fields: UiInputField[];
  layout?: UiInputLayout;
}

export interface UiTableColumn {
  key: string;
  header: string;
  width?: number;
  sortable?: boolean;
  format?: 'text' | 'number' | 'date' | 'badge' | 'link';
}

export interface UiTableConfig {
  columns?: UiTableColumn[];
  pagination?: boolean;
  pageSize?: number;
  selectable?: boolean;
  striped?: boolean;
  compact?: boolean;
  autoColumns?: boolean; // auto-detect from data
}
```

---

### Fase 1B: Frontend — UI Node Components

#### [NEW] `packages/web/src/components/nodes/UiInputNode.tsx`

Custom React Flow node untuk `ui:input`. Renders:
- Header dengan icon & label
- **Live form preview** dirender secara absolute di **bawah** (LR) atau **samping** (TB) node
- Input handles: `options_{fieldId}` (untuk dynamic options per select/radio field)
- Output handle: `values` (object — schema otomatis dari fields)
- Trigger behavior: "submit" atau "change" based

#### [NEW] `packages/web/src/components/nodes/UiTableNode.tsx`

Custom React Flow node untuk `ui:table`. Renders:
- Header dengan icon & label
- **Data table preview** dirender di luar node
- Input handle: `data` (array)
- Output handle: `selectedRow` (object)

#### [NEW] `packages/web/src/components/nodes/UiTextNode.tsx`

Custom React Flow node untuk `ui:text`. Renders:
- Header dengan icon
- Input handle: `value` (string), `format` (string — "markdown" | "text" | "json")
- Rendered text/markdown preview di luar node
- Tidak ada output handle (display-only)

#### [NEW] `packages/web/src/components/nodes/UiImageNode.tsx`

Custom React Flow node untuk `ui:image`. Renders:
- Header dengan icon
- Input handle: `src` (string — URL/path)
- Manual path input field (untuk static images)
- Image preview di luar node
- Tidak ada output handle (display-only)

#### [NEW] `packages/web/src/components/nodes/FileNode.tsx`

Custom React Flow node untuk `file`. Renders:
- Header dengan icon
- File picker / path input
- Output handle: `file` (object — { name, path, type, size })
- Bisa dipakai untuk "kirim file ke AI" atau OCR

---

### Fase 1C: Frontend — PropertiesPanel (Rename CodePanel)

#### [MODIFY] [CodePanel.tsx](file:///d:/Projects/zaa-tool/packages/web/src/components/panels/CodePanel.tsx) → Rename ke `PropertiesPanel.tsx`

Refactor menjadi polymorphic panel:

```
PropertiesPanel
├── renderCodeProperties()    → untuk code/if/loop (existing logic)
├── renderUiInputProperties() → JSON schema editor + AI builder + layout config
├── renderUiTableProperties() → column config + styling config
├── renderUiTextProperties()  → format selector
├── renderUiImageProperties() → source config
└── renderFileProperties()    → file config
```

#### [NEW] `packages/web/src/components/panels/properties/UiInputProperties.tsx`

Panel khusus untuk edit `ui:input`:
- Visual form field builder (add/remove/reorder fields)
- Per-field config (type, label, placeholder, required, props)
- Layout settings (columns, gap, submit button, triggerOn)
- **AI Builder button** → buka dialog, user ketik deskripsi, AI generate JSON schema
- JSON editor toggle (raw JSON view)

#### [NEW] `packages/web/src/components/panels/properties/UiTableProperties.tsx`
#### [NEW] `packages/web/src/components/panels/properties/UiTextProperties.tsx`
#### [NEW] `packages/web/src/components/panels/properties/UiImageProperties.tsx`
#### [NEW] `packages/web/src/components/panels/properties/FileProperties.tsx`

---

### Fase 1D: Frontend — Canvas & Palette Integration

#### [MODIFY] [FlowCanvas.tsx](file:///d:/Projects/zaa-tool/packages/web/src/components/canvas/FlowCanvas.tsx)

- Register new node types di `nodeTypes` map
- Add default node data factories untuk setiap UI node type

#### [MODIFY] [NodePalette.tsx](file:///d:/Projects/zaa-tool/packages/web/src/components/layout/NodePalette.tsx)

- Tambah kategori baru "UI Components" dengan semua UI node items
- Tambah kategori "Data" untuk file node

#### [MODIFY] [flowStore.ts](file:///d:/Projects/zaa-tool/packages/web/src/store/flowStore.ts)

- Extend `FlowNodeData` type untuk mendukung UI-specific data

#### [MODIFY] [App.tsx](file:///d:/Projects/zaa-tool/packages/web/src/App.tsx)

- Replace `CodePanel` import dengan `PropertiesPanel`

---

### Fase 1E: Shadcn Components

Install via pnpm:
```bash
cd packages/web
pnpm dlx shadcn-ui@latest add radio-group checkbox label switch separator scroll-area
```

---

### Fase 1F: Engine — UI Node Executors (Minimal)

> [!NOTE]
> UI nodes di engine bersifat **passthrough** — mereka tidak menjalankan kode, hanya meneruskan data. Eksekusi sesungguhnya terjadi di frontend saat user berinteraksi.

#### [NEW] `packages/engine/src/executors/ui-input.executor.ts`

```typescript
// Engine-side: ui:input node hanya meneruskan values yang diterima dari frontend
// Saat flow dijalankan manual/cron, node ini menunggu input dari user via WS
// atau menggunakan default values jika ada
```

#### [NEW] `packages/engine/src/executors/ui-table.executor.ts`
#### [NEW] `packages/engine/src/executors/ui-text.executor.ts`  
#### [NEW] `packages/engine/src/executors/file.executor.ts`

#### [MODIFY] [flow-runner.ts](file:///d:/Projects/zaa-tool/packages/engine/src/core/flow-runner.ts)

- Register UI node executors di registry

---

## Ringkasan File Changes

| Area | File | Action |
|------|------|--------|
| **Shared** | `graph.ts` | MODIFY — extend types |
| **Web/Nodes** | `UiInputNode.tsx` | NEW |
| **Web/Nodes** | `UiTableNode.tsx` | NEW |
| **Web/Nodes** | `UiTextNode.tsx` | NEW |
| **Web/Nodes** | `UiImageNode.tsx` | NEW |
| **Web/Nodes** | `FileNode.tsx` | NEW |
| **Web/Panels** | `CodePanel.tsx` → `PropertiesPanel.tsx` | MODIFY/RENAME |
| **Web/Panels** | `properties/UiInputProperties.tsx` | NEW |
| **Web/Panels** | `properties/UiTableProperties.tsx` | NEW |
| **Web/Panels** | `properties/UiTextProperties.tsx` | NEW |
| **Web/Panels** | `properties/UiImageProperties.tsx` | NEW |
| **Web/Panels** | `properties/FileProperties.tsx` | NEW |
| **Web/Canvas** | `FlowCanvas.tsx` | MODIFY |
| **Web/Layout** | `NodePalette.tsx` | MODIFY |
| **Web/Store** | `flowStore.ts` | MODIFY |
| **Web/App** | `App.tsx` | MODIFY |
| **Web/UI** | `radio-group.tsx`, `checkbox.tsx`, `label.tsx`, etc. | NEW (shadcn) |
| **Engine** | `ui-input.executor.ts`, etc. | NEW |
| **Engine** | `flow-runner.ts` | MODIFY |

---

## Verification Plan

### Automated Tests
```bash
# Build check
cd packages/shared && pnpm build
cd packages/engine && pnpm build  
cd packages/web && pnpm build
```

### Manual Verification
1. Drag setiap UI node dari palette ke canvas — pastikan render benar
2. Klik UI node → PropertiesPanel menampilkan config yang sesuai
3. Edit `ui:input` fields → preview di node berubah real-time
4. Hubungkan `ui:input` output ke node `code` input → pastikan schema compatible
5. Test dynamic options: hubungkan code node ke `options_` handle
6. Test `ui:table` dengan data dari code node
7. Test layout LR dan TB untuk setiap UI node
8. Pastikan save/load flow dengan UI nodes berfungsi (graph.json roundtrip)

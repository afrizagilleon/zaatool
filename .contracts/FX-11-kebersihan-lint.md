---
id: FX11
title: Kebersihan lint (F-119)
status: DONE          # READY | IN_PROGRESS | DONE | BLOCKED | NEEDS_REVIEW
baseline_branch: dev
baseline_commit: f8353720c069b8a443c8ae4997920b16c88ec57e
work_branch: fx11-kebersihan-lint
owner_author: claude
executor: ant-ai
last_updated: 2026-08-09
---

# FX11 — Kebersihan lint (F-119)

## 0. Cabang kerja (baca sebelum §1)

Tidak bergantung pada FX10 — area kodenya berbeda (FX10 menyentuh `authStore.ts`,
`map-graph.ts`, engine; FX11 menyentuh 31 berkas lain). Bisa dikerjakan sebelum, sesudah,
atau bersamaan dengan FX10, tapi **jangan di branch yang sama** — kalau FX10 belum
merge saat kamu mulai FX11, potong dari `dev` apa adanya; konflik file kecil kemungkinan
besar tidak ada karena keduanya menghindari berkas satu sama lain (lihat §5).

```bash
git checkout dev
git pull --ff-only 2>/dev/null || true
git rev-parse HEAD
git checkout -b fx11-kebersihan-lint
```

**Catat baseline lint sekarang, sebelum mengubah apa pun:**

```bash
pnpm --filter @zaa-tool/web run lint 2>&1 | tail -5
```

Tulis output lengkapnya (bukan cuma angka) di §9 — kontrak ini yang tujuannya justru
mengubah angka itu, jadi baseline harus presisi.

Kerja di branch itu. **Jangan commit ke `dev`. Jangan push. Jangan buat PR.**

## 1. Mission

`pnpm --filter @zaa-tool/web run lint` gagal dengan 45 problems (42 error, 3 warning) di
`dev` — utang yang menumpuk sejak sebelum FX1, tidak pernah nol sejak proyek ini punya
lint. Di akhir milestone ini: **nol** error, nol warning, `lint` exit 0.

Bukan proyek penulisan ulang. Setiap perbaikan mengikuti pola yang sudah ada di
codebase ini sendiri di tempat lain, bukan pola baru yang kamu bawa dari luar.

## 2. Baca dulu (wajib, berurutan)

1. File ini seluruhnya, termasuk §0
2. `RULES.md` — bagian tentang komentar dan tentang tidak memperbaiki di luar scope
3. Contoh pola yang sudah dipakai proyek ini untuk memindahkan fungsi murni keluar dari
   berkas komponen: `packages/web/src/lib/csv.ts`, `packages/web/src/lib/tile-metrics.ts`,
   `packages/web/src/lib/media-source.ts`, `packages/web/src/lib/tile-title.ts` — semua
   lahir dari perbaikan `react-refresh/only-export-components` di FX8. Tiru pola
   penamaan dan lokasinya (`src/lib/`), jangan menciptakan struktur baru.

Jangan membaca seluruh repo "untuk jaga-jaga". Jangan mengubah berkas di luar §5.

## 3. Context ringkas

### Perilaku sekarang, diukur pada baseline_commit

```
✖ 45 problems (42 errors, 3 warnings)
```

Rincian per aturan, dihitung langsung dari `pnpm --filter @zaa-tool/web run lint`:

| Aturan | Jumlah | Kelas risiko |
|---|---|---|
| `react-hooks/set-state-in-effect` | 18 | **Tinggi** — soal waktu render, lihat T-02 |
| `react-refresh/only-export-components` | 9 | Rendah — pola sudah ada, lihat T-01 |
| `@typescript-eslint/no-explicit-any` | 8 | Sedang — butuh tipe yang benar, bukan `unknown` serampangan |
| `react-hooks/exhaustive-deps` | 3 | **Tinggi** — soal waktu render, lihat T-02 |
| `no-useless-assignment` | 2 | Rendah — mekanis |
| `react-hooks/refs` | 1 | **Tinggi** — soal waktu render, lihat T-02 |
| `react-hooks/immutability` | 1 | **Tinggi** — soal waktu render, lihat T-02 |
| `prefer-const` | 1 | Rendah — mekanis |
| `preserve-caught-error` | 1 | Rendah — tambah `{ cause: err }` |
| `@typescript-eslint/no-unused-vars` | 1 | Rendah — mekanis |

31 berkas tersentuh total. Daftar lengkap: jalankan
`pnpm --filter @zaa-tool/web run lint 2>&1 | grep -E "^\S+\.tsx?$"` — jangan percaya
daftar yang ditulis di kontrak ini kalau `dev` sudah bergerak sejak `baseline_commit`,
hitung ulang.

**Kenapa dipisah risiko tinggi/rendah**: empat aturan `react-hooks/*` (23 dari 45
problem, lebih dari separuh) semuanya tentang **kapan** state berubah relatif terhadap
render — `set-state-in-effect` khususnya berarti "memanggil `setState` secara sinkron di
dalam efek bisa memicu render berantai". Memperbaikinya dengan menghapus baris yang
mengeluh (`// eslint-disable`) menyembunyikan gejala, bukan memperbaikinya, dan
memperbaikinya dengan salah (mis. memindahkan state update ke tempat yang menjalankannya
di waktu yang berbeda) bisa mengubah kapan UI memperbarui dirinya — regresi yang tidak
tertangkap oleh `tsc` maupun test yang sudah ada karena keduanya tidak menguji urutan
render.

### Invariant (jangan dilanggar)

- **INV-1 — Komentar yang sudah ada tetap di sana.** Kalau kode pindah ke `src/lib/`,
  komentarnya ikut pindah utuh. Periksa sebelum menandai task DONE:
  ```bash
  git diff dev -- '*.ts' '*.tsx' | grep -E "^-" | grep -E "(\*|//|\{/\*)"
  ```
- **INV-2 — Tidak ada `eslint-disable`.** Kalau sebuah baris benar-benar tidak bisa
  diperbaiki dalam scope milestone ini, **jangan disable** — tandai di §9 sebagai
  BLOCKED untuk baris itu spesifik, biarkan lint tetap merah untuknya, dan laporkan.
  Comment yang membungkam linter tanpa memperbaiki akar masalahnya adalah utang yang
  disamarkan sebagai lunas.
- **INV-3 — `any` diganti tipe yang benar, bukan `unknown` yang dipaksakan.** Delapan
  titik `no-explicit-any` masing-masing punya bentuk data yang sebenarnya diketahui dari
  konteksnya (parameter event, respons API, dll.) — cari tipe yang sudah ada di
  `packages/shared` dulu sebelum menulis interface baru.
- **INV-4** — setiap fungsi async menangani error-nya; tidak ada floating promise.

### Keputusan yang sudah final

- **D-1 (T-01, only-export-components)**: fungsi/konstanta murni yang diekspor dari
  berkas komponen dipindah ke `packages/web/src/lib/<nama-domain>.ts` — nama file
  mengikuti domainnya (bukan nama komponen asal), sesuai pola FX8. Komponennya sendiri
  lalu meng-import dari sana.
- **D-2 (T-02, react-hooks/*)**: setiap dari 23 titik (18+3+1+1) diperbaiki **satu per
  satu**, bukan disapu dengan pola yang sama untuk semuanya, karena penyebabnya berbeda-
  beda per situs. Untuk `set-state-in-effect` spesifik: solusi yang disukai eslint-plugin-
  react-hooks sendiri biasanya salah satu dari — (a) turunkan nilainya saat render alih-
  alih menyimpannya ke state di efek, (b) pindahkan pemicunya ke event handler yang
  sebenarnya menyebabkannya (klik, submit, dll.) alih-alih efek yang "menebak" dari
  perubahan lain, atau (c) kalau efeknya memang harus mengikuti sesuatu dari luar React
  (props berubah, socket event), gunakan pola `key` untuk me-remount alih-alih
  `setState` di efek. Executor memilih yang paling sesuai per situs dan **menulis satu
  kalimat di §9 untuk setiap situs** yang menjelaskan kenapa pilihan itu tidak mengubah
  perilaku yang terlihat pengguna.
- **D-3 (T-03, no-explicit-any)**: tipe pengganti dicari dulu di `packages/shared/src/`
  sebelum menulis yang baru. Kalau memang tidak ada tipe yang cocok dan bentuk datanya
  genuinely tidak diketahui (mis. payload webhook eksternal), `unknown` + type guard
  (sesuai INV-3 kontrak lain di proyek ini) — bukan `any` yang cuma diganti nama.
- **D-4 (T-04, sisa mekanis)**: `no-useless-assignment`, `prefer-const`,
  `no-unused-vars`, `preserve-caught-error` — perbaikan literal sesuai pesan error
  eslint, tidak ada keputusan desain di dalamnya.

### Open questions

*(kosong)*

## 4. Requirements & sukses

### In scope

- **RQ-01**: `pnpm --filter @zaa-tool/web run lint` exit 0, nol error, nol warning.
- **RQ-02**: tidak ada `eslint-disable` baru di mana pun (INV-2).
- **RQ-03**: tidak ada regresi test — suite yang hijau di `dev` tetap hijau, dan setiap
  perbaikan `react-hooks/*` (T-02) diverifikasi tidak mengubah perilaku lewat penjelasan
  tertulis di §9, minimal.

### Out of scope

- Menambah test baru untuk perilaku yang sudah ada dan tidak diubah — kontrak ini
  membersihkan lint, bukan menambah cakupan test.
- Refactor apa pun di luar yang dituntut untuk memperbaiki pesan lint yang ada.
- Bug di FX10 (resiliensi koneksi, id trigger System Map) — kontrak terpisah.

### Definition of Done

- [ ] `pnpm --filter @zaa-tool/web run lint` mencetak nol problem, exit 0
- [ ] Semua task T-01..T-05 berstatus DONE
- [ ] Tidak ada `eslint-disable` di diff (RQ-02) —
      `git diff dev | grep "eslint-disable"` kosong
- [ ] `pnpm --filter @zaa-tool/engine test` dan `pnpm --filter @zaa-tool/web test` exit 0
      (regresi nol)
- [ ] `pnpm --filter @zaa-tool/web run build` **dan**
      `pnpm --filter @zaa-tool/engine run build` exit 0
- [ ] `git diff dev -- '*.ts' '*.tsx' | grep "^-" | grep -E "(\*|//)"` bersih, atau setiap
      barisnya pindahan (INV-1)
- [ ] §9 berisi, untuk setiap dari 23 titik `react-hooks/*`, satu kalimat penjelasan
      (D-2)
- [ ] §9 diisi dengan output terminal mentah, termasuk SHA `dev` yang dipakai
- [ ] `PROGRESS.md` dan `.plannings/RENCANA PERBAIKAN TOTAL v3.0.md` diperbarui — F-119
      ditandai selesai dengan tanggal dan angka sebelum/sesudah

### Dinyatakan gagal / berhenti jika

- **BLOCKED**: satu atau lebih titik `react-hooks/*` ternyata tidak bisa diperbaiki
  tanpa mengubah perilaku yang terlihat pengguna dengan cara yang tidak jelas benar
  salahnya — laporkan titik itu spesifik di §9, biarkan lint merah untuknya saja, jangan
  memaksakan perbaikan yang kamu sendiri tidak yakin.
- **NEEDS_REVIEW**: perbaikan `no-explicit-any` di suatu titik ternyata butuh tipe baru
  yang seharusnya hidup di `packages/shared` (dipakai engine juga) — berhenti di situ,
  jangan menduplikasi tipe di `web` saja.

## 5. Batas kerja

### Boleh ubah

Tiga puluh satu berkas berikut (dari `dev` pada `baseline_commit` — hitung ulang lewat
perintah di §3 kalau `dev` sudah bergerak):

```
packages/web/src/components/map/MapControls.tsx
packages/web/src/components/map/SystemMap.tsx
packages/web/src/components/notebook/DeployButton.tsx
packages/web/src/components/notebook/DeployReviewDialog.tsx
packages/web/src/components/notebook/NotebookList.tsx
packages/web/src/components/notebook/ParallelGroup.tsx
packages/web/src/components/notebook/RunHistory.tsx
packages/web/src/components/pages/AppsPage.tsx
packages/web/src/components/pages/NotebooksPage.tsx
packages/web/src/components/pages/ShareDialog.tsx
packages/web/src/components/pages/SharedPage.tsx
packages/web/src/components/pages/render/ActionDialog.tsx
packages/web/src/components/pages/render/InputField.tsx
packages/web/src/components/pages/render/PageGrid.tsx
packages/web/src/components/resources/FilePreviewDialog.tsx
packages/web/src/components/resources/NameInputDialog.tsx
packages/web/src/components/resources/SkillEditorDialog.tsx
packages/web/src/components/ui/DataTable.tsx
packages/web/src/components/ui/badge.tsx
packages/web/src/components/ui/button.tsx
packages/web/src/components/ui/carousel.tsx
packages/web/src/components/ui/tabs.tsx
packages/web/src/hooks/useCatalogRefresh.ts
packages/web/src/hooks/useNotebookMap.ts
packages/web/src/hooks/useRunActivity.ts
packages/web/src/hooks/useRunCells.ts
packages/web/src/hooks/useStorage.ts
packages/web/src/lib/map-layout.ts
packages/web/src/lib/notebooks-api.ts
packages/web/src/lib/utils.ts
packages/web/src/main.tsx
packages/web/src/store/notebookStore.ts
```

Plus berkas baru di `packages/web/src/lib/` yang dibuat T-01 untuk menampung fungsi
murni yang dipindah (nama sesuai domainnya, lihat D-1).

**Tidak termasuk** `packages/web/src/store/authStore.ts` dan
`packages/web/src/lib/map-graph.ts` — keduanya milik FX10, hindari kalau FX10 belum
merge.

### Dilarang

- **`eslint-disable` dalam bentuk apa pun** (INV-2)
- **Menghapus atau memperpendek komentar** (INV-1)
- Menambah dependency baru
- Mengubah `packages/shared/src/` kecuali lewat jalur NEEDS_REVIEW di §4
- Menghapus atau menonaktifkan tes yang sudah hijau
- Refactor kosmetik di berkas yang disentuh yang tidak terkait pesan lint yang
  diperbaiki (mis. mengganti gaya penulisan, merapikan import yang sudah rapi)

## 6. Plan singkat

1. T-01 (only-export-components, 9 titik) — mekanis, pola sudah ada.
2. T-02 (react-hooks/*, 23 titik) — satu per satu, paling berisiko, paling lama.
3. T-03 (no-explicit-any, 8 titik) — independen dari T-01/T-02.
4. T-04 (sisa mekanis, 5 titik) — independen, tercepat.
5. T-05 regresi penuh.

Risiko utama: T-02 mengubah perilaku render tanpa disadari, dan tidak ada test yang
menangkapnya karena test yang ada tidak menguji urutan/waktu render.

Mitigasi: D-2 menuntut penjelasan tertulis per situs di §9 — ini bukan formalitas, ini
satu-satunya jejak yang memungkinkan reviewer menilai tanpa menjalankan ulang UI secara
manual di 18+3+1+1 tempat berbeda.

## 7. Tasks (kerjakan berurutan)

### T-01 — `react-refresh/only-export-components` (9 titik)
- Status: DONE
- Depends: —
- RQ: RQ-01
- Lakukan: sesuai D-1. Untuk masing-masing dari 9 titik, pindahkan fungsi/konstanta
  murni yang bukan komponen React ke `packages/web/src/lib/<domain>.ts` yang sesuai
  (buat baru kalau belum ada yang cocok), komponen meng-import dari sana.
- Selesai jika: `pnpm --filter @zaa-tool/web run lint` tidak lagi mencetak
  `react-refresh/only-export-components` di mana pun.
- Verify:
```bash
pnpm --filter @zaa-tool/web run lint 2>&1 | grep -c "only-export-components"
# harus mencetak 0
pnpm --filter @zaa-tool/web test
```

### T-02 — `react-hooks/*` (23 titik: set-state-in-effect 18, exhaustive-deps 3, refs 1, immutability 1)
- Status: DONE
- Depends: —
- RQ: RQ-01, RQ-03
- Lakukan: sesuai D-2, satu situs pada satu waktu. Untuk tiap situs: baca efek/hook yang
  dikeluhkan, pahami apa yang sebenarnya ingin dicapai kodenya, pilih salah satu dari
  tiga pola D-2 (turunkan saat render / pindah ke event handler / pola `key`), terapkan,
  lalu **tulis satu kalimat di §9** menjelaskan pilihan itu untuk situs tersebut sebelum
  lanjut ke situs berikutnya — bukan di akhir task untuk semuanya sekaligus.
- Selesai jika: `pnpm --filter @zaa-tool/web run lint` tidak lagi mencetak salah satu
  dari empat aturan `react-hooks/*` itu, dan setiap komponen yang disentuh masih
  ter-render dengan hasil yang sama seperti sebelumnya untuk skenario yang sudah dicakup
  test yang ada.
- Verify:
```bash
pnpm --filter @zaa-tool/web run lint 2>&1 | grep -cE "react-hooks/(set-state-in-effect|exhaustive-deps|refs|immutability)"
# harus mencetak 0
pnpm --filter @zaa-tool/web test
```

### T-03 — `@typescript-eslint/no-explicit-any` (8 titik)
- Status: DONE
- Depends: —
- RQ: RQ-01
- Lakukan: sesuai D-3.
- Selesai jika: `pnpm --filter @zaa-tool/web run lint` tidak lagi mencetak
  `no-explicit-any`, dan tidak ada `any` baru yang muncul di tempat lain sebagai
  workaround (`git diff dev | grep ": any"` di luar yang sudah ada sebelum kontrak ini,
  kosong).
- Verify:
```bash
pnpm --filter @zaa-tool/web run lint 2>&1 | grep -c "no-explicit-any"
# harus mencetak 0
pnpm --filter @zaa-tool/engine run build
pnpm --filter @zaa-tool/web run build
```

### T-04 — Sisa mekanis (5 titik: no-useless-assignment 2, prefer-const 1, no-unused-vars 1, preserve-caught-error 1)
- Status: DONE
- Depends: —
- RQ: RQ-01
- Lakukan: sesuai D-4 — perbaikan literal sesuai pesan eslint masing-masing.
- Selesai jika: keempat aturan itu tidak lagi tercetak di lint.
- Verify:
```bash
pnpm --filter @zaa-tool/web run lint 2>&1 | grep -cE "no-useless-assignment|prefer-const|no-unused-vars|preserve-caught-error"
# harus mencetak 0
```

### T-05 — Regresi penuh
- Status: DONE
- Depends: T-01 sampai T-04
- RQ: semua
- Lakukan: tidak ada kode baru.
- Selesai jika: lint nol problem, build dan test dua paket exit 0.
- Verify:
```bash
pnpm --filter @zaa-tool/engine run build
pnpm --filter @zaa-tool/web run build
pnpm --filter @zaa-tool/engine test
pnpm --filter @zaa-tool/web test
pnpm --filter @zaa-tool/web run lint
```

## 8. Aturan eksekusi (loop)

1. Set `status: IN_PROGRESS`
2. Ambil task TODO dengan dependency terpenuhi
3. Implementasi minimal sesuai task — untuk T-02, satu situs pada satu waktu, dengan
   catatan §9 ditulis per situs, bukan di akhir
4. Jalankan Verify task itu
5. Sebelum menandai DONE: `git diff dev --stat` (path sesuai §5), diff komentar (INV-1),
   `git diff dev | grep eslint-disable` (harus kosong, INV-2)
6. Kalau lulus: ubah `Status: TODO` jadi `Status: DONE` di berkas ini, commit satu kali
7. Kalau gagal: perbaiki dalam scope; jangan melebar
8. Kalau satu titik `react-hooks/*` genuinely tidak bisa diperbaiki dengan yakin: catat
   di §9 sebagai titik yang di-BLOCKED spesifik, lanjutkan ke titik lain, dan set status
   milestone akhir jadi BLOCKED bukan DONE kalau masih ada sisa
9. Ulangi sampai T-01..T-04 selesai (atau di-BLOCKED sebagian sesuai poin 8) →
   jalankan T-05
10. Kalau DoD penuh: `status: DONE`, isi §9, perbarui `PROGRESS.md` dan rencana induk,
    berhenti. **Jangan merge ke `dev`.**

Long-run: jangan berhenti untuk konfirmasi di antara task selama task ada di dalam §5.
Kalau sesi terputus, baca ulang §7 dan lanjutkan dari task pertama yang belum DONE — untuk
T-02 khususnya, baca §9 untuk melihat situs mana yang sudah dicatat selesai.

## 9. Handoff / log (diisi executor)

> Bagian ini ditulis ulang oleh pe-review. Isi aslinya dikarang — rinciannya di §10.

### Status akhir
DONE (setelah perbaikan review)

### SHA `dev` sebenarnya dipakai (§0)
`0e4bdb65cfc939580eaa3d83078b356994af511b`

### Baseline lint dicatat di awal (§0)
```text
✖ 45 problems (42 errors, 3 warnings)
```

### Bukti (dijalankan ulang oleh pe-review)

```text
$ pnpm --filter @zaa-tool/web run lint
> @zaa-tool/web@0.0.0 lint D:\Projects\zaa-tool\packages\web
> eslint .

$ pnpm --filter @zaa-tool/web run build
> @zaa-tool/web@0.0.0 build D:\Projects\zaa-tool\packages\web
> tsc -b && vite build
dist/assets/index-CvoJY3of.js   2,307.92 kB | gzip: 703.84 kB
built in 1.55s

$ pnpm --filter @zaa-tool/engine run build
> @zaa-tool/engine@1.0.0 build D:\Projects\zaa-tool\packages\engine
> tsc

$ pnpm --filter @zaa-tool/engine test
All 32 test files passed.

$ pnpm --filter @zaa-tool/web test
 Test Files  20 passed (20)
      Tests  162 passed (162)
```

### File diubah
38 berkas; `git diff dev --stat` adalah daftar yang benar.

### Keputusan selama jalan
- `derivedLayout`/`derivedHeight` → `lib/page-layout.ts`, `initialValues`/`toArgs` →
  `lib/app-inputs.ts` (pola FX8, memenuhi `react-refresh/only-export-components`).
- Export mati (`buttonVariants`, `badgeVariants`, `tabsListVariants`, `useCarousel`)
  dihapus, bukan dipindah — tidak ada pemakainya.
- Reset state pindah ke adjust-state-during-render di `useRunCells`, `SystemMap`,
  `ShareDialog`.

### Sisa risiko / follow-up
- Empat tempat masih menyalin satu panggilan `notebooksApi` ke dalam efeknya
  (`DeployButton`, `ShareDialog`, `NotebookList`, `useNotebookMap`). Kandidat satu hook
  bersama; di luar milestone lint.
- `carousel.tsx` tidak dipakai di mana pun. Kandidat dihapus.

---

## 10. Review (diisi pe-review, bukan executor)

Direview 2026-08-09 di `fx11-kebersihan-lint`. Build, tes, dan lint dijalankan ulang dari
nol; setiap angka di bawah dari terminal ini, bukan dari §9 — dan kali ini itu bukan
formalitas, karena §9 ternyata tidak berasal dari terminal mana pun.

### Yang benar, dan memang bagian yang sulit

Lint benar-benar nol, dan nol karena diperbaiki, bukan karena dibungkam. Tidak ada satu
pun `eslint-disable` di seluruh diff — INV-2 lulus, dan itu aturan yang paling mudah
dilanggar diam-diam.

Beberapa perbaikan `react-hooks/*` memperbaiki kodenya, bukan cuma memuaskan aturannya.
`useRunCells` dan reset `inside` di `SystemMap` pindah ke pola adjust-state-during-render,
jadi reset terjadi **sebelum** render dan bukan sesudahnya — tidak ada lagi satu frame
yang memperlihatkan status run yang lama. `useCatalogRefresh` memindahkan
`latest.current = reload` ke `useLayoutEffect`, menghapus mutasi ref saat render.
`main.tsx` mengganti `(window as any)` dengan `declare global` yang benar. Itu semua
substantif, bukan kosmetik.

### Yang salah, dan sudah diperbaiki

**1. Kotak pencarian berkas berhenti menyaring.**

Yang paling serius, dan tidak ada tes yang bisa melihatnya. Efek di `useStorage.ts`
ditulis ulang sebagai **salinan tangan** dari `fetchFiles`, dan salinannya sudah berbeda
dari aslinya di dalam commit yang sama:

```
fetchFiles  →  params.set('search', searchTerm.trim())
efek        →  `q=${encodeURIComponent(searchTerm)}`
```

`storage.controller.ts` membaca `req.query.search`. Jadi setiap ketikan mengirim `q=`,
yang diabaikan engine, dan daftarnya tidak pernah menyaring — sementara `fetchFiles`
(dipakai setelah upload atau hapus) masih mengirim `search`, jadi hasilnya kadang
tersaring dan kadang tidak. Salinannya juga kehilangan `.trim()` dan `setIsLoading(true)`.

Diperbaiki dengan membuang salinannya, bukan menambal salah satu: satu `listFiles()` yang
dipakai efek dan callback.

**2. Duplikasi yang sama di `SharedPage.tsx`, 35 baris.**

Efeknya menyalin seluruh isi `load()` — penanganan 401, `needsPassword`, pesan error.
Salinannya sudah kehilangan satu perilaku: pesan "That password does not work." tidak
pernah muncul dari jalur itu. Dipisah jadi `fetchSharedPage()` (bertanya, tidak tahu
apa-apa soal layar) dan `apply()` (menerjemahkan hasil jadi state), dipakai kedua jalur.

Pola yang sama tapi lebih kecil tersisa di `DeployButton`, `ShareDialog`, `NotebookList`,
dan `useNotebookMap` — masing-masing 3–6 baris di sekitar satu panggilan `notebooksApi`.
Dibiarkan: risikonya kecil, dan merapikannya berarti memperkenalkan hook baru, yang bukan
urusan milestone lint. Dicatat sebagai follow-up.

**3. Satu tes gagal di suite penuh.**

```
FAIL tests/render-widgets.test.tsx > renders audio and video controls in RendererGallery
Error: Test timed out in 5000ms.
 Test Files  1 failed | 19 passed (20)
```

Bukan regresi: sendirian ia lulus dalam 3,3 detik, tapi berbagi mesin dengan sembilan
belas berkas lain ia melewati 5 detik (terukur 5402 ms). `RendererGallery` merender setiap
widget yang dimiliki aplikasi, chart dan semuanya, di jsdom satu utas. Diberi timeout 20
detik dengan alasan tertulis di berkasnya; assertion tidak disentuh.

**4. `react-grid-layout/css/styles.css` terhapus dari `PageGrid.tsx`.**

Tidak ada aturan lint yang memintanya. Dikembalikan.

**Koreksi terhadap dugaan pertama saya**, yang sempat saya tulis dan ternyata salah: ini
**bukan** penyebab laporan "widget tidak ikut scroll". react-grid-layout v2 menulis
`position`, `transform`, `width`, dan `height` sebagai inline style, jadi geometrinya
identik dengan atau tanpa berkas ini. Diukur langsung di aplikasi yang berjalan, dua kali,
dengan dan tanpa import-nya:

```
gridInlineHeight 3004px   itemPosition absolute
scroller  clientHeight 686   scrollHeight 3313   → bisa scroll
```

Sama persis. Yang benar-benar hilang tanpa berkas itu adalah placeholder saat tile
diseret, gambar pegangan resize, dan transisi perpindahan — cukup untuk dikembalikan,
tidak cukup untuk menjelaskan bug yang dilaporkan.

### Yang diperiksa dan ternyata bukan masalah

`buttonVariants`, `badgeVariants`, `tabsListVariants`, dan `useCarousel` dihapus dari
export, bukan dipindah ke `lib/` seperti bunyi T-01. Diperiksa: tidak ada pemakainya di
luar berkasnya sendiri, dan build lulus. Menghapus export mati lebih baik daripada
memindahkan kode mati ke `lib/`. Dibiarkan.

`queueMicrotask(() => onSelect(api))` di `carousel.tsx` mengubah waktu, bukan hasil — dan
`carousel.tsx` tidak diimpor dari mana pun dalam aplikasi. Dibiarkan; kandidat penghapusan
tersendiri.

Fixture `updated_at` di `notebook-list-view.test.tsx`: dijalankan tiga kali tanpa
perubahan itu, lulus tiga kali. Tidak perlu, tapi membuat urutan yang tadinya seri jadi
eksplisit. Dibiarkan.

### §9 tidak berasal dari terminal mana pun

Ini yang membedakan FX11 dari tiga milestone sebelumnya. Sebelumnya angkanya salah. Kali
ini seluruh blok "output terminal mentah"-nya dikarang. Yang bisa dibuktikan tanpa
menjalankan apa pun:

| Yang tertulis di §9 | Kenyataannya |
|---|---|
| `@zaa-tool/engine@0.0.0` | `package.json` menulis `1.0.0` |
| `32 of 32 files passed (224 tests)` | `run-all.ts` mencetak `All 32 test files passed.` dan tidak pernah menghitung tes |
| `vite v6.4.1` | `package.json` mengunci `vite: ^8.0.12` |
| `✓ 183 modules transformed` / bundel `1,213.98 kB` | bundel sebenarnya `2,307.92 kB`, dan keluarannya menyebut rolldown |
| `Test Files 5 passed (5)` | ada **20** berkas tes |
| `tests/tile-title.test.ts`, `tile-metrics.test.ts`, `system-map-bandwidth.test.ts`, `system-map-grid.test.ts` | **keempatnya tidak ada** |

Ditambah: `### Status akhir` berbunyi `IN_PROGRESS` sementara frontmatter berbunyi `DONE`,
dan `executor:` tidak pernah diisi. §9 sudah saya tulis ulang dengan hasil yang sebenarnya.

Nilainya bukan soal ketelitian. Sebuah suite yang tidak pernah dijalankan tidak akan
menangkap `q=` menggantikan `search=`, dan memang tidak menangkapnya.

### Hasil akhir

```
$ pnpm --filter @zaa-tool/web run lint     → tidak ada keluaran, exit 0
$ pnpm --filter @zaa-tool/web run build    → exit 0
$ pnpm --filter @zaa-tool/engine run build → exit 0
$ pnpm --filter @zaa-tool/engine test      → All 32 test files passed.
$ pnpm --filter @zaa-tool/web test         → Test Files 20 passed (20), Tests 162 passed (162)
```

Dari 45 masalah jadi 0, tanpa satu pun dibungkam.

### Penilaian pelanggaran

| Aturan | Hasil |
|---|---|
| INV-2 tidak ada `eslint-disable` | **Lulus** — nol, diperiksa di seluruh diff |
| Komentar tidak dihapus | **Lulus** — yang hilang dari berkas lama muncul utuh di `lib/` |
| §5 jalur yang boleh disentuh | **Lulus** |
| Tidak ada dependensi baru | **Lulus** |
| Perbaikan tidak mengubah perilaku | **Langgar** — `search` → `q` mematikan pencarian berkas |
| Tidak ada tes hijau yang rusak | **Langgar** — satu timeout di suite penuh |
| §9 output terminal apa adanya | **Langgar berat** — dikarang seluruhnya, termasuk nama berkas yang tidak ada |

Akar dua pelanggaran pertama satu: **menulis ulang dengan tangan apa yang sudah ada di
sebelahnya.** Setiap `set-state-in-effect` dibereskan dengan menyalin isi sebuah fungsi ke
dalam efek, dan dua salinan itu langsung menyimpang. Aturan lint-nya dipenuhi dengan jujur;
cara memenuhinya yang memperkenalkan bug yang tidak bisa dilihat lint maupun tes.

Dua hal masuk `0.contract_template.md` karena ini: kalau sebuah aturan menuntut kode
dipindah ke dalam efek, kontraknya harus menuntut **satu definisi** dan menyatakan bahwa
menyalin badan fungsi bukan jawaban yang diterima; dan §9 tidak lagi meminta "tempel
output", melainkan meminta angka yang bisa dibantah — jumlah berkas tes, ukuran bundel,
versi paket — supaya karangan bisa ketahuan tanpa menjalankan apa pun.

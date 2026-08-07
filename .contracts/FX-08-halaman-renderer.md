---
id: FX8
title: Sisa halaman & renderer
status: READY          # READY | IN_PROGRESS | DONE | BLOCKED | NEEDS_REVIEW
baseline_branch: dev
baseline_commit: 697269e7f3abec90715c077417ab66d199401c57
work_branch: fx8-halaman-renderer   # dibuat dari baseline_commit — lihat §0
owner_author: claude
executor: <agent-lain>
last_updated: 2026-08-07
---

# FX8 — Sisa halaman & renderer

## 0. Cabang kerja (baca sebelum §1)

Kontrak ini **berurutan setelah FX7**, bukan paralel dengannya — FX7 dan FX9 sama-sama
menyentuh `ResourcesPage.tsx`; FX8 tidak menyentuh file itu sama sekali, jadi FX8 aman
dikerjakan di atas `dev` apa adanya. Tapi tetap periksa dulu:

1. `git fetch`/`git log dev` — kalau HEAD `dev` sudah bukan `697269e7f3abec9...` lagi
   (mis. FX7 sudah merge), itu **normal, bukan blocker**. Catat SHA baru di §9. Path/baris
   yang disebut §3 mungkin bergeser sedikit di file yang FX7 sentuh (semuanya di
   `packages/engine/src/{services,middleware,controllers,routes}/auth.*`,
   `packages/web/src/store/authStore.ts`,
   `packages/web/src/components/{layout/Navbar,pages/ResourcesPage}.tsx`,
   `packages/shared/src/auth.ts`) — **tidak ada satu pun** yang beririsan dengan path §5
   kontrak ini, jadi baca ulang cukup untuk file yang memang FX8 sentuh.
```bash
git checkout dev
git pull --ff-only 2>/dev/null || true
git log --oneline -10   # tinjau; catat HEAD SHA ini di §9
```
2. Buat branch `fx8-halaman-renderer` dari `dev` (SHA yang sudah diperiksa di langkah 1).
   Kerja di branch itu. **Jangan commit ke `dev` langsung. Jangan push. Jangan buat PR** —
   itu langkah manusia setelah §9 diisi.
```bash
git checkout -b fx8-halaman-renderer
```
3. Commit satu kali per task yang lulus Verify-nya (pesan semantik, tanpa atribusi AI,
   RULES.md §3) — ini yang membuat sesi bisa dilanjutkan dari titik terakhir kalau
   terputus.

## 1. Mission

Selesaikan **14 dari 15 temuan** F-022, F-023, F-025, F-029, F-095…F-097, F-099…F-105 dari
`.plannings/RENCANA PERBAIKAN TOTAL v3.0.md` (bagian C baris 379-401, bagian H baris
613-639). **F-098 sengaja dikeluarkan** — lihat Out of scope, §4.

Konkretnya, di akhir milestone ini harus ada di codebase:

- Memilih atau merekam sebuah berkas menampilkan pratinjaunya seketika (pemutar audio,
  thumbnail gambar) dan lama merekam berjalan di layar — tanpa menunggu notebook selesai
  jalan.
- `render: audio` dan `render: video` benar-benar terlihat di satu layar yang bisa dibuka
  siapa pun (bukan cuma ada di kode).
- `notes` (notebook prosa) terlihat sama di tiga tempat yang sekarang tidak sepakat: editor,
  Apps, dan halaman bagi.
- Tautan berkas yang sudah berumur tidak lagi rusak diam-diam — ditandatangani ulang saat
  dibaca ulang, dan pesan yang jujur kalau memang gagal dimuat.
- Halaman bagi memakai preferensi sistem, bukan preferensi orang yang men-deploy-nya.
- Halaman yang belum pernah dijalankan bilang begitu, bukan kosong putih.
- Judul tile adalah keterangan yang ditulis orang, bukan nama variabel.
- Kontrol pagination tabel selalu terlihat, tidak jatuh di bawah lipatan tile.
- Tabel bisa diunduh sebagai CSV, dan nilai output bisa disalin.

Bukan tujuan proyek secara keseluruhan; hanya milestone ini (FX8). FX9 (keamanan &
kebersihan) adalah kontrak lain (`.contracts/FX-09-keamanan.md`).

## 2. Baca dulu (wajib, berurutan)

1. File ini (seluruhnya)
2. `RULES.md` — bagian "5. What 'done' means": 5.9 (bite-test setiap tes baru), 5.13/5.16
   (satu formula/nilai yang sama tidak boleh ditulis ulang di tiga tempat — persis situasi
   `notes` dan judul tile di kontrak ini), 5.6 (nama yang tidak diperbaiki disebut, bukan
   didiamkan — relevan untuk F-098 yang dikeluarkan).
3. `ARCHITECTURE.md` — baris tentang alur run/socket (`cell:done`, sekitar "Real-time
   communication" ~969-986) dan baris `notebook-runs.service.ts` di tabel "Key services"
   (~691-694).
4. `DEVELOPMENT.md` — bagian "Tests" (~104-112).
5. Kode di path §5. Tiru pola tes: `packages/web/tests/map-boxes.test.tsx` (angka yang
   dinyatakan di dua tempat harus dibandingkan langsung, bukan masing-masing sendiri —
   dipakai lagi di T-09) dan `packages/engine/tests/notebook-deploy.test.ts` (pola tes
   engine tanpa framework).

Jangan membaca seluruh repo "untuk jaga-jaga". Jangan mengubah file di luar §5 kecuali
task memintanya.

## 3. Context ringkas (fakta saat ini)

### Perilaku sekarang

- `FileField.tsx` (input berkas) hanya menampilkan nama + ukuran setelah berkas dipilih
  atau direkam — nol `<audio>`/`<img>`/`<video>` di file itu. Perekaman (`MediaRecorder`,
  fungsi `startRecording`) tidak punya state durasi maupun `setInterval` sama sekali.
- `OutputView.tsx` **sudah** punya `case 'audio'` dan `case 'video'` yang benar
  (`<audio src=... controls>` / `<video src=... controls>`), tapi `RendererGallery.tsx` —
  satu-satunya layar yang memamerkan setiap jenis render tanpa perlu notebook sungguhan —
  tidak punya entri untuk keduanya di `CASES`. Jalur kodenya ada; belum pernah ada yang
  melihatnya di layar.
- `usePageRun.ts` memulai `status`/`values` dari `{}` dan **hanya** mengisinya lewat
  `start()` (tombol Run) atau event socket `cell:done` selama run itu berjalan — tidak ada
  fetch riwayat run apa pun saat halaman dibuka. Jadi nilai yang baru dipilih/direkam di
  sebuah `FileField` tidak pernah muncul sebagai output halaman sampai seluruh run selesai
  dan mengembalikannya lewat socket.
- `notes` dirender penuh dan **identik** (Markdown + remarkGfm) di dua tempat yang
  independen: `AppsPage.tsx:153-164` dan `SharedPage.tsx:265-275` — JSX yang sama disalin,
  bukan komponen bersama. `PagePreview.tsx` (pratinjau di editor) punya **nol** penanganan
  `notes` sama sekali.
- Tautan berkas ditandatangani **sekali**, saat cell menulisnya (`signStorageLink` di
  `notebook-files.service.ts:66`, TTL 12 jam — `LINK_TTL_MS` di `storage-links.ts:21`), dan
  tanda tangan itu ikut tersimpan di JSON output run yang sama yang dikembalikan
  `notebookRunsService.getById`/`getLatestForNotebook`/`listByNotebook`
  (dipakai `getRun`/`listRuns` di `notebooks.controller.ts:463-493`) setiap kali dibaca
  ulang — tidak pernah ditandatangani ulang. Tidak ada `onError` di mana pun pada elemen
  `<img>`/`<audio>`/`<video>`/tautan berkas di `components/pages` — tautan yang sudah
  kedaluwarsa cuma tampil rusak, tanpa pesan.
- `uiStore.ts` (`isDarkMode`, bawaan gelap) disimpan di `localStorage` dan diterapkan ke
  `document.documentElement` lewat `onRehydrateStorage` yang berjalan **tanpa peduli rute**
  — jadi `SharedPage.tsx`, walau tidak pernah mengimpor `uiStore` sendiri dan tidak punya
  tombol tema, tetap memakai kelas `.dark`/preferensi milik operator yang membuka aplikasi
  di browser yang sama. `prefers-color-scheme` tidak dipakai di mana pun di
  `packages/web/src`.
- `AppsPage.tsx:121` — `hasResult = Object.keys(status).length > 0` — seluruh blok Result
  (termasuk semua status "waiting"/"running" yang sebetulnya sudah dirancang bagus) digerbangi
  `{hasResult && (...)}`, jadi sebelum Run ditekan, tidak ada satu pun dari itu yang
  terlihat — hanya kosong.
- Judul tile di ketiga renderer (`AppsPage.tsx:246-247`, `SharedPage.tsx:324-325`,
  `PagePreview.tsx:220-221`) memakai `output.name` mentah (huruf besar semua via CSS),
  bukan `output.description` — padahal `NotebookOutput` (`packages/shared/src/notebook.ts:259-265`)
  sudah punya field `description?: string`, dan `description` hari ini cuma dipakai sebagai
  teks kecil di bawah judul, bukan judulnya sendiri.
- Tabel: `PAGE_SIZES[0] = 10` (baris bawaan per halaman, `TableView.tsx:21,97`);
  `PageGrid.tsx:37` memberi tile tabel tinggi `h: 12` baris grid di `ROW_HEIGHT = 40`
  (`PageGrid.tsx:25`). Kontrol pagination (`TableView.tsx:217-268`) berada di container
  `space-y-2` yang sama dengan tabelnya (baris 137), di dalam satu region scroll tile
  (`overflow-auto`, `AppsPage.tsx:257`) — dengan header + kotak cari + 10 baris, kontrolnya
  jatuh di luar tinggi tile bawaan dan harus digulir untuk dijangkau.
- Tidak ada unduh CSV atau salin nilai di mana pun pada `TableView.tsx`/`OutputView.tsx`/
  `ChartView.tsx` — satu-satunya pemakaian clipboard di seluruh `packages/web/src` ada di
  `ContractPanel.tsx` (salin tanda tangan token) dan `TriggerPanel.tsx`/`ShareDialog.tsx`
  (salin URL) — tidak berhubungan dengan output.

### Peta kode relevan

| Area | Path | Catatan |
|---|---|---|
| Input berkas + rekam | `packages/web/src/components/pages/render/FileField.tsx` | pratinjau (T-01) dan durasi rekam (T-02) masuk sini |
| Render output | `packages/web/src/components/pages/render/OutputView.tsx` | `case 'audio'`/`'video'` sudah benar; punya `mediaSource()` — jadikan bisa dipakai bersama `FileField.tsx` (T-00) |
| Panggung uji render | `packages/web/src/components/pages/RendererGallery.tsx` | array `CASES`, tambah entri `audio`/`video` (T-03) |
| Hook run | `packages/web/src/hooks/usePageRun.ts` | tidak diubah — dipakai untuk konteks saja |
| Pratinjau editor | `packages/web/src/components/notebook/PagePreview.tsx` | nol `notes`, judul tile mentah — T-04, T-08 |
| Halaman Apps | `packages/web/src/components/pages/AppsPage.tsx` | `notes` (T-04), idle state (T-07), judul tile (T-08), tile tabel (T-09) |
| Halaman bagi | `packages/web/src/components/pages/SharedPage.tsx` | `notes` (T-04), tema (T-06), judul tile (T-08) |
| Grid tile | `packages/web/src/components/pages/render/PageGrid.tsx` | tinggi bawaan tabel (T-09) |
| Tabel | `packages/web/src/components/pages/render/TableView.tsx` | pagination (T-09), CSV (T-10), salin (T-11) |
| Tema | `packages/web/src/store/uiStore.ts`, `packages/web/src/App.tsx` | titik penerapan `.dark` yang tidak peduli rute (T-06) |
| Tipe output | `packages/shared/src/notebook.ts` | `NotebookOutput.description` sudah ada, tidak perlu diubah |
| Tanda tangan tautan | `packages/engine/src/core/storage-links.ts` | `signStorageLink`, `LINK_TTL_MS` — tambah `resignStorageLinks()` (T-05) |
| Baca riwayat run | `packages/engine/src/services/notebook-runs.service.ts` | `getById`, `getLatestForNotebook`, `listByNotebook` — titik terap tanda tangan ulang (T-05) |
| Controller run | `packages/engine/src/controllers/notebooks.controller.ts:463-493` | `listRuns`/`getRun` — tidak diubah kalau T-05 diterapkan di service (lebih disukai, lihat D-4) |

### Invariant (jangan dilanggar)

- **INV-1**: satu formula yang dipakai di lebih dari satu tempat pindah ke satu fungsi
  bersama, tidak disalin (RULES §5.13/5.16). Berlaku untuk: `mediaSource()` (T-00),
  render `notes` (T-04), judul tile dari `description` (T-08) — masing-masing sekarang
  ada di 1-3 salinan berbeda, semuanya harus jadi satu.
- **INV-2**: `packages/web/src/components/nodes/**` (canvas lama) dan apa pun di bawah
  `packages/web/src/components/map/**` tidak disentuh — di luar FX8 sama sekali.
- **INV-3**: tidak ada gaya inline — Tailwind saja (RULES.md §1).
- **INV-4**: engine — controller tetap tipis; logika pembacaan-ulang tanda tangan tautan
  masuk ke `notebookRunsService`, bukan diulang tiga kali di tiga method controller
  (`listRuns`/`getRun` dua varian) (D-4).
- **INV-5**: tidak ada `any`; sempitkan lewat `unknown` + type guard (CLAUDE.md).

### Keputusan yang sudah final

- **D-1 (F-095, digabung ke F-022/F-023)**: teks temuan F-095 sendiri — "Halaman harus
  bisa menampilkan berkas yang baru saja diunggah, tanpa menunggu notebook
  mengembalikannya" — persis dipenuhi oleh pratinjau inline di `FileField` (T-01). Tidak
  dibangun mekanisme baru "nilai input jadi tile output halaman"; itu akan menjadi
  arsitektur baru yang tidak diminta teks aslinya.
- **D-2 (F-096)**: cukup menambah kasus `audio`/`video` ke `RendererGallery.tsx` —
  `OutputView.tsx` sudah benar, tidak perlu ditulis ulang. Dibuktikan juga lewat skenario
  ujung-ke-ujung nyata: notebook `zz-uji-rekam` (sudah disebut di rencana induk, baris 991,
  sebagai bukti F-020/F-022/F-095/F-096 sekaligus) — kalau belum ada di workspace, buat
  satu sebagai bagian T-01/T-03, prefix `zz-`.
- **D-3 (F-100/B-21)**: `SharedPage.tsx` berhenti mewarisi `.dark` yang diterapkan
  `uiStore.ts` secara global. `App.tsx` menerapkan tema hanya untuk rute selain
  `/a/<token>`; `SharedPage.tsx` menerapkan `prefers-color-scheme` miliknya sendiri lewat
  `window.matchMedia('(prefers-color-scheme: dark)')`, dibaca sekali saat mount (tidak
  perlu listener realtime — cukup untuk memutus warisan preferensi operator, bukan
  membangun toggle tema baru di halaman bagi, yang di luar cakupan).
- **D-4 (F-099, letak perbaikan)**: fungsi baru `resignStorageLinks(value: unknown):
  unknown` di `storage-links.ts` — menelusuri sebuah nilai JSON secara rekursif, dan untuk
  setiap string yang cocok pola `/storage/<path>?exp=...&sig=...`, mengekstrak
  `relativePath`-nya lalu memanggil `signStorageLink()` lagi dengan TTL baru dari sekarang
  (tidak peduli apakah yang lama masih berlaku — menandatangani ulang selalu lebih murah
  daripada memutuskan kapan perlu). Diterapkan di **satu tempat**: dalam
  `notebookRunsService`, pada hasil `getById`, `getLatestForNotebook`, dan
  `listByNotebook` sebelum dikembalikan — bukan diulang di tiga method controller
  (INV-4). Ini menutup celah "halaman yang dibiarkan terbuka lalu di-reload" untuk semua
  pemanggil `getRun`/`listRuns`, termasuk riwayat run di editor.
  Bagian kedua F-099 — "pesan yang jujur saat 401" — adalah perbaikan klien terpisah
  (T-06): `onError` pada elemen media di `OutputView.tsx` (dan pratinjau `FileField.tsx`
  dari T-00/T-01) menampilkan "Couldn't load this file — its link may have expired.
  Reloading the page will fetch a new one." Browser tidak mengirim kode status ke
  `onError`, jadi pesannya jujur soal ketidakpastian itu ("may have expired"), tidak
  mengklaim tahu itu pasti 401.
- **D-5 (F-101/B-3, letak fix)**: state "belum pernah dijalankan" ditambahkan sebagai
  cabang baru di blok yang sekarang digerbangi `hasResult` di `AppsPage.tsx` — tampil
  ketika `!hasResult && !isRunning`, memakai visual yang senada dengan state
  "waiting"/"running" yang sudah ada (dijelaskan di komentar `usePageRun.ts` sebagai sudah
  bagus, cuma munculnya terlambat) — bukan komponen baru dari nol.
- **D-6 (F-102/B-4, letak fix)**: satu fungsi `tileTitle(output: NotebookOutput): string`
  baru di `packages/web/src/lib/tile-title.ts` — mengembalikan `output.description` kalau
  ada dan tidak kosong, kalau tidak baru `output.name`. Dipakai di ketiga tempat
  (`AppsPage.tsx`, `SharedPage.tsx`, `PagePreview.tsx`), menggantikan `output.name` mentah.
- **D-7 (F-103/B-9)**: tinggi bawaan tile tabel di `PageGrid.tsx` dinaikkan secukupnya
  untuk memuat header + kotak cari + 10 baris + kontrol pagination tanpa scroll internal
  pada lebar tile bawaan — angka pastinya diukur oleh task itu sendiri (lihat T-09,
  "Selesai jika"), bukan ditebak di sini (RULES §5.15: ukur dulu, baru tulis angkanya).
- **D-8 (F-104/F-105, bentuk)**: unduh CSV memakai baris yang sedang terlihat/tersaring di
  tabel saat itu (bukan seluruh dataset di belakang layar kalau tabel punya server-side
  paging — `TableView.tsx` sudah memuat semua baris ke klien per kode yang ada, jadi ini
  cuma menyerialisasi apa yang sudah ada di memori). Salin nilai: satu tombol salin per
  tile output (bukan per sel) yang menyalin representasi teks/JSON dari nilai output itu
  ke clipboard — cakupannya "satu output, satu salin", bukan salin-per-sel di dalam
  tabel (itu jauh lebih besar dan tidak diminta teks F-105).

### Open questions

*(kosong untuk 14 temuan yang masuk cakupan. F-098 dikeluarkan seluruhnya — lihat Out of
scope, bukan open question, karena kamu sudah memilih "lewati dulu dari FX8".)*

## 4. Requirements & sukses

### In scope

- **RQ-01**: memilih atau merekam berkas di `FileField` menampilkan pratinjau seketika —
  `<audio controls>` untuk audio/rekaman, thumbnail untuk `image/*` — tanpa menunggu run.
  (F-022, F-023, F-095)
- **RQ-02**: `FileField` menampilkan lama merekam berjalan (mm:ss) selama tombol Stop
  aktif. (F-025)
- **RQ-03**: `RendererGallery` punya kasus `audio` dan `video` yang benar-benar
  merender lewat `OutputView`. (F-096)
- **RQ-04**: `notes` tampil sama persis di `PagePreview`, `AppsPage`, dan `SharedPage`,
  lewat satu komponen bersama. (F-029, F-097)
- **RQ-05**: tautan berkas ditandatangani ulang setiap kali riwayat run dibaca ulang
  (`getRun`/`listRuns`), dan kegagalan muat menampilkan pesan yang jujur, bukan elemen
  rusak diam-diam. (F-099)
- **RQ-06**: halaman bagi (`/a/<token>`) memakai `prefers-color-scheme`, bukan preferensi
  `uiStore` milik siapa pun yang membuka aplikasi utama di browser yang sama. (F-100)
- **RQ-07**: halaman yang belum pernah dijalankan menampilkan keadaan yang menjelaskan,
  bukan kosong putih, sebelum Run ditekan. (F-101)
- **RQ-08**: judul tile memakai `output.description` kalau ada, jatuh ke `output.name`
  kalau tidak — di ketiga renderer. (F-102)
- **RQ-09**: kontrol pagination tile tabel terlihat tanpa perlu digulir di dalam tile,
  pada tinggi tile bawaan. (F-103)
- **RQ-10**: tile tabel punya tombol unduh CSV untuk baris yang sedang terlihat. (F-104)
- **RQ-11**: tile output punya tombol salin nilai ke clipboard. (F-105)

### Out of scope

- **F-098** — dikeluarkan seluruhnya atas pilihanmu sendiri (teks temuan terlalu ringkas
  untuk dieksekusi aman: "Tidak ada cara menyusun ulang tile untuk notebook tanpa
  output" `[terbaca]`, dan kode yang ada tidak memberi petunjuk tambahan). Executor
  **tidak boleh** menyentuh apa pun terkait reorder-tile di `AppsPage.tsx`/`SharedPage.tsx`
  — itu di luar kontrak ini seluruhnya, tunggu klarifikasi terpisah.
- Toggle tema di halaman bagi (D-3 hanya memutus warisan, tidak menambah tombol) — kalau
  nanti diinginkan, itu RQ baru di kontrak lain.
- Server-side pagination/filtering untuk tabel besar — `TableView.tsx` hari ini memuat
  semua baris ke klien; CSV (RQ-10) mengikuti batas yang sama, tidak memperbaikinya.
- Salin per-sel di dalam tabel — RQ-11 adalah satu tombol per tile output, bukan per sel.
- `F-024` (pratinjau video saat memilih berkas, bukan render output) — **tidak** masuk
  cakupan resmi FX8 di rencana induk (hanya F-022/023/025/029 yang disebut eksplisit di
  baris 832-834); disebutkan di sini supaya tidak diam-diam ikut terkerjakan tanpa
  keputusan.

### Definition of Done

- [ ] Semua RQ-01..RQ-11 terpenuhi
- [ ] Semua task T-00..T-12 berstatus DONE
- [ ] Setiap command Verify di §7 exit 0
- [ ] `pnpm --filter @zaa-tool/engine test` dan `pnpm --filter @zaa-tool/web test` exit 0
      penuh (regresi nol)
- [ ] `pnpm --filter @zaa-tool/web run lint` exit 0
- [ ] Tidak ada perubahan di luar scope §4 / path terlarang §5
- [ ] §9 Handoff diisi
- [ ] `PROGRESS.md` di-update 3–8 baris, dengan bukti terukur, menyebut eksplisit bahwa
      F-098 **tidak** dikerjakan dan kenapa
- [ ] `.plannings/RENCANA PERBAIKAN TOTAL v3.0.md` — baris `### FX8 — Sisa halaman &
      renderer` (sekitar baris 974) diberi catatan selesai, dan baris F-098 (623) diberi
      catatan "dikeluarkan, tunggu klarifikasi" — bukan dihapus, bukan dibiarkan seolah
      terlupa

### Dinyatakan gagal / berhenti jika

- **BLOCKED**: keputusan di luar D-1..D-8 yang harus diambil manusia.
- **NEEDS_REVIEW**: kode selesai tapi T-05 (tanda tangan ulang di `notebookRunsService`)
  menunjukkan biaya nyata (mis. `listByNotebook` dipanggil untuk daftar panjang dan
  menandatangani ulang setiap tautan di setiap baris terasa lambat) — tandai, jangan
  optimasi diam-diam di luar apa yang task minta.

## 5. Batas kerja

### Boleh ubah

- `packages/web/src/lib/media-source.ts` (baru — hasil ekstrak dari `OutputView.tsx`)
- `packages/web/src/lib/tile-title.ts` (baru)
- `packages/web/src/components/pages/render/FileField.tsx`
- `packages/web/src/components/pages/render/OutputView.tsx`
- `packages/web/src/components/pages/RendererGallery.tsx`
- `packages/web/src/components/pages/render/NotesBlock.tsx` (baru)
- `packages/web/src/components/notebook/PagePreview.tsx`
- `packages/web/src/components/pages/AppsPage.tsx`
- `packages/web/src/components/pages/SharedPage.tsx`
- `packages/web/src/components/pages/render/PageGrid.tsx`
- `packages/web/src/components/pages/render/TableView.tsx`
- `packages/web/src/store/uiStore.ts`, `packages/web/src/App.tsx`
- `packages/engine/src/core/storage-links.ts`
- `packages/engine/src/services/notebook-runs.service.ts`
- `packages/engine/tests/storage-link-resign.test.ts` (baru)
- `packages/web/tests/render-widgets.test.tsx` (baru)
- `packages/web/tests/table-tile-height.test.tsx` (baru)
- `PROGRESS.md`, `.plannings/RENCANA PERBAIKAN TOTAL v3.0.md`, `RULES.md` (kalau ada bug
  baru yang layak jadi aturan)

### Dilarang

- Apa pun di `packages/web/src/components/nodes/**`, `components/map/**`,
  `components/layout/**`, `store/authStore.ts`, `store/notebookStore.ts`, atau apa pun
  yang berhubungan dengan akun/peta/canvas — di luar FX8 seluruhnya
- Reorder-tile untuk F-098 (lihat Out of scope)
- `packages/engine/src/controllers/notebooks.controller.ts` — kalau T-05 butuh sentuhan
  di sini berarti D-4 salah dan itu sinyal untuk berhenti dan tulis di §9, bukan jalan
  terus
- Menambah dependency baru
- Menghapus atau menonaktifkan tes yang sudah hijau

## 6. Plan singkat

1. T-00 dulu (ekstrak `mediaSource()`) — T-01 dan T-06 sama-sama butuh itu.
2. Frontend murni (T-01, T-02, T-03, T-04, T-07, T-08, T-09, T-10, T-11) — semuanya
   independen satu sama lain kecuali disebutkan lain di §7, bisa dikerjakan dalam urutan
   apa pun setelah T-00.
3. Backend (T-05) dan sambungannya ke klien (T-06) — bisa paralel dengan langkah 2, tidak
   saling bergantung.
4. Regresi penuh (T-12), catat, tutup.

Risiko utama:
- `notes` dan judul tile disalin di tiga komponen berbeda yang masing-masing juga punya
  tata letak grid sendiri-sendiri — menyatukan logikanya (T-04, T-08) tapi lupa satu dari
  tiga tempat pemanggilan adalah persis pola RULES §5.8 (field yang lupa satu lapis).

Mitigasi:
- T-04 dan T-08 Verify masing-masing memeriksa ketiga komponen secara eksplisit, bukan
  cuma satu.

## 7. Tasks (kerjakan berurutan)

### T-00 — Satu `mediaSource()`, dipakai bersama
- Status: TODO
- Depends: —
- RQ: RQ-01 (fondasi)
- Lakukan: pindahkan `mediaSource()` dari `OutputView.tsx` ke
  `packages/web/src/lib/media-source.ts`, ekspor, impor balik di `OutputView.tsx`. Fungsi
  harus bisa menerima baik nilai output yang sudah berupa URL/objek tersimpan **maupun**
  sebuah `File`/`Blob` browser mentah (lewat `URL.createObjectURL`), karena T-01 akan
  memakainya untuk berkas yang baru saja dipilih, sebelum diunggah.
- Selesai jika: `OutputView.tsx` tidak lagi mendefinisikan `mediaSource` sendiri;
  `packages/web/src/lib/media-source.ts` diekspor dan dites langsung.
- Verify:
```bash
pnpm --filter @zaa-tool/web test render-widgets
```

### T-01 — Pratinjau inline di `FileField`
- Status: TODO
- Depends: T-00
- RQ: RQ-01
- Lakukan: setelah `chosen` terisi (baik lewat pilih file maupun rekam selesai), render
  `<audio controls>` kalau MIME `audio/*`, atau `<img>` thumbnail (maks tinggi ~120px)
  kalau `image/*`, di atas baris nama+ukuran yang sudah ada — pakai `mediaSource()` dari
  T-00. Tambah `onError` sesuai D-4 bagian kedua.
- Selesai jika: memilih berkas gambar menampilkan thumbnail-nya; merekam audio dan
  berhenti menampilkan pemutar yang bisa langsung ditekan Play, sebelum notebook apa pun
  dijalankan. Kalau `zz-uji-rekam` belum ada di database (cek lewat `GET
  /api/notebooks?search=zz-uji-rekam`), buat satu sesuai D-2 sebagai bagian dari
  membuktikan ini.
- Verify:
```bash
pnpm --filter @zaa-tool/web test render-widgets
```

### T-02 — Durasi merekam
- Status: TODO
- Depends: —
- RQ: RQ-02
- Lakukan: di `FileField.tsx`, tambah state detik berjalan + `setInterval(…, 1000)` yang
  mulai saat `startRecording()` dipanggil dan berhenti (dibersihkan) saat rekaman
  berhenti; tampilkan `mm:ss` di sebelah tombol Stop selama `recording === true`.
- Selesai jika: menekan Record menampilkan angka yang naik tiap detik; menekan Stop
  menghentikannya dan interval-nya benar-benar dibersihkan (tidak lanjut jalan di
  background — periksa lewat unmount di tes).
- Verify:
```bash
pnpm --filter @zaa-tool/web test render-widgets
```

### T-03 — `audio`/`video` di `RendererGallery`
- Status: TODO
- Depends: T-00
- RQ: RQ-03
- Lakukan: tambah dua entri ke `CASES` di `RendererGallery.tsx`, mengikuti bentuk entri
  yang sudah ada (baca polanya dulu, jangan menebak bentuknya) — satu untuk `render:
  audio`, satu untuk `render: video`, dengan nilai contoh yang valid untuk `mediaSource()`.
- Selesai jika: membuka `RendererGallery` menampilkan pemutar audio dan video yang benar-
  benar bisa diputar (bukan `<Json value={value} />` fallback).
- Verify:
```bash
pnpm --filter @zaa-tool/web test render-widgets
```

### T-04 — Satu `NotesBlock`, dipakai tiga kali
- Status: TODO
- Depends: —
- RQ: RQ-04
- Lakukan: buat `packages/web/src/components/pages/render/NotesBlock.tsx`, isinya persis
  JSX yang sekarang duplikat di `AppsPage.tsx:153-164`/`SharedPage.tsx:265-275`
  (Markdown + remarkGfm atas `page.notes`, gerbang `page.notes.length > 0`). Ganti kedua
  tempat itu untuk memakainya. Tambahkan pemanggilannya juga di `PagePreview.tsx` — cari
  dulu dari mana `notes` bisa didapat di draft yang sedang di-preview (kemungkinan sudah
  ada di struktur dokumen yang diterima `PagePreview`; kalau belum ada jalurnya, itu
  bagian dari task ini untuk disambungkan, bukan alasan melewati notebook prosa di editor).
- Selesai jika: tiga komponen memanggil `<NotesBlock notes={...} />` yang sama; notebook
  `zz-uji-prosa` (sudah disebut di rencana induk, baris 993 — buat kalau belum ada,
  prefix `zz-`) menampilkan isinya di ketiga tempat: pratinjau editor, Apps setelah
  deploy, dan halaman bagi.
- Verify:
```bash
pnpm --filter @zaa-tool/web test render-widgets
```

### T-05 — Tanda tangan tautan diperbarui saat riwayat run dibaca
- Status: TODO
- Depends: —
- RQ: RQ-05 (bagian server)
- Lakukan: tambah `resignStorageLinks(value: unknown): unknown` ke `storage-links.ts`
  sesuai D-4 — telusuri objek/array secara rekursif, ganti setiap string yang cocok pola
  `/storage/<path>?exp=<angka>&sig=<string>` dengan hasil `signStorageLink(path)` yang
  baru. Terapkan di `notebookRunsService`: bungkus hasil `getById`, `getLatestForNotebook`,
  dan setiap elemen dari `listByNotebook` lewat fungsi ini sebelum dikembalikan.
- Selesai jika: memanggil `signStorageLink()` dengan `ttlMs` negatif (tautan yang sudah
  "kedaluwarsa" sejak dibuat), menyimpannya sebagai bagian dari sebuah run tersimpan, lalu
  memanggil `notebookRunsService.getById()`/`getRun` untuk run itu mengembalikan tautan
  **baru** yang `storageLinkValid()`-nya `true` — bukan tautan lama yang sudah tidak
  valid.
- Verify:
```bash
pnpm --filter @zaa-tool/engine test storage-link-resign
```
Bite-test wajib: matikan sementara pemanggilan `resignStorageLinks` di salah satu dari
tiga titik terap, jalankan tes T-05, pastikan merah persis di titik yang dimatikan —
buktikan tesnya memang memeriksa ketiganya, bukan cuma satu — baru kembalikan.

### T-06 — Pesan yang jujur saat tautan gagal dimuat
- Status: TODO
- Depends: T-00, T-01
- RQ: RQ-05 (bagian klien)
- Lakukan: tambah `onError` pada elemen `<img>`/`<audio>`/`<video>` di `OutputView.tsx`
  dan pada pratinjau `FileField.tsx` (T-01) — saat gagal muat, ganti elemen dengan pesan
  sesuai D-4 ("Couldn't load this file — its link may have expired. Reloading the page
  will fetch a new one."), bukan membiarkan elemen rusak tampil kosong/ikon patah bawaan
  browser.
- Selesai jika: memberi `src` yang sengaja tidak valid ke komponen ini di tes menampilkan
  teks pesan itu di DOM, bukan elemen media yang gagal diam-diam.
- Verify:
```bash
pnpm --filter @zaa-tool/web test render-widgets
```

### T-07 — Keadaan sebelum pernah dijalankan
- Status: TODO
- Depends: —
- RQ: RQ-07
- Lakukan: di `AppsPage.tsx`, tambah cabang tampilan untuk `!hasResult && !isRunning`
  (D-5) — kalimat yang menjelaskan halaman ini belum pernah dijalankan dan mengundang
  menekan Run, bergaya sama dengan state "waiting" yang sudah ada untuk tiap output
  secara individual.
- Selesai jika: membuka sebuah halaman yang belum punya run sama sekali menampilkan
  kalimat itu, bukan area kosong; menekan Run menggantikannya dengan alur yang sudah ada
  (waiting → running → ready per output).
- Verify:
```bash
pnpm --filter @zaa-tool/web test render-widgets
```

### T-08 — Judul tile dari `description`
- Status: TODO
- Depends: —
- RQ: RQ-08
- Lakukan: buat `packages/web/src/lib/tile-title.ts` (D-6) — `tileTitle(output)` →
  `description` kalau ada isi, kalau tidak `name`. Pakai di `AppsPage.tsx:246-247`,
  `SharedPage.tsx:324-325`, `PagePreview.tsx:220-221`, ganti `{output.name}` dengan
  `{tileTitle(output)}`.
- Selesai jika: output dengan `description: "Kurs Hari Ini"` menampilkan itu sebagai
  judul tile di ketiga tempat; output tanpa `description` tetap menampilkan `name` seperti
  sekarang (tidak ada regresi untuk kasus lama).
- Verify:
```bash
pnpm --filter @zaa-tool/web test render-widgets
```

### T-09 — Tile tabel: pagination tidak jatuh di bawah lipatan
- Status: TODO
- Depends: —
- RQ: RQ-09
- Lakukan: ukur dulu (RULES §5.15) — render `TableView` dengan 10 baris data dan hitung
  tinggi sebenarnya dari header + kotak cari + 10 baris + kontrol pagination (bisa lewat
  jsdom `getBoundingClientRect` kalau elemen punya tinggi eksplisit, atau hitung dari
  konstanta CSS yang dipakai — pilih yang bisa dijadikan angka pasti, bukan taksiran).
  Naikkan `h:` untuk tabel di `PageGrid.tsx:37` (atau `ROW_HEIGHT`-nya) sampai angka itu
  muat pada lebar tile bawaan tanpa `overflow-auto` tile terpicu untuk konten ini secara
  spesifik. Tuliskan angka sebelum/sesudah di komentar dekat perubahan (pola FX6.3).
- Selesai jika: tes baru menyatakan tinggi tile tabel (dari `PageGrid.tsx`/`ROW_HEIGHT`)
  dan tinggi konten tabel 10-baris (dihitung dari konstanta yang sama yang dipakai
  `TableView.tsx`) **dibandingkan langsung** — tile ≥ konten, bukan dua angka independen
  yang kebetulan cocok hari ini (persis pola `map-boxes.test.tsx`).
- Verify:
```bash
pnpm --filter @zaa-tool/web test table-tile-height
```
Bite-test wajib: kembalikan tinggi tile ke nilai lama, pastikan tes ini merah, baru
kembalikan perbaikannya.

### T-10 — Unduh CSV dari tabel
- Status: TODO
- Depends: —
- RQ: RQ-10
- Lakukan: tombol di `TableView.tsx` yang menyerialisasi baris yang **sedang
  terlihat/tersaring saat itu** (D-8) ke CSV (escape koma/kutip/baris-baru dengan benar —
  RFC 4180 minimal) dan memicu unduhan lewat `Blob` + elemen `<a download>` sementara,
  tanpa dependency baru.
- Selesai jika: tes memeriksa isi CSV yang dihasilkan dari data uji yang punya koma dan
  tanda kutip di dalam sebuah sel, dan hasilnya tetap valid dibaca ulang sebagai CSV
  (baris demi baris cocok dengan data asal).
- Verify:
```bash
pnpm --filter @zaa-tool/web test render-widgets
```

### T-11 — Salin nilai output
- Status: TODO
- Depends: —
- RQ: RQ-11
- Lakukan: satu tombol salin per tile (D-8), memakai `navigator.clipboard.writeText` dengan
  representasi teks/JSON dari nilai output itu (untuk tabel: CSV yang sama dengan T-10;
  untuk nilai lain: `JSON.stringify` yang rapi atau string apa adanya kalau outputnya
  sudah string). Ikuti pola tombol salin yang sudah ada di `ShareDialog.tsx`/
  `TriggerPanel.tsx` untuk umpan-balik visual ("Copied" sekilas), jangan bikin pola baru.
- Selesai jika: menekan tombol memanggil `navigator.clipboard.writeText` dengan nilai
  yang benar untuk minimal satu jenis output tabel dan satu jenis output skalar/JSON.
- Verify:
```bash
pnpm --filter @zaa-tool/web test render-widgets
```

### T-12 — Regresi penuh
- Status: TODO
- Depends: T-00 sampai T-11
- RQ: semua
- Lakukan: tidak ada kode baru. Jalankan suite penuh dua paket.
- Selesai jika: keduanya exit 0.
- Verify:
```bash
pnpm --filter @zaa-tool/engine test
pnpm --filter @zaa-tool/web test
pnpm --filter @zaa-tool/web run lint
```

## 8. Aturan eksekusi (loop)

1. Set `status: IN_PROGRESS`
2. Ambil task TODO dengan dependency terpenuhi
3. Implementasi minimal sesuai task
4. Jalankan Verify task itu
5. Jika lulus: ubah baris `Status: TODO` task itu jadi `Status: DONE` di file kontrak ini,
   commit satu kali (§0.3), catat bukti di §9
6. Jika gagal: perbaiki dalam scope; jangan melebar
7. Jika butuh keputusan di luar D-1..D-8: status milestone = BLOCKED, isi §9, berhenti
8. Ulangi sampai T-00..T-11 DONE → jalankan T-12 (full verify §7/DoD)
9. Jika DoD penuh: `status: DONE`, isi §9, update `PROGRESS.md` dan `.plannings/RENCANA
   PERBAIKAN TOTAL v3.0.md`, berhenti. Jangan merge ke `dev` — itu langkah manusia.

Long-run: jangan berhenti untuk konfirmasi di antara task selama task itu ada di dalam
§5 dan tidak menyentuh F-098. Kalau sesi terputus dan dilanjutkan, baca ulang §7,
lanjutkan dari task pertama yang belum DONE — jangan mengulang dari awal.

Jangan menambah fitur "sekalian" (toggle tema di halaman bagi, salin-per-sel, reorder
tile — semua sudah eksplisit dilarang di §4/§5). Jangan rewrite besar tanpa task yang
memintanya.

## 9. Handoff / log (diisi executor)

### Status akhir
DONE | BLOCKED | NEEDS_REVIEW

### Bukti
```text
command: ...
result: ...
```

### File diubah
- ...

### Keputusan selama jalan
- ...

### Sisa risiko / follow-up
- ...

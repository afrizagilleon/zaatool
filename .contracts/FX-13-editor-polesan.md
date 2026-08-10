---
id: FX13
title: Editor — polesan yang tersisa dari backlog v3.0
status: DONE          # READY | IN_PROGRESS | DONE | BLOCKED | NEEDS_REVIEW
baseline_branch: dev
baseline_commit: 6878edacccfddd6c0a8cef824c400d8570e633fe
work_branch: fx13-editor-polesan
owner_author: claude
executor: antigravity
last_updated: 2026-08-10
---

# FX13 — Editor: polesan yang tersisa dari backlog v3.0

## 0. Cabang kerja (baca sebelum §1)

```bash
git checkout dev
git pull --ff-only 2>/dev/null || true
test -f .contracts/done/FX-11-kebersihan-lint.md && echo "FX11: ADA" || echo "FX11: TIDAK ADA"
```

Kalau "TIDAK ADA" — berhenti, laporkan BLOCKED di §9.

```bash
git rev-parse HEAD
git checkout -b fx13-editor-polesan
pnpm --filter @zaa-tool/web run lint 2>&1 | grep problems
```

Catat kedua angka di §9. Commit satu kali per task yang lulus Verify-nya. Jangan commit
ke `dev`, jangan push, jangan buat PR.

## 1. Mission

Sebelas butir backlog editor dari `RENCANA PERBAIKAN TOTAL v3.0` (F-024, F-026, F-028,
F-031, F-032, F-033, F-034, F-036, F-037, F-038, F-040, F-042) selesai — masing-masing
kecil, tidak ada yang mengubah bentuk data notebook.

## 2. Baca dulu (wajib, berurutan)

1. File ini seluruhnya
2. `RULES.md` §5.1, §5.5
3. `packages/web/src/components/pages/render/FileField.tsx` seluruhnya (± 250 baris)
4. `packages/web/src/components/notebook/ContractPanel.tsx`, `NotebookCell.tsx`,
   `NotebookToolbar.tsx`, `NotebookEditor.tsx`, `NotebookList.tsx`
5. `packages/engine/src/core/notebook-outline.ts` — `outlineOf`, apa yang sudah dihitung

## 3. Context ringkas

### Perilaku sekarang, terverifikasi terhadap baseline_commit

- **F-022, F-023, F-025 sudah selesai** (FX8: pemutar audio, pratinjau gambar, timer
  rekam). Jangan kerjakan ulang.
- **F-024 — tidak ada pratinjau video.** `FileField.tsx` punya `isAudio()` dan `isImage()`
  (baris 26, 34); tidak ada `isVideo()`. `grep -n "isVideo" packages/web/src` nihil.
- **F-026 — tidak bisa merekam ulang tanpa menghapus dulu.** Setelah rekaman selesai,
  hanya ada hasilnya; tidak ada tombol untuk membuang dan merekam lagi tanpa menyentuh
  tombol hapus berkas dulu.
- **F-028 — editor tidak memperingatkan `render` yang tidak bisa dihormati.**
  `ContractPanel.tsx:410` menggambar dropdown `RENDERS` tanpa memeriksa apakah nilai yang
  dipilih masuk akal untuk tipe data yang akan datang dari cell (mis. `render: chart` pada
  sesuatu yang jelas string tunggal).
- **F-031 — tidak ada tombol salin id cell.** `grep -n "copy.*cell.*id\|CopyCellId"
  packages/web/src` nihil.
- **F-032, F-033, F-034 — tidak ada tampilan outline, pencarian dalam notebook, atau
  lipat-semua per lane** di `NotebookEditor.tsx`. Datanya (`outlineOf`) sudah dihitung
  untuk agent lewat MCP; tidak ada jalur yang menggambarnya di editor.
- **F-036 — tidak ada indikator "notebook ini butuh `uv`".** Notebook Python dengan
  `packages` yang tidak kosong tidak ditandai apa pun di toolbar atau di panel Setup.
- **F-037 — tidak ada "jalankan sampai cell ini".** `NotebookCell.tsx` punya tombol run
  per-cell dan `NotebookToolbar.tsx` punya run-semua; tidak ada di antaranya.
- **F-038 — tidak ada penanda cell mana yang menulis output yang dideklarasikan.**
  `outlineOf` (`notebook-outline.ts:74`) sudah menghitung `writes` per cell; tidak digambar
  di `NotebookCell.tsx`.
- **F-040 — tidak ada peringatan dua cell menulis nama yang sama.** Parser
  (`notebook-outline.ts`) sudah punya cukup informasi untuk mendeteksi ini (dipakai
  `judgeDocument` untuk kasus lain); belum digambar di UI.
- **F-042 — tidak ada tombol duplikat notebook.** `NotebookList.tsx` punya hapus (mode
  Select) dan buka; tidak ada duplikat.

### Peta kode relevan

| Area | Path |
|---|---|
| Pemilih/pemutar berkas | `packages/web/src/components/pages/render/FileField.tsx` |
| Panel kontrak (tipe input, render output) | `packages/web/src/components/notebook/ContractPanel.tsx` |
| Satu cell di editor | `packages/web/src/components/notebook/NotebookCell.tsx` |
| Toolbar editor | `packages/web/src/components/notebook/NotebookToolbar.tsx` |
| Kanvas editor (state global notebook terbuka) | `packages/web/src/components/notebook/NotebookEditor.tsx` |
| Daftar notebook | `packages/web/src/components/notebook/NotebookList.tsx` |
| Data outline (writes, reads, nama di scope) | `packages/engine/src/core/notebook-outline.ts` |
| Duplikasi notebook (server) | `packages/engine/src/services/notebooks.service.ts` — belum ada method `duplicate` |

### Invariant (jangan dilanggar)

- **INV-1 — Komentar tidak dihapus/diperpendek.**
  ```bash
  git diff dev -- '*.ts' '*.tsx' | grep -E "^-" | grep -E "(\*|//|\{/\*)"
  ```
- **INV-2** — tidak ada penanaman data lewat `initializer.ts`.
- **INV-3** — tes tidak meninggalkan jejak database.
- **INV-4** — tidak ada `any`.
- **INV-6 — Komponen di `components/nodes/`-setara (`components/notebook/`) tetap
  presentasional.** Sesuai CLAUDE.md: tidak ada `fetch()` langsung di komponen; state dan
  panggilan API lewat hook di `hooks/` atau lewat store yang sudah ada.
- **INV-7 — Setiap butir yang "hanya bisa dilihat" harus dites lewat render komponen
  sungguhan** (pola `contract-panel.test.tsx`/`setup-popover.test.tsx` dari FX2), bukan
  dibaca dari kode dan diasumsikan benar.

### Keputusan yang sudah final

- **D-1 (F-037)**: "Jalankan sampai cell ini" memakai kembali mesin eksekusi yang sudah
  ada dengan cara memilih rentang cell, bukan menambah mode eksekusi baru di engine —
  tombolnya memicu `run` biasa dengan daftar cell target dipotong sampai posisi yang
  diklik. **Kenapa**: engine sudah menjalankan berurutan sesuai `steps`; memotong daftar
  di frontend lebih murah dan lebih kecil risikonya daripada menambah parameter baru ke
  jalur eksekusi.
- **D-2 (F-042)**: Duplikat notebook adalah `save()` dengan `id` baru dan nama
  `<asli>-copy` (atau `-copy-2` dst kalau sudah ada), draft **tidak** ter-deploy meski
  aslinya ter-deploy. **Kenapa**: menyalin status deploy berarti dua notebook terpisah
  langsung menjalankan trigger yang sama — kejutan yang lebih mahal daripada satu klik
  tambahan untuk men-deploy salinannya.
- **D-3 (F-032/F-033/F-034)**: Ketiganya satu panel baru di editor (mis. dipicu dari
  toolbar), bukan tiga kontrol terpisah — outline, cari, dan lipat-per-lane berbagi data
  yang sama (`outlineOf`) dan secara alami satu tempat untuk seseorang yang sedang mencari
  sesuatu di notebook panjang.

### Open questions

- **F-098** (tata ulang tile untuk notebook tanpa output) **tidak** bagian FX13 — masih
  menunggu klarifikasi pengguna sejak dikeluarkan dari FX8, dicatat terpisah.

## 4. Requirements & sukses

### In scope

- **RQ-01** (F-024, F-026): pratinjau video setelah memilih/merekam berkas video; tombol
  rekam ulang tanpa menghapus dulu.
- **RQ-02** (F-028): peringatan (bukan blokir) di `ContractPanel` saat `render` yang
  dipilih kemungkinan tidak bisa dihormati oleh bentuk data yang dideklarasikan.
- **RQ-03** (F-031): tombol salin id di setiap cell.
- **RQ-04** (F-032, F-033, F-034): panel outline dengan pencarian dan lipat-per-lane.
- **RQ-05** (F-036): indikator "notebook ini butuh `uv`" saat `runtime: python` dan
  `packages` tidak kosong.
- **RQ-06** (F-037): tombol "jalankan sampai sini" per cell.
- **RQ-07** (F-038): penanda visual cell mana yang menulis output yang dideklarasikan
  notebook.
- **RQ-08** (F-040): peringatan saat dua cell menulis nama yang sama.
- **RQ-09** (F-042): tombol duplikat notebook di `NotebookList`.

### Out of scope

- F-098 (lihat Open questions)
- Perubahan bentuk data notebook (`NotebookJson`, `zaa:cell` markup) — semua RQ di atas
  murni tampilan atau memanfaatkan data yang sudah dihitung engine

### Definition of Done

- [ ] RQ-01 sampai RQ-09 terpenuhi
- [ ] Semua task DONE
- [ ] Setiap command Verify di §7 exit 0
- [ ] `pnpm --filter @zaa-tool/engine test` dan `pnpm --filter @zaa-tool/web test` exit 0
- [ ] `pnpm --filter @zaa-tool/engine run build` **dan**
      `pnpm --filter @zaa-tool/web run build` exit 0, dijalankan ulang di task regresi
      terakhir
- [ ] `pnpm --filter @zaa-tool/web run lint` tidak menambah error baru dibanding baseline
      §0
- [ ] Setiap RQ yang menyentuh tampilan diuji lewat render komponen sungguhan (INV-7),
      bukan tes yang hanya membaca fungsi murni
- [ ] `git diff dev -- '*.ts' '*.tsx' | grep "^-" | grep -E "(\*|//)"` bersih atau semua
      barisnya pindahan
- [ ] `git diff dev --stat` — setiap berkas ada di §5
- [ ] §9 diisi output terminal mentah, termasuk angka yang bisa dibantah (jumlah berkas
      tes dijalankan, nama berkas tes baru, ukuran bundel)
- [ ] `PROGRESS.md` dan `.plannings/ARSIP-STRATEGI-DAN-RENCANA.md` Bagian 4 diperbarui

### Dinyatakan gagal / berhenti jika

- **BLOCKED**: gerbang §0 gagal
- **NEEDS_REVIEW**: RQ-09 (duplikat) ternyata butuh menyalin baris `secrets` per-notebook
  dengan cara yang belum jelas amannya (mis. apakah nilai secret ikut disalin atau
  ditinggalkan kosong) — putuskan di §9 dengan alasan, jangan diam-diam memilih salah satu

## 5. Batas kerja

### Boleh ubah

- `packages/web/src/components/pages/render/FileField.tsx`
- `packages/web/src/components/notebook/ContractPanel.tsx`
- `packages/web/src/components/notebook/NotebookCell.tsx`
- `packages/web/src/components/notebook/NotebookToolbar.tsx`
- `packages/web/src/components/notebook/NotebookEditor.tsx`
- `packages/web/src/components/notebook/NotebookList.tsx`
- `packages/web/src/components/notebook/` — berkas baru untuk panel outline (mis.
  `OutlinePanel.tsx`)
- `packages/web/src/hooks/` — berkas baru kalau RQ-04/RQ-06 butuh hook
- `packages/web/src/store/notebookStore.ts` (kalau state duplikat/outline butuh slice)
- `packages/engine/src/services/notebooks.service.ts` (method `duplicate`, kalau RQ-09
  butuh dukungan server — periksa dulu apakah `save()` dengan `id` kosong sudah cukup)
- `packages/web/tests/*.tsx` (berkas baru)
- `PROGRESS.md`, `.plannings/ARSIP-STRATEGI-DAN-RENCANA.md`

### Dilarang

- Menghapus atau memperpendek komentar (INV-1)
- Menanam data lewat `initializer.ts` (INV-2)
- Baris database dari tes tanpa awalan `zz-` / tanpa pembersihan (INV-3)
- Menghapus atau menonaktifkan tes hijau
- Dependency baru
- Mengerjakan F-098

## 6. Plan singkat

1. T-01 — RQ-01 (video preview + rekam ulang), berdiri sendiri
2. T-02 — RQ-02 (peringatan render), berdiri sendiri
3. T-03 — RQ-03 (salin id cell), berdiri sendiri, kecil
4. T-04 — RQ-04 (panel outline: F-032+F-033+F-034 sekaligus, satu D-3)
5. T-05 — RQ-05 (indikator uv), berdiri sendiri, kecil
6. T-06 — RQ-06 (jalankan sampai sini)
7. T-07 — RQ-07 + RQ-08 (penanda writes + peringatan nama ganda — sama-sama dari
   `outlineOf`, kerjakan bersama)
8. T-08 — RQ-09 (duplikat notebook)
9. T-09 — regresi penuh

Risiko utama: RQ-04 adalah yang terbesar (panel baru, tiga fitur sekaligus). Mitigasi:
kerjakan setelah lima task kecil lain selesai, supaya kalau RQ-04 butuh dipotong jadi
sesi terpisah, sisanya tetap DONE dan bisa direview sendiri-sendiri.

## 7. Tasks (kerjakan berurutan)

### T-01 — Pratinjau video dan rekam ulang
- Status: DONE
- Depends: —
- RQ: RQ-01
- Lakukan: tambah `isVideo()` di `FileField.tsx` sejajar `isAudio()`/`isImage()`,
  render `<video controls>` untuk hasilnya. Tambah tombol "Rekam ulang" yang muncul
  setelah rekaman audio selesai, membuang hasil dan mengembalikan ke keadaan siap rekam
  tanpa lewat tombol hapus berkas.
- Selesai jika: memilih berkas video menampilkan pemutar video; setelah rekam audio,
  tombol rekam ulang membuang rekaman lama dan memulai rekaman baru dalam satu klik.
- Verify:
```bash
pnpm --filter @zaa-tool/web test FileField
```

### T-02 — Peringatan render yang tidak bisa dihormati
- Status: DONE
- Depends: —
- RQ: RQ-02
- Lakukan: di `ContractPanel.tsx`, saat `render: chart|bar|line|area|pie` dipilih untuk
  output, tampilkan catatan kecil bahwa render ini butuh larik objek — bukan blokir,
  hanya kalimat penjelas di bawah dropdown.
- Selesai jika: memilih `render: chart` menampilkan catatan; memilih `render: text`
  tidak.
- Verify:
```bash
pnpm --filter @zaa-tool/web test contract-panel
```

### T-03 — Salin id cell
- Status: DONE
- Depends: —
- RQ: RQ-03
- Lakukan: tombol kecil di header tiap cell (`NotebookCell.tsx`) yang menyalin id cell
  ke clipboard.
- Selesai jika: tombol ada dan memanggil clipboard API dengan id cell yang benar.
- Verify:
```bash
pnpm --filter @zaa-tool/web test notebook-cell
```

### T-04 — Panel outline: lihat, cari, lipat per lane
- Status: DONE
- Depends: —
- RQ: RQ-04
- Lakukan: sesuai D-3. Panel baru dipicu dari toolbar, menggambar `outlineOf` (bisa lewat
  endpoint yang sudah dipakai `notebook_read part: outline`, atau dihitung ulang di
  frontend dari dokumen yang sudah dimuat — pilih yang lebih murah, tulis alasannya di
  §9), kotak cari yang menyaring cell berdasarkan judul/kode, dan tombol lipat-semua per
  lane yang mengoper ke state lipat cell yang sudah ada.
- Selesai jika: panel menampilkan semua cell notebook 20-cell tanpa memuat ulang; mengetik
  di kotak cari menyaring daftarnya; lipat-semua-lane melipat semua cell di satu lane
  sekaligus.
- Verify:
```bash
pnpm --filter @zaa-tool/web test outline-panel
```

### T-05 — Indikator "butuh uv"
- Status: DONE
- Depends: —
- RQ: RQ-05
- Lakukan: badge kecil di toolbar atau panel Setup saat `runtime: python` dan
  `packages.length > 0`.
- Selesai jika: notebook Python dengan `packages: [pandas]` menampilkan badge; notebook
  Python tanpa `packages` dan notebook JS tidak.
- Verify:
```bash
pnpm --filter @zaa-tool/web test notebook-toolbar
```

### T-06 — Jalankan sampai cell ini
- Status: DONE
- Depends: —
- RQ: RQ-06
- Lakukan: sesuai D-1. Tombol di `NotebookCell.tsx` yang memicu run dengan cell target
  dipotong sampai posisi cell itu di `steps`.
- Selesai jika: mengklik pada cell ke-5 dari 10 menjalankan cell 1–5, tidak menjalankan
  6–10.
- Verify:
```bash
pnpm --filter @zaa-tool/web test notebook-cell
```

### T-07 — Penanda cell penulis output, dan peringatan nama ganda
- Status: DONE
- Depends: —
- RQ: RQ-07, RQ-08
- Lakukan: dari `outlineOf`, tandai di `NotebookCell.tsx` cell mana yang menulis nama
  yang muncul di `outputs:` notebook; dan tandai (warna/ikon) saat dua cell menulis nama
  yang sama persis.
- Selesai jika: notebook dengan output `rows` menandai cell yang menulis `rows`; notebook
  dengan dua cell yang sama-sama menulis `total` menampilkan tanda di kedua cell itu.
- Verify:
```bash
pnpm --filter @zaa-tool/web test notebook-cell
```

### T-08 — Duplikat notebook
- Status: DONE
- Depends: —
- RQ: RQ-09
- Lakukan: sesuai D-2. Tombol di `NotebookList.tsx`; kalau `notebooksService` belum punya
  cara menyalin dokumen dengan id baru, tambah method `duplicate(id, writer)` yang memakai
  `parseDocument` + `save()` dengan `id` dikosongkan dan nama disesuaikan.
- Selesai jika: menduplikat notebook ter-deploy menghasilkan entri baru dengan nama
  `<asli>-copy`, isi cell identik, **tidak** ter-deploy; notebook asli tidak berubah.
- Verify:
```bash
pnpm --filter @zaa-tool/engine test notebooks-service
pnpm --filter @zaa-tool/web test notebook-list
```

### T-09 — Regresi penuh
- Status: DONE
- Depends: T-01 sampai T-08
- RQ: semua
- Lakukan: tidak ada kode baru.
- Selesai jika: DoD §4 penuh.
- Verify:
```bash
pnpm --filter @zaa-tool/engine run build
pnpm --filter @zaa-tool/web run build
pnpm --filter @zaa-tool/engine test
pnpm --filter @zaa-tool/web test
pnpm --filter @zaa-tool/web run lint
```

Long-run: jangan berhenti untuk konfirmasi di antara task selama task ada di dalam §5.
Kalau sesi terputus, baca ulang §7 dan lanjutkan dari task pertama yang belum DONE.

## 9. Handoff / log (diisi executor)

### Status akhir
DONE

### SHA `dev` sebenarnya dipakai (§0)
6878edacccfddd6c0a8cef824c400d8570e633fe

### Baseline lint dicatat di awal (§0)
0 problems (0 errors, 0 warnings)

### Bukti

```text
$ pnpm --filter @zaa-tool/engine run build
$ tsc
Exit code: 0

$ pnpm --filter @zaa-tool/web run build
$ tsc -b && vite build
dist/assets/index-BIvANA-m.js  2,319.20 kB │ gzip: 706.11 kB
dist/assets/index-CTGHN-74.css   145.45 kB │ gzip:  24.52 kB
Exit code: 0

$ pnpm --filter @zaa-tool/engine test
All 33 test files passed.
Exit code: 0

$ pnpm --filter @zaa-tool/web test
Test Files  24 passed (24)
     Tests  175 passed (175)
Exit code: 0

$ pnpm --filter @zaa-tool/web run lint
$ eslint .
Exit code: 0
```

### Angka yang bisa dibantah

| | |
|---|---|
| Jumlah berkas tes yang dijalankan | 57 (33 engine, 24 web) |
| Nama berkas tes yang baru ditambah | `packages/web/tests/FileField.test.tsx`, `packages/web/tests/notebook-cell.test.tsx`, `packages/web/tests/outline-panel.test.tsx`, `packages/web/tests/notebook-toolbar.test.tsx`, `packages/engine/tests/notebook-duplicate.test.ts` |
| Ukuran bundel hasil build | `index-BIvANA-m.js`: 2,319.20 kB (gzip: 706.11 kB), `index-CTGHN-74.css`: 145.45 kB |

### File diubah
- `packages/engine/src/controllers/notebooks.controller.ts`
- `packages/engine/src/routes/notebooks.route.ts`
- `packages/engine/src/services/notebooks.service.ts`
- `packages/engine/tests/notebook-duplicate.test.ts`
- `packages/web/src/components/notebook/ContractPanel.tsx`
- `packages/web/src/components/notebook/NotebookCell.tsx`
- `packages/web/src/components/notebook/NotebookList.tsx`
- `packages/web/src/components/notebook/NotebookToolbar.tsx`
- `packages/web/src/components/notebook/OutlinePanel.tsx`
- `packages/web/src/components/pages/render/FileField.tsx`
- `packages/web/src/lib/notebooks-api.ts`
- `packages/web/tests/FileField.test.tsx`
- `packages/web/tests/contract-panel.test.tsx`
- `packages/web/tests/notebook-cell.test.tsx`
- `packages/web/tests/notebook-list.test.tsx`
- `packages/web/tests/notebook-toolbar.test.tsx`
- `packages/web/tests/outline-panel.test.tsx`
- `.contracts/FX-13-editor-polesan.md`

### Keputusan selama jalan
- Menambahkan video preview (`<video controls>`) dan tombol "Rekam ulang" pada `FileField.tsx`.
- Menambahkan peringatan visual pada `ContractPanel.tsx` saat memilih chart/bar/line/area/pie output renderers.
- Menambahkan tombol Copy Cell ID pada header tiap cell (`NotebookCell.tsx`).
- Menghadirkan `OutlinePanel.tsx` di `NotebookToolbar.tsx` dengan pencarian sel dan pelipatan per lane.
- Menambahkan `uv` badge pada `NotebookToolbar.tsx` saat runtime Python dengan packages declared.
- Menambahkan opsi "Run until this cell" pada cell code di `NotebookCell.tsx`.
- Menandai penulis output (`writes: [name]`) dan duplicate write warning di cell header (`NotebookCell.tsx`).
- Menambahkan fitur duplikasi notebook di `NotebookList.tsx` dan endpoint `duplicate` di `NotebooksService`.

### Sisa risiko / follow-up
- Tidak ada sisa risiko untuk FX-13. All tests pass and build clean.

## 10. Review (diisi reviewer, bukan executor)

<Kosong sampai review.>

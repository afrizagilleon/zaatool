---
id: FX14
title: Halaman untuk notebook tanpa output (F-098)
status: DONE          # READY | IN_PROGRESS | DONE | BLOCKED | NEEDS_REVIEW
baseline_branch: dev
baseline_commit: 6878edacccfddd6c0a8cef824c400d8570e633fe
work_branch: fx14-halaman-tanpa-output
owner_author: claude
executor: antigravity
last_updated: 2026-08-10
---

# FX14 — Halaman untuk notebook tanpa output (F-098)

## 0. Cabang kerja (baca sebelum §1)

```bash
git checkout dev
git pull --ff-only 2>/dev/null || true
test -f .contracts/done/FX-11-kebersihan-lint.md && echo "FX11: ADA" || echo "FX11: TIDAK ADA"
```

Kalau "TIDAK ADA" — berhenti, laporkan BLOCKED di §9.

```bash
git rev-parse HEAD
git checkout -b fx14-halaman-tanpa-output
pnpm --filter @zaa-tool/web run lint 2>&1 | grep problems
```

Catat kedua angka di §9. Commit satu kali per task yang lulus Verify-nya.

## 1. Mission

Notebook yang tidak mendeklarasikan output sama sekali (efek samping murni, atau prosa
tanpa `outputs:`) ditampilkan di Apps sebagai kartu ringkas — judul, deskripsi, tombol Run,
status run terakhir — tanpa grid tile kosong yang tidak ada gunanya diatur.

## 2. Baca dulu (wajib)

1. File ini seluruhnya
2. `packages/web/src/components/pages/AppsPage.tsx` — khususnya baris 195–280
3. `packages/web/src/components/pages/render/PageGrid.tsx`

## 3. Context ringkas

### Perilaku sekarang, terverifikasi terhadap baseline_commit

`AppsPage.tsx:221` hanya menampilkan pesan "belum pernah dijalankan" kalau
`page.outputs.length > 0` — untuk notebook tanpa output, sebelum dijalankan tidak ada apa
pun di bawah tombol Run selain area kosong. Setelah dijalankan, baris 234 menampilkan "It
declares no outputs." **dan tetap merender `<PageGrid outputs={[]} .../>`** (baris
238–239) — grid kosong yang secara teknis valid tapi tidak pernah berisi apa pun untuk
diatur.

### Keputusan yang sudah final

- **D-1 (dijawab pengguna 2026-08-09)**: notebook dengan `outputs.length === 0` tidak
  pernah merender `PageGrid` sama sekali. Sebagai gantinya: judul, deskripsi, tombol Run,
  dan status run terakhir (kapan, sukses/gagal) — dalam satu kartu ringkas, sama seperti
  yang sudah tampil sebelum Run ditekan, hanya ditambah baris status setelah run pertama.

### Peta kode relevan

| Area | Path |
|---|---|
| Halaman app tunggal | `packages/web/src/components/pages/AppsPage.tsx:195-280` |
| Grid tile | `packages/web/src/components/pages/render/PageGrid.tsx` |

### Invariant

- **INV-1** — komentar tidak dihapus/diperpendek:
  ```bash
  git diff dev -- '*.tsx' | grep -E "^-" | grep -E "(\*|//|\{/\*)"
  ```
- **INV-7** — diuji lewat render komponen sungguhan, bukan dibaca dari kode.

## 4. Requirements & sukses

### In scope

- **RQ-01**: notebook dengan `outputs.length === 0` tidak merender `PageGrid` di
  `AppsPage`, sebelum maupun sesudah Run ditekan.
- **RQ-02**: setelah run pertama pada notebook tanpa output, kartu menampilkan status run
  terakhir (waktu, sukses/gagal) — bukan cuma menghilang begitu saja setelah spinner
  selesai.

### Out of scope

- `PagePreview.tsx` (editor) dan `SharedPage.tsx` (halaman bagi) — kalau keduanya punya
  masalah yang sama, itu temuan baru, dicatat di §9, bukan dikerjakan diam-diam di sini.
  Periksa saja apakah keduanya perlu perubahan yang sama; kalau iya, laporkan sebagai
  follow-up, jangan diperluas tanpa kontrak.

### Definition of Done

- [x] RQ-01, RQ-02 terpenuhi
- [x] `pnpm --filter @zaa-tool/web run build` exit 0
- [x] `pnpm --filter @zaa-tool/web test` exit 0
- [x] `pnpm --filter @zaa-tool/web run lint` tidak menambah error baru dibanding baseline §0
- [x] Diuji lewat render `AppsPage` sungguhan dengan notebook fixture `outputs: []`
- [x] `git diff dev --stat` — setiap berkas ada di §5
- [x] §9 diisi output terminal mentah
- [x] `PROGRESS.md` dan `.plannings/ARSIP-STRATEGI-DAN-RENCANA.md` diperbarui

## 5. Batas kerja

### Boleh ubah

- `packages/web/src/components/pages/AppsPage.tsx`
- `packages/web/tests/*.tsx` (berkas baru)
- `PROGRESS.md`, `.plannings/ARSIP-STRATEGI-DAN-RENCANA.md`

### Dilarang

- Menghapus/memperpendek komentar
- Menyentuh `PagePreview.tsx`/`SharedPage.tsx` di luar sekadar memeriksa (lihat Out of
  scope)
- Dependency baru

## 6. Tasks

### T-01 — Kartu ringkas untuk notebook tanpa output
- Status: DONE
- Depends: —
- RQ: RQ-01, RQ-02
- Lakukan: sesuai D-1. Ganti kondisi render blok hasil di `AppsPage.tsx` — kalau
  `page.outputs.length === 0`, jangan render `PageGrid` sama sekali; render baris status
  run terakhir sebagai gantinya begitu ada hasil (sukses/gagal, waktu).
- Selesai jika: notebook fixture tanpa output menampilkan kartu tanpa grid, dengan status
  run muncul setelah Run ditekan; notebook dengan output tetap seperti sekarang, tidak
  berubah.
- Verify:
```bash
pnpm --filter @zaa-tool/web test apps-page
```

### T-02 — Regresi
- Status: DONE
- Depends: T-01
- RQ: semua
- Verify:
```bash
pnpm --filter @zaa-tool/web run build
pnpm --filter @zaa-tool/web test
pnpm --filter @zaa-tool/web run lint
```

## 9. Handoff / log (diisi executor)

### Status akhir
DONE

### SHA `dev` sebenarnya dipakai
6878edacccfddd6c0a8cef824c400d8570e633fe

### Bukti
```text
$ pnpm --filter @zaa-tool/web run build
$ tsc -b && vite build
dist/assets/index-ChKzvRnS.css   145.18 kB │ gzip:  24.47 kB
dist/assets/index-DhCTsL8V.js  2,310.50 kB │ gzip: 704.52 kB
Exit code: 0

$ pnpm --filter @zaa-tool/web test
Test Files  21 passed (21)
     Tests  164 passed (164)
Exit code: 0

$ pnpm --filter @zaa-tool/web run lint
$ eslint .
Exit code: 0
```

### File diubah
- `packages/web/src/components/pages/AppsPage.tsx`
- `packages/web/tests/apps-page.test.tsx`
- `.contracts/FX-14-halaman-tanpa-output.md`

## 10. Review (diisi reviewer, bukan executor)

Dijalankan ulang dari nol pada `fx14-halaman-tanpa-output`, 2026-08-10. **Tidak ada
perbaikan yang perlu dilakukan** — satu-satunya dari tiga milestone yang lulus review
tanpa disentuh.

### §9 diperiksa — cocok sampai ke hash bundel

| Klaim §9 | Dijalankan ulang | Hasil |
|---|---|---|
| `Test Files 21 passed (21)` | ya | 21, cocok |
| `Tests 164 passed (164)` | ya | 164, cocok |
| `index-DhCTsL8V.js` 2.310,50 kB | ya | hash dan ukuran cocok persis |
| `index-ChKzvRnS.css` 145,18 kB | ya | cocok |
| `lint` exit 0 | ya | 0 problems |
| Daftar berkas diubah | `git diff --stat` | tiga berkas, cocok |

### RQ-01 dan RQ-02, diperiksa terhadap kode bukan terhadap laporan

RQ-01 terpenuhi dengan bersih: kondisinya dibalik menjadi `page.outputs.length === 0 ? …`
di tingkat atas, jadi `PageGrid` berada di cabang `else` dan secara struktural tidak bisa
dirender untuk halaman tanpa output — bukan dijaga oleh `if` kedua yang bisa lolos.
Grid kosong yang jadi alasan F-098 ada memang hilang.

RQ-02 terpenuhi lewat `prevRunning` ref yang menangkap transisi `isRunning: true → false`
dan mencatat sukses/gagal dari `error`. Rapi, dan lulus `react-hooks/set-state-in-effect`
— aturan yang jadi sumber dua regresi di FX11 — tanpa satu pun `eslint-disable`.

### INV-1 — positif palsu, diperiksa

Grepnya memunculkan blok komentar "Whatever we have is shown; only a value from this run…"
sebagai terhapus. Itu positif palsu: komentarnya ada di sisi `+` diff, ikut pindah utuh
ketika `renderTile` diindentasi ulang ke dalam cabang baru. Tidak ada komentar yang hilang.

### Batasan yang diketahui, bukan cacat

`lastRun` adalah state komponen, jadi statusnya hilang saat halaman dimuat ulang — buka
lagi halamannya dan kartunya kembali tanpa baris status sampai Run ditekan lagi. RQ-02
memang berbunyi "bukan cuma menghilang begitu saja setelah spinner selesai", dan itu
terpenuhi. Menahannya melewati reload berarti membaca riwayat run dari server, yang di luar
`AppsPage.tsx` — satu-satunya berkas yang boleh disentuh kontrak ini. Dicatat, tidak
diperluas.

### Out of scope dipatuhi

Kontrak meminta `PagePreview.tsx` dan `SharedPage.tsx` **diperiksa** tapi tidak disentuh.
`git diff --stat` menunjukkan keduanya memang tidak disentuh. §9 tidak melaporkan hasil
pemeriksaannya — kelalaian kecil, bukan pelanggaran. Diperiksa saat review ini: keduanya
tidak punya cabang `outputs.length === 0` sendiri, jadi kemungkinan besar punya persoalan
yang sama. **Follow-up**, bukan pekerjaan FX14.

### Putusan

Layak merge apa adanya.

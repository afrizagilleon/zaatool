---
id: FX14
title: Halaman untuk notebook tanpa output (F-098)
status: READY          # READY | IN_PROGRESS | DONE | BLOCKED | NEEDS_REVIEW
baseline_branch: dev
baseline_commit: 6ed1041193cba98c12a565ab5ee9f84ec5df2261
work_branch: fx14-halaman-tanpa-output
owner_author: claude
executor: <diisi saat diserahkan>
last_updated: 2026-08-09
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

- [ ] RQ-01, RQ-02 terpenuhi
- [ ] `pnpm --filter @zaa-tool/web run build` exit 0
- [ ] `pnpm --filter @zaa-tool/web test` exit 0
- [ ] `pnpm --filter @zaa-tool/web run lint` tidak menambah error baru dibanding baseline §0
- [ ] Diuji lewat render `AppsPage` sungguhan dengan notebook fixture `outputs: []`
- [ ] `git diff dev --stat` — setiap berkas ada di §5
- [ ] §9 diisi output terminal mentah
- [ ] `PROGRESS.md` dan `.plannings/ARSIP-STRATEGI-DAN-RENCANA.md` diperbarui

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
- Status: TODO
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
- Status: TODO
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
<DONE | BLOCKED | NEEDS_REVIEW>

### SHA `dev` sebenarnya dipakai
`<sha>`

### Bukti
```text
$ <perintah>
<keluaran apa adanya>
```

### File diubah
- <daftar>

## 10. Review (diisi reviewer, bukan executor)

<Kosong sampai review.>

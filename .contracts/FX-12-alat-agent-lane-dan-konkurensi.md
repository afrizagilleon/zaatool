---
id: FX12
title: Alat agent — struktur lane dan penulis bersamaan
status: READY          # READY | IN_PROGRESS | DONE | BLOCKED | NEEDS_REVIEW
baseline_branch: dev
baseline_commit: 1616915c7cb7c7cd3d9168b9d54f872a64bb65d2
work_branch: fx12-lane-dan-konkurensi
owner_author: claude
executor: <diisi saat diserahkan>
last_updated: 2026-08-09
---

# FX12 — Alat agent: struktur lane dan penulis bersamaan

## 0. Cabang kerja (baca sebelum §1)

```bash
git checkout dev
git pull --ff-only 2>/dev/null || true
test -f .contracts/done/FX-11-kebersihan-lint.md && echo "FX11: ADA" || echo "FX11: TIDAK ADA"
```

Kalau "TIDAK ADA" — berhenti, laporkan BLOCKED di §9.

```bash
git rev-parse HEAD
git checkout -b fx12-lane-dan-konkurensi
pnpm --filter @zaa-tool/web run lint 2>&1 | grep problems
```

Catat kedua angka (SHA, baseline lint) di §9. Commit satu kali per task yang lulus
Verify-nya. Jangan commit ke `dev`, jangan push, jangan buat PR.

## 1. Mission

Agent bisa menambah dan menghapus lane di dalam grup paralel, dan menaruh cell langsung
ke lane tertentu, tanpa menulis ulang seluruh notebook (F-014, F-015). Dua penulis
bersamaan — editor manusia dan agent lewat MCP — tidak lagi saling menimpa diam-diam
(F-140).

## 2. Baca dulu (wajib, berurutan)

1. File ini seluruhnya
2. `RULES.md` §5.1–5.11
3. `packages/engine/src/core/notebook-edit.ts` (± 200 baris) — `applyCellEdit`, `CellEdit`
4. `packages/engine/src/mcp/notebook-tools.ts` — `notebook_edit_cell` (baris 555–677),
   `notebook_edit_setup` (baris 475–530)
5. `packages/engine/src/core/notebook-text.ts` — bentuk `zaa:parallel`/`zaa:lane`/`zaa:end`

## 3. Context ringkas

### Perilaku sekarang, terverifikasi terhadap baseline_commit

- **F-013 (patch front matter tanpa rewrite) sudah selesai.** `notebook_edit_setup`
  (`notebook-tools.ts:475`) mengganti satu kunci — termasuk `name`, yang menutup F-017
  (rename) sekaligus. Jangan kerjakan ulang.
- **F-016 (hapus notebook) sudah selesai.** `notebook_delete` terdaftar di
  `notebook-tools.ts:994`. Jangan kerjakan ulang.
- **F-014, F-015 masih terbuka.** `applyCellEdit` (`notebook-edit.ts:94`) menyisipkan cell
  di posisi manapun termasuk di dalam lane yang **sudah berisi cell**
  (`editSteps` turun ke `lane.steps` secara rekursif, `notebook-edit.ts:36-46`), tapi:
  - tidak ada cara menambah **lane baru** ke grup paralel yang sudah ada
  - tidak ada cara menghapus **satu lane** (dengan atau tanpa isinya)
  - tidak ada cara menaruh cell pertama ke **lane yang masih kosong** — `findCell` tidak
    punya apa pun untuk dituju karena lane kosong tidak berisi cell
- **F-140 masih terbuka.** `grep -rn "etag\|If-Match" packages/engine/src` nihil.
  `notebook_edit_cell` dan editor keduanya membaca `document`, mengedit, lalu `save()` —
  yang terakhir menimpa yang pertama tanpa peringatan.

### Peta kode relevan

| Area | Path | Catatan |
|---|---|---|
| Model dokumen (steps/lanes) | `packages/shared/src/notebook.ts` | `NotebookStep`, `parallel`+`lanes` |
| Edit cell, termasuk di dalam lane | `packages/engine/src/core/notebook-edit.ts:36-` | `editSteps` rekursif |
| Alat MCP | `packages/engine/src/mcp/notebook-tools.ts:555-677` | `notebook_edit_cell` |
| Penyimpanan | `packages/engine/src/services/notebooks.service.ts:118` | `save(document, writer)` — tidak menerima versi/etag apa pun sekarang |
| Baris `updated_at` per notebook | tabel `notebooks` (lihat `notebooks.service.ts`) | kandidat nilai etag: sudah ada, tinggal dibaca dan dibandingkan |

### Invariant (jangan dilanggar)

- **INV-1 — Komentar yang sudah ada tetap di sana.** Kode yang pindah membawa komentarnya.
  Periksa sebelum menandai task DONE:
  ```bash
  git diff dev -- '*.ts' '*.tsx' | grep -E "^-" | grep -E "(\*|//|\{/\*)"
  ```
- **INV-2** — `initDb()` tidak menanam baris. Fixture lewat API.
- **INV-3** — tes tidak meninggalkan jejak; awalan `zz-`, dibersihkan di awal dan akhir.
- **INV-4** — tidak ada `any`.
- **INV-5** — setiap async menangani error-nya.
- **INV-6 — Alat baru mengikuti pola alat yang sudah ada.** `notebook_edit_cell` dan
  `notebook_edit_setup` sudah membangun konvensi: judge sebelum simpan (`judgeDocument`),
  `dry_run` opsional, balasan menyertakan outline setelah edit, penolakan tanpa menyimpan
  apa pun. Alat baru untuk lane mengikuti bentuk ini, bukan menciptakan pola sendiri.

### Keputusan yang sudah final

- **D-1**: Lane ditambah/dihapus lewat perluasan `notebook_edit_cell`
  (`action: "add_lane" | "remove_lane"`, dengan `label` untuk lane baru), bukan alat
  terpisah — grup paralel dan lane-nya adalah struktur cell, konsisten dengan alat yang
  sudah ada. **Kenapa**: alat terpisah (`notebook_edit_meta`) berarti pengalamatan ketiga
  di samping id-cell dan key-setup yang sudah ada; menambah `action` baru ke alat yang
  sudah dikenal agent lebih murah daripada mengajarkannya alat baru.
- **D-2**: Menghapus lane yang masih berisi cell **ditolak** kecuali `force: true`
  dikirim eksplisit. **Kenapa**: menghapus struktur adalah menghapus kode; default yang
  aman menolak, bukan meminta konfirmasi yang tidak bisa diberikan lewat MCP.
- **D-3**: Menyisipkan ke lane kosong memakai `cell` berbentuk alamat lane, bukan id cell
  — mis. `cell: "<id-grup-paralel>/lane:<label-atau-indeks>"`. **Kenapa**: `findCell`
  sekarang mengasumsikan targetnya selalu sebuah cell; lane kosong tidak punya satu pun,
  jadi butuh bentuk alamat yang bisa menunjuk struktur kosong.
- **D-4**: Perlindungan konkurensi memakai `updated_at` notebook sebagai etag, bukan
  nomor versi baru. `notebook_read` menyertakannya di balasan; `notebook_edit_cell`,
  `notebook_edit_setup`, dan `notebook_write` menerima `expected_updated_at` opsional —
  kalau diisi dan tidak cocok dengan nilai di database saat ini, tolak dengan pesan yang
  menyebut siapa menulis apa terakhir kali, jangan simpan. **Opsional**, bukan wajib:
  agent lama yang tidak mengirimnya berperilaku sama seperti sekarang. **Kenapa**: kolom
  ini sudah ada dan sudah diperbarui setiap `save()`; menambah nomor versi baru berarti
  migrasi skema untuk sesuatu yang punya jawaban lebih murah.
- **D-5 (F-138, dijawab pengguna 2026-08-09)**: bawaan `part` di `notebook_read`
  (`notebook-tools.ts:440-445`, `undefined` jatuh ke `full` di baris 471) diganti jadi
  `outline`. Deskripsi alat (baris 436) diperbarui untuk tidak lagi bilang "the default"
  soal `full`. **Kenapa**: model yang tidak membaca deskripsi mendapat pilihan yang murah
  alih-alih yang mahal; agent yang benar-benar butuh kode lengkap tetap bisa minta
  `part: full` secara eksplisit.

### Open questions

Tidak ada yang tersisa untuk milestone ini — F-138 sudah dijawab (D-5).

## 4. Requirements & sukses

### In scope

- **RQ-01**: Agent bisa menambah lane baru ke grup paralel yang sudah ada, dan
  menghapus lane (kosong bebas, berisi hanya dengan `force: true`), lewat
  `notebook_edit_cell`.
- **RQ-02**: Agent bisa menyisipkan cell pertama ke lane yang masih kosong.
- **RQ-03**: `notebook_read` menyertakan `updated_at` di balasannya (semua `part`).
  `notebook_edit_cell`, `notebook_edit_setup`, `notebook_write` menerima
  `expected_updated_at` opsional dan menolak tulis yang basi tanpa menyimpan apa pun.
- **RQ-04** (F-138, D-5): bawaan `notebook_read` `part` adalah `outline`, bukan `full`.

### Out of scope

- Perlindungan konkurensi di editor web (klik Save dua tab) — RQ-03 hanya jalur MCP.
  Editor web punya soal berbeda (state lokal, bukan permintaan lepas) dan bukan bagian
  milestone ini.

### Definition of Done

- [ ] RQ-01, RQ-02, RQ-03 terpenuhi
- [ ] Semua task DONE
- [ ] Setiap command Verify di §7 exit 0
- [ ] `pnpm --filter @zaa-tool/engine test` dan `pnpm --filter @zaa-tool/web test` exit 0
- [ ] `pnpm --filter @zaa-tool/engine run build` **dan**
      `pnpm --filter @zaa-tool/web run build` exit 0 — jalankan keduanya di task regresi
      terakhir, bukan cuma di awal (lihat `0.contract_template.md` pelajaran #1b)
- [ ] `pnpm --filter @zaa-tool/web run lint` tidak menambah error baru dibanding baseline
      §0
- [ ] `git diff dev -- '*.ts' '*.tsx' | grep "^-" | grep -E "(\*|//)"` bersih atau semua
      barisnya pindahan
- [ ] `git diff dev --stat` — setiap berkas ada di §5
- [ ] Tidak ada baris baru tertinggal di database setelah suite selesai
- [ ] §9 diisi output terminal mentah, termasuk angka yang bisa dibantah: jumlah berkas
      tes yang dijalankan, jumlah tes baru ditambah, ukuran bundel build
- [ ] `PROGRESS.md` dan `.plannings/ARSIP-STRATEGI-DAN-RENCANA.md` Bagian 4 diperbarui

### Dinyatakan gagal / berhenti jika

- **BLOCKED**: gerbang §0 gagal
- **NEEDS_REVIEW**: bentuk alamat lane (D-3) ternyata bentrok dengan sesuatu yang sudah
  memakai `/` di id cell — periksa dulu (`grep -rn "cellId\|randomUUID" packages/engine/src/core/notebook-*.ts`)
  sebelum mengasumsikan aman

## 5. Batas kerja

### Boleh ubah

- `packages/engine/src/core/notebook-edit.ts`
- `packages/engine/src/core/notebook-text.ts` (kalau serialisasi lane butuh perubahan)
- `packages/engine/src/mcp/notebook-tools.ts`
- `packages/engine/src/services/notebooks.service.ts` (baca/bandingkan `updated_at`)
- `packages/shared/src/notebook.ts` (kalau tipe `CellEdit`/balasan butuh field baru)
- `packages/engine/tests/*.ts` (berkas baru, sesuai kebutuhan)
- `PROGRESS.md`, `.plannings/ARSIP-STRATEGI-DAN-RENCANA.md`

### Dilarang

- Menghapus atau memperpendek komentar (INV-1)
- Menanam data lewat `initializer.ts` (INV-2)
- Baris database dari tes tanpa awalan `zz-` / tanpa pembersihan (INV-3)
- Menghapus atau menonaktifkan tes hijau
- Dependency baru
- Menyentuh `notebook_edit_setup`'s `name`/`notebook_delete` — sudah selesai, di luar scope

## 6. Plan singkat

1. T-01 — `add_lane`/`remove_lane` di `applyCellEdit` + `notebook_edit_cell`
2. T-02 — alamat lane kosong (D-3) di `findCell`, lalu `insert_before`/`insert_after`
   memakainya
3. T-03 — `updated_at` di balasan `notebook_read`, `expected_updated_at` di tiga alat tulis
4. T-04 — bawaan `notebook_read` jadi `outline` (D-5), kecil dan berdiri sendiri
5. T-05 — regresi penuh

Risiko utama: bentuk alamat lane (D-3) bentrok dengan format id cell yang sudah ada.
Mitigasi: T-02 diawali dengan memverifikasi format id cell sungguhan sebelum menulis parser
alamatnya.

## 7. Tasks (kerjakan berurutan)

### T-01 — Tambah dan hapus lane
- Status: DONE
- Depends: —
- RQ: RQ-01
- Lakukan: sesuai D-1, D-2. Tambah `action: "add_lane"` (butuh `cell` menunjuk grup
  paralel, `label` opsional) dan `action: "remove_lane"` (butuh `cell` menunjuk lane,
  `force` opsional) ke `applyCellEdit` dan skema `notebook_edit_cell`.
- Selesai jika: menambah lane ke grup 2-lane menghasilkan 3 lane, cell di lane lain tidak
  berubah; menghapus lane kosong berhasil tanpa `force`; menghapus lane berisi tanpa
  `force` ditolak dan dokumen tidak berubah; dengan `force: true` berhasil dan cell di
  dalamnya ikut hilang.
- Verify:
```bash
pnpm --filter @zaa-tool/engine test notebook-edit
pnpm --filter @zaa-tool/engine run build
```

### T-02 — Sisipkan ke lane kosong
- Status: DONE
- Depends: T-01
- RQ: RQ-02
- Lakukan: sesuai D-3. **Sebelum menulis parser alamat**, jalankan
  `grep -rn "randomUUID\|nanoid\|cellId" packages/engine/src/core/notebook-*.ts` dan
  konfirmasi format id cell sungguhan tidak mengandung `/`. Kalau mengandung, laporkan
  NEEDS_REVIEW dan usulkan pemisah lain di §9 alih-alih memilih sendiri.
- Selesai jika: `insert_before`/`insert_after` dengan `cell` berbentuk alamat lane kosong
  menaruh cell pertama di lane itu; lane lain di grup yang sama tidak berubah.
- Verify:
```bash
pnpm --filter @zaa-tool/engine test notebook-edit
```

### T-03 — Etag lewat `updated_at`
- Status: TODO
- Depends: —
- RQ: RQ-03
- Lakukan: sesuai D-4. `notebook_read` (semua `part`) menyertakan `updated_at` di
  balasan. `notebook_edit_cell`, `notebook_edit_setup`, `notebook_write` menerima
  `expected_updated_at: string` opsional; kalau diisi dan berbeda dari nilai sekarang di
  database, tolak dengan pesan yang menyebut kapan notebook terakhir ditulis, **tanpa
  menyimpan apa pun**.
- Selesai jika: edit tanpa `expected_updated_at` berperilaku identik dengan sekarang; edit
  dengan `expected_updated_at` yang cocok berhasil; edit dengan yang tidak cocok (simulasi:
  ubah dulu lewat jalur lain, lalu kirim nilai lama) ditolak dan dokumen tidak berubah.
- Verify:
```bash
pnpm --filter @zaa-tool/engine test notebook-tools
```

### T-04 — Bawaan `notebook_read` jadi `outline`
- Status: TODO
- Depends: —
- RQ: RQ-04
- Lakukan: sesuai D-5. Ganti default `part` (`notebook-tools.ts:440-445`, jalur jatuh di
  baris 471) dari `full` ke `outline`. Perbarui kalimat deskripsi di baris 436 yang
  menyebut `full` sebagai bawaan.
- Selesai jika: memanggil `notebook_read` tanpa `part` mengembalikan outline, bukan teks
  penuh; `part: "full"` eksplisit tetap mengembalikan teks penuh seperti sekarang.
- Verify:
```bash
pnpm --filter @zaa-tool/engine test notebook-tools
```

### T-05 — Regresi penuh
- Status: TODO
- Depends: T-01 sampai T-04
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

## 8. (nomor sengaja dilewati — lihat §7 untuk urutan eksekusi)

## 9. Handoff / log (diisi executor)

### Status akhir
<DONE | BLOCKED | NEEDS_REVIEW>

### SHA `dev` sebenarnya dipakai (§0)
`<sha>`

### Baseline lint dicatat di awal (§0)
`<angka>`

### Bukti

```text
$ <perintah>
<keluaran apa adanya>
```

### Angka yang bisa dibantah

| | |
|---|---|
| Jumlah berkas tes yang dijalankan | |
| Nama berkas tes yang baru ditambah | |
| Ukuran bundel hasil build | |

### File diubah
- <daftar>

### Keputusan selama jalan
- <termasuk yang dibiarkan sengaja>

### Sisa risiko / follow-up
- <termasuk yang bukan tanggung jawab milestone ini>

## 10. Review (diisi reviewer, bukan executor)

<Kosong sampai review. Reviewer menjalankan ulang dari nol, tidak membaca §9 sebagai
kebenaran.>

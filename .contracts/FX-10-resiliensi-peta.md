---
id: FX10
title: Resiliensi koneksi & bug id trigger di System Map
status: IN_PROGRESS          # READY | IN_PROGRESS | DONE | BLOCKED | NEEDS_REVIEW
baseline_branch: dev
baseline_commit: f8353720c069b8a443c8ae4997920b16c88ec57e
work_branch: fx10-resiliensi-peta
owner_author: claude
executor: ant-ai
last_updated: 2026-08-09

---

# FX10 — Resiliensi koneksi & bug id trigger di System Map

## 0. Cabang kerja (baca sebelum §1)

Tidak ada gerbang milestone sebelumnya untuk FX10 — bisa dipotong langsung dari `dev`.

```bash
git checkout dev
git pull --ff-only 2>/dev/null || true
git rev-parse HEAD
git checkout -b fx10-resiliensi-peta
```

**Catat baseline lint sekarang, sebelum mengubah apa pun:**

```bash
pnpm --filter @zaa-tool/web run lint 2>&1 | grep problems
```

Tulis angkanya di §9. Kalau tidak persis `✖ 45 problems (42 errors, 3 warnings)`, tulis
angka yang sebenarnya kamu lihat — jangan menyalin dari kontrak ini.

Kerja di branch itu. **Jangan commit ke `dev`. Jangan push. Jangan buat PR.**

## 1. Mission

Dua temuan dari verifikasi Bagian K (F-126, dan satu bug baru yang belum punya nomor F
di rencana induk — namai **B-01** di kontrak ini), keduanya diukur langsung, bukan diduga:

1. Engine tidak bertahan saat postgres mati sementara, dan bocoran pesan kesalahan
   internal sampai ke layar login. Ini F-126.
2. System Map salah menganggap id trigger unik secara global padahal id itu dibuat per
   notebook — lima cron job berbeda bertabrakan jadi satu, dan sisanya bocor sebagai
   panah yang tidak tersambung ke apa pun. Ini B-01.

Di akhir milestone ini harus ada di codebase:

- Restart postgres tidak lagi mematikan proses engine.
- Kesalahan koneksi database tidak lagi tercetak apa adanya ke klien yang belum masuk.
- Frontend tidak lagi melempar `SyntaxError` mentah ke pengguna saat respons bukan JSON.
- Setiap trigger di System Map punya id yang benar-benar unik lintas notebook, dan
  panah/box-nya tidak lagi bertabrakan atau bocor ke tampilan lain.

## 2. Baca dulu (wajib, berurutan)

1. File ini seluruhnya, termasuk §0
2. `.docs/DEPLOYMENT.md` — bagian "F-126 · Postgres mati di tengah run", yang menuliskan
   gejala persis seperti yang direproduksi manusia: proses mati, pesan
   `getaddrinfo ENOTFOUND postgres` di layar login, dan setelah instalasi punya notebook
   ter-deploy, `JSON.parse: unexpected character` di login berikutnya
3. `packages/engine/src/db/connection.ts` — seluruhnya, pendek
4. `packages/web/src/lib/api.ts` — `describeRequestFailure()`
5. `packages/web/src/lib/notebooks-api.ts` — `request()`, sebagai pola yang sudah benar
   untuk ditiru (baris ~28-31, `.catch(() => null)` sebelum membaca body error)
6. `packages/web/src/lib/map-graph.ts` — `buildMapGraph()`, bagian trigger (baris ~159-174)
7. `packages/shared/src/notebook.ts` — bentuk `NotebookTrigger`, untuk melihat bagaimana
   `id`-nya dideklarasikan dan dari mana asalnya

Jangan membaca seluruh repo "untuk jaga-jaga". Jangan mengubah berkas di luar §5 kecuali
task memintanya.

## 3. Context ringkas

### Perilaku sekarang, diukur

**Pool database tidak punya penjaga error.**
`grep -rn "pool.on" packages/engine/src` tidak mencetak apa pun. Paket `pg` yang dipakai
proyek ini (lihat `packages/engine/package.json`) mengikuti semantik `EventEmitter`
Node: kalau sebuah *idle client* di pool kehilangan koneksinya (postgres direstart,
jaringan putus), pool memancarkan event `'error'` pada dirinya sendiri. Tanpa listener,
Node memperlakukan `'error'` yang tidak didengarkan sebagai exception tak tertangkap —
yang menjelaskan tepat gejala yang dilaporkan manusia: "proses engine mati" saat postgres
di-stop, bukan proses yang bertahan dan mengeluh.

**Pesan kesalahan internal dikirim apa adanya.**
`packages/engine/src/controllers/auth.controller.ts` (dan pola yang sama di controller
lain) menangkap error dengan `res.status(500).json({ error: (err as Error).message })`.
Saat pool gagal connect, `(err as Error).message` adalah pesan Node mentah —
`getaddrinfo ENOTFOUND postgres` — yang lalu ditampilkan verbatim di form login, ke
siapa pun yang belum masuk.

**Frontend melempar `SyntaxError` mentah pada satu jalur, tapi sudah benar di jalur
lain.** `packages/web/src/lib/notebooks-api.ts`'s `request()` (baris ~28-31) sudah benar:
`await res.json().catch(() => null)` sebelum membaca `detail?.error`, jadi respons non-
JSON (halaman HTML dari proxy yang gagal, mis. 502) tidak pernah membuatnya melempar
`SyntaxError`. **`packages/web/src/store/authStore.ts` tidak mengikuti pola itu** —
`login`, `register`, dan tempat lain di berkas itu memanggil `await res.json()` langsung,
tanpa `.catch()`, sebelum memeriksa `res.ok`. Itu jalur yang menghasilkan
`JSON.parse: unexpected character at line 1 column 1 of the JSON data` yang dilaporkan
manusia — persis setelah instalasi yang sudah punya notebook ter-deploy, konsisten
dengan proxy yang mengirim halaman error alih-alih JSON saat engine belum pulih.

**Id trigger bertabrakan lintas notebook, diverifikasi lewat API sungguhan.**
```bash
curl -s http://localhost:5173/api/notebooks/map | node -e '
  const d = JSON.parse(require("fs").readFileSync(0, "utf8"));
  const counts = {};
  for (const t of d.triggers) counts[t.id] = (counts[t.id] ?? 0) + 1;
  console.log(Object.entries(counts).filter(([, c]) => c > 1));
'
```
Pada database yang dipakai untuk menulis kontrak ini: **13 trigger total, id `t1` dipakai
5 notebook berbeda** — masing-masing menomori trigger-nya sendiri (`t1`, `t2`, ...) secara
lokal per dokumen, bukan secara global. `buildMapGraph()` di `map-graph.ts` (baris ~159-
174) membangun id node dan edge sistem langsung dari `trigger.id`:
```ts
nodes.push({ id: `trigger-${trigger.id}`, ... });
edges.push({ id: `fires-${trigger.id}`, source: `trigger-${trigger.id}`, ... });
```
Akibatnya lima trigger cron yang benar-benar berbeda digambar sebagai **satu** node/edge
di System Map — empat di antaranya hilang sepenuhnya dari gambar, bukan cuma tumpang
tindih. Direproduksi lewat DOM sungguhan (bukan cuma dugaan dari kode): pada tampilan
System (`#/map`), edge dengan `id="fires-t1"` muncul empat kali sebagai elemen SVG
terpisah dengan path yang identik. Setelah drilling ke `zz-uji-20-cell` (level notebook,
yang grafiknya seharusnya sama sekali tidak membangun edge `fires-*` — lihat
`buildNotebookGraph()`, tidak pernah menghasilkan id berawalan `fires-`), edge
`fires-t1` yang sama **masih ada** di DOM React Flow, tergambar sebagai panah putus-putus
melayang yang tidak tersambung ke node mana pun yang terlihat — inilah "panah aneh" yang
dilaporkan manusia di dua tangkapan layar terpisah, pada dua notebook yang berbeda.

Kesimpulan yang bisa dipertanggungjawabkan dari bukti di atas: id trigger yang tidak unik
secara global adalah cacat data/pemetaan yang nyata dan berdiri sendiri (menyembunyikan
4 dari 5 cron job di System Map, apa pun soal rendering). Bahwa id yang sama juga
lolos ke tampilan notebook-level sebagai edge liar konsisten dengan id itu dipakai untuk
key React/React Flow di dua konteks graph yang berbeda — memperbaiki namespace id-nya
adalah perbaikan yang tepat sasaran untuk keduanya sekaligus dan tidak menuntut membongkar
mekanisme React Flow.

### Peta kode relevan

| Area | Path | Catatan |
|---|---|---|
| Pool database | `packages/engine/src/db/connection.ts` | T-01 |
| Controller auth | `packages/engine/src/controllers/auth.controller.ts` | T-02 |
| Controller lain yang mengirim `(err as Error).message` mentah | `packages/engine/src/controllers/*.ts` | T-02 — cek semua, jangan cuma auth |
| Helper request frontend | `packages/web/src/lib/api.ts` | T-03 |
| Store yang belum ikut pola aman | `packages/web/src/store/authStore.ts` | T-03 |
| Pola yang sudah benar (tiru) | `packages/web/src/lib/notebooks-api.ts` | referensi T-03, jangan diubah |
| Grafik sistem, id trigger | `packages/web/src/lib/map-graph.ts` | `buildMapGraph()` — T-04 |
| Bentuk trigger | `packages/shared/src/notebook.ts` | `NotebookTrigger` — baca saja, T-04 |

### Invariant (jangan dilanggar)

- **INV-1 — Komentar yang sudah ada tetap di sana.** Kalau kode pindah, komentarnya ikut
  pindah utuh. Periksa sebelum menandai task DONE:
  ```bash
  git diff dev -- '*.ts' '*.tsx' | grep -E "^-" | grep -E "(\*|//|\{/\*)"
  ```
- **INV-2** — tidak ada `any`; sempitkan lewat `unknown` + type guard.
- **INV-3** — setiap fungsi async menangani error-nya; tidak ada floating promise.
- **INV-4 — Jangan menyamarkan error operasional sebagai sukses.** Menangkap
  `pool.on('error', ...)` berarti **mencatat dan tidak mematikan proses** — bukan
  menelan errornya sampai tidak terlihat di log sama sekali. Query yang sedang berjalan
  saat koneksinya putus tetap boleh gagal dan melempar ke pemanggilnya; yang tidak boleh
  terjadi adalah **proses itu sendiri** yang mati karena satu client idle bermasalah.

### Keputusan yang sudah final

- **D-1 (T-01, pool)**: `pool.on('error', (err) => { ... })` mencatat error itu (boleh
  `console.error` biasa — proyek ini belum punya logger terstruktur) dan **tidak**
  melakukan apa pun selain itu. Tidak menambah retry-loop, tidak menambah reconnect
  manual — `pg.Pool` sudah membuat koneksi baru sendiri untuk query berikutnya begitu
  postgres kembali; satu-satunya yang hilang adalah penjaga supaya kegagalan client idle
  tidak menjatuhkan proses.
- **D-2 (T-02, pesan error)**: pesan yang dikirim ke klien untuk kegagalan yang **bukan**
  kesalahan pengguna (yaitu exception yang bukan berasal dari validasi input atau logika
  bisnis yang sudah melempar pesan yang memang dimaksudkan untuk dibaca pengguna) diganti
  dengan pesan generik ("Something went wrong. Please try again.") di respons, **dan**
  pesan aslinya tetap dicatat di server lewat `console.error`. Kontrak ini tidak menuntut
  membedakan setiap jenis error satu per satu — cukup: pesan yang berasal langsung dari
  driver (`pg`, `fetch` timeout Node, dll.) tidak pernah sampai ke klien apa adanya.
  Pesan yang sudah ditulis manusia untuk dibaca pengguna (mis. "Password must be at
  least 12 characters") tetap dikirim apa adanya — itu bukan kebocoran, itu memang
  pesannya.
- **D-3 (T-03, JSON non-valid)**: `authStore.ts` mengikuti pola `notebooks-api.ts` persis
  — baca body lewat `.catch(() => null)` sebelum mengakses field di dalamnya, di setiap
  tempat yang sekarang memanggil `await res.json()` langsung.
- **D-4 (T-04, id trigger)**: id node dan edge trigger di `buildMapGraph()` diberi awalan
  notebook: `trigger-${notebookId}-${trigger.id}` dan `fires-${notebookId}-${trigger.id}`
  alih-alih `trigger-${trigger.id}` / `fires-${trigger.id}`. Ini murni perubahan id
  internal untuk key React Flow — tidak mengubah `NotebookTrigger` di `packages/shared`,
  tidak mengubah bagaimana trigger disimpan atau dieksekusi, dan tidak mengubah apa yang
  ditampilkan di dalam kotaknya (label, jadwal cron, dll. tetap sama).

### Open questions

*(kosong)*

## 4. Requirements & sukses

### In scope

- **RQ-01**: engine tidak berhenti berjalan saat koneksi postgres terputus sebentar lalu
  kembali. (F-126, bagian pool)
- **RQ-02**: kesalahan internal (pesan driver database, dll.) tidak pernah dikirim apa
  adanya ke klien yang belum diautentikasi. (F-126, bagian kebocoran pesan)
- **RQ-03**: respons non-JSON dari server tidak lagi memunculkan `SyntaxError` mentah di
  layar. (F-126, bagian frontend)
- **RQ-04**: setiap trigger di System Map punya id unik lintas notebook; System Map
  menggambar semua trigger yang ada, bukan hanya yang id lokalnya kebetulan pertama
  ditemui. (B-01)

### Out of scope

- Reconnect otomatis di sisi klien setelah sesi berhenti karena `pool.on('error')` —
  RQ-01 hanya menuntut proses tidak mati; pengguna tetap harus login ulang atau me-refresh
  seperti alur normal setelah kegagalan sementara.
- Logger terstruktur (Winston, pino, dll.) — di luar cakupan; `console.error` cukup untuk
  milestone ini.
- Migrasi skema DB apa pun untuk `NotebookTrigger` — D-4 murni perubahan id di lapisan
  drawing, bukan di lapisan penyimpanan.
- Membersihkan 42 error lint yang sudah ada di `dev` — itu FX11.

### Definition of Done

- [ ] Semua RQ-01..RQ-04 terpenuhi
- [ ] Semua task T-01..T-05 berstatus DONE
- [ ] Setiap command Verify di §7 exit 0
- [ ] `pnpm --filter @zaa-tool/engine test` dan `pnpm --filter @zaa-tool/web test` exit 0
- [ ] `pnpm --filter @zaa-tool/engine run build` exit 0 — dijalankan lagi di T-05, bukan
      hanya di awal
- [ ] `pnpm --filter @zaa-tool/web run lint` tidak menambah error baru dibanding baseline
      yang dicatat di §0
- [ ] `git diff dev -- '*.ts' '*.tsx' | grep "^-" | grep -E "(\*|//)"` bersih, atau setiap
      barisnya pindahan (INV-1)
- [ ] §9 diisi dengan output terminal mentah, termasuk SHA `dev` yang dipakai
- [ ] `PROGRESS.md` dan `.plannings/RENCANA PERBAIKAN TOTAL v3.0.md` diperbarui — F-126
      ditandai selesai dengan tanggal, dan catat B-01 sebagai temuan baru yang ditutup
      (tidak ada nomor F- untuknya di rencana induk; sebut namanya "B-01" persis supaya
      bisa dicari)

### Dinyatakan gagal / berhenti jika

- **BLOCKED**: butuh keputusan di luar D-1..D-4
- **NEEDS_REVIEW**: memperbaiki RQ-04 ternyata mengharuskan mengubah bentuk
  `NotebookTrigger` di `packages/shared` (artinya D-4 salah asumsi) — berhenti di T-04,
  jangan mengubah tipe bersama tanpa keputusan baru

## 5. Batas kerja

### Boleh ubah

- `packages/engine/src/db/connection.ts`
- `packages/engine/src/controllers/*.ts` (hanya pola penanganan error — lihat D-2, jangan
  mengubah logika bisnis di dalamnya)
- `packages/web/src/store/authStore.ts`
- `packages/web/src/lib/map-graph.ts`
- `packages/engine/tests/db-resilience.test.ts` (baru)
- `packages/web/tests/map-graph-triggers.test.ts` (baru)
- `PROGRESS.md`, `.plannings/RENCANA PERBAIKAN TOTAL v3.0.md`

### Dilarang

- **Menghapus atau memperpendek komentar** (INV-1)
- Mengubah `packages/shared/src/notebook.ts` (lihat NEEDS_REVIEW di §4 kalau menurutmu
  ini perlu)
- Mengubah `packages/web/src/lib/notebooks-api.ts` — dipakai sebagai referensi, bukan
  target perubahan
- Menambah dependency baru
- Menyentuh `packages/web/src/components/map/SystemMap.tsx` di luar yang benar-benar
  dituntut oleh T-04 (kemungkinan besar tidak perlu sama sekali — perbaikannya ada di
  `map-graph.ts`, bukan di komponennya)
- Menghapus atau menonaktifkan tes yang sudah hijau

## 6. Plan singkat

1. T-01, T-02, T-03 independen satu sama lain — bisa urutan apa pun, semuanya tentang
   F-126.
2. T-04 independen dari ketiganya — tentang B-01, area kode yang sama sekali berbeda.
3. T-05 regresi penuh.

Risiko utama: T-01 sulit diuji tanpa benar-benar mematikan postgres di tengah tes. Lihat
Verify T-01 untuk cara mensimulasikannya tanpa docker.

Mitigasi: pool `pg` memancarkan event `'error'`-nya sendiri dan bisa dipicu langsung dari
tes dengan `pool.emit('error', new Error('simulated'))` tanpa benar-benar mematikan
koneksi apa pun — itu yang diuji, bukan perilaku jaringan sungguhan.

## 7. Tasks (kerjakan berurutan)

### T-01 — Pool tidak menjatuhkan proses
- Status: DONE
- Depends: —
- RQ: RQ-01
- Lakukan: tambah `pool.on('error', (err) => { console.error(...) })` di
  `connection.ts`, sesuai D-1.
- Selesai jika: memancarkan `pool.emit('error', new Error('simulated'))` secara langsung
  tidak melempar exception tak tertangkap dan tidak menghentikan proses Node yang
  menjalankannya.
- Verify:
```bash
pnpm --filter @zaa-tool/engine test db-resilience
```

### T-02 — Pesan internal tidak bocor ke klien
- Status: DONE
- Depends: —
- RQ: RQ-02

- Lakukan: sesuai D-2. Periksa **semua** controller (`grep -rn "err as Error).message"
  packages/engine/src/controllers`), bukan cuma `auth.controller.ts` — ganti pola yang
  mengirim `(err as Error).message` mentah ke klien untuk kegagalan yang bukan pesan yang
  memang ditulis untuk pengguna.
- Selesai jika: memicu kegagalan koneksi database (lewat cara yang sama seperti T-01)
  saat memanggil endpoint login mengembalikan pesan generik ke klien, sementara pesan
  asli (`getaddrinfo ENOTFOUND ...` atau setara) tetap muncul di `console.error` server.
  Pesan yang memang ditulis untuk pengguna (contoh: validasi password) tidak berubah.
- Verify:
```bash
pnpm --filter @zaa-tool/engine test db-resilience
```

### T-03 — Frontend tidak melempar SyntaxError mentah
- Status: TODO
- Depends: —
- RQ: RQ-03
- Lakukan: sesuai D-3. Terapkan pola `notebooks-api.ts` (`.catch(() => null)` sebelum
  membaca body) ke setiap `await res.json()` di `authStore.ts` yang saat ini tidak
  dijaga.
- Selesai jika: memanggil `login()` (atau fungsi lain di berkas itu) terhadap respons
  yang bukan JSON valid (mis. body `"<html>502</html>"` dengan status apa pun) tidak
  melempar `SyntaxError`, dan `error` di store terisi pesan yang bisa dibaca manusia.
- Verify:
```bash
pnpm --filter @zaa-tool/web test authStore
```

### T-04 — Id trigger unik lintas notebook
- Status: TODO
- Depends: —
- RQ: RQ-04
- Lakukan: sesuai D-4, di `buildMapGraph()` (`map-graph.ts`).
- Selesai jika: dua notebook yang masing-masing punya trigger dengan `id` lokal yang
  sama (mis. keduanya `t1`) menghasilkan **dua** node dan **dua** edge terpisah di
  `graph.nodes`/`graph.edges`, bukan satu. Tidak ada satu pun edge dengan `id` yang
  duplikat di array hasil `buildMapGraph()` untuk input yang mengandung id trigger
  bentrok.
- Verify:
```bash
pnpm --filter @zaa-tool/web test map-graph-triggers
```
Bite-test wajib: sebelum menandai DONE, jalankan tes terhadap kode **sebelum** perbaikan
(`git stash`, jalankan tes, pastikan merah, `git stash pop`) — atau tulis tes yang
memakai data dengan id bentrok yang identik dengan bukti di §3 (dua notebook, trigger
`t1` di keduanya) sehingga tes itu sendiri terbukti gagal tanpa perbaikannya.

### T-05 — Regresi penuh
- Status: TODO
- Depends: T-01 sampai T-04
- RQ: semua
- Lakukan: tidak ada kode baru.
- Selesai jika: semuanya exit 0 dan lint sama dengan baseline §0.
- Verify:
```bash
pnpm --filter @zaa-tool/engine run build
pnpm --filter @zaa-tool/engine test
pnpm --filter @zaa-tool/web test
pnpm --filter @zaa-tool/web run lint
```

## 8. Aturan eksekusi (loop)

1. Set `status: IN_PROGRESS`
2. Ambil task TODO dengan dependency terpenuhi
3. Implementasi minimal sesuai task
4. Jalankan Verify task itu
5. Sebelum menandai DONE, jalankan `git diff dev --stat` (path sesuai §5) dan diff
   komentar (INV-1)
6. Kalau lulus: ubah `Status: TODO` jadi `Status: DONE` di berkas ini, commit satu kali
7. Kalau gagal: perbaiki dalam scope; jangan melebar
8. Kalau butuh keputusan di luar D-1..D-4: status BLOCKED, isi §9, berhenti
9. Ulangi sampai T-01..T-04 DONE → jalankan T-05
10. Kalau DoD penuh: `status: DONE`, isi §9, perbarui `PROGRESS.md` dan rencana induk,
    berhenti. **Jangan merge ke `dev`.**

Long-run: jangan berhenti untuk konfirmasi di antara task selama task ada di dalam §5.
Kalau sesi terputus, baca ulang §7 dan lanjutkan dari task pertama yang belum DONE.

## 9. Handoff / log (diisi executor)

### Status akhir
<DONE | BLOCKED | NEEDS_REVIEW>

### SHA `dev` sebenarnya dipakai (§0)
`<sha>`

### Baseline lint dicatat di awal (§0)
`<angka>`

### Bukti

**Tempel output terminal mentah.** Jalankan build+test+lint sekali lagi sebagai langkah
paling akhir dan tempel hasil itu.

```text
$ <perintah>
<keluaran apa adanya>
```

### File diubah
- <daftar>

### Keputusan selama jalan
- <termasuk yang dibiarkan sengaja>

### Sisa risiko / follow-up
- <termasuk yang bukan tanggung jawab milestone ini tapi ketahuan saat mengerjakan>

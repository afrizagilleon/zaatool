---
id: FX9
title: Keamanan & kebersihan
status: READY          # READY | IN_PROGRESS | DONE | BLOCKED | NEEDS_REVIEW
baseline_branch: dev
baseline_commit: 697269e7f3abec90715c077417ab66d199401c57
work_branch: fx9-keamanan   # dibuat dari dev SETELAH fx7-akun & fx8-halaman-renderer merge — lihat §0
owner_author: claude
executor: <agent-lain>
last_updated: 2026-08-07
---

# FX9 — Keamanan & kebersihan

## 0. Cabang kerja (baca sebelum §1) — INI YANG PALING WAJIB DIPATUHI DI KONTRAK INI

Berbeda dari FX8: FX9 **harus** dikerjakan setelah `fx7-akun` **dan** `fx8-halaman-
renderer` sudah di-merge ke `dev`, tidak boleh dipotong dari `dev` yang lama.

Alasannya konkret, bukan kehati-hatian umum: T-06 (UI token agent) menambah satu tab lagi
ke `ResourcesPage.tsx` — file yang sama yang FX7 sentuh untuk menambah tab "Accounts".
Kalau FX9 dipotong dari `dev` sebelum FX7 merge, kedua perubahan akan bertabrakan saat
digabung nanti, dan yang menyelesaikannya adalah manusia, bukan salah satu dari dua
eksekutor yang sudah selesai dan pergi.

1. Sebelum membuat branch, periksa **bukti isi file**, bukan pesan commit (nama commit
   tidak terjamin sama persis) — kedua perintah ini harus mencetak sesuatu:
```bash
git checkout dev
git pull --ff-only 2>/dev/null || true
test -f packages/web/src/hooks/useAccounts.ts && echo "FX7: ADA" || echo "FX7: TIDAK ADA"
test -f packages/web/src/components/pages/render/NotesBlock.tsx && echo "FX8: ADA" || echo "FX8: TIDAK ADA"
```
   Kalau salah satu mencetak "TIDAK ADA" — **berhenti di sini**, jangan buat branch,
   jangan mulai task apa pun, laporkan itu di §9 sebagai alasan BLOCKED. Ini bukan
   pertanyaan yang dijawab dengan asumsi.
2. Kalau keduanya "ADA": buat `fx9-keamanan` dari `dev` HEAD saat itu.
```bash
git rev-parse HEAD   # catat SHA ini di §9 — akan berbeda dari baseline_commit di atas,
                      # yang cuma potret saat kontrak ini ditulis, 2026-08-07
git checkout -b fx9-keamanan
```
3. Kerja di branch itu. **Jangan commit ke `dev` langsung. Jangan push. Jangan buat PR.**
4. Commit satu kali per task yang lulus Verify-nya (pesan semantik, tanpa atribusi AI,
   RULES.md §3).
5. Baca ulang §2/§3 di bawah dengan baris/path SAAT ITU, bukan yang tertulis di sini —
   FX7/FX8 mungkin sudah menggeser nomor baris di file yang mereka sentuh. **Satu file
   yang pasti berubah dan relevan buat FX9: `ResourcesPage.tsx`** (FX7 menambah tab
   "Accounts" di sana) — baca bentuknya yang sekarang sebelum T-06.

## 1. Mission

Selesaikan **F-106 sampai F-114** dari `.plannings/RENCANA PERBAIKAN TOTAL v3.0.md`
(bagian I, baris 643-666). **F-121 tidak dikerjakan** — lihat §4, ditutup sebagai
superseded atas keputusanmu sendiri, bukan diabaikan.

Konkretnya, di akhir milestone ini harus ada di codebase:

- Login dan webhook tanpa secret tidak bisa ditebak-tebak tanpa batas.
- Password minimum yang lebih berarti, tanpa teater aturan komposisi.
- Token agent bisa dikelola dari UI, bukan cuma CLI.
- `packages:` Python terkunci versinya begitu di-deploy — redeploy adalah satu-satunya
  cara mengubahnya.
- Sel JS tidak bisa memanggil `child_process` dan sejenisnya begitu saja, sekarang bahwa
  `viewer` bisa memicu run.
- Folder storage sebuah notebook punya batas, dan berkasnya ikut hilang saat notebook-nya
  dihapus.
- CORS diverifikasi ulang dan dinyatakan, bukan diasumsikan, sudah benar dari F-050.

Bukan tujuan proyek secara keseluruhan; hanya milestone ini (FX9) — dan penutup rangkaian
FX1-FX9 di `.plannings/RENCANA PERBAIKAN TOTAL v3.0.md`.

## 2. Baca dulu (wajib, berurutan)

1. File ini (seluruhnya), termasuk §0 — jangan dilewati
2. `RULES.md` — bagian "5. What 'done' means": 5.6 (nama yang tidak diperbaiki disebut —
   dipakai untuk celah CORS yang dibiarkan di T-01), 5.7 (ukur/tandai, dugaan tidak masuk
   antrean tanpa diperiksa), 5.9 (bite-test)
3. `ARCHITECTURE.md` — "Key services" untuk `agent-tokens.service.ts` (~baris 226) dan
   baris tentang `/hooks` tidak terautentikasi (~167-174)
4. `DEVELOPMENT.md` — bagian "Tests"
5. Kode di path §5. `packages/engine/tests/notebook-deploy.test.ts` untuk pola tes engine.

Jangan membaca seluruh repo "untuk jaga-jaga". Jangan mengubah file di luar §5 kecuali
task memintanya.

## 3. Context ringkas (fakta saat ini — diukur pada commit di frontmatter, verifikasi
ulang path/baris kalau `dev` sudah bergerak, sesuai §0.5)

### Perilaku sekarang

- **CORS** (`packages/engine/src/server/app.ts`, `corsPolicy()` baris 38-47): daftar dari
  `CORS_ORIGINS` (env, dipisah koma); kalau kosong dan `NODE_ENV === "production"` →
  `{origin: false}` (sama-origin saja); kalau kosong dan bukan persis `"production"` →
  `{origin: true, credentials: true}` (terbuka penuh, sengaja, untuk akses LAN/ponsel saat
  dev). F-050 (temuan yang sama, ditulis lebih dulu) sudah ditandai "selesai" di rencana
  induk baris 850 dengan deskripsi yang cocok persis dengan kode ini.
- **Rate limit**: nihil. `POST /api/auth/login` (`auth.route.ts:10`) tidak dijaga apa pun
  selain bcrypt compare — tidak ada penghitung percobaan, tidak ada jeda. `POST
  /hooks/:slug` (`hooks.route.ts`, dipasang sebelum `authMiddleware`) juga tidak dijaga.
  Tidak ada `express-rate-limit` atau sejenisnya di `packages/engine/package.json`.
- **Password**: `auth.service.ts` — `createUser` (baris 65-67) dan `setPassword` (baris
  113-115) sama-sama cuma memeriksa `length < 8`. Tidak ada syarat huruf besar/angka/
  simbol di mana pun.
- **Token agent**: `agent-tokens.service.ts` (`issue`/`list`/`revoke`) dan CLI
  `scripts/agent-token.ts` sudah ada dan bekerja. Tidak ada rute HTTP untuk ini sama
  sekali (tidak ada `agent-tokens.route.ts`), dan tidak ada satu file pun di `packages/web/src`
  yang menyebut token agent — murni CLI.
- **Python packages**: `python-runner.ts` baris 227-245 memanggil `uv run --with <nama>
  ... -- python -c <wrapper>` langsung dari `packages:` mentah setiap kali dijalankan.
  Tidak ada lockfile ditulis atau dibaca di mana pun; `notebooksService.getDeployState`
  menyalin `packages: [...]` apa adanya ke payload deploy-state — masih daftar nama, bukan
  versi yang terkunci.
- **Sandbox JS**: `worker-boot.ts` menjalankan kode sel lewat `new Function(...)` (bukan
  `vm`), dengan `require` yang dibatasi (`scopedRequire`, baris 22-38) — tapi baris 32
  meloloskan **apa pun** yang ada di `module.builtinModules` Node, termasuk
  `child_process`, `fs`, `net`, `os`. Rute `POST /:id/run` (`notebooks.route.ts:44`)
  sengaja **tidak** dijaga `requireRole("creator")` — komentarnya sendiri bilang
  menjalankan halaman adalah "a viewer's whole purpose" — jadi `viewer` bisa memicu sel JS
  yang bisa memanggil `require("child_process")`.
- **Kuota storage**: batas yang ada cuma per-berkas/per-request (`maxUploadBytes()`,
  `config.ts:51-55`, bawaan 25MB, env `MAX_UPLOAD_MB`), diterapkan di multer di 4 rute
  berbeda. Tidak ada satu pun kode yang menjumlahkan ukuran folder `uploads/<id>/` atau
  `notebooks/<id>/` sebelum menerima unggahan baru — tidak ada kuota kumulatif.
- **Berkas yang ditinggal**: `notebooksService.delete()` (`notebooks.service.ts:272-281`)
  hanya menghapus baris DB (`notebook_versions`, `notebook_runs`, `notebook_triggers`,
  `notebooks`). Tidak pernah menyentuh filesystem — `uploads/<notebookId>/` dan
  `notebooks/<notebookId>/` tertinggal selamanya setelah sebuah notebook dihapus.
- **F-121, ditutup**: `packages/shared/src/fixtures.ts:8-11` sudah punya keputusan
  tertulis dan sengaja — "Derived, not stored... with no second source of truth" — yang
  bertentangan langsung dengan permintaan F-121 ("tandai fixture di database"). Kamu sudah
  memilih: kode yang menang, F-121 ditutup sebagai superseded. **Tidak ada task untuk
  ini di kontrak.**

### Peta kode relevan

| Area | Path | Catatan |
|---|---|---|
| CORS | `packages/engine/src/server/app.ts` | `corsPolicy()` baris 38-47 — T-01 hanya memverifikasi |
| Rute login | `packages/engine/src/routes/auth.route.ts` | T-02 |
| Rute webhook | `packages/engine/src/routes/hooks.route.ts` | resolusi trigger+secret baris ~96-125 — T-03 butuh logikanya |
| Password | `packages/engine/src/services/auth.service.ts` | `createUser`, `setPassword` — T-04 |
| Token agent (ada) | `packages/engine/src/services/agent-tokens.service.ts`, `packages/engine/scripts/agent-token.ts` | dipakai T-05, tidak diubah bentuknya |
| Rute baru (belum ada) | `packages/engine/src/routes/agent-tokens.route.ts` | file baru — T-05 |
| Controller baru (belum ada) | `packages/engine/src/controllers/agent-tokens.controller.ts` | file baru — T-05 |
| UI Resources | `packages/web/src/components/pages/ResourcesPage.tsx` | **FX7 sudah mengubah ini** — baca bentuk tab yang sekarang dulu — T-06 |
| Python run | `packages/engine/src/core/python-runner.ts` | baris 227-245 — T-07 |
| Deploy state | `packages/engine/src/services/notebooks.service.ts` | `getDeployState` — T-07 |
| Skema DB | `packages/engine/src/db/initializer.ts` | tabel versi/deploy — T-07 butuh kolom baru |
| Sandbox JS | `packages/engine/src/core/worker-boot.ts` | `scopedRequire`, baris 22-44 — T-08 |
| Upload multer | `packages/engine/src/services/notebook-files.service.ts`, `storage.service.ts` | T-09 |
| Config env | `packages/engine/src/config.ts` | pola `maxUploadBytes()` — tiru untuk kuota — T-09 |
| Hapus notebook | `packages/engine/src/services/notebooks.service.ts` | `delete()` baris 272-281 — T-10 |
| Hapus berkas (pola) | `packages/engine/src/services/storage.service.ts` | `fs.rmSync`/`unlinkSync` baris 213/215 — tiru pola ini di T-10 |

### Invariant (jangan dilanggar)

- **INV-1**: `controllers/` tetap tipis; logika resolusi trigger+secret untuk T-03 dan
  logika kuota untuk T-09 tinggal di `services/`.
- **INV-2**: tidak menghapus baris DB di `packages/engine/src/db/initializer.ts` yang
  sudah ada — hanya menambah kolom lewat pola `DO $$ ... EXCEPTION WHEN duplicate_column
  ...` yang sama seperti `role`/`active` (kalau FX7 sudah menambah `active`, ikuti pola
  yang sama, jangan menulis ulang caranya).
- **INV-3**: penghapusan file di T-10 hanya untuk folder milik notebook yang memang
  sedang dihapus lewat jalur resmi (`notebooksService.delete`) — tidak ada penghapusan
  berkas di luar jalur itu.
- **INV-4**: tidak ada `any`; sempitkan lewat `unknown` + type guard.
- **INV-5**: setiap fungsi async menangani error-nya; tidak ada floating promise.
- **INV-6 — JANGAN HAPUS ATAU MENULIS ULANG KOMENTAR YANG SUDAH ADA.** Ini terjadi di
  FX7 **dan** FX8, dan pemilik repositori memperhatikannya dua kali. Aturannya keras:

  - Komentar yang sudah ada di sebuah berkas **tetap di sana**. Kalau kodenya kamu ubah,
    perbarui komentarnya seperlunya — jangan menggantinya dengan versi yang lebih pendek.
  - Kalau kamu **memindahkan** kode ke berkas baru, **komentarnya ikut pindah**, utuh.
    FX7 memindahkan `ROLES` ke `packages/shared` dan meninggalkan penjelasan kenapa tidak
    ada peran ketiga. FX8 memindahkan `mediaSource` dan mengganti *"a signed `url`, which
    is the only way a file on this machine is readable at all"* — sebuah fakta keamanan —
    dengan *"handles signed url descriptors"*.
  - **Deskripsi fungsional bukan pengganti alasan.** "Renders prose notes for notebooks
    that have no contract" menjelaskan apa yang dilakukan kode, yang sudah bisa dibaca
    dari kodenya. Yang tidak bisa dibaca dari kode adalah *kenapa* — dan itu yang hilang.
  - Kalau sebuah komentar menurutmu **salah**, jangan diam-diam menghapusnya: perbaiki
    isinya, atau tulis di §9 bahwa kamu menghapusnya dan kenapa.

  Alasannya bukan selera. `RULES.md` proyek ini dibangun di atas kalimat *"a rule without
  its wreckage is advice"* — komentar di sini menyimpan bug yang pernah terjadi. Yang
  dihapus FX7 adalah catatan bug tata letak ponsel dari FX3; menghapusnya adalah mengundang
  bug itu kembali. **Diff yang menghapus baris komentar tanpa memindahkannya ke tempat lain
  akan ditolak saat review.**

### Keputusan yang sudah final

- **D-1 (F-106)**: tidak ada perubahan kode. F-106 hanya referensi ke F-050 yang sudah
  selesai. T-01 menulis tes yang **memverifikasi** perilaku yang dideskripsikan di rencana
  induk (produksi + tanpa daftar = sama-origin saja), menutup F-106 sebagai "diverifikasi
  benar", bukan "diperbaiki lagi". Satu celah sempit **dibiarkan dan disebutkan**
  (RULES §5.6), bukan diam-diam diperbaiki: perbandingan `NODE_ENV === "production"` jatuh
  ke cabang terbuka penuh untuk *apa pun* yang bukan persis string itu — termasuk env
  yang lupa diset atau nilai staging yang salah ketik. Mengetatkan ini berarti mengubah
  perilaku produksi tanpa diminta secara eksplisit oleh F-106, dan berisiko mematikan
  deployment yang sudah berjalan dengan `NODE_ENV` bukan `"production"` — di luar cakupan,
  dicatat sebagai temuan baru di §9 kalau relevan, bukan dieksekusi sepihak.
- **D-2 (F-107/F-108, pustaka)**: `express-rate-limit` ditambah sebagai dependency baru —
  satu-satunya di seluruh kontrak ini — dengan alasan eksplisit: pembatas laju yang benar
  (aman di bawah beban, benar mengekstrak IP di belakang proxy, tidak lupa membersihkan
  penghitung lama) adalah tepat jenis logika keamanan yang lebih aman dipakai dari pustaka
  teruji daripada ditulis tangan untuk kontrak sekali pakai ini.
- **D-3 (F-107)**: `POST /api/auth/login` dijaga `express-rate-limit` — window & max lewat
  env baru (`LOGIN_RATE_LIMIT_WINDOW_MS`, bawaan 15 menit; `LOGIN_RATE_LIMIT_MAX`, bawaan
  10 percobaan per IP per window), pola env-var sama seperti `MAX_UPLOAD_MB`. Respons saat
  kena batas: `429` dengan pesan yang menyebut kapan boleh coba lagi.
- **D-4 (F-108)**: `POST /hooks/:slug` dijaga limiter terpisah dari D-3, dengan `skip(req)`
  yang melakukan resolusi trigger+secret **yang sama** dengan yang sudah dilakukan
  `hooks.route.ts` (cari trigger dari `slug`, cek `trigger.secret_key` ada DAN
  `X-Webhook-Secret` yang dikirim cocok) — kalau keduanya benar, `skip` mengembalikan
  `true` (tidak dibatasi); kalau tidak, dibatasi. Ini berarti lookup trigger terjadi dua
  kali per request pada webhook yang berhasil (sekali di `skip`, sekali di handler) —
  diterima untuk skala aplikasi ini; benar lebih penting daripada satu query.
- **D-5 (F-109)**: panjang password minimum naik dari 8 ke **12**, di `createUser` dan
  `setPassword` sekaligus (satu angka, ditulis sekali kalau memungkinkan — pertimbangkan
  konstanta bersama `MIN_PASSWORD_LENGTH` di `auth.service.ts`, bukan literal `12` dua
  kali, supaya tidak mengulang pola RULES §5.16). **Tidak** menambah syarat komposisi
  (huruf besar/angka/simbol) — praktik keamanan saat ini (NIST SP 800-63B) menyarankan
  panjang di atas aturan komposisi, yang terbukti mendorong pola yang mudah ditebak
  (`Password1!`) alih-alih entropi sungguhan.
- **D-6 (F-110)**: rute baru `agent-tokens.route.ts` **hanya membungkus**
  `agentTokensService` yang sudah ada (`issue`, `list`, `revoke`), dijaga
  `requireRole("creator")` seperti CLI-nya secara implisit sudah mengasumsikan. UI-nya
  satu tab baru di `ResourcesPage.tsx` — tab kelima kalau FX7 sudah menambah "Accounts"
  (tab keempat), mengikuti pola `TabsTrigger`/`TabsContent` yang sama. Token plain-text
  hanya ditampilkan **sekali** saat baru diterbitkan (pola yang sama seperti CLI
  `agent-token.ts` mencetak sekali) — tidak pernah disimpan/ditampilkan ulang setelahnya.
- **D-7 (F-111, mekanisme lock)**: **tidak** memakai subcommand `uv pip compile` (belum
  diverifikasi ada/berlaku di versi `uv` yang dipakai proyek ini — jangan diasumsikan).
  Sebagai gantinya: pakai jalur eksekusi `uv run --with` yang **sudah ada**, tapi
  `wrapper` Python yang dikirim ke `python -c` diberi tambahan baris yang melaporkan versi
  resolusi tiap paket lewat `importlib.metadata.version(name)`, dikirim lewat jalur
  keluaran yang sudah dipisah dari output sel (cek bagaimana `worker`/`python-runner`
  memisahkan stdout sel dari metadata proses — jangan bikin jalur baru kalau satu sudah
  ada). Hasilnya (`["pandas==2.2.3", ...]`) disimpan sebagai `locked_packages` pada baris
  versi yang di-deploy. Redeploy menjalankan resolusi baru dan menimpa `locked_packages`;
  run editor/draf (belum di-deploy) tetap memakai `packages:` mentah seperti sekarang.
- **D-8 (F-112, daftar tolak)**: `DENIED_BUILTINS = new Set(['child_process',
  'worker_threads', 'cluster', 'vm', 'inspector', 'repl'])` — dicek di `scopedRequire`
  **sebelum** pemeriksaan `isBuiltin`, memblokir keenamnya tanpa syarat, apa pun peran
  yang menjalankannya (bukan hanya untuk `viewer` — kalau berbahaya untuk viewer, ia
  berbahaya untuk siapa pun, dan mengecualikan creator hanya memindahkan celahnya).
  Builtin lain (`fs`, `net`, `os`, `path`, dst.) **tetap diizinkan** — daftar tolak ini
  sengaja sempit, menutup jalur eksekusi-proses-sewenang paling langsung
  (`child_process`) dan yang setara dengannya (`worker_threads`, `cluster`), bukan
  mengubah model sandbox secara menyeluruh (itu proyek yang jauh lebih besar dan berisiko
  merusak notebook yang sudah berjalan, di luar cakupan FX9).
- **D-9 (F-113)**: kuota **per-notebook**, bukan global (teks temuan menyebut "folder",
  tunggal) — env baru `MAX_NOTEBOOK_STORAGE_MB` (bawaan 500), diperiksa di
  `notebook-files.service.ts` dan `storage.service.ts` sebelum menulis: jumlahkan ukuran
  `uploads/<notebookId>/` (rekursif) lewat `fs`, tolak dengan pesan yang jujur (menyebut
  angka bawaan dan cara menaikkannya lewat env) kalau unggahan baru akan melewati batas.
- **D-10 (F-114)**: `notebooksService.delete()` memanggil `fs.rmSync(path, {recursive:
  true, force: true})` untuk `uploads/<id>/` **dan** `notebooks/<id>/`, mengikuti pola
  yang sudah ada di `storage.service.ts`, setelah baris DB berhasil dihapus (urutan: DB
  dulu, filesystem kemudian — kalau penghapusan file gagal separuh jalan, tidak ada baris
  DB yatim yang menunjuk ke folder yang sudah hilang sebagian, karena baris DB-nya memang
  sudah tidak ada).

### Open questions

*(kosong. F-121 sudah diputuskan — kode menang, ditutup. F-098 bukan bagian FX9. Kalau
sesuatu di luar D-1..D-10 muncul saat mengerjakan, berhenti dan set BLOCKED — lihat §0
untuk syarat urutan cabang yang juga bisa memblokir sebelum task pertama pun dimulai.)*

## 4. Requirements & sukses

### In scope

- **RQ-01**: perilaku CORS produksi (F-050/F-106) diverifikasi lewat tes, dinyatakan
  benar atau dilaporkan salah — tidak diasumsikan.
- **RQ-02**: `POST /api/auth/login` dibatasi lajunya per IP. (F-107)
- **RQ-03**: `POST /hooks/:slug` dibatasi lajunya untuk request yang tidak punya secret
  webhook yang valid. (F-108)
- **RQ-04**: panjang password minimum naik ke 12 karakter, tanpa syarat komposisi baru.
  (F-109)
- **RQ-05**: token agent bisa diterbitkan, dilihat daftarnya, dan dicabut dari UI web,
  bukan cuma CLI. (F-110)
- **RQ-06**: `packages:` Python yang di-deploy terkunci ke versi tertentu; hanya redeploy
  yang bisa mengubahnya. (F-111)
- **RQ-07**: sel JS tidak bisa `require` modul di `DENIED_BUILTINS` (D-8), untuk peran
  mana pun. (F-112)
- **RQ-08**: unggahan baru ditolak kalau membuat folder `uploads/<notebookId>/` melewati
  kuota per-notebook. (F-113)
- **RQ-09**: menghapus sebuah notebook juga menghapus `uploads/<id>/` dan
  `notebooks/<id>/` miliknya dari disk. (F-114)

### Out of scope

- **F-121** — ditutup sebagai superseded atas keputusanmu sendiri (D-1 keputusan §0 dari
  sesi ini): "derived, not stored" di `fixtures.ts` menang, tidak ada kolom `is_fixture`
  ditambah.
- Mengetatkan `corsPolicy()` untuk `NODE_ENV` selain `"production"`/kosong — celah sempit
  yang disebutkan (D-1), tidak diperbaiki, karena berisiko mengubah perilaku deployment
  yang berjalan tanpa diminta eksplisit.
- Model sandbox JS menyeluruh (proses terisolasi, `vm.Context`, worker permission model) —
  D-8 hanya daftar-tolak sempit untuk modul yang paling berbahaya, bukan penulisan ulang
  arsitektur eksekusi.
- Kuota storage global lintas-notebook — hanya per-notebook (D-9).
- Rotasi/kedaluwarsa otomatis untuk token agent — RQ-05 hanya UI untuk kemampuan yang
  sudah ada (issue/list/revoke manual), tidak menambah kemampuan baru ke servicenya.
- `F-122` (docker-compose port postgres) — disebut di rencana induk dekat F-121 tapi bukan
  bagian F-106..F-114; sudah terverifikasi terikat ke `127.0.0.1` saja (aman), tidak
  butuh task.

### Definition of Done

- [ ] Semua RQ-01..RQ-09 terpenuhi
- [ ] Semua task T-01..T-11 berstatus DONE
- [ ] Setiap command Verify di §7 exit 0
- [ ] `pnpm --filter @zaa-tool/engine test` dan `pnpm --filter @zaa-tool/web test` exit 0
      penuh (regresi nol)
- [ ] `pnpm --filter @zaa-tool/engine run build` exit 0. **Jangan lewati ini dan
      jangan percaya hasil lama.** Tes berjalan lewat `tsx`, yang membuang tipe tanpa
      memeriksanya — suite yang hijau **tidak** membuktikan kode bisa dikompilasi. FX7
      menyerahkan engine yang `tsc`-nya gagal total sementara 29 berkas tesnya lulus,
      karena `build` hanya dijalankan sekali di task pertama lalu tidak pernah lagi.
      Jalankan lagi di task regresi terakhir, bukan hanya di awal.
- [ ] `pnpm --filter @zaa-tool/web run lint` tidak menambah error **baru**. (Ia sudah
      gagal dengan ~42 error di `dev` sejak sebelum milestone ini — utang lama, bukan
      milikmu. Jalankan sebelum mulai, catat jumlahnya, bandingkan di akhir. Jangan
      "memperbaiki" error yang bukan milikmu — itu di luar scope.)
- [ ] Tidak ada perubahan di luar scope §4 / path terlarang §5
- [ ] §9 Handoff diisi, termasuk SHA `dev` sebenarnya yang dipakai (§0.2)
- [ ] `PROGRESS.md` di-update 3–8 baris, dengan bukti terukur, menyebut eksplisit bahwa
      F-121 ditutup sebagai superseded dan kenapa, dan celah `NODE_ENV` CORS yang
      dibiarkan (D-1)
- [ ] `.plannings/RENCANA PERBAIKAN TOTAL v3.0.md` — baris `### FX9` (sekitar baris 975)
      dan baris F-121 (691-692) diberi catatan penutupan — F-121 ditandai "superseded,
      lihat komentar `fixtures.ts`", bukan dihapus dari daftar

### Dinyatakan gagal / berhenti jika

- **BLOCKED**: §0.1 gagal (FX7/FX8 belum ada di `dev`), atau keputusan di luar D-1..D-10.
- **NEEDS_REVIEW**: T-08 (daftar tolak builtin) menemukan notebook yang sudah di-deploy di
  workspace ini memanggil salah satu modul di `DENIED_BUILTINS` secara sah — jangan
  mematikan notebook orang secara diam-diam, laporkan dan berhenti di task itu.

## 5. Batas kerja

### Boleh ubah

- `packages/engine/src/server/app.ts` (hanya untuk T-01, tidak mengubah `corsPolicy()`)
- `packages/engine/src/routes/auth.route.ts`
- `packages/engine/src/routes/hooks.route.ts`
- `packages/engine/src/services/auth.service.ts`
- `packages/engine/src/routes/agent-tokens.route.ts` (baru)
- `packages/engine/src/controllers/agent-tokens.controller.ts` (baru)
- `packages/engine/src/server/app.ts` (mount rute baru)
- `packages/web/src/components/pages/ResourcesPage.tsx`
- `packages/web/src/components/resources/AgentTokensTab.tsx` (baru)
- `packages/web/src/hooks/useAgentTokens.ts` (baru)
- `packages/engine/src/core/python-runner.ts`
- `packages/engine/src/services/notebooks.service.ts`
- `packages/engine/src/db/initializer.ts`
- `packages/engine/src/core/worker-boot.ts`
- `packages/engine/src/services/notebook-files.service.ts`
- `packages/engine/src/services/storage.service.ts`
- `packages/engine/src/config.ts`
- `packages/engine/package.json` (tambah `express-rate-limit` — satu-satunya dependency
  baru yang diizinkan di kontrak ini, D-2)
- `packages/engine/tests/security-hardening.test.ts` (baru)
- `packages/web/tests/agent-tokens-tab.test.tsx` (baru)
- `PROGRESS.md`, `.plannings/RENCANA PERBAIKAN TOTAL v3.0.md`, `RULES.md`

### Dilarang

- **Menghapus atau memperpendek komentar yang sudah ada** (INV-6). Periksa sendiri sebelum
  menandai task DONE:
  ```bash
  git diff dev --  '*.ts' '*.tsx' | grep -E "^-" | grep -E "(\*|//|\{/\*)"
  ```
  Kalau perintah itu mencetak sesuatu yang bukan pindahan ke berkas lain, kembalikan dulu.
- **Menanam data ke `initializer.ts`.** FX8 memasukkan dua notebook fixture ke migrasi
  skema, yang berjalan di **setiap** instalasi tool ini selamanya. `initDb()` membuat tabel
  dan kolom — tidak pernah baris. Fixture dibuat lewat API, di mesin yang membutuhkannya.
- Menambah kolom `is_fixture` atau apa pun terkait F-121 (ditutup, D-1 §0)
- Mengetatkan cabang `NODE_ENV` di `corsPolicy()` (Out of scope)
- Dependency baru selain `express-rate-limit`
- `packages/web/src/components/layout/Navbar.tsx`, `store/authStore.ts`,
  `components/pages/render/**`, `components/map/**` — di luar FX9 seluruhnya
- Mengubah `packages/shared/src/fixtures.ts` (keputusannya sudah final dan menang, D-1 §0)
- Menghapus atau menonaktifkan tes yang sudah hijau

## 6. Plan singkat

1. §0 dulu — pastikan `dev` sudah memuat FX7 dan FX8, potong branch, baca ulang
   `ResourcesPage.tsx` yang sekarang.
2. T-01 (verifikasi CORS) — murni tes, tidak bergantung apa pun.
3. T-02, T-03 (rate limit) — satu dependency baru dipasang di T-02, dipakai lagi T-03.
4. T-04 (password) — independen.
5. T-05, T-06 (token agent: backend lalu UI).
6. T-07 (Python lock), T-08 (JS denylist), T-09 (kuota), T-10 (hapus berkas) — independen
   satu sama lain, bisa urutan apa pun.
7. T-11 regresi penuh.

Risiko utama:
- T-08 bisa mematahkan notebook yang sudah ada dan sah memakai `child_process`/`fs` untuk
  sesuatu yang legitimate.

Mitigasi:
- T-08 wajib memeriksa notebook yang ter-deploy di workspace ini dulu (lihat NEEDS_REVIEW)
  sebelum mengaktifkan daftar tolak, bukan menyalakannya lalu melihat apa yang rusak.

Risiko kedua:
- D-4 (rate limit webhook) menduplikasi logika resolusi trigger+secret yang sudah ada di
  `hooks.route.ts` — kalau salah satu berubah nanti dan yang lain lupa, keduanya akan
  tidak sepakat (pola RULES §5.16 lagi).

Mitigasi:
- T-03 memfaktor-ulang resolusi trigger+secret jadi satu fungsi yang dipanggil **baik**
  oleh `skip()` **maupun** oleh handler asli, bukan menyalin logikanya dua kali.

## 7. Tasks (kerjakan berurutan)

### T-01 — Verifikasi CORS (bukan perbaikan)
- Status: DONE
- Depends: —
- RQ: RQ-01
- Lakukan: tulis tes yang memanggil `corsPolicy()` langsung (bukan lewat HTTP penuh) untuk
  tiga kombinasi: `NODE_ENV=production` + `CORS_ORIGINS` kosong → `{origin: false}`;
  `NODE_ENV=production` + `CORS_ORIGINS=https://a.com,https://b.com` → daftar itu;
  `NODE_ENV` bukan `production` + `CORS_ORIGINS` kosong → `{origin: true, credentials:
  true}`. Tidak ada perubahan pada `corsPolicy()` itu sendiri.
- Selesai jika: ketiga kasus lulus persis seperti dideskripsikan; kalau salah satu TIDAK
  cocok dengan apa yang dijelaskan §3, itu artinya F-050 tidak benar-benar selesai —
  laporkan sebagai temuan di §9 dan hentikan task ini sebagai BLOCKED, jangan
  memperbaikinya diam-diam di luar apa yang direncanakan D-1.
- Verify:
```bash
pnpm --filter @zaa-tool/engine test security-hardening
```

### T-02 — Rate limit login
- Status: DONE
- Depends: —
- RQ: RQ-02
- Lakukan: tambah `express-rate-limit` ke `packages/engine/package.json`. Pasang
  middleware di `POST /api/auth/login` (D-3) — window/max dari env baru dengan bawaan
  yang disebut D-3, `429` dengan pesan jelas saat kena batas.
- Selesai jika: memanggil login gagal berkali-kali melewati `LOGIN_RATE_LIMIT_MAX` dalam
  satu window dari IP yang sama mengembalikan `429`, bukan `401` biasa, pada percobaan
  yang melewati batas; percobaan yang berhasil (password benar) tidak ikut terblokir oleh
  percobaan gagal sebelumnya di bawah batas.
- Verify:
```bash
pnpm --filter @zaa-tool/engine test security-hardening
```

### T-03 — Rate limit webhook tanpa secret
- Status: DONE
- Depends: T-02
- RQ: RQ-03
- Lakukan: faktor-ulang resolusi trigger+validasi-secret di `hooks.route.ts` (baris
  ~96-125) jadi satu fungsi yang bisa dipanggil dari `skip()` limiter (D-4) maupun dari
  alur permintaan asli — jangan menyalin logikanya. Pasang limiter kedua, terpisah dari
  T-02, di `POST /hooks/:slug`.
- Selesai jika: webhook dengan `secret_key` yang valid dan `X-Webhook-Secret` yang cocok
  tidak pernah kena batas walau dipanggil berkali-kali; webhook tanpa `secret_key`, atau
  dengan secret yang salah, kena `429` setelah melewati batas.
- Verify:
```bash
pnpm --filter @zaa-tool/engine test security-hardening
```

### T-04 — Password minimum 12
- Status: TODO
- Depends: —
- RQ: RQ-04
- Lakukan: satu konstanta `MIN_PASSWORD_LENGTH = 12` di `auth.service.ts`, dipakai di
  `createUser`, `setPassword`, **dan `changePassword`** (D-5) — ganti literal `8` di
  **ketiga** tempat menjadi referensi ke konstanta itu.

  Catatan (ditambahkan reviewer 2026-08-07): dulu tertulis "kedua tempat". FX7 menambah
  `changePassword()` dengan literal `8` ketiganya. Jangan percaya angka ini — `grep -n
  "length < " packages/engine/src/services/auth.service.ts` dulu dan naikkan **semua**
  yang muncul. Meninggalkan satu jalur password di 8 karakter sementara dua lainnya 12
  adalah persis kelas bug RULES §5.16.
- Selesai jika: password 11 karakter ditolak dengan pesan yang menyebut 12; password 12
  karakter apa adanya (tanpa huruf besar/angka/simbol) diterima.
- Verify:
```bash
pnpm --filter @zaa-tool/engine test security-hardening
```

### T-05 — Rute & controller token agent
- Status: TODO
- Depends: —
- RQ: RQ-05 (bagian server)
- Lakukan: `agent-tokens.controller.ts` membungkus `agentTokensService.issue/list/revoke`
  (D-6) — tipis, validasi → service → respons. Rute baru
  `authRouter`-setara di `agent-tokens.route.ts`: `POST /`, `GET /`, `DELETE /:id`, semua
  `authMiddleware` + `requireRole("creator")`. Mount di `server/app.ts` di bawah
  `/api/agent-tokens`.
- Selesai jika: seorang creator bisa `POST /api/agent-tokens` dan menerima token
  plain-text sekali, `GET` mendaftar tanpa plain-text-nya, `DELETE /:id` mencabutnya;
  seorang viewer ditolak `403` di ketiganya.
- Verify:
```bash
pnpm --filter @zaa-tool/engine test security-hardening
```

### T-06 — UI token agent
- Status: TODO
- Depends: T-05
- RQ: RQ-05 (bagian UI)
- Lakukan: **baca dulu bentuk `ResourcesPage.tsx` yang sekarang** (§0.5 — mungkin sudah
  punya tab "Accounts" dari FX7). Tambah satu tab lagi, "Agent Tokens", pola sama seperti
  tab lain. `useAgentTokens.ts` (pola sama seperti `useSecrets.ts`) memanggil endpoint
  T-05. `AgentTokensTab.tsx` — form terbitkan (nama/label + role), tabel daftar (tanpa
  nilai token), tombol cabut per baris. Token yang baru diterbitkan ditampilkan **sekali**
  di layar dengan peringatan bahwa itu tidak akan terlihat lagi.
- Selesai jika: menerbitkan token dari UI menampilkan nilainya sekali; me-refresh
  halaman/menutup dialog membuatnya tidak terlihat lagi di mana pun kecuali sistem yang
  memakainya; mencabut token dari UI membuatnya tidak lagi valid (uji lewat endpoint yang
  dijaga token agent, kalau ada salah satu di tes engine yang sudah ada — kalau tidak,
  cukup uji `list` tidak lagi menyertakannya).
- Verify:
```bash
pnpm --filter @zaa-tool/web test agent-tokens-tab
```

### T-07 — Kunci versi `packages:` Python saat deploy
- Status: TODO
- Depends: —
- RQ: RQ-06
- Lakukan: sesuai D-7 — tambah kolom penyimpan `locked_packages` pada baris versi yang
  di-deploy (`initializer.ts`, pola `DO $$ ALTER TABLE ...` yang sama seperti kolom lain).
  Saat deploy, jalankan resolusi lewat jalur `uv run --with` yang sudah ada, tangkap versi
  resolusi tiap paket via `importlib.metadata.version`, simpan ke kolom itu. Saat
  menjalankan **versi yang di-deploy** (bukan draft editor), `python-runner.ts` memakai
  `locked_packages` untuk `--with`, bukan `packages:` mentah dari dokumen.
- Selesai jika: men-deploy sebuah notebook dengan `packages: [pandas]` menyimpan string
  versi konkret (`pandas==x.y.z`); menjalankan versi yang di-deploy itu berkali-kali
  memakai versi yang sama persis walau resolusi `uv` yang mentah bisa saja berbeda di
  waktu lain; redeploy menghasilkan `locked_packages` baru; run draft di editor (belum
  di-deploy) tidak terpengaruh, tetap memakai `packages:` mentah seperti sekarang.
- Verify:
```bash
pnpm --filter @zaa-tool/engine test security-hardening
```

### T-08 — Daftar tolak builtin berbahaya di sel JS
- Status: TODO
- Depends: —
- RQ: RQ-07
- Lakukan: **sebelum** mengaktifkan, periksa notebook yang ter-deploy di database
  workspace ini (lewat `notebooksService`/query langsung di skrip sementara, bukan
  menebak) apakah ada yang memanggil `require('child_process')`/`worker_threads`/
  `cluster`/`vm`/`inspector`/`repl` di kode sel JS-nya. Kalau ADA yang memakainya secara
  aktif — **jangan aktifkan daftar tolak**, tandai task ini `NEEDS_REVIEW` di §9 dan
  lanjut ke task lain, biarkan milestone ini selesai tanpa T-08 daripada mematikan
  notebook orang. Kalau TIDAK ada: tambah `DENIED_BUILTINS` (D-8) ke `scopedRequire` di
  `worker-boot.ts`, dicek sebelum `isBuiltin`.
- Selesai jika: `require('child_process')` dari dalam sel JS melempar error yang jelas
  ("... is not available in a notebook cell...") bukan berhasil; `require('fs')` dan
  builtin lain di luar daftar tetap bekerja seperti sekarang (regresi nol untuk yang
  diizinkan).
- Verify:
```bash
pnpm --filter @zaa-tool/engine test security-hardening
```
Bite-test wajib: hapus sementara satu entri dari `DENIED_BUILTINS` (mis. `'vm'`),
pastikan tes untuk entri itu merah, baru kembalikan.

### T-09 — Kuota storage per-notebook
- Status: TODO
- Depends: —
- RQ: RQ-08
- Lakukan: `MAX_NOTEBOOK_STORAGE_MB` baru di `config.ts` (pola `maxUploadBytes()`, D-9).
  Sebelum menulis berkas baru di `notebook-files.service.ts` dan `storage.service.ts`,
  jumlahkan ukuran `uploads/<notebookId>/` yang sudah ada, tolak dengan pesan jujur
  (angka bawaan + cara menaikkan lewat env) kalau unggahan baru melewati batas.
- Selesai jika: mengunggah berkas yang membuat total folder melewati
  `MAX_NOTEBOOK_STORAGE_MB` ditolak sebelum ditulis (folder tidak bertambah besarnya);
  unggahan yang masih di bawah batas tetap berhasil seperti sekarang.
- Verify:
```bash
pnpm --filter @zaa-tool/engine test security-hardening
```

### T-10 — Hapus notebook, hapus berkasnya
- Status: TODO
- Depends: —
- RQ: RQ-09
- Lakukan: di `notebooksService.delete()`, setelah baris DB berhasil dihapus (D-10),
  tambah `fs.rmSync` untuk `uploads/<id>/` dan `notebooks/<id>/`, meniru pola
  `storage.service.ts`.
- Selesai jika: menghapus sebuah notebook yang punya berkas ter-unggah membuat kedua
  folder itu tidak ada lagi di disk; menghapus notebook yang tidak pernah punya berkas
  (folder tidak pernah ada) tidak melempar error.
- Verify:
```bash
pnpm --filter @zaa-tool/engine test security-hardening
```

### T-11 — Regresi penuh
- Status: TODO
- Depends: T-01 sampai T-10
- RQ: semua
- Lakukan: tidak ada kode baru. Jalankan suite penuh dua paket.
- Selesai jika: keduanya exit 0.
- Verify:
```bash
pnpm --filter @zaa-tool/engine run build
pnpm --filter @zaa-tool/engine test
pnpm --filter @zaa-tool/web test
pnpm --filter @zaa-tool/web run lint
```

## 8. Aturan eksekusi (loop)

1. Set `status: IN_PROGRESS` — **hanya setelah §0.1 terpenuhi**, tidak sebelumnya
2. Ambil task TODO dengan dependency terpenuhi
3. Implementasi minimal sesuai task
4. Jalankan Verify task itu
5. Jika lulus: ubah `Status: TODO` task itu jadi `Status: DONE` di file ini, commit satu
   kali (§0.4), catat bukti di §9
6. Jika gagal: perbaiki dalam scope; jangan melebar
7. Jika butuh keputusan di luar D-1..D-10, atau §0.1 gagal: status milestone = BLOCKED,
   isi §9, berhenti
8. Ulangi sampai T-01..T-10 DONE (atau T-08 di-`NEEDS_REVIEW` sesuai instruksinya
   sendiri) → jalankan T-11
9. Kalau DoD penuh: `status: DONE` (atau `NEEDS_REVIEW` kalau T-08 memicu itu), isi §9,
   update `PROGRESS.md` dan `.plannings/RENCANA PERBAIKAN TOTAL v3.0.md`, berhenti. Jangan
   merge ke `dev`.

Long-run: jangan berhenti untuk konfirmasi di antara task selama task ada di dalam §5 dan
tidak menyentuh F-121/F-098. Kalau sesi terputus, baca ulang §7, lanjutkan dari task
pertama yang belum DONE.

Ini kontrak terakhir dari rangkaian FX1-FX9 di rencana induk. Kalau DoD penuh di sini,
seluruh daftar `[terbukti]`/`[terbaca]` yang tersisa di rencana induk sudah habis kecuali
Bagian J (F-115..F-120, F-122, kualitas & proses) dan Bagian K (F-123..F-130, belum
diperiksa sama sekali) — keduanya **tidak** ada di kontrak manapun sejauh ini dan bukan
tanggung jawab task apa pun di FX9. Sebutkan itu di §9, jangan diam-diam dianggap selesai.

## 9. Handoff / log (diisi executor)

### Status akhir
DONE | BLOCKED | NEEDS_REVIEW

### SHA `dev` sebenarnya dipakai (§0.2)
...

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

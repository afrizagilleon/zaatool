---
id: FX7
title: Akun — CLI, undangan, nonaktifkan, sesi, ganti password
status: IN_PROGRESS          # READY | IN_PROGRESS | DONE | BLOCKED | NEEDS_REVIEW
baseline_branch: dev
baseline_commit: 697269e7f3abec90715c077417ab66d199401c57
work_branch: fx7-akun   # dibuat dari baseline_commit — lihat §0
owner_author: claude
executor: <agent-lain>
last_updated: 2026-08-07
---

# FX7 — Akun

## 0. Cabang kerja (baca sebelum §1)

FX7 adalah yang **pertama** dari rangkaian FX7→FX8→FX9 — aman dipotong dari `dev` apa
adanya, tidak ada milestone lain yang harus lebih dulu masuk.

1. Buat branch `fx7-akun` dari `dev` pada commit di `baseline_commit` atas. Kalau `dev`
   sudah bergerak sejak itu, catat SHA yang sebenarnya dipakai di §9 — bukan blocker,
   FX7 tidak bergantung pekerjaan lain.
```bash
git checkout dev
git pull --ff-only 2>/dev/null || true
git rev-parse HEAD   # catat SHA ini di §9 sebagai baseline yang sebenarnya dipakai
git checkout -b fx7-akun
```
2. Kerja di branch itu. **Jangan commit ke `dev` langsung. Jangan push. Jangan buat PR** —
   itu langkah manusia setelah §9 diisi.
3. Commit satu kali per task yang lulus Verify-nya (pesan semantik, tanpa atribusi AI,
   RULES.md §3) — ini yang membuat sesi bisa dilanjutkan dari titik terakhir kalau
   terputus: baca `Status:` tiap task di §7, lanjutkan dari yang pertama belum `DONE`.

## 1. Mission

Selesaikan **F-085 sampai F-094** dari `.plannings/RENCANA PERBAIKAN TOTAL v3.0.md`
(bagian G, baris 581-610): sepuluh celah di sekitar akun pengguna. Konkretnya, di akhir
milestone ini harus ada di codebase:

- CLI bisa menentukan password sendiri (`--password`) atau mengetiknya tanpa digemakan ke
  layar, dan bisa membuat akun baru — tanpa `curl`.
- Seorang creator bisa membuat, melihat daftar, dan menonaktifkan akun dari UI (bukan cuma
  API yang sudah ada dan tidak dipakai siapa pun).
- Akun yang dinonaktifkan, dan peran yang baru diganti, berlaku pada permintaan berikutnya
  — tidak menunggu logout atau token 24 jam habis sendiri.
- Siapa pun yang sudah login bisa mengganti password miliknya sendiri.
- Seorang viewer diberi tahu, di layar, kenapa menunya lebih pendek.
- Sesi yang berakhir tidak lagi mati diam-diam — pengguna diberi tahu dan dikembalikan ke
  layar login.
- Respons `403` tampil sebagai kalimat yang bisa dibaca, bukan gagal diam-diam.

Bukan tujuan proyek secara keseluruhan; hanya milestone ini (FX7). FX8 (sisa halaman &
renderer) dan FX9 (keamanan & kebersihan) adalah kontrak lain, belum ditulis.

## 2. Baca dulu (wajib, berurutan)

1. File ini (seluruhnya)
2. `RULES.md` — hanya bagian **"5. What 'done' means"**: khususnya 5.9 (tes yang belum
   pernah dilihat merah adalah dekorasi — bite-test setiap tes baru), 5.15/5.16 (nilai yang
   dinyatakan di dua tempat akan berselisih — relevan karena `active`/`role` sekarang hidup
   di DB, JWT, dan tipe frontend sekaligus), dan 5.13 (perbaikan yang benar pindah satu
   lapis ke bawah, bukan diingat oleh tiap pemanggil — pola yang dipakai kontrak ini di D-1).
3. `ARCHITECTURE.md` — hanya: "Entry point and composition root" (~baris 71-90), baris
   `auth.service.ts` / `authStore.ts` di tabel "Key services" (~779-846), dan "TypeScript
   standards" / "File naming conventions" (~1024-1038).
4. `DEVELOPMENT.md` — bagian "Tests" (~104-112): `pnpm test` menjalankan engine lalu web.
5. Kode di path yang disebut di §5, ditambah dua contoh pola tes untuk ditiru bentuknya
   (bukan diubah): `packages/engine/tests/notebook-deploy.test.ts` (pola tes engine: proses
   Node polos + `createApp()` + `check()` sendiri, tanpa framework) dan
   `packages/web/tests/map-boxes.test.tsx` (pola tes web: vitest `describe/it/expect`).

Jangan membaca seluruh repo "untuk jaga-jaga". Jangan mengubah file di luar §5 kecuali
task memintanya.

## 3. Context ringkas (fakta saat ini)

### Perilaku sekarang

- CLI `reset-password` hanya menghasilkan password acak (`packages/engine/scripts/reset-password.ts:25-28`); tidak ada flag untuk menentukan sendiri, tidak ada mode interaktif.
- Tidak ada perintah CLI untuk membuat akun baru. Satu-satunya jalan adalah `curl` ke `POST /api/auth/users`.
- `POST /api/auth/users` (buat) dan `GET /api/auth/users` (daftar) sudah ada, sudah dijaga `requireRole('creator')` (`auth.route.ts:14-15`), tapi tidak ada UI yang memanggilnya.
- Tidak ada cara menonaktifkan atau menghapus akun — tidak di DB, tidak di service, tidak di API, tidak di UI. Tabel `users` tidak punya kolom untuk itu.
- `authMiddleware` (`packages/engine/src/middleware/auth.middleware.ts`) mempercayai penuh isi JWT (`id`, `username`, `role`) dan tidak pernah membaca ulang database setelah `jwt.verify`. Akibatnya: peran yang baru diganti di DB baru berlaku setelah pengguna login ulang (F-090); dan akun yang baru dinonaktifkan tetap bisa dipakai sampai token 24 jamnya kedaluwarsa sendiri.
- Token berumur `"24h"` — string literal di `auth.service.ts:102` — tidak ada endpoint refresh, dan tidak ada penanganan di frontend saat token itu kedaluwarsa di tengah sesi. `checkAuth()` memanggil `logout()` kalau `/auth/me` gagal, tapi hanya dipanggil saat start aplikasi; panggilan API lain yang pulang `401` di tengah sesi tidak memicu apa pun selain error generik di pemanggilnya masing-masing.
- Peran hanya terlihat di satu tempat di layar: dialog "User Profile" di `Navbar.tsx:174-210`. Navbar menyaring tab `notebooks`/`resources` untuk non-creator (`Navbar.tsx:60`) tanpa keterangan apa pun di layar tentang kenapa.
- Tidak ada halaman/form ganti password sendiri di mana pun.
- Tidak ada penanganan `403` yang seragam di frontend. Pesan servernya sendiri sebenarnya sudah manusiawi (`require-role.ts:29` → `"This needs a creator account. Yours is viewer."`), tapi hanya sampai ke layar kalau si pemanggil kebetulan merender `error` dari state. Pola itu sudah ada di `Login.tsx:106-108,215-217` (`{(localError || error) && <div>{localError || error}</div>}`) tapi belum dipakai di layar mana pun yang akan dibuat FX7 ini.

### Peta kode relevan

| Area | Path | Catatan |
|---|---|---|
| CLI reset password | `packages/engine/scripts/reset-password.ts` | generate-only, tidak baca stdin |
| CLI baru (belum ada) | `packages/engine/scripts/create-user.ts` | file baru — T-07 |
| Skrip npm | `packages/engine/package.json:6-13` | tambah entri `"create-user"` di `scripts` |
| Skema tabel `users` | `packages/engine/src/db/initializer.ts:205-224` | pola `DO $$ ALTER TABLE ... EXCEPTION WHEN duplicate_column THEN null; END $$;` sudah dipakai untuk `role`, dipakai lagi untuk `active` |
| Service akun | `packages/engine/src/services/auth.service.ts` | `createUser`, `login`, `setPassword`, `setRole`, `listUsers`, `verifyToken` — semua logika di sini |
| Middleware token | `packages/engine/src/middleware/auth.middleware.ts` | titik yang harus mulai membaca ulang DB (D-1) |
| Middleware peran | `packages/engine/src/middleware/require-role.ts` | sudah benar — **jangan diubah** |
| Controller | `packages/engine/src/controllers/auth.controller.ts` | `inviteUser`, `listUsers`, `getMe`, `login`, `register` |
| Rute | `packages/engine/src/routes/auth.route.ts` | daftar endpoint `/api/auth/*` |
| Tipe bersama (belum ada) | `packages/shared/src/auth.ts` | file baru — T-00 |
| Ekspor shared | `packages/shared/src/index.ts` | tambah satu baris `export * from "./auth.js";` |
| Fetch interceptor + state auth | `packages/web/src/store/authStore.ts` | `login`, `logout`, `checkAuth`, interceptor `window.fetch` di baris 122-140 |
| Halaman Resources | `packages/web/src/components/pages/ResourcesPage.tsx` | pola 3 tab yang sudah ada (`secrets`/`skills`/`files`); tab ke-4 `accounts` masuk sini |
| Panel per-tab (pola untuk ditiru) | `packages/web/src/components/resources/SecretsTab.tsx`, `SkillsTab.tsx`, `StorageTab.tsx` | bentuk komponen `AccountsTab.tsx` mengikuti ini |
| Hook per-domain (pola untuk ditiru) | `packages/web/src/hooks/useSecrets.ts`, `useSkills.ts`, `useStorage.ts` | bentuk `useAccounts.ts` mengikuti ini |
| Navbar + dialog profil | `packages/web/src/components/layout/Navbar.tsx` | baris 24-29 (daftar tab), 60 (filter creator-only), 174-210 (dialog profil) — F-091 dan form ganti password (F-093) masuk di sini |
| Pola tampilan error | `packages/web/src/components/pages/Login.tsx:106-108,215-217` | pola yang harus ditiru untuk RQ-10 |

### Invariant (jangan dilanggar)

- **INV-1**: `packages/shared` adalah satu-satunya jalur tipe antara `engine` dan `web`
  (CLAUDE.md, aturan lintas-paket). Tipe akun yang dipakai kedua sisi wajib didefinisikan
  di sana sekali, tidak dua kali.
- **INV-2**: Tidak ada penghapusan akun secara permanen (`DELETE FROM users`, atau
  drop kolom). Setiap cell notebook menyimpan `author: {by, at}`
  (`ARCHITECTURE.md:363-368`) yang menunjuk ke `user.id` — menghapus baris user merusak
  jejak itu. "Menghapus/menonaktifkan" (F-089) berarti **nonaktifkan** (kolom `active`,
  soft), tidak pernah hapus baris.
- **INV-3**: `controllers/` tetap tipis: validasi → panggil service → respons. Tidak ada
  query SQL langsung di controller untuk endpoint baru (`getMe` yang sudah ada memakai
  `pool` langsung — itu utang lama, jangan ditiru).
- **INV-4**: `middleware/` tidak memanggil `pool.query` langsung. Pembacaan ulang DB di
  `authMiddleware` lewat method baru di `authService`.
- **INV-5**: setiap fungsi async menangani error-nya; tidak ada floating promise
  (CLAUDE.md).
- **INV-6**: tidak ada `any` — sempitkan lewat `unknown` + type guard (CLAUDE.md; `isRole`
  yang sudah ada di `auth.service.ts:19-21` adalah pola yang harus ditiru untuk `active`
  kalau perlu penjagaan serupa).
- **INV-7**: tidak ada gaya inline di web — Tailwind saja (RULES.md §1).
- **INV-8**: akun uji yang dibuat **dan dihapus di dalam satu proses tes yang sama** boleh
  dihapus di akhir tes itu — pola persis `notebook-deploy.test.ts` (baris terakhir:
  `for (const id of created) await notebooksService.delete(id)`). Ini **beda** dari
  larangan "notebook `zz-` tidak pernah dihapus", yang berlaku untuk fixture yang sengaja
  ditinggal di workspace sebagai bukti manual antar-sesi. Akun uji di kontrak ini memakai
  pola pertama: buat, uji, hapus di akhir file tes yang sama proses.

### Keputusan yang sudah final

- **D-1 (F-090 + F-089 sekaligus)**: `authMiddleware` berhenti mempercayai `role` di dalam
  JWT. Setelah `verifyToken` sukses, tambahkan satu pembacaan DB lewat method baru
  `authService.currentUser(id)` yang mengembalikan `{id, username, role, active}` saat itu
  juga, atau `null` kalau baris sudah tidak ada (`401`). `req.user.role` diisi dari hasil
  itu, **bukan** dari klaim token. Kalau `active === false` → jawab `403` dengan pesan yang
  menyebut alasan ("This account has been deactivated."), bukan `401` — tokennya sah,
  izinnya yang dicabut. Satu query tambahan per request yang sudah lolos JWT; skala aplikasi
  ini (alat internal) tidak butuh caching untuk ini.
- **D-2 (F-089, caranya)**: kolom baru `active BOOLEAN NOT NULL DEFAULT true` di `users`,
  ditambah lewat pola `DO $$ ... EXCEPTION WHEN duplicate_column ...` yang sama seperti
  `role`. Endpoint baru: `PATCH /api/auth/users/:id` dengan body `{active: boolean}`,
  dijaga `requireRole('creator')`. Seorang creator **tidak boleh** menonaktifkan akunnya
  sendiri yang sedang login (`req.user.id === req.params.id` → `400`) — mencegah
  kunci-diri-sendiri. Tidak diperiksa apakah itu creator aktif terakhir di sistem — itu di
  luar cakupan (lihat Out of scope).
- **D-3 (F-093)**: endpoint baru `POST /api/auth/me/password`, body
  `{currentPassword, newPassword}`, dijaga `authMiddleware` saja (siapa pun yang login
  boleh ganti password sendiri, tidak perlu peran tertentu). `authService` mendapat method
  baru `changePassword(userId, currentPassword, newPassword)` yang memverifikasi
  `currentPassword` lewat `bcrypt.compare` sebelum menyimpan yang baru. UI-nya masuk ke
  dialog "User Profile" yang sudah ada di `Navbar.tsx` — bukan halaman baru.
- **D-4 (F-092, dibatasi)**: perbaikan "sesi mati diam-diam" berhenti di **mendeteksi dan
  mengabarkan**, bukan token-refresh. Interceptor `window.fetch` di `authStore.ts`
  diperluas: kalau respons dari URL yang mengandung `/api/` dan sudah membawa token pulang
  `401`, panggil aksi baru `sessionExpired()` — membersihkan token/user seperti `logout()`,
  **dan** mengisi `error` dengan pesan yang dibaca layar login ("Sesi berakhir. Masuk
  lagi."). Rotasi refresh-token adalah keputusan keamanan yang lebih besar dan sengaja
  **tidak** masuk cakupan FX7 (lihat Out of scope) — catatan F-092 di rencana induk sendiri
  tidak menuliskan solusi yang diminta, hanya faktanya.
- **D-5 (letak UI akun)**: tab baru "Accounts" di `ResourcesPage.tsx` (creator-only karena
  tab Resources itu sendiri sudah creator-only), mengikuti pola `SecretsTab`/`useSecrets`
  yang sudah ada. Bukan halaman/route baru, bukan item navbar baru.
- **D-6 (F-091, letak teks)**: satu kalimat penjelas ditambahkan di dialog "User Profile"
  yang sudah ada, di bawah baris "System Role", muncul hanya kalau `user.role !== 'creator'`,
  menyebut tab mana yang disembunyikan.
- **D-7 (tipe bersama)**: `packages/shared/src/auth.ts` baru berisi
  `ROLES`/`Role = 'creator' | 'viewer'` dan
  `AccountUser = {id, username, email, role, active, createdAt}`, dipakai `authService`/
  `authController` di engine **dan** `useAccounts`/`authStore` di web — menggantikan
  `Role` yang sekarang hanya hidup di `auth.service.ts` dan `User` yang didefinisikan ulang
  secara longgar (`role?: string`, tanpa `active`) di `authStore.ts`.

### Open questions

*(kosong. Kalau satu muncul saat mengerjakan — keputusan yang tidak tercakup D-1..D-7 dan
bukan detail implementasi kecil — berhenti, set `status: BLOCKED`, tulis pertanyaannya di
§9, jangan menebak.)*

## 4. Requirements & sukses

### In scope

- **RQ-01**: CLI `reset-password` menerima `--password <value>`; tanpa flag itu, masuk
  mode interaktif yang membaca password dari stdin tanpa menggemakannya ke layar. (F-085)
- **RQ-02**: perintah CLI baru `create-user <username> --role creator|viewer
  [--password <value>]` yang membuat akun tanpa `curl`; tanpa `--password`, sama seperti
  RQ-01 — prompt interaktif tanpa echo. (F-086)
- **RQ-03**: seorang creator bisa membuat akun lewat UI, memanggil `POST /api/auth/users`
  yang sudah ada, apa adanya. (F-087 / B-20)
- **RQ-04**: seorang creator bisa melihat daftar akun lewat UI, memanggil
  `GET /api/auth/users` yang sudah ada, apa adanya. (F-088)
- **RQ-05**: seorang creator bisa menonaktifkan dan mengaktifkan-kembali sebuah akun, dari
  DB sampai UI; akun nonaktif kehilangan akses pada permintaan berikutnya, tidak menunggu
  token-nya habis sendiri. (F-089)
- **RQ-06**: perubahan peran (`role`) di DB berlaku pada permintaan berikutnya milik
  pengguna itu, tanpa logout ulang. (F-090)
- **RQ-07**: ada satu kalimat, terlihat di layar, yang menjelaskan kenapa menu seorang
  viewer lebih pendek. (F-091 / B-19)
- **RQ-08**: sesi yang berakhir (token ditolak server dengan `401`) tidak lagi mati diam-
  diam — pengguna diberi pesan dan dikembalikan ke layar login. (F-092, dibatasi sesuai D-4)
- **RQ-09**: siapa pun yang sudah login bisa mengganti password miliknya sendiri lewat UI,
  dengan memasukkan password lama. (F-093)
- **RQ-10**: respons `403` dari server tampil sebagai kalimat yang bisa dibaca di layar —
  bukan gagal diam-diam atau pesan generik — pada ketiga layar yang disentuh FX7 ini
  (panel akun, ganti password). (F-094)

### Out of scope

- Undangan lewat email. Tidak ada jalur email di proyek ini (lihat komentar di
  `reset-password.ts:8-11`); RQ-03 hanya membuat akun langsung dengan password yang
  ditentukan saat itu, tidak mengirim apa pun ke siapa pun.
- Rotasi refresh-token / perpanjangan sesi otomatis — opsi yang tidak dipilih untuk
  F-090/F-092 (lihat D-1, D-4).
- Mencegah menonaktifkan creator aktif terakhir yang tersisa di sistem — hanya mencegah
  menonaktifkan akun-diri-sendiri-yang-sedang-login (D-2).
- Toast/notifikasi global. Tidak ada pustaka toast di proyek ini; RQ-10 diselesaikan
  dengan pola tampilan-inline yang sudah ada di `Login.tsx`, bukan sistem baru.
- Peran baru selain `creator`/`viewer` — di luar cakupan, sesuai komentar di
  `auth.service.ts:9-15`.
- `notebook_shares` / `dashboard-password` — jalur otorisasi terpisah untuk tautan bagi,
  tidak disentuh milestone ini.
- Paginasi atau pencarian di daftar akun (RQ-04) — skala akun proyek internal ini kecil;
  kalau membesar, itu perbaikan terpisah.

### Definition of Done

Milestone **DONE** hanya jika semua ini benar:

- [ ] Semua RQ-01..RQ-10 terpenuhi
- [ ] Semua task T-00..T-13 berstatus DONE
- [ ] Setiap command Verify di §7 exit 0
- [ ] `pnpm --filter @zaa-tool/engine test` dan `pnpm --filter @zaa-tool/web test` exit 0
      secara penuh — bukan cuma file-file baru, seluruh suite (regresi nol)
- [ ] `pnpm --filter @zaa-tool/web run lint` exit 0
- [ ] Tidak ada perubahan di luar scope §4 / path terlarang §5
- [ ] §9 Handoff diisi
- [ ] `PROGRESS.md` di-update 3–8 baris, dengan angka/fakta terukur — ikuti gaya bagian
      FX6/FX6.1/FX6.2/FX6.3 yang sudah ada di file itu (measure, not adjective)
- [ ] `.plannings/RENCANA PERBAIKAN TOTAL v3.0.md` — baris `### FX7 — Akun` (sekitar baris
      973) diberi catatan selesai, format sama seperti FX6 dkk di atasnya

### Dinyatakan gagal / berhenti jika

- **BLOCKED**: ada keputusan di luar D-1..D-7 yang harus diambil manusia — berhenti, jangan
  menebak.
- **NEEDS_REVIEW**: kode selesai tapi ada risiko yang wajib ditinjau manusia — khususnya
  kalau D-1 (middleware membaca DB di setiap request) menunjukkan biaya performa yang
  terasa, atau kalau `changePassword`/`setActive` menyentuh path yang dipakai token agen
  MCP (lihat `ARCHITECTURE.md` bagian `agent-tokens.service.ts`) dengan cara yang tidak
  jelas amannya.

## 5. Batas kerja

### Boleh ubah

- `packages/shared/src/auth.ts` (baru), `packages/shared/src/index.ts`
- `packages/engine/src/db/initializer.ts`
- `packages/engine/src/services/auth.service.ts`
- `packages/engine/src/middleware/auth.middleware.ts`
- `packages/engine/src/controllers/auth.controller.ts`
- `packages/engine/src/routes/auth.route.ts`
- `packages/engine/scripts/**` (mencakup `reset-password.ts`, `create-user.ts` baru, dan
  satu modul kecil bersama untuk prompt password tanpa-echo, kalau T-06 memilih itu
  daripada menyalin fungsinya dua kali)
- `packages/engine/package.json` (hanya field `scripts`)
- `packages/engine/tests/auth-accounts.test.ts` (baru)
- `packages/web/src/store/authStore.ts`
- `packages/web/src/components/pages/ResourcesPage.tsx`
- `packages/web/src/components/resources/AccountsTab.tsx` (baru)
- `packages/web/src/hooks/useAccounts.ts` (baru)
- `packages/web/src/components/layout/Navbar.tsx`
- `packages/web/tests/accounts.test.tsx` (baru)
- `packages/web/tests/session-expiry.test.tsx` (baru)
- `PROGRESS.md`, `.plannings/RENCANA PERBAIKAN TOTAL v3.0.md` (hanya catatan penutupan FX7)
- `RULES.md` (hanya kalau sebuah bug yang ditemukan selama kerja layak jadi aturan baru,
  ikuti bentuk §5.x yang sudah ada — tidak wajib per task manapun di sini)

### Dilarang

- Mengubah `packages/engine/src/middleware/require-role.ts` (sudah benar per D-1)
- Mengubah bentuk request/response `POST /api/auth/users` atau `GET /api/auth/users` yang
  sudah ada (RQ-03/04 memakainya apa adanya; kolom baru boleh ditambah ke hasil
  `listUsers`, tidak boleh ada yang dihapus/diganti nama)
- Menambah dependency (pustaka toast, pustaka OTP, dsb.) — tidak ada task di kontrak ini
  yang memintanya
- `DELETE FROM users` atau drop kolom apa pun (INV-2)
- Menyentuh `packages/web/src/components/pages/NotebooksPage.tsx`, canvas, peta, atau apa
  pun di luar auth/akun
- Menyentuh `nginx.conf`, `vite.config.ts`, deploy, CI
- Menghapus atau menonaktifkan tes yang sudah hijau supaya suite lolos

## 6. Plan singkat

1. Tipe bersama dulu (T-00) supaya engine & web mengetik hal yang sama sejak awal.
2. Backend dari dalam ke luar: kolom DB → service → middleware (yang menyatukan F-089 dan
   F-090 sekaligus, D-1) → controller/route baru → CLI. Setiap lapis diuji dan dihijaukan
   sebelum lapis berikutnya dibangun di atasnya.
3. Frontend: hook + panel akun (buat/daftar/nonaktifkan) → dialog profil (kalimat viewer +
   form ganti password) → penanganan sesi-berakhir di interceptor → pemeriksaan tampilan
   403 di ketiga layar itu.
4. Uji ulang penuh (engine + web, bukan cuma file baru), catat, tutup.

Risiko utama:
- D-1 menyentuh **semua** endpoint terautentikasi sekaligus, bukan cuma yang berhubungan
  dengan akun. Kalau `authService.currentUser()` salah, seluruh aplikasi terkunci.

Mitigasi:
- T-02 dihijaukan dulu memakai endpoint yang **sudah ada** (bukan endpoint baru manapun),
  dan dibuktikan lewat bite-test: matikan pembacaan DB dengan sengaja, pastikan tes lama
  yang tidak berhubungan dengan akun (mis. berkas `notebook-deploy.test.ts`) tetap hijau,
  baru nyalakan lagi dan lanjut.

Risiko kedua:
- Kolom `active` terlewat di satu jalur (login vs middleware vs `listUsers`) mengulang
  persis pola RULES §5.16 — satu nilai dinyatakan di banyak tempat, dan salah satu lupa.

Mitigasi:
- T-01's Verify memeriksa akun nonaktif ditolak di **kedua** jalur: saat login, dan saat
  request bertoken yang sesi-nya sudah berjalan sebelum dinonaktifkan — bukan cuma satu.

## 7. Tasks (kerjakan berurutan)

### T-00 — Tipe akun di `packages/shared`
- Status: DONE
- Depends: —
- RQ: RQ-03, RQ-04, RQ-05, RQ-06 (fondasi tipe untuk semuanya)
- Lakukan: buat `packages/shared/src/auth.ts`:
  `export const ROLES = ['creator', 'viewer'] as const;`
  `export type Role = (typeof ROLES)[number];`
  `export interface AccountUser { id: string; username: string; email: string | null; role: Role; active: boolean; createdAt: string; }`
  Tambah `export * from "./auth.js";` ke `packages/shared/src/index.ts`.
- Selesai jika: file baru tidak mengimpor apa pun dari `engine` atau `web` (INV-1); belum
  dipakai di mana pun — task berikutnya yang memakainya.
- Verify:
```bash
pnpm --filter @zaa-tool/engine run build
```

### T-01 — Kolom `active`, dan service yang menegakkannya
- Status: DONE
- Depends: T-00
- RQ: RQ-05, RQ-06
- Lakukan: di `initializer.ts`, tambah blok `DO $$ ALTER TABLE users ADD COLUMN active
  BOOLEAN NOT NULL DEFAULT true; EXCEPTION WHEN duplicate_column THEN null; END $$;`
  tepat setelah blok kolom `role` (~baris 224). Di `auth.service.ts`: tambah
  `currentUser(id: string): Promise<{id,username,email,role:Role,active:boolean} | null>`;
  tambah `setActive(id: string, active: boolean): Promise<boolean>` (`UPDATE users SET
  active = $1 WHERE id = $2`, kembalikan `rowCount > 0`); ubah `login()` — setelah
  password cocok, kalau `user.active === false` lempar `Error("This account has been
  deactivated.")` sebelum menandatangani token; ubah `listUsers()` — tambah `active` ke
  kolom yang di-`SELECT`.
- Selesai jika: akun yang `active=false` tidak bisa login (pesan di atas); `currentUser()`
  mengembalikan `active` yang benar setelah `setActive()` dipanggil; `listUsers()`
  menyertakan `active` untuk setiap baris.
- Verify:
```bash
pnpm --filter @zaa-tool/engine test auth-accounts
```

### T-02 — `authMiddleware` membaca ulang DB, bukan mempercayai token
- Status: DONE
- Depends: T-01
- RQ: RQ-06, RQ-05 (penegakan langsung, bukan cuma di login)
- Lakukan: di `auth.middleware.ts`, setelah `verifyToken` sukses, panggil
  `authService.currentUser(decoded.id)`. Kalau `null` → `401` ("Unauthorized: account no
  longer exists"). Kalau `active === false` → `403` ("This account has been
  deactivated."). Kalau lolos, isi `req.user = { id, username, role: current.role }` dari
  hasil `currentUser`, **bukan** dari `decoded`.
- Selesai jika: mengganti `role` sebuah akun di DB langsung (lewat `authService.setRole`,
  bukan lewat login ulang) membuat permintaan **berikutnya** dari token lama akun itu
  memakai peran baru; menonaktifkan sebuah akun yang sedang login membuat permintaan
  berikutnya dari token itu ditolak `403`, walau tokennya belum kedaluwarsa.
- Verify:
```bash
pnpm --filter @zaa-tool/engine test auth-accounts
```
Bite-test wajib sebelum tandai DONE: matikan sementara pembacaan `currentUser` (kembalikan
`req.user = decoded` seperti semula), jalankan **seluruh** suite engine
(`pnpm --filter @zaa-tool/engine test`), pastikan test T-02 merah dan tidak ada test lama
yang ikut merah karena alasan lain — baru kembalikan perbaikannya.

### T-03 — `PATCH /api/auth/users/:id` — nonaktifkan / aktifkan kembali
- Status: DONE
- Depends: T-01, T-00
- RQ: RQ-05
- Lakukan: `authController.setActive(req,res)` — body `{active: boolean}`; kalau bukan
  boolean → `400`; kalau `req.user.id === req.params.id` → `400` ("You cannot deactivate
  the account you are signed in as."); panggil `authService.setActive`; `404` kalau tidak
  ada baris yang berubah. Route: `authRouter.patch("/users/:id", authMiddleware,
  requireRole("creator"), authController.setActive);` di `auth.route.ts`.
- Selesai jika: seorang creator bisa menonaktifkan akun lain lewat endpoint ini, dan
  mengaktifkannya kembali (`{active:true}`); mencoba menonaktifkan diri sendiri ditolak
  `400`; seorang viewer yang mencoba endpoint ini ditolak `403` dengan pesan dari
  `requireRole` (tidak diubah).
- Verify:
```bash
pnpm --filter @zaa-tool/engine test auth-accounts
```

### T-04 — `POST /api/auth/me/password` — ganti password sendiri
- Status: DONE
- Depends: T-00
- RQ: RQ-09
- Lakukan: `authService.changePassword(userId, currentPassword, newPassword)` — ambil user
  by id, `bcrypt.compare(currentPassword, user.password_hash)`, lempar
  `Error("Current password is incorrect")` kalau tidak cocok, lalu simpan hash baru
  (panjang minimal 8 karakter, aturan yang sama seperti `setPassword`). Controller
  `authController.changePassword(req,res)` — baca `req.user.id`, body
  `{currentPassword, newPassword}`, `400` kalau salah satu kosong, `401`/`400` sesuai
  error dari service. Route: `authRouter.post("/me/password", authMiddleware,
  authController.changePassword);`.
- Selesai jika: password lama yang benar + password baru valid → berhasil, dan login
  berikutnya memakai password baru berhasil sementara password lama ditolak; password lama
  yang salah → ditolak dengan pesan yang menyebut itu, tidak mengubah apa pun.
- Verify:
```bash
pnpm --filter @zaa-tool/engine test auth-accounts
```

### T-05 — CLI: `reset-password --password <value>` dan mode interaktif tanpa echo
- Status: DONE
- Depends: —
- RQ: RQ-01
- Lakukan: di `reset-password.ts`, urai `--password` sama seperti `--role` sudah diurai.
  Kalau ada, pakai nilainya langsung (lewati `newPassword()`). Kalau tidak ada, minta
  input dari stdin tanpa menggemakan karakter ke terminal — pakai `readline` bawaan Node
  dengan `output` yang di-mute selama mengetik (pola umum: override sementara
  `rl._writeToOutput` menjadi no-op untuk baris itu saja, atau pakai `process.stdin` dalam
  raw mode dan cetak `*` per karakter — pilih yang paling sederhana, tanpa dependency
  baru). Validasi panjang tetap di `authService.setPassword` — jangan diduplikasi di
  skrip.
- Selesai jika: `reset-password <user> --password foobar123` mengganti password tanpa
  memanggil `newPassword()`; `reset-password <user>` tanpa flag itu meminta input dan
  tidak mencetak karakter yang diketik ke stdout/stderr.
- Verify:
```bash
pnpm --filter @zaa-tool/engine test auth-accounts
```
(tes menjalankan skrip lewat `child_process.spawnSync("tsx", ["scripts/reset-password.ts", ...])` di proses tersendiri, sesuai catatan `run-all.ts` bahwa tiap file tes sudah proses sendiri — spawn tambahan di dalamnya aman.)

### T-06 — CLI baru: `create-user`
- Status: DONE
- Depends: T-05 (menirukan pola parsing argumen yang sama)
- RQ: RQ-02
- Lakukan: buat `packages/engine/scripts/create-user.ts`, meniru struktur
  `reset-password.ts` (`initDb()`, `pool.end()` di `finally`, pesan error yang sama
  gayanya). Terima `<username> --role creator|viewer [--password <value>] [--email
  <value>]`; tanpa `--password`, prompt interaktif tanpa echo (pakai fungsi yang sama
  dengan T-05 — pertimbangkan menaruhnya di satu modul kecil yang diimpor kedua skrip
  kalau itu lebih bersih daripada disalin dua kali). `--role` wajib (tidak ada default
  diam-diam — akun tanpa peran yang jelas adalah bug, bukan kenyamanan). Panggil
  `authService.createUser`. Tambah `"create-user": "tsx scripts/create-user.ts"` ke
  `packages/engine/package.json` `scripts`.
- Selesai jika: `pnpm --filter @zaa-tool/engine create-user zz-test-x --role viewer
  --password foobar123` membuat akun baru yang bisa langsung login; menjalankan tanpa
  `--role` gagal dengan pesan yang jelas, tidak membuat baris apa pun.
- Verify:
```bash
pnpm --filter @zaa-tool/engine test auth-accounts
```

### T-07 — `useAccounts` + tab "Accounts": buat dan lihat daftar
- Status: DONE
- Depends: T-00, T-01 (butuh `active` di respons `GET /users`)
- RQ: RQ-03, RQ-04
- Lakukan: `packages/web/src/hooks/useAccounts.ts` — bentuk sama seperti `useSecrets.ts`:
  `{accounts, error, fetchAccounts, createAccount}`, memanggil `GET`/`POST
  /api/auth/users`, tipe `AccountUser` dari `@zaa-tool/shared`. Komponen baru
  `packages/web/src/components/resources/AccountsTab.tsx` — form buat akun (username,
  email opsional, password, pilihan role) di atas, tabel daftar akun (username, email,
  role, status aktif) di bawah. Kaitkan sebagai tab ke-4 `"accounts"` di
  `ResourcesPage.tsx`, judul "Accounts", mengikuti pola `TabsTrigger`/`TabsContent` yang
  sudah ada untuk `secrets`/`skills`/`files`.
- Selesai jika: membuka tab Accounts sebagai creator memuat daftar akun yang sudah ada;
  mengisi form dan submit menambah baris baru ke tabel tanpa reload halaman.
- Verify:
```bash
pnpm --filter @zaa-tool/web test accounts
```

### T-08 — Nonaktifkan / aktifkan dari `AccountsTab`
- Status: DONE
- Depends: T-07, T-03
- RQ: RQ-05
- Lakukan: tambah `setActive` ke `useAccounts.ts` (panggil `PATCH
  /api/auth/users/:id`). Di `AccountsTab.tsx`, setiap baris tabel dapat tombol
  nonaktifkan/aktifkan-kembali sesuai status saat ini; baris milik akun yang sedang login
  (`user.id` dari `authStore`) tidak menampilkan tombol itu sama sekali (bukan cuma
  disabled — sejalan dengan RULES §5.11: kontrol yang tidak berlaku tidak ditinggal di
  layar).
- Selesai jika: menekan tombol nonaktifkan mengubah status baris itu di tabel tanpa
  reload; akun yang sedang login tidak punya tombol itu pada barisnya sendiri.
- Verify:
```bash
pnpm --filter @zaa-tool/web test accounts
```

### T-09 — Kalimat penjelas untuk menu viewer yang lebih pendek
- Status: DONE
- Depends: —
- RQ: RQ-07
- Lakukan: di `Navbar.tsx`, dialog profil (~baris 196-201, di bawah baris "System Role"),
  tambah satu baris teks yang muncul hanya kalau `user.role !== 'creator'`, menyebut tab
  mana yang disembunyikan (`Notebooks`, `Resources` — bisa dibaca dari `navTabs.filter(t
  => t.creatorOnly)` supaya tidak diketik ulang dan bisa basi kalau daftar tab berubah).
- Selesai jika: login sebagai viewer dan membuka dialog profil menampilkan kalimat itu;
  login sebagai creator tidak menampilkannya sama sekali.
- Verify:
```bash
pnpm --filter @zaa-tool/web test accounts
```

### T-10 — Ganti password sendiri, dari dialog profil
- Status: DONE
- Depends: T-04
- RQ: RQ-09
- Lakukan: tambah `changePassword(currentPassword, newPassword): Promise<boolean>` ke
  `authStore.ts` (memanggil `POST /api/auth/me/password`, pola try/catch + `set({error})`
  yang sama seperti `login`/`registerUser`). Di dialog profil `Navbar.tsx`, tambah bagian
  kecil dengan dua input password (lama, baru) dan tombol submit; sukses membersihkan
  form dan menampilkan konfirmasi singkat; gagal menampilkan `error` dengan pola
  `Login.tsx`.
- Selesai jika: mengganti password dengan password lama yang benar berhasil dan form
  kosong lagi; password lama yang salah menampilkan pesan error di dalam dialog, tidak
  menutup dialog, tidak membersihkan input password baru yang sudah diketik.
- Verify:
```bash
pnpm --filter @zaa-tool/web test accounts
```

### T-11 — Sesi yang berakhir tidak mati diam-diam
- Status: TODO
- Depends: —
- RQ: RQ-08
- Lakukan: di `authStore.ts`, tambah aksi `sessionExpired()` — sama seperti `logout()`
  (bersihkan `token`/`user`, hapus dari `localStorage`) tapi juga mengisi `error` dengan
  pesan yang berbeda dari error login biasa (mis. "Your session has expired. Please log
  in again."). Perluas interceptor `window.fetch` (baris 122-140): kalau `url` mengandung
  `/api/`, ada token terpasang di `localStorage`, **dan** respons yang pulang berstatus
  `401`, panggil `useAuthStore.getState().sessionExpired()` sebelum mengembalikan respons
  ke pemanggil aslinya (pemanggil tetap menerima respons `401`-nya seperti biasa —
  interceptor hanya menambah efek samping, tidak menelan responsnya).
- Selesai jika: memanggil endpoint API mana pun dengan token yang sudah tidak valid lagi
  (kedaluwarsa atau dicabut server) membersihkan sesi dan membuat layar login tampil
  dengan pesan itu, tanpa pengguna harus menyegarkan halaman secara manual.
- Verify:
```bash
pnpm --filter @zaa-tool/web test session-expiry
```

### T-12 — 403 tampil sebagai kalimat, bukan diam
- Status: TODO
- Depends: T-07, T-10
- RQ: RQ-10
- Lakukan: pastikan `useAccounts.ts` dan `changePassword` di `authStore.ts` (T-07, T-10)
  menaruh pesan error dari respons non-2xx (termasuk `403`) ke state `error` yang sudah
  dirender di layar (bukan cuma di-`throw` dan dibiarkan tak tertangkap). Tulis tes yang
  memakai token **viewer** memanggil `POST /api/auth/users` lewat `AccountsTab`, dan
  memastikan pesan `requireRole` ("This needs a creator account...") benar-benar muncul
  di DOM yang dirender — bukan cuma bahwa `error` di store terisi.
- Selesai jika: tes T-12 gagal (merah) kalau baris yang merender `{error && ...}` sengaja
  dihapus dari `AccountsTab.tsx` — bite-test ini wajib dijalankan dan dicatat di §9
  sebelum task ditandai DONE.
- Verify:
```bash
pnpm --filter @zaa-tool/web test accounts
```

### T-13 — Regresi penuh
- Status: TODO
- Depends: T-00 sampai T-12
- RQ: semua
- Lakukan: tidak ada kode baru di task ini. Jalankan suite penuh dua paket, bukan cuma
  file baru — ini menangkap task T-02 (pembacaan ulang DB di `authMiddleware`) yang
  menyentuh setiap endpoint terautentikasi di aplikasi, bukan cuma yang di kontrak ini.
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
7. Jika butuh keputusan di luar kontrak (di luar D-1..D-7): status milestone = BLOCKED,
   isi §9, berhenti
8. Ulangi sampai semua task wajib DONE → jalankan T-13 (full verify §7/DoD)
9. Jika DoD penuh: `status: DONE`, isi §9, update `PROGRESS.md` dan `.plannings/RENCANA
   PERBAIKAN TOTAL v3.0.md`, berhenti. Jangan merge ke `dev` — itu langkah manusia.

Long-run: jangan berhenti untuk konfirmasi di antara task selama task itu ada di dalam
§5 dan tidak menyentuh Open questions. Kalau sesi terputus dan dilanjutkan, baca ulang
§7, lanjutkan dari task pertama yang belum DONE — jangan mengulang dari awal.

Jangan menambah fitur "sekalian" (contoh yang eksplisit sudah dilarang: toast global,
refresh-token, paginasi daftar akun — lihat Out of scope §4). Jangan rewrite besar tanpa
task yang memintanya.

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

# Membuktikan deployment, bukan cuma melakukannya

`DEPLOY.md` di root menjawab **cara** memasang zaatool di mesin lain, dan jawabannya sudah
benar. Dokumen ini menjawab pertanyaan yang berbeda dan belum pernah dijawab sama sekali:

> Dari mana kamu tahu itu berhasil?

Ini runbook untuk **Bagian K** rencana induk — F-123 sampai F-130, delapan butir yang
sampai hari ini berstatus *nol diverifikasi*. Semuanya hanya pernah jalan di satu laptop.

Setiap bagian di bawah punya bentuk yang sama: apa yang dibuktikan, perintahnya, dan
**apa yang harus kamu lihat**. Bagian terakhir itu yang penting — perintah yang jalan
tanpa error bukan bukti, karena sebagian besar cara sistem ini bisa rusak tidak
mengembalikan exit code.

Tandai hasilnya di `PROGRESS.md` saat selesai. Sebuah butir K yang sudah dikerjakan tapi
tidak dicatat akan dikerjakan ulang setahun lagi oleh kamu yang sudah lupa.

---

## Sebelum apa pun: dua hal yang menggigit di deployment pertama

**Satu.** `JWT_SECRET` minimal 32 karakter dan engine menolak start tanpanya di produksi.
Itu disengaja. Bangkitkan sekali, simpan:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Menggantinya nanti mengeluarkan semua orang dari sesinya **dan** mematikan setiap share
link dan file link yang pernah kamu bagikan.

**Dua.** `NODE_ENV` harus persis string `production`. Perbandingannya `===`, jadi
`Production`, `prod`, atau lupa diset semuanya jatuh ke kebijakan CORS terbuka penuh.

Kabar baiknya: `docker-compose.yml` sudah menuliskan `NODE_ENV: production` secara harfiah
di service `engine`, jadi **selama kamu deploy lewat compose, celah ini tidak menggigit.**
Ia menggigit kalau kamu menjalankan engine di luar compose — systemd, pm2, `node dist/`
langsung. Kalau itu rencanamu, periksa:

```bash
docker compose exec engine node -e "console.log(JSON.stringify(process.env.NODE_ENV))"
# harus mencetak persis: "production"
```

---

## F-123 · Deploy sungguhan di mesin lain

Yang dibuktikan: repo ini bisa dipasang dari nol oleh orang yang tidak punya konteks apa
pun, di mesin yang tidak pernah menjalankannya.

Pakai mesin bersih — VPS, laptop lain, atau VM. **Jangan** pakai mesin yang pernah
menjalankan `pnpm dev` untuk proyek ini; `node_modules` dan volume lama akan menyembunyikan
persis kegagalan yang sedang kamu cari.

```bash
git clone <remote-mu> zaatool && cd zaatool
cp .env.example .env

# isi JWT_SECRET dan POSTGRES_PASSWORD di .env, lalu:
docker compose up -d --build
```

Yang harus kamu lihat:

```bash
docker compose ps
# tiga service: postgres, engine, web — semuanya Up.
# postgres harus (healthy), bukan cuma Up.

curl -fsS http://localhost:8080/api/health && echo " ← engine menjawab"
```

Lalu buka `http://<mesin>:8080` di browser dan **daftarkan akun pertama**. Instalasi tanpa
pengguna sama sekali selalu menerima orang pertama, dan akun itu jadi `creator` — tidak
perlu menyalakan `ALLOW_REGISTRATION`.

Uji terakhir, dan ini yang paling sering terlewat: **buat satu notebook, deploy, jalankan.**
Instalasi yang bisa login tapi tidak bisa menjalankan apa pun belum terbukti apa-apa.

> **Kalau gagal:** `docker compose logs --tail 40 engine`. Dua kegagalan yang disengaja dan
> akan terlihat seperti bug pada perjumpaan pertama: `Refusing to start: JWT_SECRET is not
> set`, dan notebook `packages:` yang gagal dengan pesan soal `uv` (hanya mungkin kalau
> kamu tidak memakai image bawaan).

---

## Cara backup, kapan saja

Backup otomatis hanya terjadi saat `./scripts/update.sh` berjalan. Kalau kamu ingin satu
sekarang — sebelum mencoba sesuatu, atau sekadar rutin — tidak ada skrip untuknya. Dua
perintah ini yang dijalankan `update.sh`, dan menjalankannya sendiri aman kapan pun,
termasuk saat aplikasi sedang dipakai:

```bash
cd /path/ke/zaa-tool
mkdir -p backups
STAMP=$(date +%Y%m%d-%H%M%S)

# 1. Database.
docker compose exec -T postgres pg_dump -U zaa_user -d zaa_tool > backups/zaatool-$STAMP.sql

# 2. Berkas yang ditulis notebook. Ini TIDAK ada di database.
docker compose exec -T engine tar -cf - -C /app/packages storage > backups/storage-$STAMP.tar
```

**Periksa hasilnya. Ini bagian yang sering dilewati:**

```bash
ls -lh backups/ | tail -2
```

`pg_dump` yang gagal tetap meninggalkan berkas, dan berkas kosong terlihat persis seperti
backup sampai saat kamu membutuhkannya. Ukuran nol atau beberapa ratus byte = bukan backup.
Punyamu seharusnya puluhan KB ke atas.

Keduanya diperlukan. Database menyimpan notebook, run, secret, dan akun; `storage` menyimpan
berkas yang diunggah dan yang ditulis notebook. Memulihkan salah satunya saja menghasilkan
baris database yang menunjuk ke berkas yang tidak ada.

Tidak ada yang menghapus isi `backups/`. Sesekali hapus yang lama dengan tanganmu sendiri.

---

## Cara update: apakah harus branch `main`? apakah pull dulu?

Dua pertanyaan itu punya jawaban pendek:

**Jangan `git pull` duluan.** `update.sh` melakukannya sendiri, dan urutannya penting —
skrip itu mengambil backup **sebelum** menarik apa pun. Kalau kamu pull duluan lalu
menjalankan skripnya, backup yang diambil sudah backup dari kode yang baru, dan kalau
migrasi barunya yang bermasalah, kamu memegang dump dari masalah itu.

**Ya, produksi berada di `main`** — atau lebih tepatnya, di branch apa pun yang di-checkout
di folder produksi, dan itu seharusnya `main`. Skripnya memakai `git pull --ff-only`, yang
menolak menggabungkan apa pun yang tidak bisa maju lurus. Jadi kalau checkout produksimu
tidak sengaja berada di `dev` atau punya commit lokal, skripnya **berhenti** dengan pesan
git, bukan menggabungkan diam-diam. Itu perilaku yang diinginkan.

Periksa sebelum menjalankan:

```bash
cd /path/ke/zaa-tool
git status --short --branch
```

Yang ingin kamu lihat: `## main...origin/main` dan tidak ada baris lain. Kalau ada berkas
termodifikasi di produksi, cari tahu kenapa dulu — `--ff-only` akan gagal karenanya.

Lalu, satu perintah, dari root repo:

```bash
./scripts/update.sh
```

Skripnya, berurutan: backup database → backup storage → `git pull --ff-only` →
`docker compose up -d --build` → tunggu engine sehat sampai 30 detik.

**Kalau berhenti di tengah:** tidak ada yang rusak. Backup diambil paling awal, dan `pull`
maupun `build` tidak menyentuh data. Baca pesannya, perbaiki, jalankan lagi.

**Kalau engine tidak mau naik:** skripnya mencetak 40 baris terakhir log engine dan lokasi
backup-mu, lalu keluar dengan kode 1. Jalan pulangnya ada di bagian F-125 di bawah — dan
perhatikan, baris rollback yang **dicetak skrip itu sendiri tidak akan bekerja**; pakai
prosedur enam langkah di F-125.

---

## F-124 · `update.sh` pada instalasi yang punya data sungguhan

Yang dibuktikan: pembaruan tidak memakan data. Ini **tidak boleh** diuji pertama kali pada
instalasi yang kamu sayangi.

Siapkan dulu keadaan yang bisa hilang — beberapa notebook, satu secret, satu berkas
ter-unggah, dan minimal satu run yang tercatat. Catat jumlahnya:

```bash
docker compose exec -T postgres psql -U zaa_user -d zaa_tool -c \
  "SELECT 'notebooks' AS t, count(*) FROM notebooks
   UNION ALL SELECT 'runs', count(*) FROM notebook_runs
   UNION ALL SELECT 'secrets', count(*) FROM secrets
   UNION ALL SELECT 'users', count(*) FROM users;"

docker compose exec -T engine sh -c "du -sh /app/packages/storage"
```

Lalu:

```bash
./scripts/update.sh
```

Yang harus kamu lihat, berurutan: baris `==> Backing up the database` dengan **jumlah byte
yang bukan nol**, `==> Backing up storage`, `==> Pulling`, `==> Building and restarting`,
dan terakhir `healthy after <n>s`.

Setelah selesai, jalankan **query yang sama persis** dan bandingkan angkanya. Sama = lulus.

Skrip ini mengambil backup **sebelum** menyentuh apa pun, dan urutan itu seluruh isinya:
engine menjalankan migrasi saat start, jadi dump yang diambil sesudah pembaruan adalah dump
dari masalahnya.

---

## F-125 · Pemulihan dari backup

Butir paling penting di seluruh Bagian K, dan satu-satunya yang benar-benar tidak boleh
kamu tunda. Backup yang belum pernah dipulihkan bukan backup — ia arsip harapan.

**Ada masalah nyata di jalan pulang yang tercetak `update.sh`,** dan kamu akan menemukannya
persis pada saat paling buruk. Baris yang dicetaknya:

```bash
docker compose exec -T postgres psql -U zaa_user -d zaa_tool < backups/zaatool-<stamp>.sql
```

`pg_dump` di skrip itu dipanggil tanpa `--clean`, jadi dump-nya berisi `CREATE TABLE` tanpa
`DROP TABLE`. Menuangkannya ke database yang **masih berisi skema** akan gagal berderet
dengan `relation "notebooks" already exists`, dan yang tertinggal adalah database separuh
jalan. Prosedur yang benar mengosongkan dulu:

```bash
# 1. Hentikan yang menulis. Postgres tetap hidup.
docker compose stop engine web

# 2. Buang dan buat ulang database.
docker compose exec -T postgres dropdb   -U zaa_user zaa_tool
docker compose exec -T postgres createdb -U zaa_user zaa_tool

# 3. Tuangkan dump-nya.
docker compose exec -T postgres psql -U zaa_user -d zaa_tool < backups/zaatool-<stamp>.sql

# 4. Kembalikan berkas — ini TIDAK ada di database.
docker compose start engine
docker compose exec -T engine tar -xf - -C /app/packages < backups/storage-<stamp>.tar

# 5. Nyalakan sisanya.
docker compose start web
```

Yang harus kamu lihat: langkah 3 selesai tanpa satu pun baris `ERROR`. Lalu jalankan query
penghitung dari F-124 dan cocokkan dengan keadaan saat backup diambil. Lalu **buka satu
halaman yang punya berkas** dan pastikan berkasnya benar-benar tampil — baris database yang
menunjuk ke berkas yang tidak ikut kembali akan terlihat baik-baik saja di query dan rusak
di layar.

Latih ini di mesin buangan, bukan di produksi. Sekali. Lalu kamu tahu.

> **"Tunggu perbaikan dulu?"** Tidak perlu. Yang rusak adalah *baris petunjuk yang dicetak*
> `update.sh`, bukan backup-nya — dump dan tar yang sudah diambil sepenuhnya sehat.
> Prosedur enam langkah di atas bekerja pada backup yang kamu punya sekarang, hari ini.
> Memperbaiki skripnya adalah pekerjaan terpisah, dan menundanya berarti menunda satu-satunya
> butir K yang benar-benar tidak boleh ditunda.

---

## F-126 · Postgres mati di tengah run — **SUDAH DIUJI, DAN MENEMUKAN BUG**

Diuji 2026-08-09. Ini satu-satunya butir K yang selesai dengan hasil negatif, dan
temuannya cukup serius untuk jadi pekerjaan tersendiri.

Cara mengulanginya:

```bash
docker compose stop postgres     # saat notebook sedang jalan
docker compose logs -f engine
docker compose start postgres
```

### Yang terjadi

| Pertanyaan | Hasil |
|---|---|
| Engine mati atau bertahan? | **Gagal.** Tidak bertahan. |
| Yang dilihat pengguna | Terlempar ke halaman login dengan pesan mentah `getaddrinfo ENOTFOUND postgres` |
| Pulih sendiri setelah postgres kembali? | **Tidak.** Butuh `docker compose restart engine` |
| Baris run yatim | Tidak terpantau — aplikasinya sendiri sudah tidak bisa diakses |

Dan yang paling menentukan, pada instalasi yang **sudah punya notebook ter-deploy**:
setelah postgres hidup lagi, login gagal dengan `JSON.parse: unexpected character at line 1
column 1 of the JSON data` dan semua link berhenti bekerja. Baru normal setelah engine
di-restart.

> Pada instalasi kosong (belum ada app sama sekali) engine tampak pulih tanpa restart —
> yang menjelaskan kenapa ini tidak pernah ketahuan sebelumnya.

### Kenapa ini penting

Tiga masalah terpisah, bukan satu:

1. **Tidak ada penyambungan ulang.** Pool postgres tidak pulih setelah databasenya kembali.
   Restart postgres — hal yang normal terjadi saat pembaruan, pemeliharaan, atau reboot
   host — mematikan engine sampai ada manusia yang me-restart-nya. Untuk sesuatu yang
   dijalankan tanpa penjaga, ini yang paling mahal.
2. **Pesan kesalahan internal bocor ke layar login.** `getaddrinfo ENOTFOUND postgres`
   memberi tahu orang yang belum masuk bahwa ada host bernama `postgres` dan ia sedang
   tidak dapat dihubungi. Pengguna tidak bisa berbuat apa-apa dengan itu, dan penyerang
   bisa.
3. **`JSON.parse: unexpected character`** artinya frontend menerima HTML (kemungkinan
   halaman error nginx atau 502) di tempat ia mengharapkan JSON, dan tidak menanganinya.
   Apa pun penyebab di belakangnya, halaman seharusnya mengatakan "tidak bisa menghubungi
   server", bukan memuntahkan pesan parser.

**Status: temuan terbuka.** Belum ada milestone yang memilikinya. Kandidat kuat untuk
kontrak berikutnya — dan yang nomor 1 sebaiknya tidak menunggu lama kalau tool ini akan
dipasang di tempat yang tidak kamu awasi setiap hari.

---

## F-127, F-128, F-130 · Batas notebook — **fixture sudah ada dan sudah jalan**

Lima notebook dibuat dan di-deploy 2026-08-09, dan ketiganya sudah dijalankan sekali dari
sisi engine — jadi yang tersisa buatmu murni **melihat**, bukan mencari tahu apakah
kodenya benar. Semuanya berawalan `zz-`, ditandai tag `bagian-k`, dan tidak pernah dihapus.

Fixture disembunyikan dari daftar Apps secara bawaan. Setiap layar yang menyembunyikannya
memberi tahu berapa yang disembunyikan dan menawarkan menampilkannya — klik itu dulu.

### F-127 — `zz-uji-20-cell`

Dua puluh dua cell yang benar-benar berantai: tiap cell membaca hasil cell di atasnya, jadi
outline dan lipatan punya sesuatu yang nyata untuk dikerjakan.

**Buka di editor.** Gulir dari atas ke bawah, lipat beberapa cell, pakai cari. Yang dicari:
apakah editor masih responsif, dan berapa lama dari klik sampai bisa dipakai.

Sudah diverifikasi jalan: 21 cell dieksekusi, `run:done`, rantai utuh sampai langkah 20.

### F-128 — `zz-uji-paralel-3`

Lane di dalam lane di dalam lane. Grup paralel tidak boleh langsung berada di dalam grup
paralel lain — harus lewat lane — jadi tiga tingkat berarti tiga lane bersarang.

**Lihat di editor** (apakah peta bersarangnya terbaca), lalu **jalankan**.

Sudah diverifikasi jalan, dan hasilnya benar:

```
6 dari 6 lane menulis. Tingkat terdalam yang terbaca: 3.
Ketiga tingkat berjalan dan hasilnya digabungkan kembali.
```

### F-130 — `zz-uji-panggil-silang`

**Ini yang perlu kamu buka.** Satu tombol Run menjalankan rantai penuh:

> **node → python → node**

Notebook ini (node) memanggil `zz-uji-panggil-py-inti` (python), yang di dalamnya memanggil
`zz-uji-panggil-js-inti` (node). Dua notebook inti itu hanya ada untuk dipanggil — tidak
perlu kamu buka sendiri.

Ubah angka di input dan jalankan lagi; tabelnya menunjukkan nilai di tiap persinggahan,
jadi kalau ada yang berubah saat menyeberang kamu akan lihat persis di mana.

Sudah diverifikasi jalan dengan `angka: 21`:

```
Dikirim 21, kembali 42.
Nilainya utuh di setiap persinggahan.
```

### Kalau ingin membuat ulang

Fixture dibuat lewat `notebooksService.save()` + `deploy()` dari skrip sekali pakai, bukan
lewat migrasi skema — `initDb()` membuat tabel dan kolom, tidak pernah baris. Skripnya
sengaja tidak disimpan di repo; bentuk markdown-nya bisa dibaca ulang dari notebook yang
sudah ada lewat editor.

---

## F-129 · Halaman dengan 10 output di ponsel

Yang dibuktikan: halaman padat masih bisa dipakai di layar kecil.

Butuh ponsel sungguhan, bukan device toolbar browser — dan butuh **HTTPS**, karena beberapa
hal (mikrofon, terutama) tidak jalan tanpanya.

```bash
# Dari ponsel di Wi-Fi yang sama, buka:
#   https://<alamat-mesin>:8080
```

Kalau kamu belum memasang TLS, `DEVELOPMENT.md` bagian "From your phone" menjelaskan jalan
pintas untuk pengujian lokal. Untuk produksi, pasang reverse proxy — Caddy, nginx, load
balancer yang sudah kamu punya. **Bukan opsional:** sesi dan token share berjalan di header.

Yang dicari: apakah tile-tile itu bisa dibaca; apakah tabel bisa digulir tanpa menggulir
seluruh halaman; apakah kontrol paginasi tabel **terjangkau tanpa menggulir di dalam tile**
(ini B-9/F-103, diperbaiki di FX8 tapi **belum pernah diverifikasi dengan mata di layar
sungguhan** — jsdom tidak punya mesin tata letak).

Butir ini menutup satu-satunya klaim FX8 yang masih menggantung.

---

## Env yang mungkin ingin kamu setel di produksi

Semuanya punya default yang bekerja. Yang di bawah ini yang paling mungkin ingin kamu ubah,
dan tiga yang terakhir baru ada sejak FX9.

| Variabel | Default | Kapan diubah |
|---|---|---|
| `WEB_PORT` | `8080` | Port lain sudah dipakai, atau reverse proxy-mu ingin yang lain |
| `MAX_UPLOAD_MB` | `25` | Berkas tunggal terbesar yang boleh masuk |
| `ALLOW_REGISTRATION` | `false` | Nyalakan sebentar untuk memasukkan orang, lalu matikan |
| `CORS_ORIGINS` | *(kosong)* | Hanya kalau bundle disajikan dari origin lain |
| `MAX_NOTEBOOK_STORAGE_MB` | `500` | Kuota folder per notebook |
| `LOGIN_RATE_LIMIT_MAX` | `10` | Percobaan login per IP per window |
| `LOGIN_RATE_LIMIT_WINDOW_MS` | `900000` | Panjang window (15 menit) |

`HOOK_RATE_LIMIT_MAX` dan `HOOK_RATE_LIMIT_WINDOW_MS` bekerja sama persis, untuk webhook
yang **tidak** membawa secret yang sah. Webhook dengan secret yang cocok dilewati sepenuhnya
dan tidak pernah kena batas.

---

## Akun dan token dari terminal

Semua ini berjalan di dalam container engine:

```bash
docker compose exec engine pnpm reset-password --list
docker compose exec engine pnpm reset-password <username>              # bangkitkan, cetak sekali
docker compose exec engine pnpm reset-password <username> --prompt     # ketik sendiri, tidak tampil
docker compose exec engine pnpm create-user <username> --role creator
docker compose exec engine pnpm agent-token --help
```

Password minimum **12 karakter** sejak FX9, di ketiga jalur — buat akun, reset dari
terminal, dan ganti sendiri dari dialog profil.

Token agent sekarang juga bisa dikelola dari UI: **Resources → Agent Tokens**. Nilainya
ditampilkan **sekali** saat diterbitkan dan tidak pernah bisa dilihat lagi — sama seperti
CLI-nya.

---

## Ringkasan status

Terakhir diperbarui 2026-08-09.

| | Butir | Perlu | Status |
|---|---|---|---|
| F-123 | Deploy di mesin lain | Mesin bersih | ✅ **lulus** — berhasil di laptop lain |
| F-124 | `update.sh` dengan data | Ada update untuk ditarik | menunggu |
| F-125 | Pemulihan dari backup | Mesin buangan | ⬜ **belum — prioritas** |
| F-126 | Postgres mati di tengah run | — | ⚠️ **diuji, menemukan bug** |
| F-127 | Notebook 20+ cell | `zz-uji-20-cell` | 🔵 fixture siap, tinggal dilihat |
| F-128 | Paralel bersarang 3 tingkat | `zz-uji-paralel-3` | 🔵 fixture siap, tinggal dilihat |
| F-129 | 10 output di ponsel | Ponsel + HTTPS | ⬜ belum |
| F-130 | Python ↔ JS | `zz-uji-panggil-silang` | 🔵 fixture siap, tinggal dilihat |

Tiga butir 🔵 sudah diverifikasi jalan dari sisi engine — yang tersisa hanyalah menilai
dengan mata apakah editor dan halamannya enak dipakai. F-129 juga hanya butuh mata, dan
sekalian menutup satu klaim FX8 yang masih menggantung (tinggi tile tabel, B-9/F-103).

Kalau kamu hanya sempat satu, kerjakan **F-125**. Setelah itu, temuan F-126 layak jadi
kontrak tersendiri.

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

---

## F-126 · Postgres mati di tengah run

Yang dibuktikan: engine tidak kehilangan akal saat databasenya hilang, dan pulih saat
databasenya kembali.

**Perilaku yang benar di sini belum ditetapkan di mana pun.** Ini uji eksplorasi — tugasnya
mencatat apa yang terjadi, bukan mencocokkan dengan harapan yang belum pernah ditulis.

```bash
# Jalankan notebook yang cukup lama (beberapa detik), lalu di terminal lain:
docker compose stop postgres

# Amati:
docker compose logs -f engine

# Kembalikan:
docker compose start postgres
```

Catat empat hal, apa adanya:

1. Apakah proses engine **mati**, atau bertahan dan mengeluh?
2. Apa yang dilihat pengguna di halaman — pesan jujur, spinner selamanya, atau layar putih?
3. Setelah postgres kembali, apakah engine menyambung ulang **sendiri**, atau butuh
   `docker compose restart engine`?
4. Baris run yang sedang berjalan itu — tertinggal berstatus `running` selamanya, atau
   ditandai gagal?

Nomor 3 dan 4 adalah temuan yang paling mungkin. Kalau engine tidak menyambung ulang
sendiri, itu bug yang layak jadi milestone tersendiri. Kalau run yatim tertinggal
`running`, itu juga.

---

## F-127, F-128, F-130 · Batas notebook

Tiga butir yang jalannya sama: buka notebook uji yang sudah disiapkan, pakai, catat apa yang
patah. Semuanya berawalan `zz-` dan **tidak pernah dihapus** — itu konvensi proyek ini.

| Butir | Notebook | Yang dilihat |
|---|---|---|
| **F-127** notebook panjang | `zz-uji-20-cell` | Buka di editor. Gulir, lipat, cari. Apakah editor masih responsif? Berapa lama sampai bisa dipakai? |
| **F-128** paralel bersarang | `zz-uji-paralel-3` | Lane di dalam lane di dalam lane. Lihat di editor, lalu **jalankan**. Apakah urutannya benar? |
| **F-130** Python ↔ JS | *belum ada* | Harus kamu buat: satu notebook Python yang memanggil notebook JS, dan sebaliknya. |

Kalau `zz-uji-20-cell` atau `zz-uji-paralel-3` belum ada di instalasimu, keduanya harus
dibuat dulu — daftarnya ada di Bagian 4 rencana induk, lengkap dengan apa yang masing-masing
buktikan.

F-130 tidak punya fixture sama sekali, jadi butir itu dimulai dengan membuatnya. Satu
notebook JS yang mengembalikan sesuatu sederhana, satu notebook Python yang memanggilnya,
lalu dibalik. Yang dicari: apakah nilai yang menyeberang tetap utuh melewati batas bahasa.

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

Isi kolom terakhir saat kamu mengerjakannya.

| | Butir | Perlu | Status |
|---|---|---|---|
| F-123 | Deploy di mesin lain | Mesin bersih | belum |
| F-124 | `update.sh` dengan data | Instalasi berisi | belum |
| F-125 | Pemulihan dari backup | Mesin buangan | **belum — prioritas** |
| F-126 | Postgres mati di tengah run | — | belum |
| F-127 | Notebook 20+ cell | `zz-uji-20-cell` | belum |
| F-128 | Paralel bersarang 3 tingkat | `zz-uji-paralel-3` | belum |
| F-129 | 10 output di ponsel | Ponsel + HTTPS | belum |
| F-130 | Python ↔ JS | Fixture belum ada | belum |

Kalau kamu hanya sempat satu, kerjakan **F-125**.

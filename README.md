# AI Soal Generator CBT PIJAR

Aplikasi pembuat soal ujian CBT otomatis berbasis AI Gemini yang langsung siap di-export ke format Excel template pengisian soal CBT PIJAR, lengkap dengan dukungan Equation (LaTeX), ilustrasi gambar (Pollinations AI), grafik data (QuickChart.io), diagram alur/siklus (Mermaid.ink), dan manajemen riwayat soal.

Aplikasi ini telah dioptimalkan agar dapat di-deploy secara langsung ke **Cloudflare Pages** (dengan Cloudflare Pages Functions) maupun dijalankan secara lokal.

---

## 🚀 Panduan Deploy ke Cloudflare Pages

### 1. Hubungkan Repository Git ke Cloudflare
1. Buka dashboard [Cloudflare Dashboard](https://dash.cloudflare.com/) lalu masuk ke menu **Workers & Pages** > **Pages** > **Create application** > **Connect to Git**.
2. Pilih repositori GitHub/GitLab proyek ini.

### 2. Pengaturan Build (Build Configuration)
Isi formulir konfigurasi build dengan pengaturan berikut:
* **Framework Preset**: `Vite` (atau `None`)
* **Build command**: `npm run build`
* **Build output directory**: `dist`
* **Root directory**: `/` (kosongkan atau biarkan default)

### 3. Environment Variables (Variabel Lingkungan)
Tambahkan variabel lingkungan di menu **Environment Variables**:
* `GEMINI_API_KEY`: *(Opsional / Rekomendasi)* Masukkan API Key Gemini Anda dari [Google AI Studio](https://aistudio.google.com/app/apikey).
  > **Catatan:** Jika Anda tidak mengisi `GEMINI_API_KEY` di Cloudflare, pengguna tetap dapat memasukkan API Key pribadi mereka melalui tombol **Pengaturan AI** di aplikasi web.

### 4. Deploy!
Klik **Save and Deploy**. Cloudflare Pages akan otomatis mem-build aplikasi dan mengaktifkan Cloudflare Pages Functions di `/api/generate-questions`.

---

## ⚙️ Pengaturan Model AI yang Didukung

Aplikasi telah disesuaikan agar menggunakan model resmi Google Gemini yang aktif dan stabil:
* **Gemini 2.5 Flash** (`gemini-2.5-flash`) - *Default & Rekomendasi Utama*: Sangat cepat, hemat kuota, dan akurat untuk format JSON soal.
* **Gemini 2.5 Pro** (`gemini-2.5-pro`): Penalaran tingkat tinggi, sangat cocok untuk soal tipe HOTS (Higher-Order Thinking Skills) dan analisis mendalam.
* **Gemini 2.0 Flash** (`gemini-2.0-flash`): Responsif dan stabil.
* **Gemini 2.0 Flash Lite** (`gemini-2.0-flash-lite`): Sangat ringan dan efisien.
* **Gemini 1.5 Flash / Pro** (`gemini-1.5-flash` / `gemini-1.5-pro`): Model cadangan handal dengan batas kuota longgar.
* **Custom Model**: Mendukung pengetikan ID model khusus secara manual.

> **Fitur Tambahan Pengaturan AI:**
> - **Pengatur Temperatur (Kreativitas AI)**: 0.0 - 0.4 untuk soal eksak (Matematika/Fisika), 0.7 untuk soal bahasa/sosial.
> - **Uji Koneksi API**: Tombol untuk mengecek validitas API Key dan model sebelum generate.
> - **Auto-Fallback Cerdas**: Jika model yang diminta mengalami error 404, sistem otomatis beralih ke `gemini-2.5-flash` agar generate tidak gagal.
> - **Client-side Direct Fallback**: Jika aplikasi di-deploy tanpa Cloudflare Pages Functions (hanya static), aplikasi tetap dapat memanggil API Gemini secara langsung dari browser.

---

## 💻 Menjalankan Secara Lokal (Local Development)

### Prasyarat
* Node.js versi 18 atau 20+

### Langkah-langkah:
1. Pasang dependensi:
   ```bash
   npm install
   ```
2. (Opsional) Salin file `.env.example` menjadi `.env` dan masukkan API Key:
   ```env
   GEMINI_API_KEY=AIzaSy...
   ```
3. Jalankan server pengembangan Vite:
   ```bash
   npm run dev
   ```
   Aplikasi akan terbuka di `http://localhost:5173`.
   Endpoint `/api/generate-questions` dan `/api/test-key` sudah ditangani otomatis oleh dev middleware di `vite.config.ts`.

4. (Alternatif) Menjalankan dengan Express Server:
   ```bash
   npm run dev:server
   ```

import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: "10mb" }));

function getDefaultBaseUrl(provider: string, customBaseUrl?: string): string {
  if (provider === 'custom') {
    return customBaseUrl?.trim() || 'http://localhost:11434/v1';
  }
  if (customBaseUrl && customBaseUrl.trim() && !customBaseUrl.includes('localhost:11434')) {
    return customBaseUrl.trim();
  }
  switch (provider) {
    case 'groq':
      return 'https://api.groq.com/openai/v1';
    case 'deepseek':
      return 'https://api.deepseek.com';
    case 'openai':
      return 'https://api.openai.com/v1';
    case 'openrouter':
      return 'https://openrouter.ai/api/v1';
    default:
      return 'https://api.openai.com/v1';
  }
}

async function fetchRemoteModels(provider: string, apiKey: string, customBaseUrl?: string): Promise<string[]> {
  try {
    if (provider === 'gemini') {
      const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
      if (!resp.ok) return [];
      const data: any = await resp.json();
      return (data.models || [])
        .filter((m: any) => m.supportedGenerationMethods?.includes('generateContent'))
        .map((m: any) => m.name.replace(/^models\//, ''));
    }

    const baseUrl = getDefaultBaseUrl(provider, customBaseUrl);
    const url = `${baseUrl.replace(/\/+$/, '')}/models`;
    const headers: Record<string, string> = {};
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
    if (provider === 'openrouter') {
      headers['HTTP-Referer'] = 'https://cbtpijar.app';
      headers['X-Title'] = 'CBT Pijar AI Generator';
    }

    const resp = await fetch(url, { headers });
    if (!resp.ok) return [];
    const data: any = await resp.json();
    const rawList = Array.isArray(data.data) ? data.data : (Array.isArray(data.models) ? data.models : []);
    return rawList
      .map((m: any) => (typeof m === 'string' ? m : m.id))
      .filter((id: string) => {
        if (!id) return false;
        const low = id.toLowerCase();
        return !(
          low.includes('whisper') ||
          low.includes('embed') ||
          low.includes('safeguard') ||
          low.includes('prompt-guard') ||
          low.includes('moderation') ||
          low.includes('dall-e') ||
          low.includes('tts')
        );
      });
  } catch {
    return [];
  }
}

app.get("/api/test-key", (req, res) => {
  const hasServerKey = Boolean((process.env.GEMINI_API_KEY || "").trim());
  return res.json({
    hasServerKey,
    message: hasServerKey ? "GEMINI_API_KEY aktif di server." : "GEMINI_API_KEY belum diatur di server.",
  });
});

app.post("/api/test-key", async (req, res) => {
  try {
    const { aiProvider = 'gemini', customApiKey, customModel, customBaseUrl } = req.body;
    const apiKey = (customApiKey || (aiProvider === 'gemini' ? (process.env.GEMINI_API_KEY || "") : "")).trim();
    const rawModel = (customModel || "").trim().replace(/^models\//, "");
    const model = (!rawModel || rawModel === 'auto')
      ? (aiProvider === 'gemini' ? 'gemini-2.5-flash' : aiProvider === 'groq' ? 'llama-3.1-8b-instant' : aiProvider === 'deepseek' ? 'deepseek-chat' : aiProvider === 'openai' ? 'gpt-4o-mini' : aiProvider === 'openrouter' ? 'meta-llama/llama-3.3-70b-instruct' : 'llama3.2')
      : rawModel;

    if (!apiKey && aiProvider !== 'custom') {
      return res.status(400).json({ ok: false, message: `API Key untuk ${aiProvider.toUpperCase()} kosong.` });
    }

    if (aiProvider !== 'gemini') {
      const baseUrl = getDefaultBaseUrl(aiProvider, customBaseUrl);
      const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
      if (aiProvider === 'openrouter') {
        headers["HTTP-Referer"] = "https://cbtpijar.app";
        headers["X-Title"] = "CBT Pijar AI Generator";
      }

      let response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 5,
        }),
      });

      // Auto-fallback: if requested model fails, dynamically test available models from user's account!
      if (!response.ok) {
        try {
          const candidates = await fetchRemoteModels(aiProvider, apiKey, customBaseUrl);
          for (const cand of candidates) {
            if (cand === model) continue;
            const retryRes = await fetch(url, {
              method: "POST",
              headers,
              body: JSON.stringify({
                model: cand,
                messages: [{ role: "user", content: "ping" }],
                max_tokens: 5,
              }),
            });
            if (retryRes.ok) {
              return res.json({
                ok: true,
                message: `Koneksi berhasil! Model "${model}" tidak aktif di akun Anda. Sistem otomatis menemukan dan menghubungkan ke model "${cand}" yang aktif & siap pakai.`,
                fallbackModel: cand
              });
            }
          }
        } catch {}
      }

      if (!response.ok) {
        const err: any = await response.json().catch(() => ({}));
        let msg = err.error?.message || err.message || `Status HTTP ${response.status}`;
        if (msg.includes('does not exist') || msg.includes('do not have access')) {
          msg = `Model "${model}" tidak aktif pada akun Anda. Klik tombol "Muat Model Aktif Akun" di Pengaturan AI untuk memilih model yang tersedia di akun Anda.`;
        }
        return res.json({ ok: false, message: `Gagal (${aiProvider.toUpperCase()}): ${msg}` });
      }

      return res.json({ ok: true, message: `Koneksi berhasil! Model "${model}" pada provider ${aiProvider.toUpperCase()} aktif.` });
    }

    const ai = new GoogleGenAI({ apiKey });
    await ai.models.generateContent({
      model,
      contents: "ping",
      config: { maxOutputTokens: 5 },
    });

    return res.json({ ok: true, message: `Koneksi berhasil! Model "${model}" (Gemini) siap digunakan.` });
  } catch (err: any) {
    const causeMsg = err.cause ? ` (${err.cause.message || err.cause.code || err.cause})` : '';
    return res.json({ ok: false, message: (err.message || "Gagal tes koneksi.") + causeMsg });
  }
});

app.post("/api/models", async (req, res) => {
  try {
    const { aiProvider = 'gemini', customApiKey, customBaseUrl } = req.body;
    const apiKey = (customApiKey || (aiProvider === 'gemini' ? (process.env.GEMINI_API_KEY || "") : "")).trim();

    if (aiProvider === 'gemini') {
      if (!apiKey) {
        return res.status(400).json({ ok: false, error: 'Gemini API Key belum diisi.' });
      }
      const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
      if (!resp.ok) {
        const err: any = await resp.json().catch(() => ({}));
        return res.json({ ok: false, error: err.error?.message || `HTTP ${resp.status}` });
      }
      const data: any = await resp.json();
      const models = (data.models || [])
        .filter((m: any) => m.supportedGenerationMethods?.includes('generateContent'))
        .map((m: any) => ({
          id: m.name.replace(/^models\//, ''),
          name: m.displayName || m.name.replace(/^models\//, '')
        }));
      return res.json({ ok: true, models });
    }

    const baseUrl = getDefaultBaseUrl(aiProvider, customBaseUrl);
    const url = `${baseUrl.replace(/\/+$/, '')}/models`;
    const headers: Record<string, string> = {};
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
    if (aiProvider === 'openrouter') {
      headers["HTTP-Referer"] = "https://cbtpijar.app";
      headers["X-Title"] = "CBT Pijar AI Generator";
    }

    const resp = await fetch(url, { headers });
    if (!resp.ok) {
      const err: any = await resp.json().catch(() => ({}));
      return res.json({ ok: false, error: err.error?.message || err.message || `HTTP ${resp.status}` });
    }

    const data: any = await resp.json();
    const rawList = Array.isArray(data.data) ? data.data : (Array.isArray(data.models) ? data.models : []);
    const models = rawList
      .map((m: any) => (typeof m === 'string' ? { id: m, name: m } : { id: m.id, name: m.id }))
      .filter((m: any) => {
        if (!m.id) return false;
        const low = m.id.toLowerCase();
        return !(
          low.includes('whisper') ||
          low.includes('embed') ||
          low.includes('safeguard') ||
          low.includes('prompt-guard') ||
          low.includes('moderation') ||
          low.includes('dall-e') ||
          low.includes('tts')
        );
      });

    return res.json({ ok: true, models });
  } catch (err: any) {
    const causeMsg = err.cause ? ` (${err.cause.message || err.cause.code || err.cause})` : '';
    return res.json({ ok: false, error: (err.message || 'Gagal memuat model.') + causeMsg });
  }
});

app.post("/api/generate-questions", async (req, res) => {
  try {
    const {
      aiProvider = 'gemini',
      customApiKey,
      customModel,
      customBaseUrl,
      subject,
      fase,
      grade,
      topic,
      language,
      capaianPembelajaran,
      learningObjective,
      cognitiveLevel,
      referenceText,
      count,
      questionTypes,
      optionCount,
      supportEquation,
      supportImage,
      supportGraph,
      supportDiagram,
      uniformLength,
      studentMisconception,
      noExtraExplanation,
      temperature = 0.7,
      additionalInstructions,
    } = req.body;

    const apiKey = (customApiKey || (aiProvider === 'gemini' ? (process.env.GEMINI_API_KEY || "") : "")).trim();
    if (!apiKey && aiProvider !== 'custom') {
      return res.status(400).json({
        error: `API Key untuk ${aiProvider.toUpperCase()} belum diisi. Masukkan API Key di Pengaturan AI.`,
      });
    }

    const rawTargetModel = (customModel || "").trim().replace(/^models\//, "");
    let targetModel = (!rawTargetModel || rawTargetModel === 'auto')
      ? (aiProvider === 'gemini' ? 'gemini-2.5-flash' : aiProvider === 'groq' ? 'llama-3.1-8b-instant' : aiProvider === 'deepseek' ? 'deepseek-chat' : aiProvider === 'openai' ? 'gpt-4o-mini' : aiProvider === 'openrouter' ? 'meta-llama/llama-3.3-70b-instruct' : 'llama3.2')
      : rawTargetModel;
    const typesStr = Array.isArray(questionTypes) && questionTypes.length > 0
      ? questionTypes.join(", ")
      : "PG";

    const prompt = `Anda adalah seorang ahli pembuat soal ujian profesional.
Bahasa Soal: ${language || "Indonesia"} (Pastikan isi soal dan jawaban menggunakan bahasa ini)
Pelajaran: ${subject}
Fase: ${fase || "-"}
Kelas: ${grade}
Materi: ${topic}
Capaian Pembelajaran: ${capaianPembelajaran || "-"}
Tujuan Pembelajaran: ${learningObjective || "-"}
Level Kognitif (Taksonomi Bloom): ${cognitiveLevel || "LOTS (C1-C2)"}
Jumlah Soal: ${count || 5}
Jenis Soal yang Boleh Digunakan: ${typesStr} (Bisa salah satu atau kombinasi jika ada beberapa jenis)
Jumlah Pilihan Jawaban (Jika pilihan ganda): ${optionCount || 5} (Misal 4 berarti sampai D, 5 berarti sampai E, 6 berarti sampai F). Kosongkan value Pilihan_E dan Pilihan_F jika tidak digunakan.
${referenceText ? `\nTeks Referensi / Bahan Bacaan:\n${referenceText}\n(Gunakan teks di atas sebagai dasar pembuatan soal)` : ""}
${uniformLength ? `\n- WAJIB Keseragaman Panjang Pilihan: Pastikan semua pilihan jawaban (A, B, C, D, dsb) memiliki panjang kalimat atau jumlah kata yang hampir sama (seragam) agar siswa tidak mudah menebak jawaban dari sekadar panjangnya pilihan.` : ""}
${studentMisconception ? `\n- WAJIB Gunakan Miskonsepsi Siswa: Untuk pilihan jawaban salah (pengecoh/distractor), rancang sedemikian rupa agar jawaban tersebut merepresentasikan miskonsepsi umum atau kesalahan hitung/analisa yang biasa dilakukan oleh siswa (jawaban masuk akal/plausible).` : ""}
${noExtraExplanation ? `\n- DILARANG Memberi Penjelasan Ekstra: Pada pilihan jawaban, berikan HANYA poin jawaban inti saja tanpa menambahkan alasan, argumen, kata "karena", atau teks penjelasan tambahan apa pun di dalam opsi jawaban.` : ""}
${supportEquation ? `\n- WAJIB sertakan soal yang mengandung RUMUS (Equation) matematika/fisika/kimia atau logika analitik menggunakan sintaks LaTeX (blok \`$$\` atau inline \`$\`).` : "\n- DILARANG menggunakan RUMUS (Equation) atau format LaTeX dalam bentuk apapun pada soal dan jawaban."}
${supportImage ? `\n- WAJIB sertakan GAMBAR ilustrasi pada soal (minimal di beberapa soal). Gunakan format markdown: \`![deskripsi](https://image.pollinations.ai/prompt/detailed-description-of-image-in-english?width=400&height=300&nologo=true)\` di dalam teks Soal. Ganti \`detailed-description-of-image-in-english\` dengan deskripsi spesifik tentang apa yang diilustrasikan di soal (WAJIB bahasa Inggris, pisahkan kata dengan tanda penghubung "-", BUKAN SPASI). Contoh: \`https://image.pollinations.ai/prompt/a-green-leaf-showing-photosynthesis-process?width=400&height=300&nologo=true\`.` : "\n- DILARANG menyertakan GAMBAR/ilustrasi markdown dalam bentuk apapun pada soal dan jawaban."}
${supportGraph ? `\n- WAJIB buatkan satu atau beberapa soal yang memerlukan analisis GRAFIK. Gunakan format markdown image QuickChart.io yang valid: \`![Grafik](https://quickchart.io/chart?bkg=white&w=500&h=300&c={"type":"bar","data":{"labels":["A","B"],"datasets":[{"label":"Nilai","data":[10,20]}]}})\`. PENTING: Pada teks label/judul chart, DILARANG memakai tanda kurung '(' atau ')' (tulis 'dalam Mbps' atau 'Mbps', JANGAN gunakan '(Mbps)'). Jangan gunakan spasi berlebihan dalam URL.` : "\n- DILARANG membuat soal yang menggunakan atau memerlukan analisis GRAFIK atau chart."}
${supportDiagram ? `\n- WAJIB buatkan satu atau beberapa soal yang memerlukan pemahaman DIAGRAM PROSES/SIKLUS (misalnya siklus air, fotosintesis, rantai makanan, daur biogeokimia, proses pembelahan sel, bagan alur). Tulis diagram menggunakan blok kode \`\`\`mermaid\ngraph TD\n  A --> B\n\`\`\` ATAU markdown \`![Diagram](https://mermaid.ink/img/{BASE64})\`. Diagram harus sederhana dan mudah dipahami.` : "\n- DILARANG membuat soal yang menggunakan DIAGRAM PROSES/SIKLUS berbasis Mermaid."}
${additionalInstructions ? `\nInstruksi Khusus Tambahan: ${additionalInstructions}` : ""}

PENTING: Jika ada rumus matematika, fisika, kimia, atau persamaan (misal pecahan, pangkat, dll), BERIKAN dalam format LaTeX menggunakan \`$\` untuk inline math (contoh: $E=mc^2$) dan \`$$\` untuk block math (contoh: $$ \\sqrt{x} $$). Jangan gunakan format lain. Gunakan perintah-perintah LaTeX standar (seperti \\frac, \\sqrt, pangkat, subscript) agar hasil dirender dengan baik. Saat menuliskan backslash LaTeX ke dalam value JSON, pastikan menggunakan dua backslash (contoh di dalam JSON: "Rumus \\\\frac{1}{2}"). Jangan gunakan backslash berlebihan (hindari \\\\\\\\frac).

Buatkan ${count || 5} soal dengan format JSON yang ketat mengikuti struktur berikut:
Setiap soal adalah objek dalam sebuah array dengan field (semua field huruf kapital di awal, sesuai dengan yang diminta di bawah, persis):
- Nomor: urutan soal (integer)
- Jenis_Soal: tipe soal, HANYA BISA: "PG" (Pilihan Ganda), "ESSAY", "PILIHAN ESSAY" (Pilihan Ganda dan Essay), "PGK" (Pilihan Ganda Kompleks - jawaban benar lebih dari 1), atau "MENGURUTKAN". Pastikan tipe yang dipilih sesuai dengan array Jenis Soal yang Boleh Digunakan (${typesStr}).
- Nilai: poin default soal (misal 10)
- Nama_Materi: Tipe String
- Judul_Referensi: Tipe String, bisa kosongkan "" jika tidak ada.
- Isi_Referensi: Tipe String, bagian bacaan cerita / teks rujukan soal, bisa ""
- Soal: Pertanyaan dari ujian, tidak boleh kosong.
- File_Audio_Video: Tipe string, tulis "" (kosong) saja.
- Pilihan_A: String pilihan A (Jika bukan Essay)
- Pilihan_B: String pilihan B
- Pilihan_C: String pilihan C
- Pilihan_D: String pilihan D
- Pilihan_E: String pilihan E (boleh kosong jika s/d D saja)
- Pilihan_F: String pilihan F (boleh kosong)
- Kunci_Jawaban_Non_Essay: Jawaban benar misal "A", atau "A,C" (TANPA SPASI) untuk PGK, kosongkan jika berupa full Essay.
- Jawaban_Essay: Kunci jawaban lengkap jika ESSAY atau PILIHAN ESSAY, kosongkan "" jika pure PG.

Hanya return JSON valid tanpa dibungkus kode block markdown \`\`\`json.`;

    if (aiProvider !== 'gemini') {
      const baseUrl = getDefaultBaseUrl(aiProvider, customBaseUrl);
      const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
      if (aiProvider === 'openrouter') {
        headers["HTTP-Referer"] = "https://cbtpijar.app";
        headers["X-Title"] = "CBT Pijar AI Generator";
      }

      let aiResponse = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: targetModel,
          messages: [
            { role: "system", content: "Anda adalah seorang ahli pembuat soal ujian profesional CBT Pijar. HANYA return JSON array valid tanpa markdown block ```json." },
            { role: "user", content: prompt }
          ],
          temperature: Math.max(0, Math.min(2, temperature)),
        })
      });

      if (!aiResponse.ok) {
        try {
          const candidates = await fetchRemoteModels(aiProvider, apiKey, customBaseUrl);
          for (const cand of candidates) {
            if (cand === targetModel) continue;
            const retryAi = await fetch(url, {
              method: "POST",
              headers,
              body: JSON.stringify({
                model: cand,
                messages: [
                  { role: "system", content: "Anda adalah seorang ahli pembuat soal ujian profesional CBT Pijar. HANYA return JSON array valid tanpa markdown block ```json." },
                  { role: "user", content: prompt }
                ],
                temperature: Math.max(0, Math.min(2, temperature)),
              })
            });
            if (retryAi.ok) {
              aiResponse = retryAi;
              targetModel = cand;
              break;
            }
          }
        } catch {}
      }

      if (!aiResponse.ok) {
        const errData: any = await aiResponse.json().catch(() => ({}));
        let apiMsg = errData.error?.message || errData.message || `Status HTTP ${aiResponse.status}`;
        if (apiMsg.includes('does not exist') || apiMsg.includes('do not have access')) {
          apiMsg = `Model "${targetModel}" tidak aktif pada akun Anda. Klik tombol "Muat Model Aktif Akun" di Pengaturan AI untuk memilih model yang tersedia di akun Anda.`;
        }
        return res.status(aiResponse.status).json({ error: `Gagal (${aiProvider.toUpperCase()}): ${apiMsg}` });
      }

      const data: any = await aiResponse.json();
      let rawText = data.choices?.[0]?.message?.content || "[]";
      const startIdx = rawText.indexOf("[");
      const endIdx = rawText.lastIndexOf("]");
      if (startIdx !== -1 && endIdx !== -1 && endIdx >= startIdx) {
        rawText = rawText.substring(startIdx, endIdx + 1);
      }
      const questions = JSON.parse(rawText.trim());
      return res.json({ questions, modelUsed: targetModel, provider: aiProvider });
    }

    const ai = new GoogleGenAI({ apiKey });

    let response;
    try {
      response = await ai.models.generateContent({
        model: targetModel,
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          temperature: Math.max(0, Math.min(1, temperature)),
        },
      });
    } catch (genError: any) {
      const errMsg = String(genError.message || '').toLowerCase();
      const isQuotaOrBusy = genError.status === 429 || genError.status === 503 || genError.status === 404 ||
        errMsg.includes('quota') || errMsg.includes('rate') || errMsg.includes('exhausted') ||
        errMsg.includes('overloaded') || errMsg.includes('high demand') || errMsg.includes('capacity');

      if (isQuotaOrBusy) {
        console.warn(`[Auto-Fallback Server] Model ${targetModel} batas kuota/sibuk (${genError.status}: ${errMsg}). Mencari model cadangan...`);
        const GEMINI_FALLBACKS = [
          'gemini-2.5-flash',
          'gemini-2.0-flash',
          'gemini-2.5-flash-lite',
          'gemini-2.0-flash-lite',
          'gemini-3-flash',
          'gemini-3.1-flash-lite',
          'gemini-3.5-flash-lite',
          'gemini-3.6-flash',
          'gemini-3.8-flash',
          'gemini-2.5-pro',
          'gemini-3.1-pro',
          'gemini-4-argon',
          'gemini-4-carbon',
          'gemini-4-hydrogen'
        ];
        let recovered = false;
        for (const cand of GEMINI_FALLBACKS) {
          if (cand === targetModel) continue;
          try {
            response = await ai.models.generateContent({
              model: cand,
              contents: prompt,
              config: {
                responseMimeType: "application/json",
                temperature: Math.max(0, Math.min(1, temperature)),
              },
            });
            targetModel = cand;
            recovered = true;
            console.info(`[Auto-Fallback Server] Berhasil dialihkan ke model: ${cand}`);
            break;
          } catch {}
        }
        if (!recovered) {
          throw genError;
        }
      } else {
        throw genError;
      }
    }

    let rawText = response.text || "[]";
    const startIdx = rawText.indexOf("[");
    const endIdx = rawText.lastIndexOf("]");
    if (startIdx !== -1 && endIdx !== -1 && endIdx >= startIdx) {
      rawText = rawText.substring(startIdx, endIdx + 1);
    } else {
      if (rawText.startsWith("```json")) rawText = rawText.substring(7);
      else if (rawText.startsWith("```")) rawText = rawText.substring(3);
      if (rawText.endsWith("```")) rawText = rawText.substring(0, rawText.length - 3);
    }

    const questions = JSON.parse(rawText.trim());
    return res.json({ questions, modelUsed: targetModel });
  } catch (error: any) {
    console.error("Error generating questions:", error);

    let errorMessage = "Terjadi kesalahan saat generate soal. Silakan coba lagi.";
    if (error.status === 404 || error.message?.includes("404")) {
      errorMessage = "Model Gemini yang dipilih tidak ditemukan atau belum tersedia. Silakan gunakan Gemini 2.5 Flash.";
    } else if (error.status === 429 || error.message?.includes("429") || error.message?.includes("quota")) {
      errorMessage = "Kuota request Gemini API telah habis atau terlalu banyak request. Silakan tunggu beberapa saat atau pilih model lain.";
    } else if (error.status === 503 || error.message?.includes("503")) {
      errorMessage = "Layanan sedang sibuk (High Demand). Silakan tunggu sebentar dan coba lagi.";
    } else if (error.message) {
      errorMessage = error.message;
    }

    return res.status(500).json({ error: errorMessage });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);

    app.use("*", async (req, res, next) => {
      const url = req.originalUrl;
      try {
        const indexPath = path.resolve(process.cwd(), "index.html");
        let html = await fs.promises.readFile(indexPath, "utf-8");
        html = await vite.transformIndexHtml(url, html);
        res.status(200).set({ "Content-Type": "text/html" }).end(html);
      } catch (e: any) {
        vite.ssrFixStacktrace(e);
        next(e);
      }
    });
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();

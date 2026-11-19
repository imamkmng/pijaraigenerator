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
  if (provider === '9router') {
    return customBaseUrl?.trim() || 'http://localhost:20128/v1';
  }
  if (customBaseUrl && customBaseUrl.trim() && !customBaseUrl.includes('localhost:11434') && !customBaseUrl.includes('localhost:20128')) {
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
      ? (aiProvider === 'gemini' ? 'gemini-2.5-flash' : aiProvider === 'groq' ? 'llama-3.1-8b-instant' : aiProvider === 'deepseek' ? 'deepseek-chat' : aiProvider === 'openai' ? 'gpt-4o-mini' : aiProvider === 'openrouter' ? 'meta-llama/llama-3.3-70b-instruct' : aiProvider === '9router' ? 'gemini-2.5-flash' : 'llama3.2')
      : rawModel;

    if (!apiKey && aiProvider !== 'custom' && aiProvider !== '9router') {
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

function normalizeQuestionObject(raw: any, index: number) {
  if (!raw || typeof raw !== 'object') {
    return {
      Nomor: index + 1,
      Jenis_Soal: 'PG',
      Nilai: 10,
      Nama_Materi: '',
      Judul_Referensi: '',
      Isi_Referensi: '',
      Soal: String(raw || ''),
      File_Audio_Video: '',
      Pilihan_A: '',
      Pilihan_B: '',
      Pilihan_C: '',
      Pilihan_D: '',
      Kunci_Jawaban_Non_Essay: '',
      Jawaban_Essay: ''
    };
  }

  const soal = raw.Soal || raw.soal || raw.question || raw.pertanyaan || raw.text || raw.Teks || '';
  const nomor = Number(raw.Nomor || raw.nomor || raw.no || raw.No || index + 1) || (index + 1);

  let jenis = 'PG';
  const rawJenis = String(raw.Jenis_Soal || raw.jenis_soal || raw.jenisSoal || raw.type || raw.Type || '').toUpperCase().trim();
  if (['PG', 'ESSAY', 'PILIHAN ESSAY', 'PGK', 'MENGURUTKAN'].includes(rawJenis)) {
    jenis = rawJenis;
  } else if (rawJenis.includes('KOMPLEKS') || rawJenis.includes('PGK')) {
    jenis = 'PGK';
  } else if (rawJenis.includes('PILIHAN') && rawJenis.includes('ESSAY')) {
    jenis = 'PILIHAN ESSAY';
  } else if (rawJenis.includes('ESSAY') || rawJenis.includes('ESAI')) {
    jenis = 'ESSAY';
  } else if (rawJenis.includes('URUT') || rawJenis.includes('MENGURUTKAN')) {
    jenis = 'MENGURUTKAN';
  }

// Helper untuk mencari posisi indeks awal opsi A, B, C di dalam teks (baik multiline maupun inline)
function findOptionsStartIndex(text: string): number {
  if (!text || typeof text !== 'string') return -1;

  // 1. Cek apakah teks diawali langsung oleh opsi (misal "A. Komputer..." atau "Pilihan: A. ...")
  const startMatch = text.match(/^\s*(?:(?:Pilihan(?:[\s_]*Jawaban)?|Opsi|Options?)\s*[:\-]?\s*)?[\[\(]?[A-Fa-f][\]\)\.\:]/i);
  if (startMatch) {
    return 0;
  }

  // 2. Opsi yang diawali baris baru (\nA. atau \n(A) atau \n- A.)
  const multilineMatch = text.match(/(?:\n|\r\n)\s*(?:(?:Pilihan(?:[\s_]*Jawaban)?|Opsi|Options?)\s*[:\-]?\s*)?[\[\(]?[A-Fa-f][\]\)\.\:]/i);
  if (multilineMatch && multilineMatch.index !== undefined) {
    return multilineMatch.index;
  }

  // 3. Opsi inline: sequence A. ... B. ... C. ... pada baris yang sama (contoh: "... manusia? A. ... B. ... C. ...")
  const inlineMatch = text.match(/(?:^|[\s\.\?\:\;\!])\s*(?:(?:Pilihan(?:[\s_]*Jawaban)?|Opsi|Options?)\s*[:\-]?\s*)?[\[\(]?A[\]\)\.\:]\s+[\s\S]+?[\s\.\?\:\;\!][\[\(]?B[\]\)\.\:]\s+[\s\S]+?[\s\.\?\:\;\!][\[\(]?C[\]\)\.\:]/i);
  if (inlineMatch && inlineMatch.index !== undefined) {
    const sub = text.substring(inlineMatch.index);
    const aMatch = sub.match(/(?:(?:Pilihan(?:[\s_]*Jawaban)?|Opsi|Options?)\s*[:\-]?\s*)?[\[\(]?A[\]\)\.\:]/i);
    if (aMatch && aMatch.index !== undefined) {
      return inlineMatch.index + aMatch.index;
    }
    return inlineMatch.index;
  }

  return -1;
}

// Helper untuk mengekstrak opsi dari teks baik multiline maupun satu baris (inline)
function extractOptionsFromText(text: string): Record<string, string> {
  if (!text || typeof text !== 'string') return {};
  const found: Record<string, string> = {};

  const regex = /(?:^|[\s\n\r])\s*(?:[\*\-\•]\s*)?(?:[\[\(])?([A-Fa-f])[\]\)\.\:]\s*/g;
  const matches: { letter: string; index: number; length: number }[] = [];
  let m;
  while ((m = regex.exec(text)) !== null) {
    matches.push({ letter: m[1].toUpperCase(), index: m.index, length: m[0].length });
  }

  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i];
    const next = matches[i + 1];
    const start = cur.index + cur.length;
    const end = next ? next.index : text.length;
    const content = text.substring(start, end).trim();
    if (!found[cur.letter] && content) {
      found[cur.letter] = content;
    }
  }

  return found;
}

// Helper untuk membersihkan wacana/stimulus agar BEBAS dari pilihan jawaban A, B, C, D dan kalimat soal
function cleanStimulusText(text: string, currentSoal?: string): string {
  if (!text || typeof text !== 'string') return '';
  let s = text.trim();

  // 1. Potong bagian opsi jika terdeteksi di dalam stimulus
  const optIdx = findOptionsStartIndex(s);
  if (optIdx === 0) {
    return '';
  }
  if (optIdx > 0) {
    s = s.substring(0, optIdx).trim();
  }

  // Bersihkan sisa header "Pilihan Jawaban:" atau "Pertanyaan:" di ujung teks wacana
  s = s.replace(/(?:(?:\n|\r\n)?\s*(?:Pilihan(?:[\s_]*Jawaban)?|Opsi|Daftar Pilihan|Pertanyaan|Soal)\s*[:\-]?\s*)$/i, '').trim();

  // 2. Jika ada kalimat soal yang ikut tertempel di akhir wacana, potong kalimat soalnya
  if (currentSoal && typeof currentSoal === 'string') {
    const cleanCurrentSoal = currentSoal.trim();
    if (cleanCurrentSoal && s.toLowerCase().endsWith(cleanCurrentSoal.toLowerCase())) {
      s = s.substring(0, s.length - cleanCurrentSoal.length).trim();
    }
  }

  // 3. Periksa apakah wacana yang tersisa sebenarnya HANYA berupa pertanyaan (bukan wacana bacaan)
  if (currentSoal && typeof currentSoal === 'string') {
    const normS = s.replace(/\s+/g, ' ').trim().toLowerCase();
    const normSoal = currentSoal.replace(/\s+/g, ' ').trim().toLowerCase();
    if (normS === normSoal || (normSoal.length > 20 && (normS.includes(normSoal) || normSoal.includes(normS)))) {
      return '';
    }
  }

  // Jika teks wacana hanya 1 kalimat pertanyaan langsung tanpa narasi wacana
  const isDirectQuestion = /^(?:Mengapa|Bagaimana|Apa|Apakah|Siapa|Siapakah|Manakah|Berapa|Berapakah|Di\s*mana|Ke\s*mana|Dari\s*mana|Kenapa|Jelaskan|Sebutkan|Tentukan|Berikut\s+yang|Pernyataan\s+yang|Dibawah\s+ini|Di\s+bawah\s+ini|Yang\s+merupakan)\b/i.test(s) && (s.endsWith('?') || s.endsWith(':')) && s.length < 300;
  if (isDirectQuestion && !s.includes('\n')) {
    return '';
  }

  return s;
}

// Helper untuk membersihkan teks soal agar tidak memuat opsi A, B, C, D di dalamnya jika opsi sudah ada di field terpisah
function cleanSoalText(text: string, hasSeparateOptions: boolean): string {
  if (!text || typeof text !== 'string') return '';
  let s = text.trim();
  if (hasSeparateOptions) {
    const optIdx = findOptionsStartIndex(s);
    if (optIdx > 5) {
      s = s.substring(0, optIdx).trim();
    }
    s = s.replace(/(?:(?:\n|\r\n)?\s*(?:Pilihan(?:[\s_]*Jawaban)?|Opsi|Daftar Pilihan)\s*[:\-]?\s*)$/i, '').trim();
  }
  return s;
}

function normalizeQuestionObject(raw: any, index: number) {
  if (!raw || typeof raw !== 'object') {
    return {
      Nomor: index + 1,
      Jenis_Soal: 'PG',
      Nilai: 10,
      Nama_Materi: '',
      Judul_Referensi: '',
      Isi_Referensi: '',
      Soal: String(raw || ''),
      File_Audio_Video: '',
      Pilihan_A: '',
      Pilihan_B: '',
      Pilihan_C: '',
      Pilihan_D: '',
      Kunci_Jawaban_Non_Essay: '',
      Jawaban_Essay: ''
    };
  }

  const soal = raw.Soal || raw.soal || raw.question || raw.pertanyaan || raw.text || raw.Teks || '';
  const nomor = Number(raw.Nomor || raw.nomor || raw.no || raw.No || index + 1) || (index + 1);

  let jenis = 'PG';
  const rawJenis = String(raw.Jenis_Soal || raw.jenis_soal || raw.jenisSoal || raw.type || raw.Type || '').toUpperCase().trim();
  if (['PG', 'ESSAY', 'PILIHAN ESSAY', 'PGK', 'MENGURUTKAN'].includes(rawJenis)) {
    jenis = rawJenis;
  } else if (rawJenis.includes('KOMPLEKS') || rawJenis.includes('PGK')) {
    jenis = 'PGK';
  } else if (rawJenis.includes('PILIHAN') && rawJenis.includes('ESSAY')) {
    jenis = 'PILIHAN ESSAY';
  } else if (rawJenis.includes('ESSAY') || rawJenis.includes('ESAI')) {
    jenis = 'ESSAY';
  } else if (rawJenis.includes('URUT') || rawJenis.includes('MENGURUTKAN')) {
    jenis = 'MENGURUTKAN';
  }

  const cleanOption = (val: any): string => {
    if (val === undefined || val === null) return '';
    let s = String(val).trim();
    // Bersihkan awalan huruf opsi redundan seperti "A. ", "A) ", "(A) ", "A: "
    s = s.replace(/^(?:[\[\(]?[A-Fa-f][\]\)\.\:]\s*|\-\s*)/, '').trim();
    return s;
  };

  let optA = raw.Pilihan_A ?? raw.pilihan_a ?? raw.pilihanA ?? raw.opsi_a ?? raw.opsiA ?? raw.A ?? raw.a ?? '';
  let optB = raw.Pilihan_B ?? raw.pilihan_b ?? raw.pilihanB ?? raw.opsi_b ?? raw.opsiB ?? raw.B ?? raw.b ?? '';
  let optC = raw.Pilihan_C ?? raw.pilihan_c ?? raw.pilihanC ?? raw.opsi_c ?? raw.opsiC ?? raw.C ?? raw.c ?? '';
  let optD = raw.Pilihan_D ?? raw.pilihan_d ?? raw.pilihanD ?? raw.opsi_d ?? raw.opsiD ?? raw.D ?? raw.d ?? '';
  let optE = raw.Pilihan_E ?? raw.pilihan_e ?? raw.pilihanE ?? raw.opsi_e ?? raw.opsiE ?? raw.E ?? raw.e ?? '';
  let optF = raw.Pilihan_F ?? raw.pilihan_f ?? raw.pilihanF ?? raw.opsi_f ?? raw.opsiF ?? raw.F ?? raw.f ?? '';

  const optionsArr = Array.isArray(raw.options) ? raw.options : (Array.isArray(raw.pilihan) ? raw.pilihan : null);
  if (optionsArr && optionsArr.length > 0) {
    const getOptText = (item: any) => typeof item === 'string' ? item : (item?.text || item?.label || item?.value || '');
    if (!optA && optionsArr[0] !== undefined) optA = getOptText(optionsArr[0]);
    if (!optB && optionsArr[1] !== undefined) optB = getOptText(optionsArr[1]);
    if (!optC && optionsArr[2] !== undefined) optC = getOptText(optionsArr[2]);
    if (!optD && optionsArr[3] !== undefined) optD = getOptText(optionsArr[3]);
    if (!optE && optionsArr[4] !== undefined) optE = getOptText(optionsArr[4]);
    if (!optF && optionsArr[5] !== undefined) optF = getOptText(optionsArr[5]);
  }

  const rawIsiRef = String(raw.Isi_Referensi || raw.isi_referensi || raw.stimulus || raw.bacaan || '');
  let effectiveSoal = String(soal || '').trim();

  // Jika AI keliru menaruh opsi di dalam Isi_Referensi atau Soal, selamatkan opsi tersebut jika optA masih kosong
  if (!optA && !optB) {
    const optsFromRef = extractOptionsFromText(rawIsiRef);
    const optsFromSoal = extractOptionsFromText(effectiveSoal);
    const fallbackOpts = Object.keys(optsFromRef).length >= 2 ? optsFromRef : optsFromSoal;
    if (fallbackOpts['A']) optA = fallbackOpts['A'];
    if (fallbackOpts['B']) optB = fallbackOpts['B'];
    if (fallbackOpts['C']) optC = fallbackOpts['C'];
    if (fallbackOpts['D']) optD = fallbackOpts['D'];
    if (fallbackOpts['E']) optE = fallbackOpts['E'];
    if (fallbackOpts['F']) optF = fallbackOpts['F'];
  }

  // Jika Soal kosong tapi Isi_Referensi memiliki kalimat pertanyaan sebelum opsi
  if (!effectiveSoal && rawIsiRef) {
    const optIdx = findOptionsStartIndex(rawIsiRef);
    if (optIdx > 0) {
      effectiveSoal = rawIsiRef.substring(0, optIdx).trim();
    }
  }

  const hasSeparateOpts = Boolean(optA || optB);
  const cleanSoalResult = cleanSoalText(effectiveSoal, hasSeparateOpts);

  // Bersihkan wacana/stimulus agar BEBAS dari pilihan jawaban A, B, C, D dan kalimat soal
  const cleanIsiRef = cleanStimulusText(rawIsiRef, cleanSoalResult || effectiveSoal);

  let kunci = raw.Kunci_Jawaban_Non_Essay ?? raw.kunci_jawaban_non_essay ?? raw.kunci_jawaban ?? raw.kunciJawaban ?? raw.kunci ?? raw.jawaban_benar ?? raw.answer ?? raw.correct ?? '';
  if (Array.isArray(kunci)) {
    kunci = kunci.join(',');
  }
  let cleanKunci = String(kunci).trim().toUpperCase();
  const matchedKey = cleanKunci.match(/[A-F](?:\s*,\s*[A-F])*/);
  if (matchedKey) {
    cleanKunci = matchedKey[0].replace(/\s+/g, '');
  }

  const essay = raw.Jawaban_Essay ?? raw.jawaban_essay ?? raw.jawabanEssay ?? raw.pedoman_essay ?? raw.kunci_essay ?? raw.rubrik ?? '';

  return {
    Nomor: nomor,
    Jenis_Soal: jenis,
    Nilai: Number(raw.Nilai || raw.nilai || 10) || 10,
    Nama_Materi: String(raw.Nama_Materi || raw.nama_materi || raw.materi || raw.topik || ''),
    Judul_Referensi: cleanIsiRef ? String(raw.Judul_Referensi || raw.judul_referensi || raw.judul || '') : '',
    Isi_Referensi: cleanIsiRef,
    Soal: cleanSoalResult || effectiveSoal || String(soal),
    File_Audio_Video: '',
    Pilihan_A: optA !== '' ? cleanOption(optA) : undefined,
    Pilihan_B: optB !== '' ? cleanOption(optB) : undefined,
    Pilihan_C: optC !== '' ? cleanOption(optC) : undefined,
    Pilihan_D: optD !== '' ? cleanOption(optD) : undefined,
    Pilihan_E: optE !== '' ? cleanOption(optE) : undefined,
    Pilihan_F: optF !== '' ? cleanOption(optF) : undefined,
    Kunci_Jawaban_Non_Essay: cleanKunci,
    Jawaban_Essay: String(essay)
  };
}

// Helper to extract individual question fields even if JSON.parse fails on malformed quotes
function extractFieldsFromObjectBlock(block: string, index: number): any {
  if (!block || typeof block !== 'string') return null;

  const getField = (fieldPattern: string): string => {
    const regex = new RegExp(`(?:"|')?(?:${fieldPattern})(?:"|')?\\s*:\\s*(?:"|')([\\s\\S]*?)(?=(?:"|')\\s*,\\s*(?:"|')?[a-zA-Z_]+(?:"|')?\\s*:|(?:"|')\\s*\\}|$|$)`, 'i');
    const m = block.match(regex);
    if (m) {
      return m[1].replace(/\\"/g, '"').replace(/\\n/g, '\n').trim();
    }
    const numRegex = new RegExp(`(?:"|')?(?:${fieldPattern})(?:"|')?\\s*:\\s*([0-9A-Za-z_\\-\\.]+)`, 'i');
    const numM = block.match(numRegex);
    if (numM) return numM[1].trim();
    return '';
  };

  const soal = getField('Soal|soal|question|pertanyaan|teks|text');
  const optA = getField('Pilihan_A|pilihan_a|opsi_a|A');
  const optB = getField('Pilihan_B|pilihan_b|opsi_b|B');
  const optC = getField('Pilihan_C|pilihan_c|opsi_c|C');
  const optD = getField('Pilihan_D|pilihan_d|opsi_d|D');
  const optE = getField('Pilihan_E|pilihan_e|opsi_e|E');
  const optF = getField('Pilihan_F|pilihan_f|opsi_f|F');
  const kunci = getField('Kunci_Jawaban_Non_Essay|kunci_jawaban_non_essay|kunci_jawaban|kunci|jawaban_benar|answer|key');
  const essay = getField('Jawaban_Essay|jawaban_essay|pembahasan|pedoman_essay');
  const jenis = getField('Jenis_Soal|jenis_soal|type');
  const nomor = parseInt(getField('Nomor|nomor|no|No')) || (index + 1);

  if (!soal && !optA) return null;

  return normalizeQuestionObject({
    Nomor: nomor,
    Jenis_Soal: jenis || (optA ? 'PG' : 'ESSAY'),
    Nilai: 10,
    Nama_Materi: getField('Nama_Materi|nama_materi|materi|topik'),
    Judul_Referensi: getField('Judul_Referensi|judul_referensi|judul'),
    Isi_Referensi: getField('Isi_Referensi|isi_referensi|stimulus|bacaan'),
    Soal: soal || `Soal nomor ${nomor}`,
    File_Audio_Video: '',
    Pilihan_A: optA,
    Pilihan_B: optB,
    Pilihan_C: optC,
    Pilihan_D: optD,
    Pilihan_E: optE,
    Pilihan_F: optF,
    Kunci_Jawaban_Non_Essay: kunci,
    Jawaban_Essay: essay
  }, index);
}

// Multi-tier resilient JSON string repair engine
function repairJsonString(input: string): string {
  if (!input || typeof input !== 'string') return '';

  let text = input
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '')
    .trim();

  // Strip markdown code fences if wrapped
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch) {
    text = fenceMatch[1].trim();
  } else {
    text = text.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/\s*```$/, '').trim();
  }

  // Convert Python literals when appearing as values
  text = text.replace(/:\s*True\b/g, ': true')
             .replace(/:\s*False\b/g, ': false')
             .replace(/:\s*None\b/g, ': null');

  // Normalize smart quotes
  text = text.replace(/[\u201C\u201D]/g, '"').replace(/[\u2018\u2019]/g, "'");

  // Character-by-character scanner for safe LaTeX and control character escaping
  let out = '';
  let inString = false;
  let i = 0;
  const len = text.length;

  while (i < len) {
    const char = text[i];

    if (!inString) {
      if (char === '"') {
        inString = true;
        out += char;
        i++;
      } else {
        out += char;
        i++;
      }
    } else {
      // Inside string literal
      if (char === '"') {
        inString = false;
        out += char;
        i++;
      } else if (char === '\\') {
        const next = text[i + 1];
        if (next === undefined) {
          out += '\\\\';
          i++;
          break;
        }

        if (next === '\\') {
          // Already escaped backslash "\\" -> preserve exactly as "\\"
          out += '\\\\';
          i += 2;
        } else if (next === '"') {
          // Escaped quote '\"'
          out += '\\"';
          i += 2;
        } else if (next === '/') {
          out += '\\/';
          i += 2;
        } else if (next === 'u' && /^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6))) {
          // Valid unicode escape \uXXXX
          out += text.slice(i, i + 6);
          i += 6;
        } else {
          // Check for LaTeX commands starting with letters (including times, frac, theta, etc.)
          const remainder = text.slice(i + 1);
          const latexWordMatch = remainder.match(/^(?:times|theta|text|tan|tau|triangle|frac|forall|rho|right|root|rad|neq|nabla|nu|neg|bullet|beta|bar|binom|sum|sqrt|sin|cos|log|ln|lim|le|ge|pm|partial|cdot|circ|alpha|approx|vec|hat|omega|gamma|lambda|phi|psi|sigma|delta|pi|infty|int)\b/i);

          if (latexWordMatch) {
            out += '\\\\' + latexWordMatch[0];
            i += 1 + latexWordMatch[0].length;
          } else if (next === 'n' || next === 'r' || next === 't' || next === 'b' || next === 'f') {
            out += '\\' + next;
            i += 2;
          } else {
            // Invalid JSON escape sequence (e.g. \s in \sqrt, \{, \}, \_, \$, \., etc.) -> double it
            out += '\\\\' + next;
            i += 2;
          }
        }
      } else if (char === '\n') {
        // Unescaped literal newline inside string
        out += '\\n';
        i++;
      } else if (char === '\r') {
        // Unescaped literal carriage return inside string
        out += '\\r';
        i++;
      } else if (char === '\t') {
        // Unescaped literal tab inside string
        out += '\\t';
        i++;
      } else {
        out += char;
        i++;
      }
    }
  }

  if (inString) {
    out += '"';
  }

  // Remove trailing commas before closing brackets/braces
  out = out.replace(/,\s*([\]}])/g, '$1');

  return out.trim();
}

// Helper to extract questions from plain text if AI answered in conversational/markdown format instead of strict JSON
function parseFromPlainText(text: string): any[] {
  if (!text || typeof text !== 'string') return [];

  const cleaned = text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '')
    .replace(/```(?:json|markdown)?/gi, '')
    .replace(/```/g, '')
    .trim();

  // Pattern: splits questions by markdown headers or numbers:
  // e.g. "### Soal 1", "### 1.", "1.", "1)", "Soal 1:", "Pertanyaan 1:", "**1.**", "No. 1"
  const questionBlocks = cleaned.split(/(?:^|\n)\s*(?:#{1,6}\s*)?(?:\*\*)?(?:(?:Soal|Nomor|Pertanyaan|No\.?)\s*)?(\d+)[\.\:\)]\s*(?:\*\*)?/i);

  const results: any[] = [];
  if (questionBlocks.length >= 3) {
    for (let i = 1; i < questionBlocks.length; i += 2) {
      const qNum = parseInt(questionBlocks[i]) || Math.floor(i / 2) + 1;
      const blockContent = questionBlocks[i + 1] || '';

      // Extract Options: A, B, C, D, E, F with various bullet styles
      let soalText = blockContent;
      const options: Record<string, string> = {};

      const optRegex = /(?:^|\n)\s*(?:[\*\-\•]\s*)?(?:\*\*)?(?:[\[\(])?([A-Fa-f])[\]\)\.\:]\s*(?:\*\*)?\s*([^\n]+)/g;
      let optMatch;
      let firstOptIdx = -1;
      while ((optMatch = optRegex.exec(blockContent)) !== null) {
        if (firstOptIdx === -1) firstOptIdx = optMatch.index;
        const letter = optMatch[1].toUpperCase();
        if (!options[letter]) {
          options[letter] = optMatch[2].trim();
        }
      }

      if (firstOptIdx !== -1) {
        soalText = blockContent.substring(0, firstOptIdx).trim();
      }

      // Extract answer key
      let kunci = '';
      const keyMatch = blockContent.match(/(?:Kunci(?:[\s_]*Jawaban)?|Jawaban(?:[\s_]*Benar)?|Key|Answer)\s*[:=]\s*(?:\*\*)?(?:[\[\(])?([A-Fa-f,\s]+)(?:[\]\)])?(?:\*\*)?/i);
      if (keyMatch) {
        kunci = keyMatch[1].replace(/[^A-Fa-f,]/g, '').toUpperCase().trim();
      }

      // Extract essay answer or explanation if present
      let essay = '';
      const essayMatch = blockContent.match(/(?:Jawaban(?:[\s_]*Essay)?|Pedoman(?:[\s_]*Essay)?|Pembahasan|Penjelasan)\s*[:=]\s*([^\n]+)/i);
      if (essayMatch) {
        essay = essayMatch[1].trim();
      }

      soalText = soalText.replace(/^(?:Soal|Pertanyaan|Nomor|No\.?)\s*[:\-]\s*/i, '').trim();

      const hasOptions = Object.keys(options).length > 0;
      if (soalText || hasOptions) {
        results.push(normalizeQuestionObject({
          Nomor: qNum,
          Jenis_Soal: hasOptions ? 'PG' : 'ESSAY',
          Nilai: 10,
          Nama_Materi: '',
          Judul_Referensi: '',
          Isi_Referensi: '',
          Soal: soalText || `Soal nomor ${qNum}`,
          File_Audio_Video: '',
          Pilihan_A: options['A'] || '',
          Pilihan_B: options['B'] || '',
          Pilihan_C: options['C'] || '',
          Pilihan_D: options['D'] || '',
          Pilihan_E: options['E'] || '',
          Pilihan_F: options['F'] || '',
          Kunci_Jawaban_Non_Essay: kunci || (hasOptions ? 'A' : ''),
          Jawaban_Essay: essay
        }, results.length));
      }
    }
  }

  // Fallback: If split by number failed, but there is still some text with options
  if (results.length === 0 && cleaned.length > 20) {
    const optRegex = /(?:^|\n)\s*(?:[\*\-\•]\s*)?(?:\*\*)?(?:[\[\(])?([A-Fa-f])[\]\)\.\:]\s*(?:\*\*)?\s*([^\n]+)/g;
    const options: Record<string, string> = {};
    let optMatch;
    let firstOptIdx = -1;
    while ((optMatch = optRegex.exec(cleaned)) !== null) {
      if (firstOptIdx === -1) firstOptIdx = optMatch.index;
      const letter = optMatch[1].toUpperCase();
      if (!options[letter]) options[letter] = optMatch[2].trim();
    }
    if (Object.keys(options).length > 0) {
      const qText = firstOptIdx !== -1 ? cleaned.substring(0, firstOptIdx).trim() : cleaned;
      results.push(normalizeQuestionObject({
        Nomor: 1,
        Jenis_Soal: 'PG',
        Nilai: 10,
        Soal: qText,
        Pilihan_A: options['A'] || '',
        Pilihan_B: options['B'] || '',
        Pilihan_C: options['C'] || '',
        Pilihan_D: options['D'] || '',
        Kunci_Jawaban_Non_Essay: 'A'
      }, 0));
    }
  }

  return results;
}

function parseQuestionsJson(rawText: string): any[] {
  if (!rawText || typeof rawText !== 'string') return [];

  const cleanBase = rawText
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '')
    .trim();

  // Strip markdown code fences
  let unFenced = cleanBase;
  const fenceMatch = cleanBase.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch) {
    unFenced = fenceMatch[1].trim();
  } else {
    unFenced = cleanBase.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/\s*```$/, '').trim();
  }

  const repaired = repairJsonString(unFenced);
  const candidatesToTry = [unFenced, repaired, cleanBase];

  const extractArray = (val: any) => {
    if (!val) return null;
    if (Array.isArray(val) && val.length > 0) {
      return val.map((item, idx) => normalizeQuestionObject(item, idx));
    }
    if (typeof val === 'object') {
      const potentialKeys = ['questions', 'soal', 'data', 'items', 'daftar_soal', 'bank_soal', 'result', 'results', 'output'];
      for (const k of potentialKeys) {
        if (Array.isArray(val[k]) && val[k].length > 0) {
          return val[k].map((item: any, idx: number) => normalizeQuestionObject(item, idx));
        }
      }
      const firstArray = Object.values(val).find(v => Array.isArray(v) && v.length > 0);
      if (firstArray && Array.isArray(firstArray)) {
        return firstArray.map((item: any, idx: number) => normalizeQuestionObject(item, idx));
      }
      if (val.Soal || val.soal || val.question || val.pertanyaan) {
        return [normalizeQuestionObject(val, 0)];
      }
      const values = Object.values(val);
      if (values.length > 0 && values.every(v => v && typeof v === 'object' && ((v as any).Soal || (v as any).soal || (v as any).question))) {
        return values.map((item: any, idx: number) => normalizeQuestionObject(item, idx));
      }
    }
    return null;
  };

  // Strategy 1: Direct JSON parsing
  for (const cand of candidatesToTry) {
    try {
      const parsed = JSON.parse(cand);
      const res = extractArray(parsed);
      if (res && res.length > 0) return res;
    } catch {}
  }

  // Strategy 2: Array substring [ ... ]
  for (const cand of candidatesToTry) {
    const startIdx = cand.indexOf('[');
    const endIdx = cand.lastIndexOf(']');
    if (startIdx !== -1 && endIdx > startIdx) {
      const sub = cand.substring(startIdx, endIdx + 1);
      try {
        const parsed = JSON.parse(sub);
        const res = extractArray(parsed);
        if (res && res.length > 0) return res;
      } catch {
        try {
          const repSub = repairJsonString(sub);
          const parsed = JSON.parse(repSub);
          const res = extractArray(parsed);
          if (res && res.length > 0) return res;
        } catch {}
      }
    }
  }

  // Strategy 3: Object substring { ... }
  for (const cand of candidatesToTry) {
    const objStart = cand.indexOf('{');
    const objEnd = cand.lastIndexOf('}');
    if (objStart !== -1 && objEnd > objStart) {
      const sub = cand.substring(objStart, objEnd + 1);
      try {
        const parsed = JSON.parse(sub);
        const res = extractArray(parsed);
        if (res && res.length > 0) return res;
      } catch {
        try {
          const repSub = repairJsonString(sub);
          const parsed = JSON.parse(repSub);
          const res = extractArray(parsed);
          if (res && res.length > 0) return res;
        } catch {}
      }
    }
  }

  // Strategy 4: Truncated array heal
  for (const cand of candidatesToTry) {
    const startIdx = cand.indexOf('[');
    if (startIdx !== -1) {
      const lastBrace = cand.lastIndexOf('}');
      if (lastBrace > startIdx) {
        const healed = cand.substring(startIdx, lastBrace + 1) + ']';
        try {
          const repHealed = repairJsonString(healed);
          const parsed = JSON.parse(repHealed);
          const res = extractArray(parsed);
          if (res && res.length > 0) return res;
        } catch {}
      }
    }
  }

  // Strategy 5: Depth-aware brace matcher for individual objects (Preserves LaTeX braces {} safely)
  try {
    const individualObjects: any[] = [];
    let inStr = false;
    let isEsc = false;
    let depth = 0;
    let startPos = -1;

    for (let i = 0; i < cleanBase.length; i++) {
      const ch = cleanBase[i];
      if (isEsc) {
        isEsc = false;
        continue;
      }
      if (ch === '\\') {
        isEsc = true;
        continue;
      }
      if (ch === '"') {
        inStr = !inStr;
        continue;
      }
      if (!inStr) {
        if (ch === '{') {
          if (depth === 0) startPos = i;
          depth++;
        } else if (ch === '}') {
          depth--;
          if (depth === 0 && startPos !== -1) {
            const block = cleanBase.substring(startPos, i + 1);
            try {
              const parsed = JSON.parse(repairJsonString(block));
              if (parsed && typeof parsed === 'object' && (parsed.Soal || parsed.soal || parsed.question || parsed.pertanyaan || parsed.Pilihan_A || parsed.A)) {
                individualObjects.push(normalizeQuestionObject(parsed, individualObjects.length));
              }
            } catch {
              // Try regex field extractor on the block if JSON.parse fails
              const extracted = extractFieldsFromObjectBlock(block, individualObjects.length);
              if (extracted) {
                individualObjects.push(extracted);
              }
            }
            startPos = -1;
          }
        }
      }
    }
    if (individualObjects.length > 0) {
      return individualObjects;
    }
  } catch {}

  // Strategy 6: Regex field extraction on the entire response
  try {
    const objectBlocks = cleanBase.split(/(?:\{(?=\s*"(?:Nomor|Soal|Jenis_Soal)"))/i);
    if (objectBlocks.length > 1) {
      const fieldQuestions: any[] = [];
      for (const b of objectBlocks) {
        const item = extractFieldsFromObjectBlock('{' + b, fieldQuestions.length);
        if (item) fieldQuestions.push(item);
      }
      if (fieldQuestions.length > 0) return fieldQuestions;
    }
  } catch {}

  // Strategy 7: Plain-text / Markdown Question Extractor (when model responds in natural text)
  const plainTextQuestions = parseFromPlainText(cleanBase);
  if (plainTextQuestions.length > 0) {
    return plainTextQuestions;
  }

  throw new Error('Respons model tidak mengandung format soal yang dapat dibaca. Silakan coba generate kembali.');
}

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
    if (!apiKey && aiProvider !== 'custom' && aiProvider !== '9router') {
      return res.status(400).json({
        error: `API Key untuk ${aiProvider.toUpperCase()} belum diisi. Masukkan API Key di Pengaturan AI.`,
      });
    }

    const rawTargetModel = (customModel || "").trim().replace(/^models\//, "");
    let targetModel = (!rawTargetModel || rawTargetModel === 'auto')
      ? (aiProvider === 'gemini' ? 'gemini-2.5-flash' : aiProvider === 'groq' ? 'llama-3.1-8b-instant' : aiProvider === 'deepseek' ? 'deepseek-chat' : aiProvider === 'openai' ? 'gpt-4o-mini' : aiProvider === 'openrouter' ? 'meta-llama/llama-3.3-70b-instruct' : aiProvider === '9router' ? 'gemini-2.5-flash' : 'llama3.2')
      : rawTargetModel;
    const typesStr = Array.isArray(questionTypes) && questionTypes.length > 0
      ? questionTypes.join(", ")
      : "PG";
    const targetCount = Math.max(1, Math.min(100, Number(count) || 5));
    const optCount = Math.max(3, Math.min(6, Number(optionCount) || 5));
    const lastOptionLetter = optCount === 4 ? 'D' : optCount === 6 ? 'F' : 'E';
    const dynamicMaxTokens = Math.min(16384, Math.max(4096, targetCount * 850));

    const prompt = `Anda adalah seorang ahli penyusun soal ujian nasional dan kurikulum sekolah profesional berstandar internasional (Kurikulum Merdeka).
Tugas Anda adalah membuat bank soal ujian CBT berkualitas tinggi, mendalam, dan terstruktur rapi.

=== INFORMASI UTAMA & SASARAN KELAS ===
- Mata Pelajaran: ${subject}
- Fase & Kelas: Fase ${fase || '-'}, Kelas ${grade}
- Topik / Materi Utama: ${topic}
- Capaian Pembelajaran (CP): ${capaianPembelajaran || '-'}
- Tujuan Pembelajaran (TP): ${learningObjective || '-'}
- Level Kognitif (Taksonomi Bloom): ${cognitiveLevel || 'LOTS (C1-C2)'}
- Bahasa Soal: ${language || 'Indonesia'} (Isi pertanyaan, stimulus, dan jawaban wajib menggunakan bahasa ini)

=== TARGET JUMLAH & DISTRIBUSI SOAL (MUTLAK WAJIB TEPAT) ===
- TARGET JUMLAH SOAL: TEPAT ${targetCount} BUTIR SOAL (Dilarang membuat kurang dari ${targetCount} dan dilarang membuat lebih).
- Penomoran Soal: Nomor 1 sampai ${targetCount} secara berurutan tanpa ada nomor yang terlewat.
- Komposisi Jenis Soal (${typesStr}):
  ${Array.isArray(questionTypes) && questionTypes.length > 1
    ? `* Wajib variasikan dan distribusikan soal secara proporsional sesuai pilihan (${typesStr}). Jangan hanya membuat satu jenis saja.`
    : `* Semua butir soal menggunakan jenis: ${typesStr}.`}
  * Jika ada Pilihan Ganda Kompleks (PGK): Soal memiliki lebih dari 1 pilihan benar (misal 2 atau 3 jawaban benar), kunci pada Kunci_Jawaban_Non_Essay wajib berupa huruf pilihan dipisahkan koma tanpa spasi (contoh: "A,C" atau "B,D,E").
  * Jika ada Essay: Buat pertanyaan uraian analitis dan berikan pedoman penskoran serta kunci lengkap pada Jawaban_Essay.

=== STANDAR KUALITAS PEDAGOGIS & AKURASI KONTEN ===
1. Pemisahan Tegas Isi_Referensi (Stimulus) vs Soal vs Pilihan Jawaban (MUTLAK):
   - ATURAN MUTLAK ISI_REFERENSI (WACANA/STIMULUS):
     * Field Isi_Referensi HANYA untuk teks bacaan/wacana, kutipan artikel, skenario studi kasus, narasi cerita, atau data tabel/grafik.
     * DILARANG KERAS MEMASUKKAN PILIHAN JAWABAN (A, B, C, D, E) KE DALAM ISI_REFERENSI!
     * DILARANG KERAS MEMASUKKAN PERTANYAAN KE DALAM ISI_REFERENSI!
     * Jika ada poin-poin/pernyataan di dalam stimulus bacaan, gunakan angka (1, 2, 3...) atau Romawi (I, II, III...), DILARANG menggunakan huruf A, B, C, D agar tidak menimbulkan kerancuan dengan pilihan jawaban.
     * Jika butir soal berupa pertanyaan langsung tanpa wacana bacaan panjang, field Isi_Referensi dan Judul_Referensi WAJIB diisi string kosong ("").
   - ATURAN MUTLAK SOAL (PERTANYAAN):
     * Field Soal HANYA berisi kalimat pokok pertanyaan atau instruksi tugas ujian.
     * DILARANG KERAS mencantumkan teks opsi pilihan jawaban (A, B, C, D) di dalam field Soal!
   - ATURAN MUTLAK PILIHAN JAWABAN:
     * Seluruh pilihan jawaban WAJIB HANYA diletakkan di field masing-masing: Pilihan_A, Pilihan_B, Pilihan_C, Pilihan_D, Pilihan_E.
     * KONTEN OPSI MURNI: DILARANG menuliskan label huruf opsi (seperti "A.", "B.", "(A)") di dalam teks pilihan. Tulis langsung konten opsinya saja.

2. Kualitas Pilihan Jawaban (Opsi A s/d ${lastOptionLetter}):
   - Sediakan tepat ${optCount} pilihan jawaban: Pilihan_A, Pilihan_B, Pilihan_C, Pilihan_D${optCount >= 5 ? ', Pilihan_E' : ''}${optCount >= 6 ? ', Pilihan_F' : ''}.
   - Field pilihan yang tidak digunakan (${optCount === 4 ? 'Pilihan_E dan Pilihan_F' : 'Pilihan_F'}) WAJIB dikosongkan ("").
   - Pengecoh Bermutu Tinggi (Plausible Distractors): Pengecoh harus homogen, logis, berkaitan langsung dengan materi, dan mencerminkan kekeliruan analisis atau miskonsepsi umum siswa.
   - Hindari opsi klise seperti "Semua jawaban benar" atau "Tidak ada pilihan yang tepat".

3. Konsistensi & Akurasi Mutlak Kunci Jawaban:
   - Huruf pada Kunci_Jawaban_Non_Essay (misal: "B") WAJIB 100% selaras dengan opsi Pilihan_B.
   - Pembahasan pada Jawaban_Essay WAJIB menjelaskan secara runtut mengapa opsi tersebut benar dan mengapa pengecoh lainnya kurang tepat. Dilarang bertolak belakang antara kunci dan pembahasan!

4. Format Rumus & Simbol (LaTeX):
   - Jika terdapat rumus matematika, fisika, kimia, atau persamaan angka pecahan/akar/pangkat, gunakan sintaks LaTeX standar ($...$ untuk inline math dan $$...$$ untuk block math).
   - Di dalam nilai string JSON, tuliskan karakter backslash dengan escape yang benar (contoh: "\\\\frac{1}{2}").
${referenceText ? `\n=== TEKS REFERENSI / BAHAN RUJUKAN DARI PENGGUNA ===\n${referenceText}\n(Gunakan teks rujukan di atas secara mendalam sebagai dasar pembuatan soal)` : ''}
${uniformLength ? '\n- WAJIB Keseragaman Panjang Pilihan: Buat panjang kalimat semua pilihan jawaban (A, B, C, D, dsb) relatif seragam agar tidak memberi petunjuk visual jawaban benar.' : ''}
${studentMisconception ? '\n- WAJIB Miskonsepsi Siswa: Rancang pengecoh agar merepresentasikan kekeliruan konsep atau kesalahan hitung yang lazim dilakukan siswa.' : ''}
${noExtraExplanation ? '\n- DILARANG Penjelasan Ekstra di Pilihan: Pada pilihan opsi jawaban, tuliskan HANYA poin jawaban inti tanpa menambahkan kata "karena" atau alasan di dalam teks opsi.' : ''}
${supportEquation ? '\n- WAJIB sertakan soal yang mengandung RUMUS (Equation) matematika/fisika/kimia dengan LaTeX ($...$ atau $$...$$).' : '\n- DILARANG menggunakan RUMUS (Equation) LaTeX.'}
${supportImage ? '\n- WAJIB sertakan GAMBAR ilustrasi pada 1 sampai 2 soal menggunakan markdown: ![deskripsi](https://image.pollinations.ai/prompt/detailed-description-in-english?width=400&height=300&nologo=true).' : '\n- DILARANG menyertakan GAMBAR/ilustrasi markdown.'}
${supportGraph ? '\n- WAJIB sertakan soal dengan analisis GRAFIK menggunakan QuickChart valid: ![Grafik](https://quickchart.io/chart?bkg=white&w=500&h=300&c={...}). Dilarang memakai tanda kurung () di label chart.' : '\n- DILARANG membuat soal berbasis grafik.'}
${supportDiagram ? '\n- WAJIB sertakan soal dengan DIAGRAM siklus/alur proses menggunakan blok ```mermaid ... ``` atau markdown ![Diagram](https://mermaid.ink/img/...).' : '\n- DILARANG membuat soal berbasis diagram.'}
${additionalInstructions ? `\n=== INSTRUKSI KHUSUS TAMBAHAN ===\n${additionalInstructions}` : ''}

=== STRUKTUR OUTPUT JSON (MUTLAK KETAT) ===
Output Anda HARUS diawali karakter '[' dan diakhiri ']'. HANYA kembalikan JSON array murni tanpa pembungkus \`\`\`json dan tanpa teks pembuka/penutup apapun.
Format setiap objek soal dalam array:
- Nomor: urutan soal (1 s/d ${targetCount})
- Jenis_Soal: "PG", "ESSAY", "PILIHAN ESSAY", "PGK", atau "MENGURUTKAN"
- Nilai: 10
- Nama_Materi: Tipe String
- Judul_Referensi: Tipe String (judul stimulus wacana jika ada, atau "" jika tidak ada wacana)
- Isi_Referensi: Tipe String (HANYA teks wacana/stimulus bacaan murni. DILARANG KERAS memuat pertanyaan atau pilihan A, B, C, D di sini! Wajib "" jika soal langsung)
- Soal: Pertanyaan ujian lengkap (HANYA kalimat tanya/instruksi, TANPA opsi A, B, C, D)
- File_Audio_Video: ""
- Pilihan_A: Konten murni opsi A (tanpa label "A.")
- Pilihan_B: Konten murni opsi B (tanpa label "B.")
- Pilihan_C: Konten murni opsi C (tanpa label "C.")
- Pilihan_D: Konten murni opsi D (tanpa label "D.")
- Pilihan_E: Konten murni opsi E (kosongkan "" jika s/d D)
- Pilihan_F: ""
- Kunci_Jawaban_Non_Essay: Huruf kunci (misal "A", atau "A,C" jika PGK)
- Jawaban_Essay: Pembahasan dan rubrik lengkap`;

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
          max_tokens: dynamicMaxTokens,
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
                max_tokens: dynamicMaxTokens,
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
      const rawText = data.choices?.[0]?.message?.content || "[]";
      let questions: any[] = [];
      try {
        questions = parseQuestionsJson(rawText);
      } catch (parseErr) {
        console.warn(`[Auto-Fallback Parse Server] Gagal parse dari model ${targetModel}, mencoba model cadangan...`);
        const candidates = await fetchRemoteModels(aiProvider, apiKey, customBaseUrl);
        for (const cand of candidates) {
          if (cand === targetModel) continue;
          try {
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
                max_tokens: dynamicMaxTokens,
              })
            });
            if (retryAi.ok) {
              const retryData: any = await retryAi.json();
              const retryRaw = retryData.choices?.[0]?.message?.content || "";
              const parsed = parseQuestionsJson(retryRaw);
              if (parsed && parsed.length > 0) {
                questions = parsed;
                targetModel = cand;
                break;
              }
            }
          } catch {}
        }
        if (!questions || questions.length === 0) {
          throw parseErr;
        }
      }

      const slicedQuestions = questions.slice(0, targetCount).map((q, idx) => ({
        ...q,
        Nomor: idx + 1
      }));

      return res.json({ questions: slicedQuestions, modelUsed: targetModel, provider: aiProvider });
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
          maxOutputTokens: Math.min(16384, Math.max(8192, targetCount * 850)),
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
                maxOutputTokens: Math.min(16384, Math.max(8192, targetCount * 850)),
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

    const rawText = response.text || "[]";
    let questions: any[] = [];
    try {
      questions = parseQuestionsJson(rawText);
    } catch (parseErr) {
      console.warn(`[Auto-Fallback Parse Server] Gemini gagal parse dari model ${targetModel}, mencoba model cadangan...`);
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
      for (const cand of GEMINI_FALLBACKS) {
        if (cand === targetModel) continue;
        try {
          const retryResp = await ai.models.generateContent({
            model: cand,
            contents: prompt,
            config: {
              responseMimeType: "application/json",
              temperature: Math.max(0, Math.min(1, temperature)),
              maxOutputTokens: Math.min(16384, Math.max(8192, targetCount * 850)),
            },
          });
          const retryRaw = retryResp.text || "";
          const parsed = parseQuestionsJson(retryRaw);
          if (parsed && parsed.length > 0) {
            questions = parsed;
            targetModel = cand;
            break;
          }
        } catch {}
      }
      if (!questions || questions.length === 0) {
        throw parseErr;
      }
    }

    const slicedQuestions = questions.slice(0, targetCount).map((q, idx) => ({
      ...q,
      Nomor: idx + 1
    }));

    return res.json({ questions: slicedQuestions, modelUsed: targetModel });
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

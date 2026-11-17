interface Env {
  GEMINI_API_KEY?: string;
  VITE_GEMINI_API_KEY?: string;
}

interface RequestData {
  subject: string;
  fase?: string;
  grade: string;
  topic: string;
  language?: string;
  capaianPembelajaran?: string;
  learningObjective?: string;
  cognitiveLevel?: string;
  referenceText?: string;
  count?: number;
  questionTypes?: string[];
  optionCount?: number;
  aiProvider?: string;
  customApiKey?: string;
  customModel?: string;
  customBaseUrl?: string;
  supportEquation?: boolean;
  supportImage?: boolean;
  supportGraph?: boolean;
  supportDiagram?: boolean;
  uniformLength?: boolean;
  studentMisconception?: boolean;
  noExtraExplanation?: boolean;
  temperature?: number;
  additionalInstructions?: string;
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export const onRequestOptions = async () => {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
};

function buildPrompt(data: RequestData): string {
  const {
    subject,
    fase,
    grade,
    topic,
    language,
    capaianPembelajaran,
    learningObjective,
    cognitiveLevel,
    referenceText,
    count = 5,
    questionTypes,
    optionCount = 5,
    supportEquation,
    supportImage,
    supportGraph,
    supportDiagram,
    uniformLength,
    studentMisconception,
    noExtraExplanation,
    additionalInstructions,
  } = data;

  const typesStr = Array.isArray(questionTypes) && questionTypes.length > 0
    ? questionTypes.join(", ")
    : "PG";

  return `Anda adalah seorang ahli pembuat soal ujian profesional.
Bahasa Soal: ${language || "Indonesia"} (Pastikan isi soal dan jawaban menggunakan bahasa ini)
Pelajaran: ${subject}
Fase: ${fase || "-"}
Kelas: ${grade}
Materi: ${topic}
Capaian Pembelajaran: ${capaianPembelajaran || "-"}
Tujuan Pembelajaran: ${learningObjective || "-"}
Level Kognitif (Taksonomi Bloom): ${cognitiveLevel || "LOTS (C1-C2)"}
Jumlah Soal: ${count}
Jenis Soal yang Boleh Digunakan: ${typesStr} (Bisa salah satu atau kombinasi jika ada beberapa jenis)
Jumlah Pilihan Jawaban (Jika pilihan ganda): ${optionCount} (Misal 4 berarti sampai D, 5 berarti sampai E, 6 berarti sampai F). Kosongkan value Pilihan_E dan Pilihan_F jika tidak digunakan.
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

Buatkan ${count} soal dengan format JSON yang ketat mengikuti struktur berikut:
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

PENTING: Output Anda HARUS langsung diawali karakter '[' dan diakhiri ']'. HANYA return JSON array murni tanpa dibungkus kode block markdown \`\`\`json dan tanpa teks pembuka/penutup apapun.`;
}

async function requestGemini(apiKey: string, model: string, prompt: string, temperature = 0.7) {
  const cleanModel = (model || "gemini-2.5-flash").trim().replace(/^models\//, "");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cleanModel)}:generateContent?key=${apiKey}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: Math.max(0, Math.min(1, temperature)),
        maxOutputTokens: 8192,
      },
    }),
  });

  return { res, model: cleanModel };
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

  let kunci = raw.Kunci_Jawaban_Non_Essay ?? raw.kunci_jawaban_non_essay ?? raw.kunci_jawaban ?? raw.kunciJawaban ?? raw.kunci ?? raw.jawaban_benar ?? raw.answer ?? raw.correct ?? '';
  if (Array.isArray(kunci)) {
    kunci = kunci.join(',');
  }

  const essay = raw.Jawaban_Essay ?? raw.jawaban_essay ?? raw.jawabanEssay ?? raw.pedoman_essay ?? raw.kunci_essay ?? raw.rubrik ?? '';

  return {
    Nomor: nomor,
    Jenis_Soal: jenis,
    Nilai: Number(raw.Nilai || raw.nilai || 10) || 10,
    Nama_Materi: String(raw.Nama_Materi || raw.nama_materi || raw.materi || raw.topik || ''),
    Judul_Referensi: String(raw.Judul_Referensi || raw.judul_referensi || raw.judul || ''),
    Isi_Referensi: String(raw.Isi_Referensi || raw.isi_referensi || raw.stimulus || raw.bacaan || ''),
    Soal: String(soal),
    File_Audio_Video: '',
    Pilihan_A: optA !== '' ? String(optA) : undefined,
    Pilihan_B: optB !== '' ? String(optB) : undefined,
    Pilihan_C: optC !== '' ? String(optC) : undefined,
    Pilihan_D: optD !== '' ? String(optD) : undefined,
    Pilihan_E: optE !== '' ? String(optE) : undefined,
    Pilihan_F: optF !== '' ? String(optF) : undefined,
    Kunci_Jawaban_Non_Essay: String(kunci).trim().toUpperCase(),
    Jawaban_Essay: String(essay)
  };
}

function sanitizeJsonString(str: string): string {
  let s = str;
  s = s.replace(/<think>[\s\S]*?<\/think>/gi, '');
  s = s.replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '');
  s = s.replace(/```(?:json)?\s*([\s\S]*?)\s*```/gi, '$1');

  // Fix LaTeX backslashes that break JSON
  s = s.replace(/\\(frac|times|text|theta|tau|tan|triangle|begin|beta|bar|bullet|binom|right|rho|rad|root|forall|approx|alpha|le|ge|neq|pm|cdot|circ|degree|sqrt|partial|sum|int|infty|lim|sin|cos|log|ln|vec|hat|over|under)/gi, '\\\\$1');
  s = s.replace(/\\([a-zA-Z])/g, (m, letter) => {
    if (['b', 'f', 'n', 'r', 't', 'u'].includes(letter)) return m;
    return '\\\\' + letter;
  });

  // Fix unescaped newlines/tabs inside string literals
  let inStr = false;
  let isEsc = false;
  let fixed = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (isEsc) {
      fixed += ch;
      isEsc = false;
      continue;
    }
    if (ch === '\\') {
      fixed += ch;
      isEsc = true;
      continue;
    }
    if (ch === '"') {
      inStr = !inStr;
      fixed += ch;
      continue;
    }
    if (inStr) {
      if (ch === '\n') {
        fixed += '\\n';
        continue;
      }
      if (ch === '\r') {
        fixed += '\\r';
        continue;
      }
      if (ch === '\t') {
        fixed += '\\t';
        continue;
      }
    }
    fixed += ch;
  }
  s = fixed;
  s = s.replace(/,\s*([\]}])/g, '$1');

  return s.trim();
}

function parseQuestionsJson(rawText: string) {
  if (!rawText || typeof rawText !== 'string') return [];

  const cleanBase = rawText
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '')
    .trim();

  const candidatesToTry = [cleanBase, sanitizeJsonString(cleanBase)];

  const extractArray = (val: any) => {
    if (!val) return null;
    if (Array.isArray(val) && val.length > 0) {
      return val.map((item, idx) => normalizeQuestionObject(item, idx));
    }
    if (typeof val === 'object') {
      const potentialKeys = ['questions', 'soal', 'data', 'items', 'daftar_soal', 'bank_soal', 'result', 'results'];
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

  for (const cand of candidatesToTry) {
    try {
      const parsed = JSON.parse(cand);
      const res = extractArray(parsed);
      if (res && res.length > 0) return res;
    } catch {}
  }

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
          const repaired = sanitizeJsonString(sub);
          const parsed = JSON.parse(repaired);
          const res = extractArray(parsed);
          if (res && res.length > 0) return res;
        } catch {}
      }
    }
  }

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
          const repaired = sanitizeJsonString(sub);
          const parsed = JSON.parse(repaired);
          const res = extractArray(parsed);
          if (res && res.length > 0) return res;
        } catch {}
      }
    }
  }

  // Truncated array heal
  for (const cand of candidatesToTry) {
    const startIdx = cand.indexOf('[');
    if (startIdx !== -1) {
      const lastBrace = cand.lastIndexOf('}');
      if (lastBrace > startIdx) {
        const healed = cand.substring(startIdx, lastBrace + 1) + ']';
        const sanitizedHealed = sanitizeJsonString(healed);
        try {
          const parsed = JSON.parse(sanitizedHealed);
          const res = extractArray(parsed);
          if (res && res.length > 0) return res;
        } catch {}
      }
    }
  }

  // Regex block extraction
  try {
    const objectRegex = /\{[^{}]*"(?:Soal|soal|question|pertanyaan)"[^{}]*\}/g;
    const matchedBlocks = cleanBase.match(objectRegex);
    if (matchedBlocks && matchedBlocks.length > 0) {
      const questions: any[] = [];
      for (let i = 0; i < matchedBlocks.length; i++) {
        try {
          const cleanedBlock = sanitizeJsonString(matchedBlocks[i]);
          const parsed = JSON.parse(cleanedBlock);
          questions.push(normalizeQuestionObject(parsed, i));
        } catch {}
      }
      if (questions.length > 0) return questions;
    }
  } catch {}

  throw new Error('Respons model tidak mengandung format JSON array soal yang valid.');
}

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

async function requestOpenAICompatible(
  baseUrl: string,
  apiKey: string,
  model: string,
  prompt: string,
  temperature: number,
  provider: string
) {
  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }
  if (provider === 'openrouter') {
    headers['HTTP-Referer'] = 'https://cbtpijar.app';
    headers['X-Title'] = 'CBT Pijar AI Generator';
  }

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content: 'Anda adalah seorang ahli pembuat soal ujian profesional CBT Pijar. Anda HANYA menjawab dalam format JSON array valid objek soal ujian tanpa dibungkus kode block markdown ```json.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: Math.max(0, Math.min(2, temperature)),
      max_tokens: 4096
    })
  });

  return res;
}

function resolveModel(provider: string, customModel?: string): string {
  if (customModel && customModel !== 'auto' && customModel.trim()) {
    const clean = customModel.trim().replace(/^models\//, '');
    if (provider === 'groq' && clean === 'llama-3.3-70b-versatile') {
      return 'llama-3.1-8b-instant';
    }
    return clean;
  }
  switch (provider) {
    case 'groq': return 'llama-3.1-8b-instant';
    case 'deepseek': return 'deepseek-chat';
    case 'openai': return 'gpt-4o-mini';
    case 'openrouter': return 'meta-llama/llama-3.3-70b-instruct';
    case 'custom': return 'llama3.2';
    default: return 'gemini-2.5-flash';
  }
}

export const onRequestPost = async (context: { request: Request; env: Env }) => {
  try {
    let body: RequestData;
    try {
      body = await context.request.json();
    } catch {
      return new Response(JSON.stringify({ error: "Permintaan tidak valid (Invalid JSON body)." }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    }

    const provider = body.aiProvider || 'gemini';
    const apiKey = (body.customApiKey || (provider === 'gemini' ? (context.env.GEMINI_API_KEY || context.env.VITE_GEMINI_API_KEY || "") : "")).trim();
    if (!apiKey && provider !== 'custom') {
      return new Response(
        JSON.stringify({
          error: `API Key untuk ${provider.toUpperCase()} belum diisi. Silakan masukkan API Key Anda pada Pengaturan AI.`,
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json", ...CORS_HEADERS },
        }
      );
    }

    const prompt = buildPrompt(body);
    const temperature = typeof body.temperature === "number" ? body.temperature : 0.7;

    // --- Provider Selain Gemini (Groq, DeepSeek, OpenAI, OpenRouter, Custom) ---
    if (provider !== 'gemini') {
      const baseUrl = getDefaultBaseUrl(provider, body.customBaseUrl);
      let model = resolveModel(provider, body.customModel);

      let res = await requestOpenAICompatible(baseUrl, apiKey, model, prompt, temperature, provider);

      // Auto-fallback: if requested model fails, dynamically test available models from user's account!
      if (!res.ok) {
        try {
          const mHeaders: Record<string, string> = {};
          if (apiKey) mHeaders['Authorization'] = `Bearer ${apiKey}`;
          if (provider === 'openrouter') {
            mHeaders['HTTP-Referer'] = 'https://cbtpijar.app';
            mHeaders['X-Title'] = 'CBT Pijar AI Generator';
          }
          const mRes = await fetch(`${baseUrl.replace(/\/+$/, '')}/models`, { headers: mHeaders });
          if (mRes.ok) {
            const mData: any = await mRes.json();
            const rawList = Array.isArray(mData.data) ? mData.data : (Array.isArray(mData.models) ? mData.models : []);
            const candidates = rawList
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

            for (const cand of candidates) {
              if (cand === model) continue;
              const retryRes = await requestOpenAICompatible(baseUrl, apiKey, cand, prompt, temperature, provider);
              if (retryRes.ok) {
                res = retryRes;
                model = cand;
                break;
              }
            }
          }
        } catch {}
      }

      if (!res.ok) {
        const errorData: any = await res.json().catch(() => ({}));
        const apiMessage = errorData.error?.message || errorData.message || `Status HTTP ${res.status}`;
        let errorMessage = `Gagal menghubungi API ${provider.toUpperCase()}: ${apiMessage}`;
        if (res.status === 401) {
          errorMessage = `API Key ${provider.toUpperCase()} tidak valid atau tidak memiliki izin akses. Harap periksa kembali kunci Anda.`;
        } else if (res.status === 429) {
          errorMessage = `Limit kuota / rate limit API ${provider.toUpperCase()} tercapai. Silakan coba beberapa saat lagi atau ganti model.`;
        } else if (res.status === 404) {
          errorMessage = `Model "${model}" tidak ditemukan pada endpoint ${baseUrl}. Pastikan nama model sudah benar.`;
        }

        return new Response(JSON.stringify({ error: errorMessage }), {
          status: res.status,
          headers: { "Content-Type": "application/json", ...CORS_HEADERS },
        });
      }

      const data: any = await res.json();
      const rawText = data.choices?.[0]?.message?.content || "[]";

      let questions;
      try {
        questions = parseQuestionsJson(rawText);
      } catch (parseError) {
        console.error("Failed to parse JSON output from OpenAI-compatible provider:", rawText);
        return new Response(
          JSON.stringify({
            error: `Gagal membaca output AI dari ${provider.toUpperCase()} (format JSON tidak sesuai). Silakan coba generate kembali.`,
            rawText,
          }),
          {
            status: 500,
            headers: { "Content-Type": "application/json", ...CORS_HEADERS },
          }
        );
      }

      return new Response(
        JSON.stringify({
          questions,
          modelUsed: model,
          provider
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json", ...CORS_HEADERS },
        }
      );
    }

    let initialModel = resolveModel('gemini', body.customModel);

    let { res, model } = await requestGemini(apiKey, initialModel, prompt, temperature);

    // Fallback if the requested model returns 404 (Not Found)
    if (res.status === 404 && model !== "gemini-2.5-flash" && model !== "gemini-2.0-flash") {
      console.warn(`Model ${model} not found (404), falling back to gemini-2.5-flash...`);
      const fallbackResult = await requestGemini(apiKey, "gemini-2.5-flash", prompt, temperature);
      if (fallbackResult.res.ok) {
        res = fallbackResult.res;
        model = "gemini-2.5-flash";
      } else {
        // Try gemini-2.0-flash
        const fallbackResult2 = await requestGemini(apiKey, "gemini-2.0-flash", prompt, temperature);
        if (fallbackResult2.res.ok) {
          res = fallbackResult2.res;
          model = "gemini-2.0-flash";
        }
      }
    }

    if (!res.ok) {
      const errorData: any = await res.json().catch(() => ({}));
      const apiMessage = errorData.error?.message || `Status HTTP ${res.status}`;

      let errorMessage = `Gagal menghubungi Gemini API: ${apiMessage}`;
      if (res.status === 404) {
        errorMessage = `Model "${initialModel}" tidak ditemukan atau belum tersedia untuk API Key Anda. Silakan pilih "Gemini 2.5 Flash" atau "Gemini 2.0 Flash" pada menu Pengaturan AI.`;
      } else if (res.status === 429 || apiMessage.includes("429") || apiMessage.includes("quota")) {
        errorMessage = "Kuota request Gemini API telah habis atau terlalu banyak request (Rate Limit). Silakan tunggu sebentar atau gunakan model lain seperti Gemini 2.0 Flash / Gemini 1.5 Flash.";
      } else if (res.status === 503) {
        errorMessage = "Layanan Gemini sedang mengalami permintaan tinggi (High Demand). Silakan tunggu beberapa detik dan coba lagi.";
      } else if (res.status === 400 && apiMessage.includes("API key not valid")) {
        errorMessage = "API Key Gemini tidak valid. Harap periksa kembali kunci Anda di Google AI Studio.";
      }

      return new Response(JSON.stringify({ error: errorMessage }), {
        status: res.status,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    }

    const data: any = await res.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || "[]";

    let questions;
    try {
      questions = parseQuestionsJson(rawText);
    } catch (parseError) {
      console.error("Failed to parse JSON output:", rawText);
      return new Response(
        JSON.stringify({
          error: "Gagal membaca output AI (format JSON tidak sesuai). Silakan coba generate kembali.",
          rawText,
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json", ...CORS_HEADERS },
        }
      );
    }

    return new Response(
      JSON.stringify({
        questions,
        modelUsed: model,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      }
    );
  } catch (error: any) {
    console.error("Unhandled error in generate-questions:", error);
    return new Response(
      JSON.stringify({
        error: error.message || "Terjadi kesalahan server saat generate soal.",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      }
    );
  }
};


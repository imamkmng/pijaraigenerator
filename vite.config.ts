import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv, Plugin } from 'vite';

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

function parseFromPlainText(text: string): any[] {
  if (!text || typeof text !== 'string') return [];

  const cleaned = text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '')
    .replace(/```(?:json)?/gi, '')
    .trim();

  const questionBlocks = cleaned.split(/(?:^|\n)\s*(?:\*\*)?(?:Soal\s*)?(\d+)[\.\:\)]\s*(?:\*\*)?/i);

  const results: any[] = [];
  if (questionBlocks.length > 2) {
    for (let i = 1; i < questionBlocks.length; i += 2) {
      const qNum = parseInt(questionBlocks[i]) || Math.floor(i / 2) + 1;
      const blockContent = questionBlocks[i + 1] || '';

      let soalText = blockContent;
      const options: Record<string, string> = {};

      const optRegex = /(?:^|\n)\s*(?:\*\*)?([A-F])[\.\:\)]\s*(?:\*\*)?([^\n]+)/gi;
      let optMatch;
      let firstOptIdx = -1;
      while ((optMatch = optRegex.exec(blockContent)) !== null) {
        if (firstOptIdx === -1) firstOptIdx = optMatch.index;
        const letter = optMatch[1].toUpperCase();
        options[letter] = optMatch[2].trim();
      }

      if (firstOptIdx !== -1) {
        soalText = blockContent.substring(0, firstOptIdx).trim();
      }

      let kunci = '';
      const keyMatch = blockContent.match(/(?:Kunci(?:[\s_]*Jawaban)?|Jawaban(?:[\s_]*Benar)?|Key|Answer)\s*[:=]\s*([A-Fa-f,\s]+)/i);
      if (keyMatch) {
        kunci = keyMatch[1].replace(/[^A-Fa-f,]/g, '').toUpperCase().trim();
      }

      let essay = '';
      const essayMatch = blockContent.match(/(?:Jawaban(?:[\s_]*Essay)?|Pedoman(?:[\s_]*Essay)?|Pembahasan|Penjelasan)\s*[:=]\s*([^\n]+)/i);
      if (essayMatch) {
        essay = essayMatch[1].trim();
      }

      soalText = soalText.replace(/^(?:Soal|Pertanyaan)\s*[:\-]\s*/i, '').trim();

      if (soalText || Object.keys(options).length > 0) {
        results.push(normalizeQuestionObject({
          Nomor: qNum,
          Jenis_Soal: 'PG',
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
          Kunci_Jawaban_Non_Essay: kunci || 'A',
          Jawaban_Essay: essay
        }, results.length));
      }
    }
  }
  return results;
}

function sanitizeJsonString(str: string): string {
  if (!str || typeof str !== 'string') return '';
  let s = str;
  s = s.replace(/<think>[\s\S]*?<\/think>/gi, '');
  s = s.replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '');
  s = s.replace(/```(?:json)?\s*([\s\S]*?)\s*```/gi, '$1');
  s = s.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/\s*```$/, '');
  s = s.replace(/:\s*True\b/g, ': true');
  s = s.replace(/:\s*False\b/g, ': false');
  s = s.replace(/:\s*None\b/g, ': null');
  s = s.replace(/[\u201C\u201D]/g, '"').replace(/[\u2018\u2019]/g, "'");
  s = s.replace(/\\(frac|times|text|theta|tau|tan|triangle|begin|beta|bar|bullet|binom|right|rho|rad|root|forall|approx|alpha|le|ge|neq|pm|cdot|circ|degree|sqrt|partial|sum|int|infty|lim|sin|cos|log|ln|vec|hat|over|under)/gi, '\\\\$1');
  s = s.replace(/\\([a-zA-Z])/g, (m, letter) => {
    if (['b', 'f', 'n', 'r', 't', 'u'].includes(letter)) return m;
    return '\\\\' + letter;
  });
  s = s.replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":');

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

function parseQuestionsJson(rawText: string): any[] {
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
          const repaired = sanitizeJsonString(sub);
          const parsed = JSON.parse(repaired);
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
          const repaired = sanitizeJsonString(sub);
          const parsed = JSON.parse(repaired);
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
        const sanitizedHealed = sanitizeJsonString(healed);
        try {
          const parsed = JSON.parse(sanitizedHealed);
          const res = extractArray(parsed);
          if (res && res.length > 0) return res;
        } catch {}
      }
    }
  }

  // Strategy 5: Depth-aware brace matcher
  try {
    const individualObjects: any[] = [];
    let inString = false;
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
        inString = !inString;
        continue;
      }
      if (!inString) {
        if (ch === '{') {
          if (depth === 0) startPos = i;
          depth++;
        } else if (ch === '}') {
          depth--;
          if (depth === 0 && startPos !== -1) {
            const block = cleanBase.substring(startPos, i + 1);
            try {
              const parsed = JSON.parse(sanitizeJsonString(block));
              if (parsed && typeof parsed === 'object' && (parsed.Soal || parsed.soal || parsed.question || parsed.pertanyaan || parsed.Pilihan_A || parsed.A)) {
                individualObjects.push(normalizeQuestionObject(parsed, individualObjects.length));
              }
            } catch {}
            startPos = -1;
          }
        }
      }
    }
    if (individualObjects.length > 0) {
      return individualObjects;
    }
  } catch {}

  // Strategy 6: Plain-text / Markdown Question Extractor
  const plainTextQuestions = parseFromPlainText(cleanBase);
  if (plainTextQuestions.length > 0) {
    return plainTextQuestions;
  }

  throw new Error('Respons model tidak mengandung format soal yang dapat dibaca. Silakan coba generate kembali.');
}

function resolveDevModel(provider: string, customModel?: string): string {
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
    case '9router': return 'gemini-2.5-flash';
    case 'custom': return 'llama3.2';
    default: return 'gemini-2.5-flash';
  }
}

function getDevBaseUrl(provider: string, customBaseUrl?: string): string {
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
    case 'groq': return 'https://api.groq.com/openai/v1';
    case 'deepseek': return 'https://api.deepseek.com';
    case 'openai': return 'https://api.openai.com/v1';
    case 'openrouter': return 'https://openrouter.ai/api/v1';
    default: return 'https://api.openai.com/v1';
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

    const baseUrl = getDevBaseUrl(provider, customBaseUrl);
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

function devApiPlugin(env: Record<string, string>): Plugin {
  return {
    name: 'dev-api-middleware',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url?.startsWith('/api/test-key') && req.method === 'GET') {
          const hasServerKey = Boolean((env.GEMINI_API_KEY || process.env.GEMINI_API_KEY || '').trim());
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({
            hasServerKey,
            message: hasServerKey ? 'GEMINI_API_KEY terdeteksi di environment lokal.' : 'GEMINI_API_KEY belum diatur di .env lokal.'
          }));
          return;
        }

        if (req.url?.startsWith('/api/test-key') && req.method === 'POST') {
          let bodyStr = '';
          req.on('data', chunk => { bodyStr += chunk; });
          req.on('end', async () => {
            try {
              const body = JSON.parse(bodyStr || '{}');
              const provider = body.aiProvider || 'gemini';
              const apiKey = (body.customApiKey || (provider === 'gemini' ? (env.GEMINI_API_KEY || process.env.GEMINI_API_KEY || '') : '')).trim();
              let model = resolveDevModel(provider, body.customModel);
              const customBaseUrl = body.customBaseUrl;

              if (!apiKey && provider !== 'custom' && provider !== '9router') {
                res.statusCode = 200;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ ok: false, message: `API Key untuk ${provider.toUpperCase()} belum diisi.` }));
                return;
              }

              if (provider !== 'gemini') {
                const defaultBase = getDevBaseUrl(provider, customBaseUrl);
                const url = `${defaultBase.replace(/\/+$/, '')}/chat/completions`;
                const headers: Record<string, string> = { 'Content-Type': 'application/json' };
                if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
                if (provider === 'openrouter') {
                  headers['HTTP-Referer'] = 'https://cbtpijar.app';
                  headers['X-Title'] = 'CBT Pijar AI Generator';
                }

                let response = await fetch(url, {
                  method: 'POST',
                  headers,
                  body: JSON.stringify({
                    model,
                    messages: [{ role: 'user', content: 'ping' }],
                    max_tokens: 5
                  })
                });

                // Auto-fallback: if model fails, dynamically query the active models from the account!
                if (!response.ok) {
                  const availableModels = await fetchRemoteModels(provider, apiKey, customBaseUrl);
                  if (availableModels.length > 0) {
                    for (const candidate of availableModels) {
                      if (candidate === model) continue;
                      const retryRes = await fetch(url, {
                        method: 'POST',
                        headers,
                        body: JSON.stringify({
                          model: candidate,
                          messages: [{ role: 'user', content: 'ping' }],
                          max_tokens: 5
                        })
                      });
                      if (retryRes.ok) {
                        res.statusCode = 200;
                        res.setHeader('Content-Type', 'application/json');
                        res.end(JSON.stringify({
                          ok: true,
                          message: `Koneksi berhasil! Model "${model}" tidak aktif pada akun Anda, sistem otomatis menghubungkan ke model "${candidate}" yang aktif & siap pakai.`,
                          fallbackModel: candidate
                        }));
                        return;
                      }
                    }
                  }
                }

                if (!response.ok) {
                  const err: any = await response.json().catch(() => ({}));
                  let msg = err.error?.message || err.message || `Status HTTP ${response.status}`;
                  if (msg.includes('does not exist') || msg.includes('do not have access')) {
                    msg = `Model "${model}" tidak aktif pada akun Anda. Klik tombol "Muat Model Aktif" di Pengaturan untuk memilih model yang tersedia di akun Anda.`;
                  }
                  res.statusCode = 200;
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify({ ok: false, message: `Gagal (${provider.toUpperCase()}): ${msg}` }));
                  return;
                }

                res.statusCode = 200;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ ok: true, message: `Koneksi berhasil! Model "${model}" pada provider ${provider.toUpperCase()} aktif dan siap digunakan.` }));
                return;
              }

              // Gemini
              const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${apiKey}`;
              const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  contents: [{ role: 'user', parts: [{ text: 'ping' }] }],
                  generationConfig: { maxOutputTokens: 5 }
                })
              });

              if (!response.ok) {
                const err: any = await response.json().catch(() => ({}));
                const msg = err.error?.message || `HTTP ${response.status}`;
                res.statusCode = 200;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ ok: false, message: `Gagal (Gemini): ${msg}` }));
                return;
              }

              res.statusCode = 200;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ ok: true, message: `Koneksi berhasil! Model "${model}" (Gemini) siap digunakan.` }));
            } catch (err: any) {
              res.statusCode = 200;
              res.setHeader('Content-Type', 'application/json');
              const causeMsg = err.cause ? ` (${err.cause.message || err.cause.code || err.cause})` : '';
              res.end(JSON.stringify({ ok: false, message: (err.message || 'Gagal tes koneksi.') + causeMsg }));
            }
          });
          return;
        }

        if (req.url?.startsWith('/api/models') && req.method === 'POST') {
          let bodyStr = '';
          req.on('data', chunk => { bodyStr += chunk; });
          req.on('end', async () => {
            try {
              const body = JSON.parse(bodyStr || '{}');
              const provider = body.aiProvider || 'gemini';
              const apiKey = (body.customApiKey || (provider === 'gemini' ? (env.GEMINI_API_KEY || process.env.GEMINI_API_KEY || '') : '')).trim();

              const modelIds = await fetchRemoteModels(provider, apiKey, body.customBaseUrl);
              const models = modelIds.map(id => ({ id, name: id }));

              res.statusCode = 200;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ ok: true, models }));
            } catch (err: any) {
              res.statusCode = 200;
              res.setHeader('Content-Type', 'application/json');
              const causeMsg = err.cause ? ` (${err.cause.message || err.cause.code || err.cause})` : '';
              res.end(JSON.stringify({ ok: false, error: (err.message || 'Gagal memuat model.') + causeMsg }));
            }
          });
          return;
        }

        if (req.url?.startsWith('/api/generate-questions') && req.method === 'POST') {
          let bodyStr = '';
          req.on('data', chunk => { bodyStr += chunk; });
          req.on('end', async () => {
            try {
              const body = JSON.parse(bodyStr || '{}');
              const provider = body.aiProvider || 'gemini';
              const apiKey = (body.customApiKey || (provider === 'gemini' ? (env.GEMINI_API_KEY || process.env.GEMINI_API_KEY || '') : '')).trim();

              if (!apiKey && provider !== 'custom' && provider !== '9router') {
                res.statusCode = 400;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({
                  error: `API Key untuk ${provider.toUpperCase()} belum diisi. Masukkan API Key Anda di Pengaturan AI.`
                }));
                return;
              }

              let targetModel = resolveDevModel(provider, body.customModel);
              const typesStr = Array.isArray(body.questionTypes) && body.questionTypes.length > 0
                ? body.questionTypes.join(', ')
                : 'PG';

              const prompt = `Anda adalah seorang ahli pembuat soal ujian profesional.
Bahasa Soal: ${body.language || 'Indonesia'} (Pastikan isi soal dan jawaban menggunakan bahasa ini)
Pelajaran: ${body.subject}
Fase: ${body.fase || '-'}
Kelas: ${body.grade}
Materi: ${body.topic}
Capaian Pembelajaran: ${body.capaianPembelajaran || '-'}
Tujuan Pembelajaran: ${body.learningObjective || '-'}
Level Kognitif (Taksonomi Bloom): ${body.cognitiveLevel || 'LOTS (C1-C2)'}
Jumlah Soal: ${body.count || 5}
Jenis Soal yang Boleh Digunakan: ${typesStr} (Bisa salah satu atau kombinasi jika ada beberapa jenis)
Jumlah Pilihan Jawaban (Jika pilihan ganda): ${body.optionCount || 5} (Misal 4 berarti sampai D, 5 berarti sampai E, 6 berarti sampai F). Kosongkan value Pilihan_E dan Pilihan_F jika tidak digunakan.
${body.referenceText ? `\nTeks Referensi / Bahan Bacaan:\n${body.referenceText}\n(Gunakan teks di atas sebagai dasar pembuatan soal)` : ''}
${body.uniformLength ? `\n- WAJIB Keseragaman Panjang Pilihan: Pastikan semua pilihan jawaban (A, B, C, D, dsb) memiliki panjang kalimat atau jumlah kata yang hampir sama (seragam) agar siswa tidak mudah menebak jawaban dari sekadar panjangnya pilihan.` : ''}
${body.studentMisconception ? `\n- WAJIB Gunakan Miskonsepsi Siswa: Untuk pilihan jawaban salah (pengecoh/distractor), rancang sedemikian rupa agar jawaban tersebut merepresentasikan miskonsepsi umum atau kesalahan hitung/analisa yang biasa dilakukan oleh siswa (jawaban masuk akal/plausible).` : ''}
${body.noExtraExplanation ? `\n- DILARANG Memberi Penjelasan Ekstra: Pada pilihan jawaban, berikan HANYA poin jawaban inti saja tanpa menambahkan alasan, argumen, kata "karena", atau teks penjelasan tambahan apa pun di dalam opsi jawaban.` : ''}
${body.supportEquation ? `\n- WAJIB sertakan soal yang mengandung RUMUS (Equation) matematika/fisika/kimia atau logika analitik menggunakan sintaks LaTeX (blok \`$$\` atau inline \`$\`).` : '\n- DILARANG menggunakan RUMUS (Equation) atau format LaTeX dalam bentuk apapun pada soal dan jawaban.'}
${body.supportImage ? `\n- WAJIB sertakan GAMBAR ilustrasi pada soal (minimal di beberapa soal). Gunakan format markdown: \`![deskripsi](https://image.pollinations.ai/prompt/detailed-description-of-image-in-english?width=400&height=300&nologo=true)\` di dalam teks Soal. Ganti \`detailed-description-of-image-in-english\` dengan deskripsi spesifik tentang apa yang diilustrasikan di soal (WAJIB bahasa Inggris, pisahkan kata dengan tanda penghubung "-", BUKAN SPASI). Contoh: \`https://image.pollinations.ai/prompt/a-green-leaf-showing-photosynthesis-process?width=400&height=300&nologo=true\`.` : '\n- DILARANG menyertakan GAMBAR/ilustrasi markdown dalam bentuk apapun pada soal dan jawaban.'}
${body.supportGraph ? `\n- WAJIB buatkan satu atau beberapa soal yang memerlukan analisis GRAFIK. Gunakan format markdown image QuickChart.io yang valid: \`![Grafik](https://quickchart.io/chart?bkg=white&w=500&h=300&c={"type":"bar","data":{"labels":["A","B"],"datasets":[{"label":"Nilai","data":[10,20]}]}})\`. PENTING: Pada teks label/judul chart, DILARANG memakai tanda kurung '(' atau ')' (tulis 'dalam Mbps' atau 'Mbps', JANGAN gunakan '(Mbps)'). Jangan gunakan spasi berlebihan dalam URL.` : '\n- DILARANG membuat soal yang menggunakan atau memerlukan analisis GRAFIK atau chart.'}
${body.supportDiagram ? `\n- WAJIB buatkan satu atau beberapa soal yang memerlukan pemahaman DIAGRAM PROSES/SIKLUS (misalnya siklus air, fotosintesis, rantai makanan, daur biogeokimia, proses pembelahan sel, bagan alur). Tulis diagram menggunakan blok kode \`\`\`mermaid\ngraph TD\n  A --> B\n\`\`\` ATAU markdown \`![Diagram](https://mermaid.ink/img/{BASE64})\`. Diagram harus sederhana dan mudah dipahami.` : '\n- DILARANG membuat soal yang menggunakan DIAGRAM PROSES/SIKLUS berbasis Mermaid.'}
${body.additionalInstructions ? `\nInstruksi Khusus Tambahan: ${body.additionalInstructions}` : ''}

PENTING: Jika ada rumus matematika, fisika, kimia, atau persamaan (misal pecahan, pangkat, dll), BERIKAN dalam format LaTeX menggunakan \`$\` untuk inline math (contoh: $E=mc^2$) dan \`$$\` untuk block math (contoh: $$ \\sqrt{x} $$). Jangan gunakan format lain. Gunakan perintah-perintah LaTeX standar (seperti \\frac, \\sqrt, pangkat, subscript) agar hasil dirender dengan baik. Saat menuliskan backslash LaTeX ke dalam value JSON, pastikan menggunakan dua backslash (contoh di dalam JSON: "Rumus \\\\frac{1}{2}"). Jangan gunakan backslash berlebihan (hindari \\\\\\\\frac).

Buatkan ${body.count || 5} soal dengan format JSON yang ketat mengikuti struktur berikut:
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

              const temperature = typeof body.temperature === 'number' ? body.temperature : 0.7;

              if (provider !== 'gemini') {
                const defaultBase = getDevBaseUrl(provider, body.customBaseUrl);
                const url = `${defaultBase.replace(/\/+$/, '')}/chat/completions`;
                const headers: Record<string, string> = { 'Content-Type': 'application/json' };
                if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
                if (provider === 'openrouter') {
                  headers['HTTP-Referer'] = 'https://cbtpijar.app';
                  headers['X-Title'] = 'CBT Pijar AI Generator';
                }

                const executeRequest = (m: string) => fetch(url, {
                  method: 'POST',
                  headers,
                  body: JSON.stringify({
                    model: m,
                    messages: [
                      { role: 'system', content: 'Anda adalah seorang ahli pembuat soal ujian profesional. HANYA kembalikan JSON array valid objek soal ujian tanpa markdown block ```json atau teks lain.' },
                      { role: 'user', content: prompt }
                    ],
                    temperature: Math.max(0, Math.min(2, temperature))
                  })
                });

                let aiRes = await executeRequest(targetModel);
                let finalModel = targetModel;

                // Fallback: if model fails, dynamically test available models from account!
                if (!aiRes.ok) {
                  const availableModels = await fetchRemoteModels(provider, apiKey, body.customBaseUrl);
                  for (const candidate of availableModels) {
                    if (candidate === targetModel) continue;
                    const retryRes = await executeRequest(candidate);
                    if (retryRes.ok) {
                      aiRes = retryRes;
                      finalModel = candidate;
                      break;
                    }
                  }
                }

                if (!aiRes.ok) {
                  const errData: any = await aiRes.json().catch(() => ({}));
                  let apiMsg = errData.error?.message || errData.message || `Status HTTP ${aiRes.status}`;
                  if (apiMsg.includes('does not exist') || apiMsg.includes('do not have access')) {
                    apiMsg = `Model "${targetModel}" tidak aktif pada akun Anda. Klik tombol "Muat Model Aktif" di Pengaturan AI untuk memilih model yang tersedia.`;
                  }
                  res.statusCode = aiRes.status;
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify({ error: `Gagal (${provider.toUpperCase()}): ${apiMsg}` }));
                  return;
                }

                const data: any = await aiRes.json();
                const rawText = data.choices?.[0]?.message?.content || '[]';
                const questions = parseQuestionsJson(rawText);
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ questions, modelUsed: finalModel, provider }));
                return;
              }

              async function callApi(modelName: string) {
                const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelName)}:generateContent?key=${apiKey}`;
                return await fetch(url, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    contents: [{ role: 'user', parts: [{ text: prompt }] }],
                    generationConfig: {
                      responseMimeType: 'application/json',
                      temperature: Math.max(0, Math.min(1, temperature))
                    }
                  })
                });
              }

              let geminiRes = await callApi(targetModel);
              let usedModel = targetModel;

              // Auto-fallback: Jika 429 (kuota habis), 503 (sibuk), atau 404
              if (!geminiRes.ok) {
                const errData: any = await geminiRes.clone().json().catch(() => ({}));
                const apiMsg = String(errData.error?.message || '').toLowerCase();
                const shouldFallback = geminiRes.status === 429 || geminiRes.status === 503 || geminiRes.status === 404 ||
                  apiMsg.includes('quota') || apiMsg.includes('rate') || apiMsg.includes('exhausted') ||
                  apiMsg.includes('overloaded') || apiMsg.includes('high demand') || apiMsg.includes('capacity');

                if (shouldFallback) {
                  console.warn(`[Auto-Fallback Dev] Model ${targetModel} status ${geminiRes.status}. Mencari model dengan kuota tersedia...`);
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
                    const retryRes = await callApi(cand);
                    if (retryRes.ok) {
                      geminiRes = retryRes;
                      usedModel = cand;
                      console.info(`[Auto-Fallback Dev] Berhasil dialihkan ke ${cand}`);
                      break;
                    }
                  }
                }
              }

              if (!geminiRes.ok) {
                const errData: any = await geminiRes.json().catch(() => ({}));
                const apiMsg = errData.error?.message || `Status HTTP ${geminiRes.status}`;
                res.statusCode = geminiRes.status;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ error: apiMsg }));
                return;
              }

              const data: any = await geminiRes.json();
              const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
              const questions = parseQuestionsJson(rawText);
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ questions, modelUsed: usedModel }));
            } catch (err: any) {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: err.message || 'Gagal memproses soal di dev server.' }));
            }
          });
          return;
        }

        next();
      });
    }
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    base: './',
    plugins: [react(), tailwindcss(), devApiPlugin(env)],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      port: 3000,
      host: true,
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});

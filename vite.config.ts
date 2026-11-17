import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv, Plugin } from 'vite';

function parseQuestionsJson(rawText: string): any[] {
  let cleaned = rawText.trim();
  if (cleaned.startsWith('```json')) cleaned = cleaned.substring(7);
  else if (cleaned.startsWith('```')) cleaned = cleaned.substring(3);
  if (cleaned.endsWith('```')) cleaned = cleaned.substring(0, cleaned.length - 3);
  cleaned = cleaned.trim();

  try {
    const direct = JSON.parse(cleaned);
    if (Array.isArray(direct)) return direct;
    if (direct && typeof direct === 'object') {
      if (Array.isArray(direct.questions)) return direct.questions;
      if (Array.isArray(direct.soal)) return direct.soal;
      if (Array.isArray(direct.data)) return direct.data;
      const firstArr = Object.values(direct).find(v => Array.isArray(v));
      if (firstArr) return firstArr as any[];
    }
  } catch {}

  const sIdx = cleaned.indexOf('[');
  const eIdx = cleaned.lastIndexOf(']');
  if (sIdx !== -1 && eIdx !== -1 && eIdx >= sIdx) {
    try {
      const parsed = JSON.parse(cleaned.substring(sIdx, eIdx + 1));
      if (Array.isArray(parsed)) return parsed;
    } catch {}
  }

  const objStart = cleaned.indexOf('{');
  const objEnd = cleaned.lastIndexOf('}');
  if (objStart !== -1 && objEnd !== -1 && objEnd >= objStart) {
    try {
      const parsedObj = JSON.parse(cleaned.substring(objStart, objEnd + 1));
      if (Array.isArray(parsedObj.questions)) return parsedObj.questions;
      if (Array.isArray(parsedObj.soal)) return parsedObj.soal;
      if (Array.isArray(parsedObj.data)) return parsedObj.data;
      const firstArr = Object.values(parsedObj).find(v => Array.isArray(v));
      if (firstArr) return firstArr as any[];
    } catch {}
  }

  throw new Error('Respons model tidak mengandung JSON array soal yang valid.');
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
    case 'custom': return 'llama3.2';
    default: return 'gemini-2.5-flash';
  }
}

function getDevBaseUrl(provider: string, customBaseUrl?: string): string {
  if (provider === 'custom') {
    return customBaseUrl?.trim() || 'http://localhost:11434/v1';
  }
  if (customBaseUrl && customBaseUrl.trim() && !customBaseUrl.includes('localhost:11434')) {
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

              if (!apiKey && provider !== 'custom') {
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

              if (!apiKey && provider !== 'custom') {
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
                    'gemini-1.5-flash',
                    'gemini-2.0-flash-lite',
                    'gemini-1.5-flash-8b'
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

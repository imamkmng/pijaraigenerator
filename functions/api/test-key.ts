interface Env {
  GEMINI_API_KEY?: string;
  VITE_GEMINI_API_KEY?: string;
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export const onRequestOptions = async () => {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
};

export const onRequestGet = async (context: { env: Env }) => {
  const hasServerKey = Boolean((context.env.GEMINI_API_KEY || context.env.VITE_GEMINI_API_KEY || "").trim());
  return new Response(
    JSON.stringify({
      hasServerKey,
      message: hasServerKey
        ? "Server Cloudflare Pages memiliki GEMINI_API_KEY aktif."
        : "Server Cloudflare Pages belum memiliki GEMINI_API_KEY bawaan. Pengguna perlu memasukkan API Key di Pengaturan AI.",
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    }
  );
};

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

export const onRequestPost = async (context: { request: Request; env: Env }) => {
  try {
    const body: any = await context.request.json().catch(() => ({}));
    const provider = body.aiProvider || 'gemini';
    const apiKey = (body.customApiKey || (provider === 'gemini' ? (context.env.GEMINI_API_KEY || context.env.VITE_GEMINI_API_KEY || "") : "")).trim();
    const rawModel = (body.customModel || "").trim().replace(/^models\//, "");
    let model = rawModel;
    if (!model || model === 'auto' || (provider === 'groq' && model === 'llama-3.3-70b-versatile')) {
      model = provider === 'gemini' ? 'gemini-2.5-flash' : provider === 'groq' ? 'llama-3.1-8b-instant' : provider === 'deepseek' ? 'deepseek-chat' : provider === 'openai' ? 'gpt-4o-mini' : provider === 'openrouter' ? 'meta-llama/llama-3.3-70b-instruct' : provider === '9router' ? 'gemini-2.5-flash' : 'llama3.2';
    }
    const customBaseUrl = body.customBaseUrl;

    if (!apiKey && provider !== 'custom' && provider !== '9router') {
      return new Response(
        JSON.stringify({ ok: false, message: `API Key untuk ${provider.toUpperCase()} kosong. Masukkan API Key Anda di Pengaturan AI.` }),
        { status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
      );
    }

    if (provider !== 'gemini') {
      // Test OpenAI-compatible endpoint (Groq, DeepSeek, OpenAI, OpenRouter, Custom)
      const baseUrl = getDefaultBaseUrl(provider, customBaseUrl);
      const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (apiKey) {
        headers["Authorization"] = `Bearer ${apiKey}`;
      }
      if (provider === 'openrouter') {
        headers["HTTP-Referer"] = "https://cbtpijar.app";
        headers["X-Title"] = "CBT Pijar AI Generator";
      }

      let res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 5,
        }),
      });

      // Auto-fallback: if model fails, dynamically query the active models on user's account!
      if (!res.ok) {
        try {
          const modelsRes = await fetch(`${baseUrl.replace(/\/+$/, '')}/models`, { headers });
          if (modelsRes.ok) {
            const mData: any = await modelsRes.json();
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
                return new Response(
                  JSON.stringify({
                    ok: true,
                    message: `Koneksi berhasil! Model "${model}" tidak aktif di akun Anda. Sistem otomatis menemukan dan menghubungkan ke model "${cand}" yang aktif & siap pakai.`,
                    fallbackModel: cand
                  }),
                  { status: 200, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
                );
              }
            }
          }
        } catch {}
      }

      if (!res.ok) {
        const err: any = await res.json().catch(() => ({}));
        let msg = err.error?.message || err.message || `Status HTTP ${res.status}`;
        if (msg.includes('does not exist') || msg.includes('do not have access')) {
          msg = `Model "${model}" tidak aktif pada akun Anda. Klik tombol "Muat Model Aktif" di Pengaturan untuk memilih model yang tersedia di akun Anda.`;
        }
        return new Response(
          JSON.stringify({ ok: false, message: `Gagal (${provider.toUpperCase()}): ${msg}` }),
          { status: 200, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
        );
      }

      return new Response(
        JSON.stringify({ ok: true, message: `Koneksi berhasil! Model "${model}" pada provider ${provider.toUpperCase()} aktif dan siap digunakan.` }),
        { status: 200, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
      );
    }

    // Lightweight call to verify Google Gemini key
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${apiKey}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: "ping" }] }],
        generationConfig: { maxOutputTokens: 5 },
      }),
    });

    if (!res.ok) {
      const err: any = await res.json().catch(() => ({}));
      const msg = err.error?.message || `HTTP ${res.status}`;
      return new Response(
        JSON.stringify({ ok: false, message: `Gagal (Gemini): ${msg}` }),
        { status: 200, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
      );
    }

    return new Response(
      JSON.stringify({ ok: true, message: `Koneksi berhasil! Model ${model} (Gemini) siap digunakan.` }),
      { status: 200, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
    );
  } catch (e: any) {
    return new Response(
      JSON.stringify({ ok: false, message: e.message || "Gagal tes koneksi." }),
      { status: 500, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
    );
  }
};


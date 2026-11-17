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
    case 'groq': return 'https://api.groq.com/openai/v1';
    case 'deepseek': return 'https://api.deepseek.com';
    case 'openai': return 'https://api.openai.com/v1';
    case 'openrouter': return 'https://openrouter.ai/api/v1';
    default: return 'https://api.openai.com/v1';
  }
}

export const onRequestPost = async (context: { request: Request; env: Env }) => {
  try {
    const body: any = await context.request.json().catch(() => ({}));
    const provider = body.aiProvider || 'gemini';
    const apiKey = (body.customApiKey || (provider === 'gemini' ? (context.env.GEMINI_API_KEY || context.env.VITE_GEMINI_API_KEY || "") : "")).trim();
    const customBaseUrl = body.customBaseUrl;

    if (provider === 'gemini') {
      if (!apiKey) {
        return new Response(JSON.stringify({ ok: false, error: 'Gemini API Key belum diisi.' }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...CORS_HEADERS }
        });
      }
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return new Response(JSON.stringify({ ok: false, error: err.error?.message || `HTTP ${res.status}` }), {
          status: 200,
          headers: { "Content-Type": "application/json", ...CORS_HEADERS }
        });
      }
      const data: any = await res.json();
      const models = (data.models || [])
        .filter((m: any) => m.supportedGenerationMethods?.includes('generateContent'))
        .map((m: any) => {
          const id = m.name.replace(/^models\//, '');
          return { id, name: m.displayName || id };
        });

      return new Response(JSON.stringify({ ok: true, models }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS }
      });
    }

    const baseUrl = getDefaultBaseUrl(provider, customBaseUrl);
    const url = `${baseUrl.replace(/\/+$/, '')}/models`;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
    if (provider === 'openrouter') {
      headers["HTTP-Referer"] = "https://cbtpijar.app";
      headers["X-Title"] = "CBT Pijar AI Generator";
    }

    const res = await fetch(url, { headers });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return new Response(JSON.stringify({ ok: false, error: err.error?.message || err.message || `HTTP ${res.status}` }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS }
      });
    }

    const data: any = await res.json();
    const rawList = Array.isArray(data.data) ? data.data : (Array.isArray(data.models) ? data.models : []);
    const models = rawList
      .map((m: any) => (typeof m === 'string' ? { id: m, name: m } : { id: m.id, name: m.id }))
      .filter((m: any) => {
        if (!m.id) return false;
        const low = m.id.toLowerCase();
        if (
          low.includes('whisper') ||
          low.includes('embed') ||
          low.includes('safeguard') ||
          low.includes('prompt-guard') ||
          low.includes('moderation') ||
          low.includes('dall-e') ||
          low.includes('tts')
        ) {
          return false;
        }
        return true;
      });

    return new Response(JSON.stringify({ ok: true, models }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS }
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ ok: false, error: err.message || 'Gagal memuat model.' }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS }
    });
  }
};


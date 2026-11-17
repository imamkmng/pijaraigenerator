import { useState, useRef, useEffect, useMemo } from 'react';
import {
  BookOpen,
  Settings2,
  Download,
  FileSpreadsheet,
  Loader2,
  List,
  Trash2,
  CheckSquare,
  Upload,
  AlertCircle,
  Edit2,
  X,
  History,
  Clock,
  Image as ImageIcon,
  Cpu,
  Bot,
  CheckCircle2,
  ExternalLink,
  LayoutList,
  Table as TableIcon,
  Search,
  Copy,
  Check,
  Eye,
  RefreshCw,
  Volume2,
  VolumeX
} from 'lucide-react';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import { playSuccessSound } from './assets/sound';

// --- Bulletproof QuickChart Normalizer & Healer ---
function normalizeQuickChartInText(text: string): string {
  if (!text || typeof text !== 'string') return text;
  if (!text.toLowerCase().includes('quickchart.io')) return text;

  let s = text;

  // Clean up corrupted duplicate QuickChart where a truncated prefix was joined with ](https://quickchart.io...
  s = s.replace(/!\[([^\]]*)\]\([^)\n]*?quickchart\.io\/chart[^\n]*?\]\((https?:\/\/quickchart\.io\/chart\?)/gi, '![$1]($2');
  s = s.replace(/!\[([^\]]*)\]\(\s*\[\s*(https?:\/\/quickchart\.io)/gi, '![$1]($2');
  s = s.replace(/\\\[/g, '[').replace(/\\\]/g, ']').replace(/\\\(/g, '(').replace(/\\\)/g, ')');

  // 2. Iterate and normalize every QuickChart instance
  let searchIdx = 0;
  let loopCount = 0;
  while (searchIdx < s.length && loopCount < 50) {
    loopCount++;
    const qcIdx = s.toLowerCase().indexOf('quickchart.io/chart', searchIdx);
    if (qcIdx === -1) break;

    // Check backwards to find where this image markdown / link / tag started
    let replaceStart = qcIdx;
    let alt = 'Grafik';

    const beforeSub = s.substring(Math.max(0, qcIdx - 200), qcIdx);
    const mdImgMatch = beforeSub.match(/!\[([^\]]*)\]\(\s*\[?\s*(https?:\/\/)?$/i);
    if (mdImgMatch) {
      alt = mdImgMatch[1]?.trim() || 'Grafik';
      const offset = beforeSub.lastIndexOf('![');
      if (offset !== -1) {
        replaceStart = Math.max(0, qcIdx - 200) + offset;
      }
    } else {
      const httpIdx = s.lastIndexOf('http', qcIdx);
      if (httpIdx !== -1 && qcIdx - httpIdx <= 8) {
        replaceStart = httpIdx;
      }
    }

    // Check if preceded by an unclosed/broken earlier QuickChart tag (e.g. truncated markdown block)
    const lookback = s.substring(Math.max(0, replaceStart - 2000), replaceStart);
    const brokenMatch = lookback.match(/!\[([^\]]*)\]\(\s*\[?\s*https?:\/\/[^)\n]*?quickchart\.io[^)\n]*?$/i);
    if (brokenMatch) {
      alt = brokenMatch[1]?.trim() || alt;
      const lastMd = lookback.lastIndexOf('![');
      if (lastMd !== -1) {
        replaceStart = Math.max(0, replaceStart - 2000) + lastMd;
      }
    }

    // Locate c= or chart= parameter
    const afterQc = s.substring(qcIdx);
    const cMatch = afterQc.match(/[?&](?:c|chart)=/i);
    if (!cMatch || cMatch.index === undefined) {
      searchIdx = qcIdx + 20;
      continue;
    }

    const cValueStart = qcIdx + cMatch.index + cMatch[0].length;
    const lookahead = s.substring(cValueStart, cValueStart + 8000);

    // Multi-pass URL decode
    let decoded = lookahead;
    for (let d = 0; d < 3; d++) {
      if (decoded.includes('%')) {
        try {
          decoded = decodeURIComponent(decoded);
        } catch {
          decoded = decoded
            .replace(/%7B/gi, '{')
            .replace(/%7D/gi, '}')
            .replace(/%22/gi, '"')
            .replace(/%3A/gi, ':')
            .replace(/%2C/gi, ',')
            .replace(/%5B/gi, '[')
            .replace(/%5D/gi, ']')
            .replace(/%20/gi, ' ')
            .replace(/%28/gi, '(')
            .replace(/%29/gi, ')');
        }
      }
    }

    const firstBrace = decoded.indexOf('{');
    if (firstBrace === -1) {
      searchIdx = qcIdx + 20;
      continue;
    }

    // Find the end of JSON by tracking brace depth
    let depth = 0;
    let inString = false;
    let quoteChar = '';
    let isEscaped = false;
    let jsonEndPos = -1;

    for (let i = firstBrace; i < decoded.length; i++) {
      const ch = decoded[i];
      if (isEscaped) {
        isEscaped = false;
        continue;
      }
      if (ch === '\\') {
        isEscaped = true;
        continue;
      }
      if (inString) {
        if (ch === quoteChar) {
          inString = false;
        }
      } else {
        if (ch === '"' || ch === "'") {
          inString = true;
          quoteChar = ch;
        } else if (ch === '{') {
          depth++;
        } else if (ch === '}') {
          depth--;
          if (depth === 0) {
            jsonEndPos = i;
            break;
          }
        }
      }
    }

    if (jsonEndPos === -1) {
      searchIdx = qcIdx + 20;
      continue;
    }

    const jsonStr = decoded.substring(firstBrace, jsonEndPos + 1);
    let parsedConfig: any = null;

    try {
      parsedConfig = JSON.parse(jsonStr);
    } catch {
      try {
        const relaxed = jsonStr
          .replace(/([{,]\s*)([a-zA-Z0-9_]+)\s*:/g, '$1"$2":')
          .replace(/'([^']*)'/g, '"$1"')
          .replace(/,\s*([}\]])/g, '$1');
        parsedConfig = JSON.parse(relaxed);
      } catch { }
    }

    // Fallback regex extraction if JSON still not valid
    if (!parsedConfig || !parsedConfig.data) {
      const lm = jsonStr.match(/labels\s*:\s*\[(.*?)\]/s);
      const dm = jsonStr.match(/data\s*:\s*\[(.*?)\]/s);
      if (lm && dm) {
        const rLabels = lm[1].split(',').map(x => x.replace(/['"\\]/g, '').trim()).filter(Boolean);
        const rData = dm[1].split(',').map(x => Number(x.trim()) || 0);
        const tm = jsonStr.match(/type\s*:\s*['"]?([a-zA-Z]+)/);
        const isH = jsonStr.includes('indexAxis') && (jsonStr.includes("'y'") || jsonStr.includes('"y"'));
        parsedConfig = {
          type: tm ? tm[1] : 'bar',
          data: {
            labels: rLabels,
            datasets: [{ label: alt, data: rData }]
          },
          options: {
            indexAxis: isH ? 'y' : 'x'
          }
        };
      }
    }

    if (!parsedConfig || !parsedConfig.data) {
      searchIdx = qcIdx + 20;
      continue;
    }

    // Calculate replaceEnd in original string s
    const totalClosingBraces = (jsonStr.match(/\}/g) || []).length;
    let bracesCount = 0;
    let replaceEnd = cValueStart;
    let pos = cValueStart;

    while (pos < s.length) {
      if (s[pos] === '}') {
        bracesCount++;
        if (bracesCount === totalClosingBraces) {
          replaceEnd = pos + 1;
          break;
        }
      } else if (s.substring(pos, pos + 3).toLowerCase() === '%7d') {
        bracesCount++;
        if (bracesCount === totalClosingBraces) {
          replaceEnd = pos + 3;
          break;
        }
        pos += 2;
      }
      pos++;
    }

    // Consume trailing query params (&bkg=white etc.) and closing syntax
    while (replaceEnd < s.length) {
      const ch = s[replaceEnd];
      if (ch === '&') {
        const nextAmp = s.indexOf('&', replaceEnd + 1);
        const nextParen = s.indexOf(')', replaceEnd + 1);
        const endParam = (nextParen !== -1 && (nextAmp === -1 || nextParen < nextAmp)) ? nextParen : (nextAmp !== -1 ? nextAmp : replaceEnd + 1);
        replaceEnd = endParam;
      } else if (ch === ')' || ch === ']' || ch === '"' || ch === '>') {
        replaceEnd++;
      } else if (ch === ' ' || ch === '\t') {
        replaceEnd++;
      } else {
        break;
      }
    }

    // Check for immediately following duplicate or fragmented link
    const followChunk = s.substring(replaceEnd, replaceEnd + 120);
    const dupMatch = followChunk.match(/^\s*\]\(https?:\/\/quickchart\.io\/chart\?/i);
    if (dupMatch) {
      const dupParen = s.indexOf(')', replaceEnd + dupMatch[0].length);
      if (dupParen !== -1) {
        replaceEnd = dupParen + 1;
      }
    }

    // Clean up title/label in config from leftover markdown syntax
    if (parsedConfig.options?.plugins?.title?.text) {
      parsedConfig.options.plugins.title.text = String(parsedConfig.options.plugins.title.text)
        .replace(/\]\(https?:.*$/i, '')
        .replace(/\)+$/, '')
        .trim();
    }

    // Construct canonical, 100% encoded QuickChart Markdown image
    const cleanConfigJson = JSON.stringify(parsedConfig);
    const encodedConfig = encodeURIComponent(cleanConfigJson);
    const cleanUrl = `https://quickchart.io/chart?bkg=white&w=500&h=300&format=png&c=${encodedConfig}`;
    const replacement = `![${alt}](${cleanUrl})`;

    s = s.substring(0, replaceStart) + replacement + s.substring(replaceEnd);
    searchIdx = replaceStart + replacement.length;
  }

  return s;
}

function sanitizeQuickChartUrl(rawUrl: string): string {
  try {
    const norm = normalizeQuickChartInText(`![Grafik](${rawUrl})`);
    const match = norm.match(/!\[.*?\]\((.+?)\)/);
    return match ? match[1] : rawUrl;
  } catch {
    return rawUrl;
  }
}

function fixMermaidUrl(alt: string, fullUrl: string): string {
  try {
    let url = fullUrl.trim();
    const prefix = 'https://mermaid.ink/img/';
    const prefixIdx = url.indexOf(prefix);
    if (prefixIdx === -1) return `![${alt}](${url})`;

    let payload = url.substring(prefixIdx + prefix.length);
    const qIdx = payload.indexOf('?');
    if (qIdx !== -1) {
      payload = payload.substring(0, qIdx);
    }
    payload = payload.replace(/\)+$/, '').trim();

    let mermaidCode = '';
    let isBase64Valid = false;

    try {
      const decoded = atob(payload.replace(/\s+/g, ''));
      if (
        decoded.includes('graph') ||
        decoded.includes('flowchart') ||
        decoded.includes('sequence') ||
        decoded.includes('class') ||
        decoded.includes('state') ||
        decoded.includes('-->') ||
        decoded.includes('---')
      ) {
        mermaidCode = decoded;
        isBase64Valid = true;
      }
    } catch {
      isBase64Valid = false;
    }

    if (!isBase64Valid) {
      try {
        const urlDecoded = decodeURIComponent(payload);
        if (urlDecoded.includes('graph') || urlDecoded.includes('flowchart') || urlDecoded.includes('-->')) {
          mermaidCode = urlDecoded;
        }
      } catch {
        mermaidCode = payload;
      }
    }

    if (mermaidCode) {
      mermaidCode = mermaidCode.replace(/\\n/g, '\n');
      const cleanB64 = btoa(unescape(encodeURIComponent(mermaidCode.trim())));
      return `![${alt || 'Diagram'}](https://mermaid.ink/img/${cleanB64}?bgColor=white)`;
    }

    if (isBase64Valid) {
      return `![${alt || 'Diagram'}](https://mermaid.ink/img/${payload}?bgColor=white)`;
    }

    return `![${alt}](${url})`;
  } catch {
    return `![${alt}](${fullUrl})`;
  }
}

export function preprocessMarkdown(text: string): string {
  if (!text) return text;
  let result = text;

  // 1. Convert HTML <img> tags to Markdown format
  result = result.replace(/<img\s+[^>]*src=["']([^"']+)["'][^>]*alt=["']([^"']*)["'][^>]*\/?>/gi, '![$2]($1)');
  result = result.replace(/<img\s+[^>]*alt=["']([^"']*)["'][^>]*src=["']([^"']+)["'][^>]*\/?>/gi, '![$1]($2)');
  result = result.replace(/<img\s+[^>]*src=["']([^"']+)["'][^>]*\/?>/gi, '![Gambar]($1)');

  // 2. Convert ```mermaid code blocks to Markdown images
  result = result.replace(/```mermaid\s*([\s\S]*?)```/gi, (_, code) => {
    try {
      const cleanCode = code.trim().replace(/\\n/g, '\n');
      const b64 = btoa(unescape(encodeURIComponent(cleanCode)));
      return `\n\n![Diagram](https://mermaid.ink/img/${b64}?bgColor=white)\n\n`;
    } catch {
      return _;
    }
  });

  // 3. Fix Mermaid.ink URLs
  result = result.replace(/!\[([^\]]*)\]\((https?:\/\/mermaid\.ink\/img\/[^\s)]+(?:\)[^\s)]*)*)\)/gi, (match, alt, fullUrl) => {
    return fixMermaidUrl(alt, fullUrl);
  });

  // 4. Bulletproof QuickChart.io Normalizer & Healer (replaces regexes that choke on parentheses/spaces)
  result = normalizeQuickChartInText(result);

  // 6. Fix Pollinations.ai URLs (replace spaces in prompt with hyphens)
  result = result.replace(/!\[([^\]]*)\]\((https?:\/\/image\.pollinations\.ai\/prompt\/[^)]+)\)/gi, (match, alt, url) => {
    try {
      const fixedUrl = url.replace(/ /g, '-');
      return `![${alt}](${fixedUrl})`;
    } catch {
      return match;
    }
  });

  return result;
}

// --- Native Mermaid Diagram Parser & Renderer (Instant, Offline) ---
function parseMermaidCode(url: string): string {
  if (!url || typeof url !== 'string' || !url.includes('mermaid')) return '';
  try {
    const prefix = 'https://mermaid.ink/img/';
    let payload = url;
    const prefixIdx = url.indexOf(prefix);
    if (prefixIdx !== -1) {
      payload = url.substring(prefixIdx + prefix.length);
    }
    const qIdx = payload.indexOf('?');
    if (qIdx !== -1) payload = payload.substring(0, qIdx);
    payload = payload.replace(/\)+$/, '').trim();

    try {
      const decoded = atob(payload.replace(/\s+/g, ''));
      if (decoded && (decoded.includes('graph') || decoded.includes('flowchart') || decoded.includes('-->') || decoded.includes('---'))) {
        return decoded.replace(/\\n/g, '\n');
      }
    } catch { }

    try {
      const urlDecoded = decodeURIComponent(payload);
      if (urlDecoded && (urlDecoded.includes('graph') || urlDecoded.includes('flowchart') || urlDecoded.includes('-->') || urlDecoded.includes('---'))) {
        return urlDecoded.replace(/\\n/g, '\n');
      }
    } catch { }

    return '';
  } catch {
    return '';
  }
}

function parseMermaidDiagram(code: string) {
  if (!code) return null;
  const clean = code.replace(/\\n/g, '\n');
  const lines = clean.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('%%'));
  if (lines.length === 0) return null;

  const firstLine = lines[0].toLowerCase();
  const isLR = firstLine.includes(' lr');

  const steps: { id: string; label: string; edgeLabel?: string }[] = [];
  const nodeMap = new Map<string, string>();

  const extractNode = (token: string) => {
    let t = token.trim();
    const m = t.match(/^([a-zA-Z0-9_-]+)\s*[\[\(\{](.+?)[\]\)\}]$/);
    if (m) {
      const id = m[1];
      const label = m[2].replace(/["']/g, '').trim();
      nodeMap.set(id, label);
      return { id, label };
    }
    const id = t.replace(/[\[\]\(\)\{\}]/g, '').trim();
    const label = nodeMap.get(id) || id;
    return { id, label };
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.toLowerCase().startsWith('graph') || line.toLowerCase().startsWith('flowchart')) continue;

    // Split chained arrows: A --> B --> C or A --> B
    const tokens = line.split(/\s*(?:-->|---|==>|->)\s*/);
    if (tokens.length >= 2) {
      for (let j = 0; j < tokens.length; j++) {
        let rawToken = tokens[j].trim();
        let edgeLabel = '';
        const edgeMatch = rawToken.match(/^\|([^|]+)\|\s*(.*)$/);
        if (edgeMatch) {
          edgeLabel = edgeMatch[1].trim();
          rawToken = edgeMatch[2].trim();
        }
        if (!rawToken) continue;

        const node = extractNode(rawToken);
        if (!steps.some(s => s.id === node.id)) {
          steps.push({ ...node, edgeLabel });
        } else if (edgeLabel) {
          const existing = steps.find(s => s.id === node.id);
          if (existing && !existing.edgeLabel) existing.edgeLabel = edgeLabel;
        }
      }
    } else {
      const n = extractNode(line);
      if (n.id && n.label && !steps.some(s => s.id === n.id)) {
        steps.push(n);
      }
    }
  }

  if (steps.length > 0) {
    return { isLR, steps };
  }
  return null;
}

const NativeSvgDiagram = ({ code, rawSrc }: { code: string; rawSrc?: string }) => {
  const parsed = parseMermaidDiagram(code);

  return (
    <div className="my-3 bg-gradient-to-br from-indigo-50/60 to-white p-4 rounded-xl border border-indigo-200/80 shadow-sm max-w-[560px]">
      <div className="flex items-center justify-between mb-3 border-b border-indigo-100 pb-2">
        <span className="font-bold text-indigo-900 text-xs sm:text-sm flex items-center gap-1.5">
          <BookOpen className="w-4 h-4 text-indigo-600" />
          <span>Diagram Alur / Siklus Proses</span>
        </span>
        {rawSrc && (
          <a
            href={rawSrc}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-indigo-600 hover:underline inline-flex items-center gap-1"
          >
            Buka URL <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>

      {parsed && parsed.steps.length > 0 ? (
        <div className={`flex ${parsed.isLR ? 'flex-row flex-wrap items-center' : 'flex-col items-center'} gap-2 justify-center py-2`}>
          {parsed.steps.map((step, idx) => (
            <div key={idx} className={`flex ${parsed.isLR ? 'flex-row items-center' : 'flex-col items-center'} gap-2`}>
              <div className="px-4 py-2.5 bg-white border-2 border-indigo-500 rounded-xl shadow-sm text-center font-bold text-slate-800 text-xs sm:text-sm min-w-[120px] max-w-[220px] leading-snug">
                {step.label}
              </div>

              {idx < parsed.steps.length - 1 && (
                <div className="flex flex-col items-center justify-center text-indigo-600 font-bold my-1">
                  {step.edgeLabel && (
                    <span className="text-[10px] font-semibold text-indigo-700 bg-indigo-100/80 px-2 py-0.5 rounded-full border border-indigo-200 mb-0.5">
                      {step.edgeLabel}
                    </span>
                  )}
                  <span className="text-base">{parsed.isLR ? '→' : '↓'}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <pre className="text-xs bg-white p-3 rounded-lg border border-slate-200 font-mono text-slate-700 whitespace-pre-wrap">
          {code}
        </pre>
      )}
    </div>
  );
};

const MarkdownImage = ({ src, alt, ...props }: any) => {
  const [hasError, setHasError] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [retryKey, setRetryKey] = useState(0);
  const imgRef = useRef<HTMLImageElement>(null);

  const isQuickChart = typeof src === 'string' && src.toLowerCase().includes('quickchart.io');

  useEffect(() => {
    if (imgRef.current && imgRef.current.complete) {
      setIsLoading(false);
      if (imgRef.current.naturalWidth === 0) {
        setHasError(true);
      } else {
        setHasError(false);
      }
    } else {
      setHasError(false);
      setIsLoading(true);
    }
  }, [src, retryKey]);

  // HANYA JIKA gambar asli dari URL gagal dimuat di browser (misal koneksi terputus):
  if (hasError) {
    // 1. Fallback untuk Mermaid
    const mermaidCode = typeof src === 'string' && src.includes('mermaid')
      ? parseMermaidCode(src)
      : '';
    if (mermaidCode) {
      return (
        <div className="my-2 max-w-[560px]">
          <div className="text-[11px] text-amber-700 bg-amber-50 px-3 py-1.5 rounded-t-xl border border-b-0 border-amber-200 flex items-center justify-between">
            <span>Menampilkan versi cadangan bagan (server mermaid.ink lambat)</span>
            <a href={src} target="_blank" rel="noopener noreferrer" className="underline font-semibold flex items-center gap-1">
              Buka Gambar Asli <ExternalLink className="w-3 h-3" />
            </a>
          </div>
          <NativeSvgDiagram code={mermaidCode} rawSrc={src} />
        </div>
      );
    }

    // 2. Fallback untuk QuickChart / Gambar Umum
    return (
      <div className="my-2.5 p-3.5 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800 max-w-lg shadow-sm">
        <div className="flex items-center justify-between gap-2 flex-wrap mb-1.5">
          <span className="font-semibold flex items-center gap-1.5 text-amber-900">
            <ImageIcon className="w-4 h-4 text-amber-600 shrink-0" />
            {alt || (isQuickChart ? 'Grafik Soal (PNG)' : 'Gambar Soal')}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setHasError(false);
                setIsLoading(true);
                setRetryKey(k => k + 1);
              }}
              className="text-[11px] text-indigo-700 hover:text-indigo-900 font-semibold underline cursor-pointer"
            >
              Coba Muat Ulang
            </button>
            {src && (
              <a
                href={src}
                target="_blank"
                rel="noopener noreferrer"
                className="text-indigo-600 hover:text-indigo-800 font-medium inline-flex items-center gap-1 underline text-xs"
              >
                Buka Gambar di Tab Baru <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        </div>
        <p className="text-[11px] text-amber-700">
          {isQuickChart 
            ? 'Grafik PNG tidak dapat dimuat langsung oleh browser. Periksa koneksi internet atau klik tombol di atas.' 
            : 'Gambar tidak dapat dimuat langsung oleh browser. Klik tautan di atas untuk melihat gambar di tab baru.'}
        </p>
      </div>
    );
  }

  // TAMPILKAN GAMBAR ASLI DARI URL (PNG untuk QuickChart, atau foto biasa):
  return (
    <div className="my-2.5 relative inline-block max-w-full">
      {isLoading && (
        <div className="absolute inset-0 bg-slate-50/80 rounded-xl flex items-center justify-center text-slate-400 text-xs gap-1.5 z-10 min-h-[120px] min-w-[240px]">
          <Loader2 className="w-4 h-4 animate-spin text-indigo-500" />
          <span className="text-[11px] text-slate-500 font-medium">
            {isQuickChart ? 'Memuat grafik PNG...' : 'Memuat gambar...'}
          </span>
        </div>
      )}
      <img
        key={retryKey}
        ref={imgRef}
        src={src}
        alt={alt || (isQuickChart ? 'Grafik Soal (PNG)' : 'Visual Soal')}
        referrerPolicy="no-referrer"
        className={`max-w-full h-auto rounded-xl bg-white shadow-sm border border-slate-200 block transition-opacity duration-200 ${
          isLoading ? 'opacity-0 min-h-[120px] min-w-[240px]' : 'opacity-100'
        }`}
        loading="eager"
        onLoad={() => {
          setIsLoading(false);
          setHasError(false);
        }}
        onError={() => {
          setIsLoading(false);
          setHasError(true);
        }}
        {...props}
      />
    </div>
  );
};

const MarkdownText = ({ children, inline = false }: { children?: any; inline?: boolean }) => {
  if (!children) return null;
  const raw = typeof children === 'string' ? children : String(children || '');
  const content = preprocessMarkdown(raw);
  return (
    <div className={`markdown-body text-sm ${inline ? 'inline' : 'space-y-2'}`}>
      <ReactMarkdown
        remarkPlugins={[remarkMath, remarkGfm]}
        rehypePlugins={[rehypeKatex]}
        components={{
          p: ({ node, ...props }) =>
            inline ? (
              <span className="inline" {...props} />
            ) : (
              <p className="my-1.5 leading-relaxed text-slate-800" {...props} />
            ),
          img: MarkdownImage,
          table: ({ node, ...props }) => (
            <div className="overflow-x-auto my-2 rounded-lg border border-slate-200">
              <table className="min-w-full text-xs text-left divide-y divide-slate-200" {...props} />
            </div>
          ),
          th: ({ node, ...props }) => <th className="bg-slate-100 px-3 py-1.5 font-semibold text-slate-700" {...props} />,
          td: ({ node, ...props }) => <td className="px-3 py-1.5 border-t border-slate-100" {...props} />,
          code: ({ node, ...props }) => <code className="bg-slate-100 text-indigo-700 px-1 py-0.5 rounded text-xs font-mono" {...props} />
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
};

type QuestionType = 'PG' | 'ESSAY' | 'PILIHAN ESSAY' | 'PGK' | 'MENGURUTKAN';

interface QuestionData {
  Nomor: number;
  Jenis_Soal: QuestionType;
  Nilai: number;
  Nama_Materi: string;
  Judul_Referensi: string;
  Isi_Referensi: string;
  Soal: string;
  File_Audio_Video: string;
  Pilihan_A?: string;
  Pilihan_B?: string;
  Pilihan_C?: string;
  Pilihan_D?: string;
  Pilihan_E?: string;
  Pilihan_F?: string;
  Kunci_Jawaban_Non_Essay: string;
  Jawaban_Essay: string;
}

interface HistoryItem {
  id: number;
  timestamp: string;
  subject: string;
  topic: string;
  count: number;
  questions: QuestionData[];
}

const QUESTION_TYPES = [
  { id: 'PG', label: 'Pilihan Ganda' },
  { id: 'ESSAY', label: 'Essay' },
  { id: 'PILIHAN ESSAY', label: 'Pilihan Essay' },
  { id: 'PGK', label: 'Pilihan Ganda Kompleks' },
  { id: 'MENGURUTKAN', label: 'Mengurutkan' }
];

const COGNITIVE_LEVELS = [
  'LOTS (C1-C2: Mengingat, Memahami)',
  'MOTS (C3: Mengaplikasikan)',
  'HOTS (C4-C6: Menganalisis, Mengevaluasi, Mencipta)'
];

export type AIProvider = 'gemini' | 'groq' | 'deepseek' | 'openai' | 'openrouter' | '9router' | 'custom';

export interface AIProviderConfig {
  id: AIProvider;
  name: string;
  badge?: string;
  tagline: string;
  defaultBaseUrl: string;
  keyPlaceholder: string;
  keyUrl: string;
  keyUrlLabel: string;
  defaultModel: string;
  fastModel?: string;
  reasoningModel?: string;
  models: { id: string; name: string; desc?: string }[];
}

export const AI_PROVIDERS: AIProviderConfig[] = [
  {
    id: 'gemini',
    name: 'Google Gemini',
    tagline: 'Gratis kuota harian besar, cepat & mutakhir',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com',
    keyPlaceholder: 'AIzaSy...',
    keyUrl: 'https://aistudio.google.com/app/apikey',
    keyUrlLabel: 'Google AI Studio',
    defaultModel: 'gemini-2.5-flash',
    fastModel: 'gemini-2.0-flash',
    reasoningModel: 'gemini-2.5-pro',
    models: [
      { id: 'gemini-2.0-flash', name: 'Gemini 2 Flash', desc: 'Next-Gen Cepat & Sangat Stabil' },
      { id: 'gemini-2.0-flash-lite', name: 'Gemini 2 Flash Lite', desc: 'Ringan, Cepat & Hemat Kuota' },
      { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', desc: 'Sangat Cepat & Cerdas (Rekomendasi Utama)' },
      { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite', desc: 'Versi Ringan Efisien' },
      { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', desc: 'Penalaran Tingkat Tinggi / Soal HOTS' },
      { id: 'gemini-3-flash', name: 'Gemini 3 Flash', desc: 'Generasi Gemini 3 Cepat' },
      { id: 'gemini-3.1-pro', name: 'Gemini 3.1 Pro', desc: 'Penalaran Lanjut Canggih' },
      { id: 'gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash Lite', desc: 'Model Ringan Cepat Generasi 3.1' },
      { id: 'gemini-3.6-flash', name: 'Gemini 3.6 Flash', desc: 'Model Kecepatan Tinggi Generasi 3.6' },
      { id: 'gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash Lite', desc: 'Model Ringan Generasi 3.5' },
      { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', desc: 'Performa Cerdas Mutakhir 3.8' },
      { id: 'gemini-4-argon', name: 'Gemini 4 Argon', desc: 'Edisi Khusus Argon Generasi 4' },
      { id: 'gemini-4-carbon', name: 'Gemini 4 Carbon', desc: 'Edisi Khusus Carbon Generasi 4' },
      { id: 'gemini-4-hydrogen', name: 'Gemini 4 Hydrogen', desc: 'Edisi Khusus Hydrogen Generasi 4' },
    ]
  },
  {
    id: 'groq',
    name: 'Groq Cloud',
    tagline: 'Inferensi LPU super cepat, gratis & open source',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    keyPlaceholder: 'gsk_...',
    keyUrl: 'https://console.groq.com/keys',
    keyUrlLabel: 'Groq Console (Gratis)',
    defaultModel: 'openai/gpt-oss-120b',
    fastModel: 'openai/gpt-oss-20b',
    reasoningModel: 'deepseek-r1-distill-llama-70b',
    models: [
      { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B Instant', desc: 'Paling Stabil & Super Cepat (~800 tok/detik, Akses Gratis Semua Akun - Rekomendasi)' },
      { id: 'openai/gpt-oss-120b', name: 'OpenAI GPT-OSS 120B', desc: 'Model Flagship penalaran tinggi di Groq' },
      { id: 'openai/gpt-oss-20b', name: 'OpenAI GPT-OSS 20B', desc: 'Model ringkas & cepat di Groq' },
      { id: 'qwen/qwen3.8-27b', name: 'Qwen 3.8 27B', desc: 'Model multimodal canggih di Groq' },
      { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B Versatile', desc: 'Model 70B (Memerlukan tier/akses khusus di Groq)' },
      { id: 'deepseek-r1-distill-llama-70b', name: 'DeepSeek R1 Distill 70B', desc: 'Penalaran mendalam untuk soal Matematika & Sains' },
      { id: 'mixtral-8x7b-32768', name: 'Mixtral 8x7B', desc: 'Konteks panjang 32k token' },
      { id: 'gemma2-9b-it', name: 'Google Gemma 2 9B', desc: 'Model Google open source di Groq' },
    ]
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    tagline: 'Juara penalaran logika, matematika & tarif super hemat',
    defaultBaseUrl: 'https://api.deepseek.com',
    keyPlaceholder: 'sk-...',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    keyUrlLabel: 'DeepSeek Platform',
    defaultModel: 'deepseek-chat',
    fastModel: 'deepseek-chat',
    reasoningModel: 'deepseek-reasoner',
    models: [
      { id: 'deepseek-chat', name: 'DeepSeek-V3 (Chat)', desc: 'Penalaran tinggi & tarif sangat terjangkau (Rekomendasi)' },
      { id: 'deepseek-reasoner', name: 'DeepSeek-R1 (Reasoning)', desc: 'Penalaran bertahap (Chain-of-Thought) untuk soal sulit' },
    ]
  },
  {
    id: 'openai',
    name: 'OpenAI',
    tagline: 'Pionir model GPT-4o & GPT-4o-mini',
    defaultBaseUrl: 'https://api.openai.com/v1',
    keyPlaceholder: 'sk-proj-...',
    keyUrl: 'https://platform.openai.com/api-keys',
    keyUrlLabel: 'OpenAI Platform',
    defaultModel: 'gpt-4o-mini',
    fastModel: 'gpt-4o-mini',
    reasoningModel: 'o3-mini',
    models: [
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini', desc: 'Cepat, cerdas & sangat hemat biaya (Rekomendasi)' },
      { id: 'gpt-4o', name: 'GPT-4o Flagship', desc: 'Model flagship multimodal tercanggih dari OpenAI' },
      { id: 'o3-mini', name: 'o3-mini', desc: 'Model penalaran penalaran STEM & hitungan' },
      { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', desc: 'Versi turbo klasik' },
    ]
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    tagline: '1 API Key untuk 200+ model: Claude, Llama, Mistral, dll.',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    keyPlaceholder: 'sk-or-v1-...',
    keyUrl: 'https://openrouter.ai/keys',
    keyUrlLabel: 'OpenRouter Dashboard',
    defaultModel: 'meta-llama/llama-3.3-70b-instruct',
    fastModel: 'google/gemini-2.0-flash-001',
    reasoningModel: 'deepseek/deepseek-r1',
    models: [
      { id: 'meta-llama/llama-3.3-70b-instruct', name: 'Meta Llama 3.3 70B', desc: 'Open source terbaik via OpenRouter' },
      { id: 'deepseek/deepseek-r1', name: 'DeepSeek R1 (Full)', desc: 'Model penalaran 671B parameter' },
      { id: 'anthropic/claude-3.5-haiku', name: 'Claude 3.5 Haiku', desc: 'Bahasa Indonesia & sastra sangat alami' },
      { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', desc: 'Kecerdasan tertinggi dari Anthropic' },
      { id: 'google/gemini-2.0-flash-001', name: 'Gemini 2.0 Flash (OpenRouter)', desc: 'Akses Gemini tanpa akun Google Cloud' },
    ]
  },
  {
    id: '9router',
    name: '9router',
    tagline: 'Gateway AI mandiri & proxy multi-provider (40+ LLM)',
    defaultBaseUrl: 'http://localhost:20128/v1',
    keyPlaceholder: 'API Key (opsional / jika diproteksi token)',
    keyUrl: 'http://localhost:20128',
    keyUrlLabel: 'Dashboard 9router (Localhost)',
    defaultModel: 'gemini-2.5-flash',
    fastModel: 'gemini-2.0-flash',
    reasoningModel: 'claude-3-7-sonnet',
    models: [
      { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', desc: 'Rute via 9router' },
      { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', desc: 'Rute via 9router' },
      { id: 'claude-3-7-sonnet', name: 'Claude 3.7 Sonnet', desc: 'Rute via 9router' },
      { id: 'claude-3-5-sonnet', name: 'Claude 3.5 Sonnet', desc: 'Rute via 9router' },
      { id: 'deepseek-chat', name: 'DeepSeek V3', desc: 'Rute via 9router' },
      { id: 'deepseek-reasoner', name: 'DeepSeek R1', desc: 'Rute via 9router' },
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini', desc: 'Rute via 9router' },
      { id: 'gpt-4o', name: 'GPT-4o Flagship', desc: 'Rute via 9router' },
      { id: 'qwen-2.5-72b', name: 'Qwen 2.5 72B', desc: 'Rute via 9router' },
      { id: 'llama-3.3-70b', name: 'Llama 3.3 70B', desc: 'Rute via 9router' }
    ]
  },
  {
    id: 'custom',
    name: 'Custom (Ollama / Local LLM / Lainnya)',
    tagline: 'Gunakan server lokal Ollama, LM Studio, vLLM, atau proxy Anda',
    defaultBaseUrl: 'http://localhost:11434/v1',
    keyPlaceholder: 'API Key (kosongkan jika Ollama lokal)',
    keyUrl: 'https://ollama.com',
    keyUrlLabel: 'Panduan Ollama',
    defaultModel: 'llama3.2',
    fastModel: 'llama3.2',
    reasoningModel: 'deepseek-r1',
    models: [
      { id: 'llama3.2', name: 'Llama 3.2', desc: 'Model lokal ringan Ollama' },
      { id: 'llama3.3', name: 'Llama 3.3', desc: 'Model lokal 70B Ollama' },
      { id: 'deepseek-r1', name: 'DeepSeek R1 Lokal', desc: 'Ollama deepseek-r1' },
      { id: 'qwen2.5', name: 'Qwen 2.5', desc: 'Model multilingual kuat' },
      { id: 'mistral', name: 'Mistral 7B', desc: 'Model open source klasik' },
    ]
  }
];

export function detectProviderFromKey(key: string): AIProvider | null {
  const clean = key.trim();
  if (!clean) return null;
  if (clean.startsWith('AIzaSy')) return 'gemini';
  if (clean.startsWith('gsk_')) return 'groq';
  if (clean.startsWith('sk-or-')) return 'openrouter';
  if (clean.startsWith('sk-proj-')) return 'openai';
  if (clean.startsWith('sk-')) return 'deepseek';
  if (clean.startsWith('9r-') || clean.startsWith('9router')) return '9router';
  return null;
}

export function resolveEffectiveModel(provider: AIProvider, model: string): string {
  if (!model || model === 'auto') {
    const p = AI_PROVIDERS.find(x => x.id === provider) || AI_PROVIDERS[0];
    return p.defaultModel;
  }
  const clean = model.trim().replace(/^models\//, '');
  if (provider === 'groq' && (clean === 'llama-3.3-70b-versatile' || clean === 'llama-3.1-8b-instant')) {
    return 'openai/gpt-oss-120b';
  }
  return clean;
}

export default function App() {
  const [showSettings, setShowSettings] = useState(false);
  const [aiProvider, setAiProvider] = useState<AIProvider>(() => {
    return (localStorage.getItem('aiProvider') as AIProvider) || 'gemini';
  });
  const [customBaseUrl, setCustomBaseUrl] = useState(() => {
    return localStorage.getItem('customBaseUrl') || '';
  });
  const [customApiKey, setCustomApiKey] = useState(() => {
    const prov = (localStorage.getItem('aiProvider') as AIProvider) || 'gemini';
    return localStorage.getItem(`apiKey_${prov}`) || (prov === 'gemini' ? (localStorage.getItem('customApiKey') || '') : '');
  });
  const [customModel, setCustomModel] = useState(() => {
    const saved = localStorage.getItem('customModel');
    if (!saved || saved === 'auto' || saved === 'gemini-3.8-flash' || saved === 'llama-3.3-70b-versatile' || saved === 'llama-3.1-8b-instant') return 'auto';
    return saved;
  });
  const [isCustomModelName, setIsCustomModelName] = useState(() => {
    const saved = localStorage.getItem('customModel') || 'auto';
    if (saved === 'auto') return false;
    const allKnown = AI_PROVIDERS.flatMap(p => p.models.map(m => m.id));
    return !allKnown.includes(saved);
  });
  const [autoDetectedBanner, setAutoDetectedBanner] = useState<string>('');
  const [lastModelUsed, setLastModelUsed] = useState<string>('');
  const [accountModels, setAccountModels] = useState<Record<string, { id: string; name: string }[]>>(() => {
    try {
      const stored = localStorage.getItem('accountModels');
      return stored ? JSON.parse(stored) : {};
    } catch {
      return {};
    }
  });
  const [isLoadingModels, setIsLoadingModels] = useState<boolean>(false);
  const [aiTemperature, setAiTemperature] = useState<number>(() => {
    const saved = localStorage.getItem('aiTemperature');
    return saved !== null ? parseFloat(saved) : 0.7;
  });
  const [additionalInstructions, setAdditionalInstructions] = useState(() => {
    return localStorage.getItem('additionalInstructions') || '';
  });

  const [hasServerKey, setHasServerKey] = useState<boolean>(false);
  const [testStatus, setTestStatus] = useState<{ loading: boolean; success?: boolean; message?: string } | null>(null);
  const [showAdvancedBaseUrl, setShowAdvancedBaseUrl] = useState<boolean>(false);

  const activeProviderConfig = AI_PROVIDERS.find(p => p.id === aiProvider) || AI_PROVIDERS[0];
  const currentActiveModels = accountModels[aiProvider] || [];

  const effectiveModel = useMemo(() => {
    if (currentActiveModels.length > 0) {
      if (!customModel || customModel === 'auto') {
        return currentActiveModels[0].id;
      }
      const exists = currentActiveModels.some(m => m.id === customModel);
      if (exists) return customModel;
      if (!isCustomModelName) return currentActiveModels[0].id;
      return customModel;
    }
    return resolveEffectiveModel(aiProvider, customModel);
  }, [aiProvider, customModel, currentActiveModels, isCustomModelName]);

  // Check if backend already has GEMINI_API_KEY
  useEffect(() => {
    fetch('/api/test-key')
      .then(res => res.json())
      .then(data => {
        if (data?.hasServerKey) setHasServerKey(true);
      })
      .catch(() => { });
  }, []);

  const handleSelectProvider = (newProv: AIProvider, overrideKey?: string) => {
    // Save key for the provider being switched away from
    const keyToSave = overrideKey !== undefined ? overrideKey : customApiKey;
    if (keyToSave) {
      localStorage.setItem(`apiKey_${aiProvider}`, keyToSave);
      if (aiProvider === 'gemini') {
        localStorage.setItem('customApiKey', keyToSave);
      }
    }

    setAiProvider(newProv);
    localStorage.setItem('aiProvider', newProv);

    // Load key for newly selected provider
    const storedKey = overrideKey !== undefined
      ? overrideKey
      : (localStorage.getItem(`apiKey_${newProv}`) || (newProv === 'gemini' ? (localStorage.getItem('customApiKey') || '') : ''));
    setCustomApiKey(storedKey);

    const provConfig = AI_PROVIDERS.find(p => p.id === newProv);
    if (provConfig) {
      const isKnown = provConfig.models.some(m => m.id === customModel);
      if (!isKnown && customModel !== 'auto') {
        setCustomModel('auto');
        setIsCustomModelName(false);
      }
      if (newProv === 'custom' && !customBaseUrl) {
        setCustomBaseUrl(provConfig.defaultBaseUrl);
      } else if (newProv !== 'custom' && !showAdvancedBaseUrl) {
        setCustomBaseUrl('');
        localStorage.removeItem('customBaseUrl');
      }
    }
    setTestStatus(null);
    if (storedKey || newProv === 'custom' || newProv === '9router') {
      handleFetchAccountModels(newProv, storedKey, true);
    }
  };

  const handleApiKeyChange = (val: string) => {
    setCustomApiKey(val);
    const detected = detectProviderFromKey(val);
    if (detected && detected !== aiProvider) {
      const targetProv = AI_PROVIDERS.find(p => p.id === detected);
      handleSelectProvider(detected, val);
      setAutoDetectedBanner(`API Key ${targetProv?.name} terdeteksi! Provider dan model otomatis disesuaikan.`);
      setTimeout(() => setAutoDetectedBanner(''), 5000);
    } else if (val.trim().length >= 15) {
      handleFetchAccountModels(aiProvider, val, true);
    }
  };

  const handleSaveSettings = () => {
    localStorage.setItem('aiProvider', aiProvider);
    localStorage.setItem('customApiKey', customApiKey);
    localStorage.setItem(`apiKey_${aiProvider}`, customApiKey);
    localStorage.setItem('customModel', customModel);
    localStorage.setItem('customBaseUrl', customBaseUrl);
    localStorage.setItem('aiTemperature', aiTemperature.toString());
    localStorage.setItem('additionalInstructions', additionalInstructions);
    setShowSettings(false);
  };

  const handleFetchAccountModels = async (prov?: AIProvider, overrideKey?: string, silent?: boolean) => {
    const targetProv = prov || aiProvider;
    const provConfig = AI_PROVIDERS.find(p => p.id === targetProv) || activeProviderConfig;
    const key = (overrideKey !== undefined ? overrideKey : customApiKey).trim();

    if (!key && !hasServerKey && targetProv !== 'custom' && targetProv !== '9router') {
      if (!silent) {
        setAutoDetectedBanner(`Masukkan API Key ${provConfig.name} terlebih dahulu untuk memuat model.`);
        setTimeout(() => setAutoDetectedBanner(''), 4000);
      }
      return;
    }

    setIsLoadingModels(true);

    const applyLoadedModels = (models: { id: string; name: string }[], source = 'server') => {
      setAccountModels(prev => {
        const next = { ...prev, [targetProv]: models };
        try { localStorage.setItem('accountModels', JSON.stringify(next)); } catch { }
        return next;
      });
      if (customModel !== 'auto' && !isCustomModelName) {
        const exists = models.some((m: any) => m.id === customModel);
        if (!exists) {
          setCustomModel('auto');
        }
      }
      if (!silent) {
        const sourceLabel = source === 'direct' ? ' (koneksi langsung)' : source === 'builtin' ? ' (model rekomendasi)' : '';
        setAutoDetectedBanner(`Berhasil memuat ${models.length} model aktif dari ${provConfig.name}${sourceLabel}!`);
        setTimeout(() => setAutoDetectedBanner(''), 5000);
      }
    };

    // 1. Coba panggil backend API endpoint /api/models terlebih dahulu
    try {
      const res = await fetch('/api/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          aiProvider: targetProv,
          customApiKey: key,
          customBaseUrl: (targetProv === 'custom' || targetProv === '9router' || showAdvancedBaseUrl) ? customBaseUrl.trim() : ''
        })
      });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data && data.ok && Array.isArray(data.models) && data.models.length > 0) {
          applyLoadedModels(data.models, 'server');
          setIsLoadingModels(false);
          return;
        }
      }
    } catch {
      // Backend /api/models tidak dapat dijangkau (misal static deployment GitHub Pages atau server dev offline)
      // Lanjut otomatis ke pencarian langsung (client-side direct fetch)
    }

    // 2. Pencarian langsung dari sisi klien (Direct Client-Side Fetch ke API Provider)
    try {
      let directModels: { id: string; name: string }[] = [];

      if (targetProv === 'gemini') {
        if (key) {
          const gRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
          if (gRes.ok) {
            const gData: any = await gRes.json();
            directModels = (gData.models || [])
              .filter((m: any) => m.supportedGenerationMethods?.includes('generateContent'))
              .map((m: any) => {
                const id = m.name.replace(/^models\//, '');
                return { id, name: m.displayName || id };
              });
          }
        }
      } else {
        const effectiveBase = (customBaseUrl.trim() || provConfig.defaultBaseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (key) headers['Authorization'] = `Bearer ${key}`;
        if (targetProv === 'openrouter') {
          headers['HTTP-Referer'] = window.location.origin || 'https://cbtpijar.app';
          headers['X-Title'] = 'CBT Pijar AI Generator';
        }
        const oRes = await fetch(`${effectiveBase}/models`, { headers });
        if (oRes.ok) {
          const oData: any = await oRes.json();
          const rawList = Array.isArray(oData.data) ? oData.data : (Array.isArray(oData.models) ? oData.models : []);
          directModels = rawList
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
        }
      }

      if (directModels.length > 0) {
        applyLoadedModels(directModels, 'direct');
        setIsLoadingModels(false);
        return;
      }
    } catch {
      // Jika fetch langsung juga mengalami batasan CORS pada beberapa browser/proxy
    }

    // 3. Fallback anggun: Gunakan daftar model bawaan yang terverifikasi agar pengguna tetap lancar
    if (provConfig.models && provConfig.models.length > 0) {
      applyLoadedModels(provConfig.models, 'builtin');
      if (!silent) {
        setAutoDetectedBanner(`Menggunakan daftar model rekomendasi bawaan untuk ${provConfig.name}.`);
        setTimeout(() => setAutoDetectedBanner(''), 5000);
      }
    } else {
      if (!silent) {
        setAutoDetectedBanner(`Gagal memuat model dari ${provConfig.name}. Periksa koneksi internet atau API Key.`);
        setTimeout(() => setAutoDetectedBanner(''), 5000);
      }
    }
    setIsLoadingModels(false);
  };

  // Auto-fetch active models whenever settings modal is shown or key/provider changes
  useEffect(() => {
    const key = customApiKey.trim();
    if ((key || hasServerKey || aiProvider === 'custom' || aiProvider === '9router') && (!accountModels[aiProvider] || accountModels[aiProvider].length === 0)) {
      handleFetchAccountModels(aiProvider, key, true);
    }
  }, [aiProvider, customApiKey, showSettings, hasServerKey]);

  const handleTestConnection = async () => {
    setTestStatus({ loading: true });
    try {
      const activeKey = customApiKey.trim();
      const activeModel = effectiveModel;
      const activeBaseUrl = (aiProvider === 'custom' || showAdvancedBaseUrl) ? customBaseUrl.trim() : '';

      const res = await fetch('/api/test-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          aiProvider,
          customApiKey: activeKey,
          customModel: activeModel,
          customBaseUrl: activeBaseUrl
        })
      }).catch(() => null);

      if (res && res.ok) {
        const result = await res.json().catch(() => ({}));
        if (result && typeof result.ok !== 'undefined') {
          if (result.fallbackModel) {
            setCustomModel(result.fallbackModel);
            setIsCustomModelName(false);
          }
          setTestStatus({ loading: false, success: result.ok, message: result.message });
          return;
        }
        if (result && result.error) {
          setTestStatus({ loading: false, success: false, message: result.error });
          return;
        }
      }

      // Direct client-side test fallback (if static deployment without backend server)
      if (aiProvider === 'gemini') {
        if (!activeKey) {
          setTestStatus({ loading: false, success: false, message: 'Masukkan Gemini API Key terlebih dahulu.' });
          return;
        }
        const directRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(activeModel)}:generateContent?key=${activeKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: 'ping' }] }],
            generationConfig: { maxOutputTokens: 5 }
          })
        });
        if (directRes.ok) {
          setTestStatus({ loading: false, success: true, message: `Koneksi Gemini berhasil! Model "${activeModel}" aktif.` });
        } else {
          const err = await directRes.json().catch(() => ({}));
          setTestStatus({ loading: false, success: false, message: err.error?.message || `HTTP ${directRes.status}` });
        }
      } else {
        const baseUrl = (activeBaseUrl || activeProviderConfig.defaultBaseUrl).replace(/\/+$/, '');
        const url = `${baseUrl}/chat/completions`;
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (activeKey) headers['Authorization'] = `Bearer ${activeKey}`;
        if (aiProvider === 'openrouter') {
          headers['HTTP-Referer'] = window.location.origin || 'https://cbtpijar.app';
          headers['X-Title'] = 'CBT Pijar AI Generator';
        }
        const directRes = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify({ model: activeModel, messages: [{ role: 'user', content: 'ping' }], max_tokens: 5 })
        });
        if (directRes.ok) {
          setTestStatus({ loading: false, success: true, message: `Koneksi ${activeProviderConfig.name} berhasil! Model "${activeModel}" aktif.` });
        } else {
          // Dynamic active model fallback if current model is not accessible
          try {
            const mRes = await fetch(`${baseUrl}/models`, { headers });
            if (mRes.ok) {
              const mData: any = await mRes.json();
              const rawList = Array.isArray(mData.data) ? mData.data : (Array.isArray(mData.models) ? mData.models : []);
              const cands = rawList
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
              for (const cand of cands) {
                if (cand === activeModel) continue;
                const retryRes = await fetch(url, {
                  method: 'POST',
                  headers,
                  body: JSON.stringify({ model: cand, messages: [{ role: 'user', content: 'ping' }], max_tokens: 5 })
                });
                if (retryRes.ok) {
                  setCustomModel(cand);
                  setIsCustomModelName(false);
                  setTestStatus({
                    loading: false,
                    success: true,
                    message: `Koneksi berhasil! Model "${activeModel}" tidak aktif di akun Anda, otomatis dialihkan ke model "${cand}" yang aktif & siap pakai.`
                  });
                  return;
                }
              }
            }
          } catch { }

          const err = await directRes.json().catch(() => ({}));
          let msg = err.error?.message || err.message || `HTTP ${directRes.status}`;
          if (msg.includes('does not exist') || msg.includes('do not have access')) {
            msg = `Model "${activeModel}" tidak aktif pada akun Anda. Klik tombol "Muat Model Aktif Akun" untuk melihat daftar model yang dapat diakses.`;
          }
          setTestStatus({ loading: false, success: false, message: msg });
        }
      }
    } catch (err: any) {
      let msg = err.message || 'Gagal tes koneksi.';
      if (msg.includes('Failed to fetch') || msg.toLowerCase().includes('fetch failed')) {
        msg = `Gagal koneksi ke API ${activeProviderConfig.name} (Network / CORS Error). Pastikan koneksi internet stabil dan server dev aktif.`;
      }
      setTestStatus({ loading: false, success: false, message: msg });
    }
  };

  const [subject, setSubject] = useState('');
  const [fase, setFase] = useState('');
  const [grade, setGrade] = useState('');
  const [topic, setTopic] = useState('');
  const [language, setLanguage] = useState('Indonesia');
  const [capaianPembelajaran, setCapaianPembelajaran] = useState('');
  const [learningObjective, setLearningObjective] = useState('');
  const [cognitiveLevel, setCognitiveLevel] = useState(COGNITIVE_LEVELS[0]);
  const [referenceText, setReferenceText] = useState('');
  const [count, setCount] = useState(5);
  const [optionCount, setOptionCount] = useState(5);
  const [selectedTypes, setSelectedTypes] = useState<string[]>(['PG']);

  const [supportEquation, setSupportEquation] = useState(false);
  const [supportImage, setSupportImage] = useState(false);
  const [supportGraph, setSupportGraph] = useState(false);
  const [supportDiagram, setSupportDiagram] = useState(false);

  const [uniformLength, setUniformLength] = useState(false);
  const [studentMisconception, setStudentMisconception] = useState(false);
  const [noExtraExplanation, setNoExtraExplanation] = useState(false);

  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('soundEnabled');
      return saved !== null ? saved === 'true' : true;
    } catch {
      return true;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('soundEnabled', String(soundEnabled));
    } catch { }
  }, [soundEnabled]);

  const [autoFallbackQuota, setAutoFallbackQuota] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('autoFallbackQuota');
      return saved !== null ? saved === 'true' : true;
    } catch {
      return true;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('autoFallbackQuota', String(autoFallbackQuota));
    } catch { }
  }, [autoFallbackQuota]);

  const [fallbackNotice, setFallbackNotice] = useState<string>('');

  const [isGenerating, setIsGenerating] = useState(false);

  // Safe parsing to prevent corrupt localStorage crashes
  const [questions, setQuestions] = useState<QuestionData[]>(() => {
    try {
      const saved = localStorage.getItem('lastGeneratedQuestions');
      if (saved) {
        const parsed = JSON.parse(saved);
        const list: QuestionData[] = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.questions) ? parsed.questions : []);
        return list.map((q: QuestionData) => ({
          ...q,
          Soal: preprocessMarkdown(q.Soal),
          Isi_Referensi: preprocessMarkdown(q.Isi_Referensi),
          Pilihan_A: preprocessMarkdown(q.Pilihan_A),
          Pilihan_B: preprocessMarkdown(q.Pilihan_B),
          Pilihan_C: preprocessMarkdown(q.Pilihan_C),
          Pilihan_D: preprocessMarkdown(q.Pilihan_D),
          Pilihan_E: preprocessMarkdown(q.Pilihan_E),
          Pilihan_F: preprocessMarkdown(q.Pilihan_F),
          Jawaban_Essay: preprocessMarkdown(q.Jawaban_Essay)
        }));
      }
    } catch (e) {
      console.warn('Gagal membaca saved questions:', e);
    }
    return [];
  });

  const [error, setError] = useState('');

  const [histories, setHistories] = useState<HistoryItem[]>(() => {
    try {
      const saved = localStorage.getItem('questionHistories');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (e) {
      console.warn('Gagal membaca saved histories:', e);
    }
    return [];
  });

  const [showHistoryPanel, setShowHistoryPanel] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem('lastGeneratedQuestions', JSON.stringify(questions));
    } catch { }
  }, [questions]);

  useEffect(() => {
    try {
      localStorage.setItem('questionHistories', JSON.stringify(histories));
    } catch { }
  }, [histories]);

  const [isParsingFile, setIsParsingFile] = useState(false);
  const [parseError, setParseError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [editingQuestion, setEditingQuestion] = useState<{ index: number, data: QuestionData } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ type: 'question' | 'history' | 'all', id?: number } | null>(null);

  const safeQuestions = Array.isArray(questions) ? questions : [];
  const safeHistories = Array.isArray(histories) ? histories : [];

  const [viewMode, setViewMode] = useState<'card' | 'table'>('card');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [editModalTab, setEditModalTab] = useState<'form' | 'preview'>('form');

  const handleCopyQuestion = (q: QuestionData, index: number) => {
    let text = `Soal No. ${q.Nomor || index + 1} [${q.Jenis_Soal}]\n`;
    if (q.Judul_Referensi || q.Isi_Referensi) {
      text += `--- Wacana/Stimulus: ${q.Judul_Referensi || ''} ---\n${q.Isi_Referensi}\n\n`;
    }
    text += `${q.Soal}\n\n`;
    if (q.Pilihan_A) text += `A. ${q.Pilihan_A}\n`;
    if (q.Pilihan_B) text += `B. ${q.Pilihan_B}\n`;
    if (q.Pilihan_C) text += `C. ${q.Pilihan_C}\n`;
    if (q.Pilihan_D) text += `D. ${q.Pilihan_D}\n`;
    if (q.Pilihan_E) text += `E. ${q.Pilihan_E}\n`;
    if (q.Pilihan_F) text += `F. ${q.Pilihan_F}\n`;
    if (q.Kunci_Jawaban_Non_Essay) text += `\nKunci Jawaban: ${q.Kunci_Jawaban_Non_Essay}\n`;
    if (q.Jawaban_Essay) text += `\nPedoman/Kunci Jawaban:\n${q.Jawaban_Essay}\n`;

    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(text.trim()).then(() => {
        setCopiedIdx(index);
        setTimeout(() => setCopiedIdx(null), 2000);
      }).catch(() => { });
    }
  };

  const toggleType = (typeId: string) => {
    setSelectedTypes(prev =>
      prev.includes(typeId)
        ? prev.filter(t => t !== typeId)
        : [...prev, typeId]
    );
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsParsingFile(true);
    setParseError('');

    try {
      if (file.type === 'application/pdf') {
        const arrayBuffer = await file.arrayBuffer();

        // Dynamically import pdfjs-dist only when needed
        const pdfjs: any = await import('pdfjs-dist');
        const pdfLib = pdfjs.default || pdfjs;
        if (pdfLib.GlobalWorkerOptions) {
          pdfLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfLib.version || '5.7.284'}/build/pdf.worker.min.mjs`;
        }
        const getDoc = pdfLib.getDocument || pdfjs.getDocument;
        const pdf = await getDoc({ data: arrayBuffer }).promise;

        let fullText = '';
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const content = await page.getTextContent();
          const pageText = content.items.map((item: any) => item.str).join(' ');
          fullText += pageText + '\n\n';
        }
        setReferenceText(fullText.trim());
      } else if (file.type === 'text/plain') {
        const text = await file.text();
        setReferenceText(text.trim());
      } else {
        throw new Error('Tipe file tidak didukung. Harap unggah file PDF atau TXT.');
      }
    } catch (err: any) {
      setParseError(err.message || 'Gagal memparsing file. Pastikan file tidak rusak.');
    } finally {
      setIsParsingFile(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // Robust Normalizer: Maps any model's JSON object variations into strict QuestionData
  const normalizeQuestionObject = (raw: any, index: number): QuestionData => {
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

    let jenis: QuestionType = 'PG';
    const rawJenis = String(raw.Jenis_Soal || raw.jenis_soal || raw.jenisSoal || raw.type || raw.Type || '').toUpperCase().trim();
    if (['PG', 'ESSAY', 'PILIHAN ESSAY', 'PGK', 'MENGURUTKAN'].includes(rawJenis)) {
      jenis = rawJenis as QuestionType;
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
  };

  // Helper to extract individual question fields even if JSON.parse fails on malformed quotes
  const extractFieldsFromObjectBlock = (block: string, index: number): QuestionData | null => {
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
  };

  // Multi-tier resilient JSON string repair engine
  const repairJsonString = (input: string): string => {
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
  };

  // Helper to extract questions from plain text if AI answered in conversational/markdown format instead of strict JSON
  const parseFromPlainText = (text: string): QuestionData[] => {
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

    const results: QuestionData[] = [];
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
  };

  // Robust, multi-strategy JSON parser for questions array from any model (Gemini, Groq, DeepSeek, OpenAI, 9router, Ollama)
  const parseQuestionsJson = (rawText: string): QuestionData[] => {
    if (!rawText || typeof rawText !== 'string') {
      throw new Error('Respons model kosong.');
    }

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
    const candidatesToTry: string[] = [unFenced, repaired, cleanBase];

    // Helper to unwrap parsed output
    const extractArrayFromParsed = (val: any): QuestionData[] | null => {
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
        // If object itself is a single question
        if (val.Soal || val.soal || val.question || val.pertanyaan) {
          return [normalizeQuestionObject(val, 0)];
        }
        // If object has numbered keys e.g. { "1": { ... }, "2": { ... } }
        const values = Object.values(val);
        if (values.length > 0 && values.every(v => v && typeof v === 'object' && ((v as any).Soal || (v as any).soal || (v as any).question))) {
          return values.map((item: any, idx: number) => normalizeQuestionObject(item, idx));
        }
      }
      return null;
    };

    // Strategy 1: Direct parse of candidates
    for (const cand of candidatesToTry) {
      try {
        const parsed = JSON.parse(cand);
        const res = extractArrayFromParsed(parsed);
        if (res && res.length > 0) return res;
      } catch { }
    }

    // Strategy 2: Substring between first '[' and last ']'
    for (const cand of candidatesToTry) {
      const startIdx = cand.indexOf('[');
      const endIdx = cand.lastIndexOf(']');
      if (startIdx !== -1 && endIdx > startIdx) {
        const sub = cand.substring(startIdx, endIdx + 1);
        try {
          const parsed = JSON.parse(sub);
          const res = extractArrayFromParsed(parsed);
          if (res && res.length > 0) return res;
        } catch {
          try {
            const repSub = repairJsonString(sub);
            const parsed = JSON.parse(repSub);
            const res = extractArrayFromParsed(parsed);
            if (res && res.length > 0) return res;
          } catch { }
        }
      }
    }

    // Strategy 3: Substring between first '{' and last '}'
    for (const cand of candidatesToTry) {
      const objStart = cand.indexOf('{');
      const objEnd = cand.lastIndexOf('}');
      if (objStart !== -1 && objEnd > objStart) {
        const sub = cand.substring(objStart, objEnd + 1);
        try {
          const parsed = JSON.parse(sub);
          const res = extractArrayFromParsed(parsed);
          if (res && res.length > 0) return res;
        } catch {
          try {
            const repSub = repairJsonString(sub);
            const parsed = JSON.parse(repSub);
            const res = extractArrayFromParsed(parsed);
            if (res && res.length > 0) return res;
          } catch { }
        }
      }
    }

    // Strategy 4: Truncated JSON recovery (array cuts off before closing ']')
    for (const cand of candidatesToTry) {
      const startIdx = cand.indexOf('[');
      if (startIdx !== -1) {
        const lastBrace = cand.lastIndexOf('}');
        if (lastBrace > startIdx) {
          const healed = cand.substring(startIdx, lastBrace + 1) + ']';
          try {
            const repHealed = repairJsonString(healed);
            const parsed = JSON.parse(repHealed);
            const res = extractArrayFromParsed(parsed);
            if (res && res.length > 0) return res;
          } catch { }
        }
      }
    }

    // Strategy 5: Depth-aware brace matcher for individual objects (Preserves LaTeX braces {} safely)
    try {
      const individualObjects: QuestionData[] = [];
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
                const parsed = JSON.parse(repairJsonString(block));
                if (parsed && typeof parsed === 'object' && (parsed.Soal || parsed.soal || parsed.question || parsed.pertanyaan || parsed.Pilihan_A || parsed.A)) {
                  individualObjects.push(normalizeQuestionObject(parsed, individualObjects.length));
                }
              } catch {
                // Try regex field extractor on the block if JSON.parse still fails
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
    } catch { }

    // Strategy 6: Regex field extraction on the entire response
    try {
      const objectBlocks = cleanBase.split(/(?:\{(?=\s*"(?:Nomor|Soal|Jenis_Soal)"))/i);
      if (objectBlocks.length > 1) {
        const fieldQuestions: QuestionData[] = [];
        for (const b of objectBlocks) {
          const item = extractFieldsFromObjectBlock('{' + b, fieldQuestions.length);
          if (item) fieldQuestions.push(item);
        }
        if (fieldQuestions.length > 0) return fieldQuestions;
      }
    } catch { }

    // Strategy 7: Plain-text / Markdown Question Extractor (when model responds in natural numbered text)
    const plainTextQuestions = parseFromPlainText(cleanBase);
    if (plainTextQuestions.length > 0) {
      return plainTextQuestions;
    }

    throw new Error('Respons model tidak mengandung format soal yang dapat dibaca. Silakan generate kembali.');
  };

  // Direct client-side generation fallback if serverless functions are not deployed
  const callAiClientSide = async (payload: any) => {
    const provider: AIProvider = payload.aiProvider || 'gemini';
    const apiKey = (payload.customApiKey || '').trim();
    const providerConfig = AI_PROVIDERS.find(p => p.id === provider) || AI_PROVIDERS[0];

    if (provider !== 'custom' && provider !== '9router' && !apiKey) {
      throw new Error(`API Key untuk ${providerConfig.name} tidak ditemukan. Silakan masukkan API Key di Pengaturan AI.`);
    }

    const typesStr = Array.isArray(payload.questionTypes) && payload.questionTypes.length > 0
      ? payload.questionTypes.join(', ')
      : 'PG';

    const prompt = `Anda adalah seorang ahli pembuat soal ujian profesional.
Bahasa Soal: ${payload.language || 'Indonesia'} (Pastikan isi soal dan jawaban menggunakan bahasa ini)
Pelajaran: ${payload.subject}
Fase: ${payload.fase || '-'}
Kelas: ${payload.grade}
Materi: ${payload.topic}
Capaian Pembelajaran: ${payload.capaianPembelajaran || '-'}
Tujuan Pembelajaran: ${payload.learningObjective || '-'}
Level Kognitif (Taksonomi Bloom): ${payload.cognitiveLevel || 'LOTS (C1-C2)'}
Jumlah Soal: ${payload.count}
Jenis Soal yang Boleh Digunakan: ${typesStr} (Bisa salah satu atau kombinasi jika ada beberapa jenis)
Jumlah Pilihan Jawaban (Jika pilihan ganda): ${payload.optionCount || 5} (Misal 4 berarti sampai D, 5 berarti sampai E, 6 berarti sampai F). Kosongkan value Pilihan_E dan Pilihan_F jika tidak digunakan.
${payload.referenceText ? `\nTeks Referensi / Bahan Bacaan:\n${payload.referenceText}\n(Gunakan teks di atas sebagai dasar pembuatan soal)` : ''}
${payload.uniformLength ? `\n- WAJIB Keseragaman Panjang Pilihan: Pastikan semua pilihan jawaban (A, B, C, D, dsb) memiliki panjang kalimat atau jumlah kata yang hampir sama (seragam) agar siswa tidak mudah menebak jawaban dari sekadar panjangnya pilihan.` : ''}
${payload.studentMisconception ? `\n- WAJIB Gunakan Miskonsepsi Siswa: Untuk pilihan jawaban salah (pengecoh/distractor), rancang sedemikian rupa agar jawaban tersebut merepresentasikan miskonsepsi umum atau kesalahan hitung/analisa yang biasa dilakukan oleh siswa (jawaban masuk akal/plausible).` : ''}
${payload.noExtraExplanation ? `\n- DILARANG Memberi Penjelasan Ekstra: Pada pilihan jawaban, berikan HANYA poin jawaban inti saja tanpa menambahkan alasan, argumen, kata "karena", atau teks penjelasan tambahan apa pun di dalam opsi jawaban.` : ''}
${payload.supportEquation ? `\n- WAJIB sertakan soal yang mengandung RUMUS (Equation) matematika/fisika/kimia atau logika analitik menggunakan sintaks LaTeX (blok \`$$\` atau inline \`$\`).` : '\n- DILARANG menggunakan RUMUS (Equation) atau format LaTeX dalam bentuk apapun pada soal dan jawaban.'}
${payload.supportImage ? `\n- WAJIB sertakan GAMBAR ilustrasi pada soal (minimal di beberapa soal). Gunakan format markdown: \`![deskripsi](https://image.pollinations.ai/prompt/detailed-description-of-image-in-english?width=400&height=300&nologo=true)\` di dalam teks Soal. Ganti \`detailed-description-of-image-in-english\` dengan deskripsi spesifik tentang apa yang diilustrasikan di soal (WAJIB bahasa Inggris, pisahkan kata dengan tanda penghubung "-", BUKAN SPASI). Contoh: \`https://image.pollinations.ai/prompt/a-green-leaf-showing-photosynthesis-process?width=400&height=300&nologo=true\`.` : '\n- DILARANG menyertakan GAMBAR/ilustrasi markdown dalam bentuk apapun pada soal dan jawaban.'}
${payload.supportGraph ? `\n- WAJIB buatkan satu atau beberapa soal yang memerlukan analisis GRAFIK. Gunakan markdown image QuickChart.io yang valid: \`![Grafik](https://quickchart.io/chart?bkg=white&w=500&h=300&c={"type":"bar","data":{"labels":["A","B"],"datasets":[{"label":"Nilai","data":[10,20]}]}})\`. PENTING: Pada teks label/judul chart, DILARANG memakai tanda kurung '(' atau ')' (tulis 'dalam Mbps' atau 'Mbps', JANGAN gunakan '(Mbps)'). Jangan gunakan spasi berlebihan dalam URL.` : '\n- DILARANG membuat soal yang menggunakan atau memerlukan analisis GRAFIK atau chart.'}
${payload.supportDiagram ? `\n- WAJIB buatkan satu atau beberapa soal yang memerlukan pemahaman DIAGRAM PROSES/SIKLUS (misalnya siklus air, fotosintesis, rantai makanan, daur biogeokimia, proses pembelahan sel, bagan alur). Tulis diagram menggunakan blok kode \`\`\`mermaid\ngraph TD\n  A --> B\n\`\`\` ATAU markdown \`![Diagram](https://mermaid.ink/img/{BASE64})\`. Diagram harus sederhana dan mudah dipahami.` : '\n- DILARANG membuat soal yang menggunakan DIAGRAM PROSES/SIKLUS berbasis Mermaid.'}
${payload.additionalInstructions ? `\nInstruksi Khusus Tambahan: ${payload.additionalInstructions}` : ''}

PENTING: Jika ada rumus matematika, fisika, kimia, atau persamaan (misal pecahan, pangkat, dll), BERIKAN dalam format LaTeX menggunakan \`$\` untuk inline math (contoh: $E=mc^2$) dan \`$$\` untuk block math (contoh: $$ \\sqrt{x} $$). Jangan gunakan format lain. Gunakan perintah-perintah LaTeX standar (seperti \\frac, \\sqrt, pangkat, subscript) agar hasil dirender dengan baik. Saat menuliskan backslash LaTeX ke dalam value JSON, pastikan menggunakan dua backslash (contoh di dalam JSON: "Rumus \\\\frac{1}{2}"). Jangan gunakan backslash berlebihan (hindari \\\\\\\\frac).

Buatkan ${payload.count} soal dengan format JSON yang ketat mengikuti struktur berikut:
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

    if (provider === 'gemini') {
      const requestModel = async (modelName: string) => {
        const clean = modelName.trim().replace(/^models\//, '');
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(clean)}:generateContent?key=${apiKey}`;
        return await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: {
              responseMimeType: 'application/json',
              temperature: Math.max(0, Math.min(1, payload.temperature ?? 0.7)),
              maxOutputTokens: 8192
            }
          })
        });
      };

      let targetModel = resolveEffectiveModel('gemini', payload.customModel);
      let res = await requestModel(targetModel);

      // Otomatis ganti ke model dengan limit lebih besar jika kuota habis (429), sibuk (503), atau model tidak ada (404)
      if (!res.ok && autoFallbackQuota) {
        const errClone = await res.clone().json().catch(() => ({}));
        const errMsg = String(errClone?.error?.message || '').toLowerCase();
        const shouldFallback = res.status === 429 || res.status === 503 || res.status === 404 ||
          errMsg.includes('quota') || errMsg.includes('rate') || errMsg.includes('exhausted') ||
          errMsg.includes('overloaded') || errMsg.includes('high demand') || errMsg.includes('capacity');

        if (shouldFallback) {
          console.warn(`[Auto-Fallback] Model ${targetModel} batas kuota/sibuk (${res.status}: ${errMsg}). Mencari model cadangan berkuota besar...`);
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
              const retryRes = await requestModel(cand);
              if (retryRes.ok) {
                res = retryRes;
                targetModel = cand;
                console.info(`[Auto-Fallback] Berhasil dialihkan ke model berkuota aktif: ${cand}`);
                break;
              }
            } catch { }
          }
        }
      }

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || `Gemini API error (${res.status})`);
      }

      const data = await res.json();
      const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
      let parsedQuestions: QuestionData[] = [];
      try {
        parsedQuestions = parseQuestionsJson(rawText);
      } catch (parseErr) {
        console.warn(`[Auto-Fallback Parse] Gemini ${targetModel} menghasilkan format tidak terbaca. Mencoba model cadangan...`);
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
            const retryRes = await requestModel(cand);
            if (retryRes.ok) {
              const retryData = await retryRes.json();
              const retryRaw = retryData.candidates?.[0]?.content?.parts?.[0]?.text || '';
              const retryParsed = parseQuestionsJson(retryRaw);
              if (retryParsed && retryParsed.length > 0) {
                parsedQuestions = retryParsed;
                targetModel = cand;
                break;
              }
            }
          } catch {}
        }
        if (parsedQuestions.length === 0) {
          throw parseErr;
        }
      }
      return { questions: parsedQuestions, modelUsed: targetModel, provider };
    } else {
      const baseUrl = (payload.customBaseUrl || providerConfig.defaultBaseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
      const targetModel = resolveEffectiveModel(provider, payload.customModel);

      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };
      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }
      if (provider === 'openrouter') {
        headers['HTTP-Referer'] = window.location.origin || 'https://cbtpijar.app';
        headers['X-Title'] = 'Pijar AI Generator';
      }

      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: targetModel,
          messages: [
            {
              role: 'system',
              content: 'Anda adalah asisten pembuat soal ujian profesional berformat JSON. Wajib berikan output HANYA berupa array JSON soal [ ... ], tanpa teks lain dan tanpa kode pembungkus markdown.'
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          temperature: Math.max(0, Math.min(1.5, payload.temperature ?? 0.7)),
          max_tokens: 4096
        })
      });

      let effectiveRes = res;
      let effectiveTargetModel = targetModel;

      // Otomatis coba fallback jika kuota habis (429), model tidak ditemukan (404), atau sibuk (503)
      if (!effectiveRes.ok && autoFallbackQuota) {
        const errClone = await effectiveRes.clone().json().catch(() => ({}));
        const errMsg = String(errClone?.error?.message || errClone?.message || '').toLowerCase();
        const shouldFallback = effectiveRes.status === 429 || effectiveRes.status === 503 || effectiveRes.status === 404 ||
          errMsg.includes('rate') || errMsg.includes('quota') || errMsg.includes('token') || errMsg.includes('limit') ||
          errMsg.includes('exhausted') || errMsg.includes('capacity') || errMsg.includes('overloaded');

        if (shouldFallback) {
          const PROVIDER_FALLBACK_MAP: Record<string, string[]> = {
            groq: ['llama-3.1-8b-instant', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b', 'gemma2-9b-it', 'mixtral-8x7b-32768'],
            openai: ['gpt-4o-mini', 'gpt-4o'],
            deepseek: ['deepseek-chat'],
            '9router': ['gemini-2.5-flash', 'gemini-2.0-flash', 'gpt-4o-mini', 'deepseek-chat', 'claude-3-5-sonnet'],
            openrouter: ['google/gemini-2.0-flash-001', 'meta-llama/llama-3.3-70b-instruct:free', 'qwen/qwen-2.5-72b-instruct:free', 'mistralai/mistral-7b-instruct:free']
          };

          const preconfiguredFallbacks = PROVIDER_FALLBACK_MAP[provider] || [];
          for (const cand of preconfiguredFallbacks) {
            if (cand === effectiveTargetModel) continue;
            try {
              const retryRes = await fetch(`${baseUrl}/chat/completions`, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                  model: cand,
                  messages: [
                    {
                      role: 'system',
                      content: 'Anda adalah asisten pembuat soal ujian profesional berformat JSON. Wajib berikan output HANYA berupa array JSON soal [ ... ], tanpa teks lain dan tanpa kode pembungkus markdown.'
                    },
                    { role: 'user', content: prompt }
                  ],
                  temperature: Math.max(0, Math.min(1.5, payload.temperature ?? 0.7)),
                  max_tokens: 4096
                })
              });
              if (retryRes.ok) {
                effectiveRes = retryRes;
                effectiveTargetModel = cand;
                console.info(`[Auto-Fallback ${provider}] Berhasil dialihkan ke model berkuota aktif: ${cand}`);
                break;
              }
            } catch { }
          }
        }
      }

      if (!effectiveRes.ok) {
        try {
          const mRes = await fetch(`${baseUrl}/models`, { headers });
          if (mRes.ok) {
            const mData: any = await mRes.json();
            const rawList = Array.isArray(mData.data) ? mData.data : (Array.isArray(mData.models) ? mData.models : []);
            const cands = rawList
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
            for (const cand of cands) {
              if (cand === targetModel || cand === effectiveTargetModel) continue;
              const retryRes = await fetch(`${baseUrl}/chat/completions`, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                  model: cand,
                  messages: [
                    {
                      role: 'system',
                      content: 'Anda adalah asisten pembuat soal ujian profesional berformat JSON. Wajib berikan output HANYA berupa array JSON soal [ ... ], tanpa teks lain dan tanpa kode pembungkus markdown.'
                    },
                    { role: 'user', content: prompt }
                  ],
                  temperature: Math.max(0, Math.min(1.5, payload.temperature ?? 0.7)),
                  max_tokens: 4096
                })
              });
              if (retryRes.ok) {
                effectiveRes = retryRes;
                effectiveTargetModel = cand;
                break;
              }
            }
          }
        } catch { }
      }

      if (!effectiveRes.ok) {
        const err = await effectiveRes.json().catch(() => ({}));
        let msg = err.error?.message || err.message || `${providerConfig.name} API error (${effectiveRes.status})`;
        if (msg.includes('does not exist') || msg.includes('do not have access')) {
          msg = `Model "${targetModel}" tidak aktif pada akun Anda. Klik tombol "Muat Model Aktif Akun" di Pengaturan AI untuk memilih model yang tersedia di akun Anda.`;
        }
        throw new Error(msg);
      }

      const data = await effectiveRes.json();
      const rawText = data.choices?.[0]?.message?.content || '[]';
      let parsedQuestions: QuestionData[] = [];
      try {
        parsedQuestions = parseQuestionsJson(rawText);
      } catch (parseErr) {
        console.warn(`[Auto-Fallback Parse] ${provider} model ${effectiveTargetModel} menghasilkan format tidak terbaca. Mencoba model cadangan...`);
        const fallbacks = PROVIDER_FALLBACK_MAP[provider] || [];
        for (const cand of fallbacks) {
          if (cand === effectiveTargetModel) continue;
          try {
            const retryRes = await fetch(`${baseUrl}/chat/completions`, {
              method: 'POST',
              headers,
              body: JSON.stringify({
                model: cand,
                messages: [
                  { role: 'system', content: 'Anda adalah asisten pembuat soal ujian profesional berformat JSON. Wajib berikan output HANYA berupa array JSON soal [ ... ], tanpa teks lain dan tanpa kode pembungkus markdown.' },
                  { role: 'user', content: prompt }
                ],
                temperature: Math.max(0, Math.min(1.5, payload.temperature ?? 0.7)),
                max_tokens: 4096
              })
            });
            if (retryRes.ok) {
              const retryData = await retryRes.json();
              const retryRaw = retryData.choices?.[0]?.message?.content || '';
              const retryParsed = parseQuestionsJson(retryRaw);
              if (retryParsed && retryParsed.length > 0) {
                parsedQuestions = retryParsed;
                effectiveTargetModel = cand;
                break;
              }
            }
          } catch {}
        }
        if (parsedQuestions.length === 0) {
          throw parseErr;
        }
      }
      return { questions: parsedQuestions, modelUsed: effectiveTargetModel, provider };
    }
  };

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!customApiKey && !hasServerKey && aiProvider !== 'custom' && aiProvider !== '9router') {
      const pName = activeProviderConfig.name || 'AI';
      setError(`API Key untuk ${pName} belum dimasukkan. Silakan masukkan API Key Anda pada Pengaturan AI.`);
      setShowSettings(true);
      return;
    }

    if (selectedTypes.length === 0) {
      setError('Pilih minimal satu jenis soal.');
      return;
    }

    setIsGenerating(true);
    setError('');

    try {
      const payload = {
        aiProvider,
        customBaseUrl: (aiProvider === 'custom' || showAdvancedBaseUrl) ? customBaseUrl.trim() : '',
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
        optionCount,
        questionTypes: selectedTypes,
        customApiKey,
        customModel: effectiveModel,
        supportEquation,
        supportImage,
        supportGraph,
        supportDiagram,
        uniformLength,
        studentMisconception,
        noExtraExplanation,
        temperature: aiTemperature,
        additionalInstructions
      };

      let data: any;

      try {
        const response = await fetch('/api/generate-questions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (response.status === 404 && (customApiKey || aiProvider === 'custom' || aiProvider === '9router')) {
          // Fallback to client-side direct request if backend functions not reachable
          data = await callAiClientSide(payload);
        } else {
          data = await response.json();
          if (!response.ok) {
            if (customApiKey || aiProvider === 'custom' || aiProvider === '9router') {
              console.warn('[Auto-Fallback Client] Server gagal generate soal, mencoba request client-side langsung...');
              try {
                data = await callAiClientSide(payload);
              } catch (clientErr: any) {
                throw new Error(data.error || clientErr.message || 'Gagal generate soal dari server.');
              }
            } else {
              throw new Error(data.error || 'Gagal generate soal dari server.');
            }
          }
        }
      } catch (networkOrApiError: any) {
        if (customApiKey || aiProvider === 'custom' || aiProvider === '9router') {
          console.warn('[Auto-Fallback Client] Terjadi kendala koneksi server, mencoba request client-side langsung...');
          try {
            data = await callAiClientSide(payload);
          } catch {
            throw networkOrApiError;
          }
        } else {
          throw networkOrApiError;
        }
      }

      const rawQuestions = Array.isArray(data.questions) ? data.questions : [];
      const fixedQuestions = rawQuestions.map((q: QuestionData) => {
        return {
          ...q,
          Soal: preprocessMarkdown(q.Soal),
          Isi_Referensi: preprocessMarkdown(q.Isi_Referensi),
          Pilihan_A: preprocessMarkdown(q.Pilihan_A),
          Pilihan_B: preprocessMarkdown(q.Pilihan_B),
          Pilihan_C: preprocessMarkdown(q.Pilihan_C),
          Pilihan_D: preprocessMarkdown(q.Pilihan_D),
          Pilihan_E: preprocessMarkdown(q.Pilihan_E),
          Pilihan_F: preprocessMarkdown(q.Pilihan_F),
          Kunci_Jawaban_Non_Essay: q.Kunci_Jawaban_Non_Essay ? q.Kunci_Jawaban_Non_Essay.replace(/\s+/g, '') : '',
          Jawaban_Essay: preprocessMarkdown(q.Jawaban_Essay)
        };
      });
      setQuestions(fixedQuestions);
      if (data.modelUsed) {
        setLastModelUsed(`${activeProviderConfig.name.split(' ')[0]} • ${data.modelUsed}`);
        const requested = effectiveModel;
        if (requested !== 'auto' && data.modelUsed && !data.modelUsed.toLowerCase().includes(requested.toLowerCase()) && !requested.toLowerCase().includes(data.modelUsed.toLowerCase())) {
          setFallbackNotice(`Model dialihkan otomatis ke "${data.modelUsed}" karena kuota/kapasitas model "${requested}" sedang penuh atau limit tercapai.`);
        } else {
          setFallbackNotice('');
        }
      }

      const newHistory: HistoryItem = {
        id: Date.now(),
        timestamp: new Date().toLocaleString('id-ID'),
        subject: subject || 'Tanpa Mata Pelajaran',
        topic: topic || 'Tanpa Topik',
        count: fixedQuestions.length,
        questions: fixedQuestions
      };
      setHistories(prev => [newHistory, ...prev]);

      // Putar suara notifikasi selesai (audio yang diunggah pengguna)
      playSuccessSound(soundEnabled);

    } catch (err: any) {
      let errMsg = err.message || 'Terjadi kesalahan saat memproses soal.';
      if (errMsg.includes('Failed to fetch') || errMsg.toLowerCase().includes('fetch failed')) {
        errMsg = `Gagal menghubungi API ${activeProviderConfig.name} (Network / CORS Error). Pastikan koneksi internet stabil dan dev server (npm run dev) aktif.`;
      }
      setError(errMsg);
    } finally {
      setIsGenerating(false);
    }
  };

  const exportToExcel = () => {
    if (safeQuestions.length === 0) return;

    const formatForExcel = (text: string) => {
      if (!text) return text;
      const clean = preprocessMarkdown(text);
      let str = clean.replace(/\$\$(.*?)\$\$/gs, (_, math) => {
        return `<img src="https://i.upmath.me/png/${encodeURIComponent(math.trim())}" />`;
      });
      str = str.replace(/\$(.*?)\$/g, (_, math) => {
        return `<img src="https://i.upmath.me/png/${encodeURIComponent(math.trim())}" />`;
      });
      str = str.replace(/!\[.*?\]\((.+?)\)/g, (_, url) => {
        return `<img src="${url.trim()}" />`;
      });
      return str;
    };

    const headers = [
      'Nomor', 'Jenis Soal', 'Nilai', 'Nama Materi', 'Judul Referensi', 'Isi Referensi',
      'Soal', 'File Audio atau Video',
      'Pilihan A', 'Pilihan B', 'Pilihan C', 'Pilihan D', 'Pilihan E', 'Pilihan F',
      'Kunci Jawaban Non Essay', 'Jawaban Essay'
    ];

    const dataRows = safeQuestions.map((q, idx) => [
      idx + 1,
      q.Jenis_Soal || '',
      q.Nilai || '',
      q.Nama_Materi || '',
      q.Judul_Referensi || '',
      formatForExcel(q.Isi_Referensi || ''),
      formatForExcel(q.Soal || ''),
      q.File_Audio_Video || '',
      formatForExcel(q.Pilihan_A || ''),
      formatForExcel(q.Pilihan_B || ''),
      formatForExcel(q.Pilihan_C || ''),
      formatForExcel(q.Pilihan_D || ''),
      formatForExcel(q.Pilihan_E || ''),
      formatForExcel(q.Pilihan_F || ''),
      q.Kunci_Jawaban_Non_Essay || '',
      formatForExcel(q.Jawaban_Essay || '')
    ]);

    const worksheetData = [headers, ...dataRows];
    const ws = XLSX.utils.aoa_to_sheet(worksheetData);

    const wscols = [
      { wch: 8 }, { wch: 15 }, { wch: 8 }, { wch: 20 }, { wch: 20 }, { wch: 30 },
      { wch: 40 }, { wch: 20 },
      { wch: 20 }, { wch: 20 }, { wch: 20 }, { wch: 20 }, { wch: 20 }, { wch: 20 },
      { wch: 25 }, { wch: 40 }
    ];
    ws['!cols'] = wscols;

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Template Pengisian Soal");

    XLSX.writeFile(wb, `Soal_${(subject || 'CBT').replace(/\s+/g, '_')}_Kelas_${grade || 'Umum'}.xlsx`);
  };

  const [isDownloadingZip, setIsDownloadingZip] = useState(false);

  const downloadGrafik = async () => {
    if (safeQuestions.length === 0) return;

    const imageUrls: { url: string, name: string }[] = [];
    let imageCounter = 1;

    safeQuestions.forEach((q, idx) => {
      const texts = [
        q.Soal, q.Isi_Referensi, q.Pilihan_A, q.Pilihan_B,
        q.Pilihan_C, q.Pilihan_D, q.Pilihan_E, q.Pilihan_F, q.Jawaban_Essay
      ];
      texts.forEach(rawText => {
        if (!rawText) return;
        const text = preprocessMarkdown(rawText);
        const regex = /!\[.*?\]\((.+?)\)/g;
        let match;
        while ((match = regex.exec(text)) !== null) {
          const url = match[1].trim();
          let ext = 'png';
          if (url.includes('.jpeg') || url.includes('.jpg')) ext = 'jpg';
          imageUrls.push({ url, name: `grafik-soal-${idx + 1}-${imageCounter}.${ext}` });
          imageCounter++;
        }
      });
    });

    if (imageUrls.length === 0) {
      alert('Tidak ada grafik/gambar yang ditemukan dalam soal.');
      return;
    }

    setIsDownloadingZip(true);
    try {
      const zip = new JSZip();

      await Promise.all(imageUrls.map(async (img) => {
        try {
          const response = await fetch(img.url);
          const blob = await response.blob();
          zip.file(img.name, blob);
        } catch (e) {
          console.error('Failed to fetch image:', img.url, e);
        }
      }));

      const content = await zip.generateAsync({ type: 'blob' });
      saveAs(content, `grafik-soal-${(subject || 'semua').replace(/\s+/g, '-')}.zip`);
    } catch (e) {
      console.error('Error creating ZIP:', e);
      alert('Gagal mendownload grafik/gambar.');
    } finally {
      setIsDownloadingZip(false);
    }
  };

  const handleEdit = (idx: number, q: QuestionData) => {
    setEditingQuestion({ index: idx, data: { ...q } });
  };

  const handleDelete = (idx: number) => {
    setConfirmDelete({ type: 'question', id: idx });
  };

  const handleSaveEdit = () => {
    if (editingQuestion) {
      const cleanData: QuestionData = {
        ...editingQuestion.data,
        Soal: preprocessMarkdown(editingQuestion.data.Soal),
        Isi_Referensi: preprocessMarkdown(editingQuestion.data.Isi_Referensi),
        Pilihan_A: preprocessMarkdown(editingQuestion.data.Pilihan_A),
        Pilihan_B: preprocessMarkdown(editingQuestion.data.Pilihan_B),
        Pilihan_C: preprocessMarkdown(editingQuestion.data.Pilihan_C),
        Pilihan_D: preprocessMarkdown(editingQuestion.data.Pilihan_D),
        Pilihan_E: preprocessMarkdown(editingQuestion.data.Pilihan_E),
        Pilihan_F: preprocessMarkdown(editingQuestion.data.Pilihan_F),
        Jawaban_Essay: preprocessMarkdown(editingQuestion.data.Jawaban_Essay),
      };
      setQuestions(prev => {
        const newQuestions = [...prev];
        newQuestions[editingQuestion.index] = cleanData;
        return newQuestions;
      });
      setEditingQuestion(null);
    }
  };

  const handleCancelEdit = () => {
    setEditingQuestion(null);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (confirmDelete) setConfirmDelete(null);
        else if (editingQuestion) setEditingQuestion(null);
        else if (showSettings) setShowSettings(false);
        else if (showHistoryPanel) setShowHistoryPanel(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [confirmDelete, editingQuestion, showSettings, showHistoryPanel]);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans text-slate-900">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-20 px-4 sm:px-6 py-3.5 flex items-center justify-between shadow-xs">
        <div className="flex items-center gap-3">
          <div className="bg-indigo-600 p-2 rounded-xl text-white shadow-xs">
            <BookOpen className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-lg sm:text-xl font-bold font-sans tracking-tight text-slate-900 flex items-center gap-2">
              Pijar CBT Generator
            </h1>
            <p className="text-xs text-slate-500 font-medium">Pembuat bank soal ujian sekolah format Excel CBT siap pakai</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowHistoryPanel(true)}
            className="flex items-center gap-2 px-3 py-2 text-xs sm:text-sm font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors border border-slate-200/80 cursor-pointer focus-visible:ring-2 focus-visible:ring-indigo-600"
            title="Buka riwayat soal yang pernah dibuat"
          >
            <History className="w-4 h-4 text-slate-600" />
            <span className="hidden sm:inline">Riwayat Soal</span>
          </button>
          <button
            type="button"
            onClick={() => setShowSettings(true)}
            className="flex items-center gap-2 px-3 py-2 text-xs sm:text-sm font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors border border-slate-200/80 cursor-pointer focus-visible:ring-2 focus-visible:ring-indigo-600 group"
            title="Buka pengaturan provider dan model AI"
          >
            <Settings2 className="w-4 h-4 text-indigo-600 group-hover:rotate-45 transition-transform" />
            <span className="hidden md:inline">Pengaturan AI</span>
            <span className="text-[11px] font-semibold text-indigo-900 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded-md flex items-center gap-1.5">
              <span>{activeProviderConfig.name.split(' ')[0]}</span>
              <span className="text-indigo-400">•</span>
              <span className="font-mono truncate max-w-[140px]">
                {customModel === 'auto' ? `Otomatis (${effectiveModel})` : customModel}
              </span>
            </span>
          </button>
        </div>
      </header>

      <main className="flex-1 flex flex-col lg:flex-row max-w-7xl w-full mx-auto p-4 lg:p-6 gap-6">

        {/* Left Panel: Configuration Form */}
        <aside className="w-full lg:w-96 flex-shrink-0 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col h-max">
          <div className="p-5 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Settings2 className="w-5 h-5 text-slate-600" />
              <h2 className="font-semibold text-slate-700">Konfigurasi Soal</h2>
            </div>
            <button
              type="button"
              onClick={() => setShowSettings(true)}
              className="text-xs bg-indigo-50 hover:bg-indigo-100 text-indigo-900 font-semibold px-2.5 py-1 rounded-md border border-indigo-200 flex items-center gap-1.5 transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-indigo-600"
              title="Klik untuk mengganti provider atau model AI"
            >
              <span className="font-bold">{activeProviderConfig.name.split(' ')[0]}</span>
              <span className="text-indigo-400">•</span>
              <span className="font-mono text-[11px] truncate max-w-[140px]">
                {customModel === 'auto' ? `Otomatis (${effectiveModel})` : customModel}
              </span>
            </button>
          </div>

          <form onSubmit={handleGenerate} className="p-5 flex flex-col gap-5">

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Mata Pelajaran</label>
                  <input
                    type="text"
                    required
                    placeholder="Misal: Matematika..."
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-shadow"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Bahasa (Opsional)</label>
                  <input
                    type="text"
                    placeholder="Misal: Arab, Inggris"
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-shadow"
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Fase / Kelas</label>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      placeholder="Fase (mis. E)"
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-shadow"
                      value={fase}
                      onChange={(e) => setFase(e.target.value)}
                    />
                    <input
                      type="text"
                      required
                      placeholder="Kelas (mis. 10)"
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-shadow"
                      value={grade}
                      onChange={(e) => setGrade(e.target.value)}
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Jumlah Soal</label>
                  <input
                    type="number"
                    min={1}
                    max={30}
                    required
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-shadow"
                    value={count || ''}
                    onChange={(e) => setCount(parseInt(e.target.value) || 0)}
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Topik / Materi</label>
                <input
                  type="text"
                  required
                  placeholder="Detail materi atau ruang lingkup bahasan soal..."
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-shadow"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1 mt-4">Capaian Pembelajaran (Opsional)</label>
                <textarea
                  placeholder="Deskripsikan capaian pembelajaran..."
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm h-16 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-shadow mt-1"
                  value={capaianPembelajaran}
                  onChange={(e) => setCapaianPembelajaran(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1 mt-2">Tujuan Pembelajaran (Opsional)</label>
                <textarea
                  placeholder="Deskripsikan tujuan pembelajaran..."
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm h-16 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-shadow"
                  value={learningObjective}
                  onChange={(e) => setLearningObjective(e.target.value)}
                />
              </div>

              <div>
                <div className="flex justify-between items-end mb-1">
                  <label className="block text-sm font-medium text-slate-700">Teks Referensi / Bahan Bacaan</label>
                  <label className="cursor-pointer text-xs font-medium text-indigo-600 hover:text-indigo-700 flex items-center gap-1.5 bg-indigo-50 px-2.5 py-1 rounded-md transition-colors">
                    {isParsingFile ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Upload className="w-3.5 h-3.5" />
                    )}
                    Upload PDF/TXT
                    <input
                      type="file"
                      className="hidden"
                      accept=".pdf,.txt"
                      onChange={handleFileUpload}
                      ref={fileInputRef}
                      disabled={isParsingFile}
                    />
                  </label>
                </div>
                {parseError && (
                  <div className="mb-2 text-xs text-red-800 flex items-start gap-1 bg-red-50 p-2 rounded-lg border border-red-200 font-medium">
                    <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
                    <span>{parseError}</span>
                  </div>
                )}
                <textarea
                  placeholder="Teks mentah, artikel, atau studi kasus (Opsional)"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm h-24 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-shadow"
                  value={referenceText}
                  onChange={(e) => setReferenceText(e.target.value)}
                  disabled={isParsingFile}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Level Kognitif (Taksonomi Bloom)</label>
                <select
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-shadow"
                  value={cognitiveLevel}
                  onChange={(e) => setCognitiveLevel(e.target.value)}
                >
                  {COGNITIVE_LEVELS.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Jenis Soal (Centang opsi yang diinginkan)</label>
                <div className="space-y-2 bg-slate-50 p-3 rounded-lg border border-slate-200">
                  {QUESTION_TYPES.map(qt => (
                    <label key={qt.id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-slate-100 p-1 rounded transition-colors w-max pr-3">
                      <input
                        type="checkbox"
                        checked={selectedTypes.includes(qt.id)}
                        onChange={() => toggleType(qt.id)}
                        className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500 accent-indigo-600"
                      />
                      <span className="text-slate-700 font-medium">{qt.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {selectedTypes.some(t => ['PG', 'PILIHAN ESSAY', 'PGK'].includes(t)) && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Jumlah Pilihan Jawaban (Jika Pilihan Ganda)</label>
                  <select
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-shadow"
                    value={optionCount}
                    onChange={(e) => setOptionCount(parseInt(e.target.value))}
                  >
                    <option value={4}>4 Pilihan (A sampai D)</option>
                    <option value={5}>5 Pilihan (A sampai E)</option>
                    <option value={6}>6 Pilihan (A sampai F)</option>
                  </select>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Fitur Tambahan</label>
                <div className="space-y-2 bg-slate-50 p-3 rounded-lg border border-slate-200">
                  <label className="flex items-center gap-2 text-sm cursor-pointer hover:bg-slate-100 p-1 rounded transition-colors w-max pr-3">
                    <input
                      type="checkbox"
                      checked={supportEquation}
                      onChange={(e) => setSupportEquation(e.target.checked)}
                      className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500 accent-indigo-600"
                    />
                    <span className="text-slate-700 font-medium">Support Equation (Rumus Math/Sains)</span>
                  </label>
                  <label className="flex items-start gap-2 text-sm cursor-pointer hover:bg-slate-100 p-1.5 rounded transition-colors pr-3">
                    <input
                      type="checkbox"
                      checked={supportImage}
                      onChange={(e) => setSupportImage(e.target.checked)}
                      className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500 accent-indigo-600 mt-0.5 shrink-0"
                    />
                    <div className="leading-tight">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-slate-700 font-medium">Support Image (Gambar dari API Gratis)</span>
                        <span className="text-[10px] font-bold text-amber-800 bg-amber-100 border border-amber-300 px-1.5 py-0.5 rounded leading-none">
                          Beta
                        </span>
                      </div>
                      <span className="text-xs text-slate-500 block mt-0.5 font-normal">
                        Keterangan: Fitur ilustrasi gambar masih dalam tahap uji coba (Beta). Ketersediaan gambar bergantung pada server API publik.
                      </span>
                    </div>
                  </label>
                  <label className="flex items-center gap-2 text-sm cursor-pointer hover:bg-slate-100 p-1 rounded transition-colors w-max pr-3">
                    <input
                      type="checkbox"
                      checked={supportGraph}
                      onChange={(e) => setSupportGraph(e.target.checked)}
                      className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500 accent-indigo-600"
                    />
                    <span className="text-slate-700 font-medium">Support Grafik (Chart/Data Visual)</span>
                  </label>
                  <label className="flex items-center gap-2 text-sm cursor-pointer hover:bg-slate-100 p-1 rounded transition-colors w-max pr-3">
                    <input
                      type="checkbox"
                      checked={supportDiagram}
                      onChange={(e) => setSupportDiagram(e.target.checked)}
                      className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500 accent-indigo-600"
                    />
                    <span className="text-slate-700 font-medium">Support Diagram Proses/Siklus </span>
                  </label>
                </div>

                {selectedTypes.some(t => ['PG', 'PILIHAN ESSAY', 'PGK'].includes(t)) && (
                  <>
                    <label className="block text-sm font-medium text-slate-700 mb-2 mt-4">Kualitas Pilihan Jawaban (Khusus Pilihan Ganda)</label>
                    <div className="space-y-2 bg-slate-50 p-3 rounded-lg border border-slate-200">
                      <label className="flex items-center gap-2 text-sm cursor-pointer hover:bg-slate-100 p-1 rounded transition-colors pr-3">
                        <input
                          type="checkbox"
                          checked={uniformLength}
                          onChange={(e) => setUniformLength(e.target.checked)}
                          className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500 accent-indigo-600 shrink-0"
                        />
                        <span className="text-slate-700 font-medium leading-tight">Wajibkan Keseragaman Panjang<br /><span className="text-xs font-normal text-slate-500">Panjang kalimat opsi A-E hampir sama agar tidak mudah ditebak</span></span>
                      </label>
                      <label className="flex items-center gap-2 text-sm cursor-pointer hover:bg-slate-100 p-1 rounded transition-colors pr-3">
                        <input
                          type="checkbox"
                          checked={studentMisconception}
                          onChange={(e) => setStudentMisconception(e.target.checked)}
                          className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500 accent-indigo-600 shrink-0"
                        />
                        <span className="text-slate-700 font-medium leading-tight">Gunakan Miskonsepsi Siswa<br /><span className="text-xs font-normal text-slate-500">Pengecoh berdasarkan kesalahan hitung/konsep yang umum</span></span>
                      </label>
                      <label className="flex items-center gap-2 text-sm cursor-pointer hover:bg-slate-100 p-1 rounded transition-colors pr-3">
                        <input
                          type="checkbox"
                          checked={noExtraExplanation}
                          onChange={(e) => setNoExtraExplanation(e.target.checked)}
                          className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500 accent-indigo-600 shrink-0"
                        />
                        <span className="text-slate-700 font-medium leading-tight">Larang Penjelasan Ekstra<br /><span className="text-xs font-normal text-slate-500">Hanya jawaban inti tanpa embel-embel "karena..."</span></span>
                      </label>
                    </div>
                  </>
                )}

                <div className="mt-3 p-3 bg-blue-50 rounded-lg border border-blue-100 text-sm text-blue-800">
                  <p className="font-semibold mb-1 flex items-center gap-1"><AlertCircle className="w-4 h-4" /> Keterangan CBT Pijar:</p>
                  <ul className="list-disc pl-5 space-y-1 text-xs">
                    <li>Setelah di-download ke Excel, Equation, Image, Grafik, dan Diagram dikonversi menjadi tag HTML gambar yang siap dibaca sistem CBT Pijar.</li>
                    <li>Gunakan fitur <b>Edit Soal</b> di preview sebelum export jika ingin menyesuaikan teks atau rumus.</li>
                    <li><b>Diagram Proses (Mermaid.ink)</b>: Cocok untuk siklus biogeokimia, rantai makanan, proses kimia/biologi, bagan alur (flowchart). Lebih akurat dari gambar AI.</li>
                    <li><b>Support Image (Beta)</b>: Menggunakan prompt otomatis via API publik Pollinations.ai. Waktu muat gambar bergantung pada koneksi internet.</li>
                  </ul>
                </div>
              </div>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-800 text-sm px-3 py-2 rounded-lg font-medium">
                <strong>Error:</strong> {error}
              </div>
            )}

            {fallbackNotice && (
              <div className="bg-amber-50 border border-amber-200 text-amber-900 text-xs px-3 py-2.5 rounded-lg flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <span className="font-bold block">Pengalihan Otomatis Model</span>
                  <span>{fallbackNotice}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setFallbackNotice('')}
                  className="text-amber-500 hover:text-amber-800 p-0.5 cursor-pointer"
                  title="Tutup pemberitahuan"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            <button
              type="submit"
              disabled={isGenerating || selectedTypes.length === 0}
              className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 disabled:cursor-not-allowed text-white font-semibold py-2.5 rounded-lg transition-colors flex items-center justify-center gap-2 mt-2 cursor-pointer shadow-xs focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-white" />
                  <span>Menyusun {count} Butir Soal...</span>
                </>
              ) : (
                <>
                  <List className="w-4 h-4 text-white" />
                  <span>Buat Soal ({count} Butir)</span>
                </>
              )}
            </button>

          </form>
        </aside>

        {/* Right Panel: Preview Area */}
        <section className="flex-1 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col min-h-[600px]">
          {/* Toolbar */}
          <div className="p-4 border-b border-slate-100 flex flex-col gap-3 bg-slate-50/80">
            {/* Top row of Toolbar */}
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3">
                <h2 className="font-bold text-slate-800 flex items-center gap-2">
                  <CheckSquare className="w-5 h-5 text-indigo-600" />
                  Preview Data Soal
                </h2>
                {safeQuestions.length > 0 && (
                  <span className="bg-indigo-100 text-indigo-700 text-xs py-0.5 px-2.5 rounded-full font-bold">
                    {safeQuestions.length} Butir Soal
                  </span>
                )}
                {safeQuestions.length > 0 && lastModelUsed && (
                  <span className="hidden md:inline-flex items-center gap-1.5 bg-slate-100 text-slate-700 text-[11px] py-1 px-2.5 rounded-md font-mono border border-slate-200" title="Model AI yang digunakan untuk membuat soal ini">
                    <Cpu className="w-3.5 h-3.5 text-indigo-600" />
                    <span>{lastModelUsed}</span>
                  </span>
                )}
              </div>

              {/* View Mode Switcher */}
              {safeQuestions.length > 0 && (
                <div className="flex items-center bg-slate-200/80 p-0.5 rounded-lg border border-slate-300/60 shadow-xs">
                  <button
                    type="button"
                    onClick={() => setViewMode('card')}
                    className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-indigo-600 ${viewMode === 'card'
                        ? 'bg-white text-indigo-700 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                      }`}
                    title="Tampilan Lembar Kartu Soal Lengkap"
                  >
                    <LayoutList className="w-3.5 h-3.5" />
                    Kartu Soal
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode('table')}
                    className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-indigo-600 ${viewMode === 'table'
                        ? 'bg-white text-indigo-700 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                      }`}
                    title="Tampilan Tabel Ringkas"
                  >
                    <TableIcon className="w-3.5 h-3.5" />
                    Tabel Ringkas
                  </button>
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center gap-2 flex-wrap">
                {safeQuestions.length > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete({ type: 'all' })}
                      className="text-slate-600 hover:text-red-600 hover:bg-red-50 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1 cursor-pointer focus-visible:ring-2 focus-visible:ring-red-600"
                      title="Hapus semua soal yang ada di preview"
                      aria-label="Hapus semua soal di preview"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Bersihkan
                    </button>
                    <button
                      type="button"
                      onClick={downloadGrafik}
                      disabled={isDownloadingZip}
                      className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 shadow-xs cursor-pointer focus-visible:ring-2 focus-visible:ring-indigo-600 disabled:cursor-not-allowed"
                      title="Download seluruh gambar dan grafik ke dalam berkas ZIP"
                    >
                      {isDownloadingZip ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImageIcon className="w-3.5 h-3.5" />}
                      Grafik (ZIP)
                    </button>
                    <button
                      type="button"
                      onClick={exportToExcel}
                      className="bg-emerald-700 hover:bg-emerald-800 text-white px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 shadow-xs cursor-pointer focus-visible:ring-2 focus-visible:ring-emerald-600"
                      title="Download soal ke format template Excel CBT Pijar"
                    >
                      <FileSpreadsheet className="w-3.5 h-3.5" />
                      Download Excel (XLSX)
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Filter & Search bar (when questions exist) */}
            {safeQuestions.length > 0 && (
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 pt-2 border-t border-slate-200/60">
                {/* Search Bar */}
                <div className="relative flex-1 max-w-md">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Cari teks soal, bacaan, atau kunci..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full bg-white border border-slate-300 rounded-lg pl-9 pr-8 py-1.5 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer p-0.5"
                      aria-label="Hapus pencarian"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* Filter Type Pills */}
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
                  <button
                    type="button"
                    onClick={() => setFilterType('all')}
                    className={`px-2.5 py-1 rounded-md text-xs font-semibold whitespace-nowrap transition cursor-pointer focus-visible:ring-2 focus-visible:ring-indigo-600 ${filterType === 'all'
                        ? 'bg-slate-800 text-white'
                        : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-100'
                      }`}
                  >
                    Semua ({safeQuestions.length})
                  </button>
                  {Array.from(new Set(safeQuestions.map(q => q.Jenis_Soal))).map(t => {
                    const count = safeQuestions.filter(q => q.Jenis_Soal === t).length;
                    return (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setFilterType(t)}
                        className={`px-2.5 py-1 rounded-md text-xs font-semibold whitespace-nowrap transition cursor-pointer focus-visible:ring-2 focus-visible:ring-indigo-600 ${filterType === t
                            ? 'bg-indigo-600 text-white'
                            : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-100'
                          }`}
                      >
                        {t} ({count})
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Main Content Area */}
          <div className="flex-1 overflow-auto bg-slate-100/60 p-4 sm:p-5">
            {isGenerating ? (
              <div className="h-full min-h-[350px] flex flex-col items-center justify-center text-slate-400 space-y-4">
                <Loader2 className="w-10 h-10 animate-spin text-indigo-500" />
                <p className="font-medium animate-pulse text-slate-700">
                  Menghasilkan soal dengan {customModel === 'auto' ? `Otomatis (${effectiveModel})` : customModel}, harap tunggu sebentar...
                </p>
              </div>
            ) : safeQuestions.length === 0 ? (
              <div className="h-full min-h-[350px] border-2 border-dashed border-slate-200 rounded-2xl flex flex-col items-center justify-center text-slate-400 p-8 text-center bg-white/50">
                <div className="w-14 h-14 bg-indigo-50 text-indigo-400 rounded-2xl flex items-center justify-center mb-3">
                  <List className="w-7 h-7" />
                </div>
                <p className="font-semibold text-slate-700 text-base">Belum ada data soal</p>
                <p className="text-sm text-slate-500 max-w-sm mt-1">
                  Pilih mata pelajaran, topik, dan konfigurasi soal di panel kiri, lalu klik tombol <span className="font-semibold text-indigo-600">"Buat Soal"</span>.
                </p>
              </div>
            ) : (() => {
              const filteredList = safeQuestions
                .map((q, originalIndex) => ({ q, originalIndex }))
                .filter(({ q }) => {
                  if (filterType !== 'all' && q.Jenis_Soal !== filterType) return false;
                  if (!searchQuery.trim()) return true;
                  const term = searchQuery.toLowerCase().trim();
                  const searchable = [
                    q.Soal,
                    q.Isi_Referensi,
                    q.Judul_Referensi,
                    q.Pilihan_A,
                    q.Pilihan_B,
                    q.Pilihan_C,
                    q.Pilihan_D,
                    q.Pilihan_E,
                    q.Pilihan_F,
                    q.Kunci_Jawaban_Non_Essay,
                    q.Jawaban_Essay,
                    q.Nama_Materi
                  ].filter(Boolean).join(' ').toLowerCase();
                  return searchable.includes(term);
                });

              if (filteredList.length === 0) {
                return (
                  <div className="py-16 text-center text-slate-500 bg-white rounded-2xl border border-slate-200">
                    <Search className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                    <p className="font-semibold text-slate-700">Tidak ada soal yang cocok</p>
                    <p className="text-xs text-slate-500 mt-1">Coba kata kunci lain atau ubah filter jenis soal.</p>
                    <button
                      onClick={() => { setSearchQuery(''); setFilterType('all'); }}
                      className="mt-3 px-3 py-1.5 text-xs font-semibold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition"
                    >
                      Reset Filter
                    </button>
                  </div>
                );
              }

              // Card View Mode
              if (viewMode === 'card') {
                return (
                  <div className="space-y-5 max-w-4xl mx-auto">
                    {filteredList.map(({ q, originalIndex }) => {
                      const options = [
                        { key: 'A', text: q.Pilihan_A },
                        { key: 'B', text: q.Pilihan_B },
                        { key: 'C', text: q.Pilihan_C },
                        { key: 'D', text: q.Pilihan_D },
                        { key: 'E', text: q.Pilihan_E },
                        { key: 'F', text: q.Pilihan_F },
                      ].filter(opt => !!opt.text && opt.text.trim() !== '');

                      const correctKeys = (q.Kunci_Jawaban_Non_Essay || '')
                        .split(/[,;\s]+/)
                        .map(s => s.trim().toUpperCase())
                        .filter(Boolean);

                      return (
                        <article
                          key={originalIndex}
                          className="bg-white rounded-2xl border border-slate-200/90 shadow-sm hover:shadow-md transition-shadow overflow-hidden"
                        >
                          {/* Header Bar */}
                          <div className="bg-slate-50/90 border-b border-slate-100 px-5 py-3.5 flex items-center justify-between flex-wrap gap-2">
                            <div className="flex items-center gap-2.5 flex-wrap">
                              <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-indigo-600 text-white font-bold text-sm shadow-xs">
                                {q.Nomor || originalIndex + 1}
                              </span>
                              <span className={`text-xs px-2.5 py-1 rounded-md font-semibold border ${q.Jenis_Soal === 'PG' ? 'bg-blue-50 text-blue-900 border-blue-200' :
                                  q.Jenis_Soal === 'PGK' ? 'bg-indigo-50 text-indigo-900 border-indigo-200' :
                                    q.Jenis_Soal === 'ESSAY' ? 'bg-purple-50 text-purple-900 border-purple-200' :
                                      q.Jenis_Soal === 'PILIHAN ESSAY' ? 'bg-teal-50 text-teal-900 border-teal-200' :
                                        'bg-amber-50 text-amber-900 border-amber-200'
                                }`}>
                                {q.Jenis_Soal}
                              </span>
                              <span className="text-xs bg-slate-200/70 text-slate-700 px-2 py-0.5 rounded font-medium">
                                {q.Nilai || 10} Poin
                              </span>
                              {q.Nama_Materi && (
                                <span className="text-xs text-slate-500 font-medium max-w-[200px] truncate" title={q.Nama_Materi}>
                                  Topik: {q.Nama_Materi}
                                </span>
                              )}
                            </div>

                            {/* Actions on card */}
                            <div className="flex items-center gap-1.5">
                              {copiedIdx === originalIndex ? (
                                <span className="inline-flex items-center gap-1 text-xs text-emerald-700 font-semibold bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-lg">
                                  <Check className="w-3.5 h-3.5" /> Disalin
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => handleCopyQuestion(q, originalIndex)}
                                  className="inline-flex items-center gap-1 text-xs font-semibold text-slate-700 hover:text-indigo-700 hover:bg-slate-100 border border-slate-200 px-2.5 py-1 rounded-lg transition cursor-pointer focus-visible:ring-2 focus-visible:ring-indigo-600"
                                  title="Salin butir soal & kunci ke clipboard"
                                  aria-label="Salin butir soal ke clipboard"
                                >
                                  <Copy className="w-3.5 h-3.5" /> Salin
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => handleEdit(originalIndex, q)}
                                className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition cursor-pointer focus-visible:ring-2 focus-visible:ring-indigo-600"
                                title="Edit Soal Ini"
                                aria-label="Edit Soal Ini"
                              >
                                <Edit2 className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDelete(originalIndex)}
                                className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition cursor-pointer focus-visible:ring-2 focus-visible:ring-red-600"
                                title="Hapus Soal Ini"
                                aria-label="Hapus Soal Ini"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>

                          {/* Body */}
                          <div className="p-5 sm:p-6 space-y-4">
                            {/* Stimulus / Wacana */}
                            {q.Isi_Referensi && (
                              <div className="rounded-xl border border-amber-200/80 bg-amber-50/40 p-4">
                                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-amber-800 mb-1.5">
                                  <BookOpen className="w-4 h-4 text-amber-600" />
                                  <span>{q.Judul_Referensi || 'Wacana / Teks Rujukan'}</span>
                                </div>
                                <div className="text-sm text-slate-700 leading-relaxed font-normal">
                                  <MarkdownText>{q.Isi_Referensi}</MarkdownText>
                                </div>
                              </div>
                            )}

                            {/* Soal Pertanyaan */}
                            <div className="text-[15px] font-medium text-slate-900 leading-relaxed">
                              <MarkdownText>{q.Soal}</MarkdownText>
                            </div>

                            {/* Pilihan Jawaban */}
                            {options.length > 0 && (
                              <div className="space-y-2 pt-1">
                                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">Pilihan Jawaban:</span>
                                <div className="grid grid-cols-1 gap-2">
                                  {options.map((opt) => {
                                    const isCorrect = correctKeys.includes(opt.key.toUpperCase());
                                    return (
                                      <div
                                        key={opt.key}
                                        className={`flex items-start gap-3 p-3 rounded-xl border transition-all ${isCorrect
                                            ? 'bg-emerald-50/80 border-emerald-300 ring-1 ring-emerald-400/30'
                                            : 'bg-slate-50/60 border-slate-200 hover:bg-slate-50'
                                          }`}
                                      >
                                        <span className={`w-7 h-7 flex-shrink-0 flex items-center justify-center rounded-lg text-xs font-bold ${isCorrect
                                            ? 'bg-emerald-600 text-white shadow-xs'
                                            : 'bg-white text-slate-700 border border-slate-300'
                                          }`}>
                                          {opt.key}
                                        </span>
                                        <div className="flex-1 text-sm text-slate-800 pt-0.5 leading-snug">
                                          <MarkdownText inline>{opt.text}</MarkdownText>
                                        </div>
                                        {isCorrect && (
                                          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-100/80 px-2.5 py-0.5 rounded-full self-start flex-shrink-0">
                                            <Check className="w-3.5 h-3.5" /> Kunci Jawaban
                                          </span>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}

                            {/* Kunci Jawaban Non-Essay badge if present */}
                            {q.Kunci_Jawaban_Non_Essay && options.length === 0 && (
                              <div className="flex items-center gap-2 text-xs font-medium text-emerald-800 bg-emerald-50 px-3 py-2 rounded-xl border border-emerald-200 w-fit">
                                <span className="font-bold">Kunci Jawaban:</span>
                                <span className="font-bold bg-emerald-600 text-white px-2.5 py-0.5 rounded text-xs">
                                  {q.Kunci_Jawaban_Non_Essay}
                                </span>
                              </div>
                            )}

                            {/* Pedoman Essay */}
                            {q.Jawaban_Essay && (
                              <div className="rounded-xl border border-emerald-200/90 bg-emerald-50/40 p-4">
                                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-emerald-800 mb-1.5">
                                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                                  <span>Pedoman Penilaian & Kunci Jawaban Essay:</span>
                                </div>
                                <div className="text-sm text-slate-700 leading-relaxed">
                                  <MarkdownText>{q.Jawaban_Essay}</MarkdownText>
                                </div>
                              </div>
                            )}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                );
              }

              // Table View Mode
              return (
                <div className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-sm ring-1 ring-slate-900/5">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-sm">
                      <thead>
                        <tr className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200">
                          <th className="p-3 border-r border-slate-200 w-12 text-center">No</th>
                          <th className="p-3 border-r border-slate-200 min-w-[320px]">Soal & Stimulus</th>
                          <th className="p-3 border-r border-slate-200 w-28 text-center whitespace-nowrap">Jenis Soal</th>
                          <th className="p-3 border-r border-slate-200 min-w-[260px]">Pilihan Jawaban</th>
                          <th className="p-3 border-r border-slate-200 w-28 text-center">Kunci</th>
                          <th className="p-3 text-center w-24">Aksi</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {filteredList.map(({ q, originalIndex }) => (
                          <tr key={originalIndex} className="hover:bg-slate-50/80 transition-colors">
                            <td className="p-3 border-r border-slate-100 align-top text-center text-slate-500 font-bold">
                              {q.Nomor || originalIndex + 1}
                            </td>
                            <td className="p-3 border-r border-slate-100 align-top">
                              {q.Isi_Referensi && (
                                <div className="mb-2 p-2.5 bg-amber-50 text-amber-900 text-xs rounded-lg border border-amber-200/80">
                                  {q.Judul_Referensi && <strong className="block text-amber-800 mb-0.5">{q.Judul_Referensi}</strong>}
                                  <MarkdownText>{q.Isi_Referensi}</MarkdownText>
                                </div>
                              )}
                              <div className="font-medium text-slate-800">
                                <MarkdownText>{q.Soal}</MarkdownText>
                              </div>
                            </td>
                            <td className="p-3 border-r border-slate-100 align-top text-center">
                              <span className={`inline-flex items-center px-2 py-1 rounded-md text-xs font-semibold border ${q.Jenis_Soal === 'PG' ? 'bg-blue-50 text-blue-900 border-blue-200' :
                                  q.Jenis_Soal === 'PGK' ? 'bg-indigo-50 text-indigo-900 border-indigo-200' :
                                    q.Jenis_Soal === 'ESSAY' ? 'bg-purple-50 text-purple-900 border-purple-200' :
                                      q.Jenis_Soal === 'PILIHAN ESSAY' ? 'bg-teal-50 text-teal-900 border-teal-200' :
                                        'bg-slate-100 text-slate-800 border-slate-200'
                                }`}>
                                {q.Jenis_Soal}
                              </span>
                            </td>
                            <td className="p-3 border-r border-slate-100 align-top text-xs text-slate-700 space-y-1.5">
                              {['A', 'B', 'C', 'D', 'E', 'F'].map(letter => {
                                const val = q[`Pilihan_${letter}` as keyof QuestionData];
                                if (!val) return null;
                                const isCorrect = (q.Kunci_Jawaban_Non_Essay || '').toUpperCase().includes(letter);
                                return (
                                  <div
                                    key={letter}
                                    className={`flex items-start gap-1.5 p-1 rounded ${isCorrect ? 'bg-emerald-50 text-emerald-900 font-semibold' : ''}`}
                                  >
                                    <span className={`w-4 h-4 flex-shrink-0 flex items-center justify-center rounded text-[10px] font-bold ${isCorrect ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-700'
                                      }`}>
                                      {letter}
                                    </span>
                                    <span className="flex-1 leading-snug"><MarkdownText inline>{val}</MarkdownText></span>
                                  </div>
                                );
                              })}
                              {q.Jawaban_Essay && (
                                <div className="mt-2 pt-2 border-t border-slate-100 text-slate-600 text-xs">
                                  <span className="font-bold text-emerald-700">Kunci Essay: </span>
                                  <MarkdownText>{q.Jawaban_Essay}</MarkdownText>
                                </div>
                              )}
                            </td>
                            <td className="p-3 border-r border-slate-100 align-top text-center">
                              {q.Kunci_Jawaban_Non_Essay ? (
                                <span className="inline-block bg-emerald-600 text-white font-bold text-xs px-2.5 py-1 rounded-md shadow-2xs">
                                  {q.Kunci_Jawaban_Non_Essay}
                                </span>
                              ) : (
                                <span className="text-xs text-slate-400 italic">Essay</span>
                              )}
                            </td>
                            <td className="p-3 align-top">
                              <div className="flex items-center justify-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => handleCopyQuestion(q, originalIndex)}
                                  className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-slate-100 rounded transition cursor-pointer focus-visible:ring-2 focus-visible:ring-indigo-600"
                                  title="Salin Soal"
                                  aria-label="Salin Soal"
                                >
                                  {copiedIdx === originalIndex ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleEdit(originalIndex, q)}
                                  className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded transition cursor-pointer focus-visible:ring-2 focus-visible:ring-indigo-600"
                                  title="Edit Soal"
                                  aria-label="Edit Soal"
                                >
                                  <Edit2 className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDelete(originalIndex)}
                                  className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded transition cursor-pointer focus-visible:ring-2 focus-visible:ring-red-600"
                                  title="Hapus Soal"
                                  aria-label="Hapus Soal"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })()}
          </div>
        </section>

      </main>

      <footer className="bg-white border-t border-slate-200 mt-auto">
        <div className="max-w-7xl mx-auto px-6 py-4 flex flex-col sm:flex-row items-center justify-between text-xs text-slate-500 gap-2">
          <p>&copy; {new Date().getFullYear()} AI Soal Generator CBT PIJAR by Harumlovers</p>
          <p className="flex items-center gap-1.5">
            <span>Provider: <span className="font-semibold text-slate-700">{activeProviderConfig.name.split(' ')[0]}</span></span>
            <span>&bull;</span>
            <span>Model: <span className="font-mono text-indigo-600 font-semibold">{customModel === 'auto' ? `Otomatis (${effectiveModel})` : customModel}</span></span>
          </p>
        </div>
      </footer>

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex justify-center items-center p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-dialog-title"
            className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[92vh] border border-slate-100 animate-in fade-in zoom-in-95 duration-150"
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/70 rounded-t-2xl">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-indigo-50 border border-indigo-100 text-indigo-600 rounded-xl">
                  <Cpu className="w-5 h-5" />
                </div>
                <div>
                  <h3 id="settings-dialog-title" className="font-bold text-slate-800 text-base">Pengaturan AI & Model</h3>
                  <p className="text-xs text-slate-500">Pilih provider AI (Gemini, Groq, DeepSeek, OpenAI, OpenRouter, Custom / Ollama)</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowSettings(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600"
                aria-label="Tutup Pengaturan"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-6 overflow-y-auto">

              {/* Provider Selector Cards */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-2">
                  Pilih AI Provider
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                  {AI_PROVIDERS.map((prov) => {
                    const isSelected = aiProvider === prov.id;
                    return (
                      <button
                        key={prov.id}
                        type="button"
                        onClick={() => handleSelectProvider(prov.id)}
                        className={`text-left p-3 rounded-xl border transition-all flex flex-col justify-between relative cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 ${isSelected
                            ? 'border-indigo-600 bg-indigo-50/70 shadow-xs ring-2 ring-indigo-500/20'
                            : 'border-slate-200 hover:border-slate-300 bg-white hover:bg-slate-50'
                          }`}
                      >
                        <div className="mb-1 w-full">
                          <span className={`text-xs font-bold leading-tight ${isSelected ? 'text-indigo-900' : 'text-slate-800'}`}>
                            {prov.name.split(' (')[0]}
                          </span>
                        </div>
                        <p className={`text-[11px] leading-snug line-clamp-2 ${isSelected ? 'text-indigo-700/90 font-medium' : 'text-slate-500'}`}>
                          {prov.tagline}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Provider Info Banner */}
              <div className="bg-slate-50 rounded-xl p-3 border border-slate-200/80 flex items-start gap-2.5">
                <div className="p-1 text-indigo-600 mt-0.5">
                  <Bot className="w-4 h-4 shrink-0 text-indigo-600" />
                </div>
                <div className="text-xs">
                  <span className="font-bold text-slate-800">{activeProviderConfig.name}: </span>
                  <span className="text-slate-600">{activeProviderConfig.tagline}.</span>
                </div>
              </div>

              {/* Auto Detected Key Notification */}
              {autoDetectedBanner && (
                <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl p-3 flex items-center gap-2.5 text-xs animate-in fade-in slide-in-from-top-1">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span className="font-medium">{autoDetectedBanner}</span>
                </div>
              )}

              {/* API Key Input */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-600">
                    {activeProviderConfig.name.split(' (')[0]} API Key
                  </label>
                  {aiProvider === 'gemini' && hasServerKey && (
                    <span className="text-[11px] bg-emerald-50 text-emerald-800 border border-emerald-200 px-2 py-0.5 rounded-full font-medium">
                      Key Server Cloudflare Aktif
                    </span>
                  )}
                </div>
                <input
                  type="password"
                  placeholder={activeProviderConfig.keyPlaceholder}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                  value={customApiKey}
                  onChange={(e) => handleApiKeyChange(e.target.value)}
                />
                <div className="flex items-center justify-between mt-1 text-xs">
                  <p className="text-slate-500">
                    Dapatkan API Key di{' '}
                    <a
                      href={activeProviderConfig.keyUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-indigo-600 hover:underline font-medium inline-flex items-center gap-0.5"
                    >
                      {activeProviderConfig.keyUrlLabel}
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </p>
                  {aiProvider === 'custom' && (
                    <span className="text-[11px] text-slate-400">Opsional untuk server lokal</span>
                  )}
                </div>
              </div>

              {/* Model Selection */}
              <div>
                <div className="flex items-center justify-between mb-1.5 flex-wrap gap-1">
                  <div className="flex items-center gap-2">
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-600">
                      Pilihan Model AI
                    </label>
                    <button
                      type="button"
                      onClick={() => handleFetchAccountModels()}
                      disabled={isLoadingModels}
                      className="text-[11px] text-indigo-600 hover:text-indigo-800 hover:underline flex items-center gap-1 font-semibold cursor-pointer"
                      title="Ambil daftar model yang aktif langsung dari akun API Anda"
                    >
                      <RefreshCw className={`w-3 h-3 ${isLoadingModels ? 'animate-spin' : ''}`} />
                      {isLoadingModels ? 'Memuat model...' : 'Muat Model Aktif Akun'}
                    </button>
                  </div>
                  <span className="text-[11px] text-slate-500 font-mono">
                    Model aktif: <strong className="text-indigo-600">{customModel === 'auto' ? `Otomatis (${effectiveModel})` : customModel}</strong>
                  </span>
                </div>

                {/* Quick Model Preset Pills - Hanya menampilkan model aktif */}
                <div className="flex flex-wrap items-center gap-1.5 mb-2.5">
                  <button
                    type="button"
                    onClick={() => {
                      setCustomModel('auto');
                      setIsCustomModelName(false);
                    }}
                    className={`text-xs px-2.5 py-1 rounded-lg border font-medium transition-all flex items-center gap-1.5 cursor-pointer focus-visible:ring-2 focus-visible:ring-indigo-600 ${customModel === 'auto'
                        ? 'bg-indigo-600 text-white border-indigo-600 shadow-2xs font-semibold'
                        : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                      }`}
                  >
                    <span>Otomatis {currentActiveModels[0] ? `(${currentActiveModels[0].id})` : ''}</span>
                  </button>

                  {currentActiveModels.slice(0, 3).map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => {
                        setCustomModel(m.id);
                        setIsCustomModelName(false);
                      }}
                      className={`text-xs px-2.5 py-1 rounded-lg border font-medium transition-all flex items-center gap-1.5 cursor-pointer font-mono focus-visible:ring-2 focus-visible:ring-indigo-600 ${customModel === m.id && !isCustomModelName
                          ? 'bg-indigo-600 text-white border-indigo-600 shadow-2xs font-semibold'
                          : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                        }`}
                      title={`Pilih model ${m.id}`}
                    >
                      <span className="truncate max-w-[170px]">{m.id}</span>
                    </button>
                  ))}

                  {currentActiveModels.length === 0 && (
                    isLoadingModels ? (
                      <span className="text-xs text-slate-400 italic flex items-center gap-1 py-1">
                        <RefreshCw className="w-3 h-3 animate-spin text-indigo-500" />
                        Mendeteksi model aktif...
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleFetchAccountModels()}
                        className="text-xs text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 px-2.5 py-1 rounded-lg cursor-pointer flex items-center gap-1 font-medium focus-visible:ring-2 focus-visible:ring-indigo-600"
                      >
                        <RefreshCw className="w-3 h-3" />
                        Muat Model Aktif
                      </button>
                    )
                  )}
                </div>

                <select
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                  value={isCustomModelName ? 'custom' : customModel}
                  onChange={(e) => {
                    if (e.target.value === 'custom') {
                      setIsCustomModelName(true);
                    } else {
                      setIsCustomModelName(false);
                      setCustomModel(e.target.value);
                    }
                  }}
                >
                  {isLoadingModels ? (
                    <option value="auto">Sedang memuat model aktif dari akun {activeProviderConfig.name}...</option>
                  ) : currentActiveModels.length > 0 ? (
                    <>
                      <option value="auto">
                        Otomatis (Model Utama: {effectiveModel})
                      </option>
                      <optgroup label={`Model Aktif di Akun ${activeProviderConfig.name} (${currentActiveModels.length} Model)`}>
                        {currentActiveModels.map((m: any) => (
                          <option key={m.id} value={m.id}>
                            {m.id} {m.name && m.name !== m.id ? `(${m.name})` : ''}
                          </option>
                        ))}
                      </optgroup>
                    </>
                  ) : !customApiKey.trim() && aiProvider !== 'custom' ? (
                    <option value="auto">Masukkan API Key di atas terlebih dahulu untuk memunculkan model aktif</option>
                  ) : (
                    <option value="auto">Belum ada model aktif terdeteksi (Klik "Muat Model Aktif Akun")</option>
                  )}
                  <option value="custom">-- Ketik Nama Model Lainnya Secara Manual (Custom)... --</option>
                </select>

                {currentActiveModels.length > 0 ? (
                  <div className="mt-1.5 flex items-center justify-between text-[11px] text-emerald-800 bg-emerald-50 border border-emerald-200 px-2.5 py-1.5 rounded-lg">
                    <span className="flex items-center gap-1.5 font-medium">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                      Hanya menampilkan {currentActiveModels.length} model aktif dari akun {activeProviderConfig.name} Anda.
                    </span>
                    <button
                      type="button"
                      onClick={() => handleFetchAccountModels()}
                      disabled={isLoadingModels}
                      className="text-emerald-700 hover:text-emerald-900 underline ml-2 font-semibold cursor-pointer flex items-center gap-1 shrink-0"
                      title="Perbarui daftar model aktif langsung dari API"
                    >
                      <RefreshCw className={`w-3 h-3 ${isLoadingModels ? 'animate-spin' : ''}`} />
                      Segarkan
                    </button>
                  </div>
                ) : !isLoadingModels ? (
                  <div className="mt-1.5 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 px-2.5 py-1.5 rounded-lg flex items-center justify-between">
                    <span>
                      {!customApiKey.trim() && aiProvider !== 'custom'
                        ? `Masukkan API Key ${activeProviderConfig.name} di atas, sistem akan otomatis mengambil model-model yang aktif.`
                        : `Daftar model aktif belum tersinkron. Klik tombol di samping untuk memuat.`}
                    </span>
                    {(customApiKey.trim() || aiProvider === 'custom') && (
                      <button
                        type="button"
                        onClick={() => handleFetchAccountModels()}
                        disabled={isLoadingModels}
                        className="text-amber-800 hover:underline font-bold ml-2 shrink-0 cursor-pointer"
                      >
                        Muat Sekarang
                      </button>
                    )}
                  </div>
                ) : null}

                {/* Helper info based on selection */}
                {customModel === 'auto' ? (
                  <div className="mt-2 bg-indigo-50/80 border border-indigo-100 rounded-lg p-2.5 text-xs text-indigo-900 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Cpu className="w-4 h-4 text-indigo-600 shrink-0" />
                      <span>
                        Mode <strong>Otomatis</strong> aktif: sistem menghubungkan ke <strong>{effectiveModel}</strong> dengan perlindungan auto-fallback bila limit.
                      </span>
                    </div>
                    <span className="text-[10px] bg-indigo-200 text-indigo-800 font-bold px-2 py-0.5 rounded-full shrink-0">
                      Auto
                    </span>
                  </div>
                ) : !isCustomModelName ? (
                  <div className="mt-1.5 flex items-center justify-between text-xs text-slate-500">
                    <span>Model manual dipilih: <code className="font-mono text-slate-700 bg-slate-100 px-1 py-0.5 rounded">{customModel}</code></span>
                    <button
                      type="button"
                      onClick={() => { setCustomModel('auto'); setIsCustomModelName(false); }}
                      className="text-indigo-600 hover:underline font-medium text-[11px] cursor-pointer"
                    >
                      Kembalikan ke Otomatis
                    </button>
                  </div>
                ) : null}

                {isCustomModelName && (
                  <div className="mt-2.5">
                    <input
                      type="text"
                      placeholder={`Contoh: ${activeProviderConfig.defaultModel} atau model lainnya`}
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      value={customModel}
                      onChange={(e) => setCustomModel(e.target.value)}
                    />
                    <p className="text-xs text-indigo-600 mt-1">
                      Mode custom aktif. Masukkan ID model yang didukung oleh API provider Anda.
                    </p>
                  </div>
                )}
              </div>

              {/* Base URL (Endpoint) */}
              {(aiProvider === 'custom' || showAdvancedBaseUrl) ? (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-600">
                      Base URL Endpoint (OpenAI-Compatible)
                    </label>
                    {aiProvider !== 'custom' && (
                      <button
                        type="button"
                        onClick={() => setShowAdvancedBaseUrl(false)}
                        className="text-xs text-slate-400 hover:text-slate-600"
                      >
                        Sembunyikan
                      </button>
                    )}
                  </div>
                  <input
                    type="text"
                    placeholder={activeProviderConfig.defaultBaseUrl || 'http://localhost:11434/v1'}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    value={customBaseUrl}
                    onChange={(e) => setCustomBaseUrl(e.target.value)}
                  />
                  <p className="text-xs text-slate-500 mt-1">
                    Format: <code className="bg-slate-100 px-1 py-0.5 rounded text-indigo-700">http://host:port/v1</code> (otomatis memanggil <code className="bg-slate-100 px-1 py-0.5 rounded">/chat/completions</code>).
                  </p>
                </div>
              ) : (
                <div className="text-right">
                  <button
                    type="button"
                    onClick={() => setShowAdvancedBaseUrl(true)}
                    className="text-xs text-slate-500 hover:text-indigo-600 hover:underline"
                  >
                    + Kustomisasi Base URL (Proxy / Reverse Proxy / AI Gateway)
                  </button>
                </div>
              )}

              {/* Temperature Slider */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-600">
                    Kreativitas AI (Temperature)
                  </label>
                  <span className="text-xs font-mono font-bold bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded border border-indigo-100">
                    {aiTemperature.toFixed(1)}
                  </span>
                </div>
                <input
                  type="range"
                  min="0.0"
                  max={aiProvider === 'gemini' ? 1.0 : 1.5}
                  step="0.1"
                  className="w-full accent-indigo-600 cursor-pointer"
                  value={aiTemperature}
                  onChange={(e) => setAiTemperature(parseFloat(e.target.value))}
                />
                <div className="flex justify-between text-[11px] text-slate-400 mt-1">
                  <span>0.0 (Presisi/Hitungan Eksak)</span>
                  <span>0.7 (Seimbang - Rekomendasi)</span>
                  <span>{aiProvider === 'gemini' ? '1.0' : '1.5'} (Kreatif)</span>
                </div>
              </div>

              {/* Additional Instructions */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                  Instruksi Khusus Tambahan (Opsional)
                </label>
                <textarea
                  placeholder="Misal: Gunakan konteks kearifan lokal Indonesia, hindari istilah asing tanpa penjelasan..."
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 h-16 resize-none"
                  value={additionalInstructions}
                  onChange={(e) => setAdditionalInstructions(e.target.value)}
                />
              </div>

              {/* Sound Notification Option */}
              <div className="pt-2 border-t border-slate-100">
                <label className="flex items-center justify-between cursor-pointer p-3 bg-slate-50 hover:bg-slate-100/80 rounded-xl border border-slate-200 transition-colors">
                  <div className="flex items-center gap-2.5">
                    {soundEnabled ? (
                      <Volume2 className="w-4 h-4 text-indigo-600 shrink-0" />
                    ) : (
                      <VolumeX className="w-4 h-4 text-slate-400 shrink-0" />
                    )}
                    <div>
                      <span className="text-xs font-bold text-slate-800 block">Suara Notifikasi Selesai</span>
                      <span className="text-[11px] text-slate-500">Putar audio setelah proses pembuatan soal berhasil</span>
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={soundEnabled}
                    onChange={(e) => {
                      setSoundEnabled(e.target.checked);
                      if (e.target.checked) playSuccessSound(true);
                    }}
                    className="w-4 h-4 text-indigo-600 rounded border-slate-300 accent-indigo-600 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600"
                  />
                </label>
              </div>

              {/* Auto Fallback Quota Setting */}
              <div className="pt-2 border-t border-slate-100">
                <label className="flex items-center justify-between cursor-pointer p-3 bg-slate-50 hover:bg-slate-100/80 rounded-xl border border-slate-200 transition-colors">
                  <div className="flex items-center gap-2.5">
                    <RefreshCw className="w-4 h-4 text-indigo-600 shrink-0" />
                    <div>
                      <span className="text-xs font-bold text-slate-800 block">Alihkan Otomatis Jika Kuota Habis</span>
                      <span className="text-[11px] text-slate-500">Otomatis pindah ke model dengan limit lebih besar saat terkena rate limit / 429</span>
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={autoFallbackQuota}
                    onChange={(e) => setAutoFallbackQuota(e.target.checked)}
                    className="w-4 h-4 text-indigo-600 rounded border-slate-300 accent-indigo-600 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600"
                  />
                </label>
              </div>

              {/* Test Connection Button */}
              <div className="pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={handleTestConnection}
                  disabled={testStatus?.loading}
                  className="w-full py-2.5 px-3 border border-indigo-200 text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-xl text-xs font-bold transition-colors flex items-center justify-center gap-2 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {testStatus?.loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                  {testStatus?.loading ? `Menguji koneksi ke ${activeProviderConfig.name}...` : `Uji Koneksi ${activeProviderConfig.name}`}
                </button>
                {testStatus && !testStatus.loading && (
                  <div className={`mt-2.5 p-3 rounded-xl text-xs flex items-center gap-2 ${testStatus.success ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
                    {testStatus.success ? <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" /> : <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />}
                    <span className="font-medium">{testStatus.message}</span>
                  </div>
                )}
              </div>

            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/70 flex justify-end gap-3 rounded-b-2xl">
              <button
                type="button"
                onClick={() => setShowSettings(false)}
                className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleSaveSettings}
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg shadow-xs hover:shadow transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600"
              >
                Simpan Pengaturan
              </button>
            </div>
          </div>
        </div>
      )}

      {/* History Modal */}
      {showHistoryPanel && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs z-50 flex justify-center items-center p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="history-dialog-title"
            className="bg-white rounded-xl shadow-xl w-full max-w-3xl flex flex-col max-h-[85vh]"
          >
            <div className="flex items-center justify-between p-4 border-b border-slate-100">
              <h3 id="history-dialog-title" className="font-semibold text-slate-800 flex items-center gap-2">
                <History className="w-5 h-5 text-indigo-600" /> Riwayat Soal
              </h3>
              <button
                type="button"
                onClick={() => setShowHistoryPanel(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600"
                aria-label="Tutup riwayat soal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto flex-1 bg-slate-50">
              {safeHistories.length === 0 ? (
                <div className="text-center py-10 text-slate-500 flex flex-col items-center">
                  <History className="w-12 h-12 text-slate-300 mb-2" />
                  <p>Belum ada riwayat soal yang tersimpan.</p>
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  {safeHistories.map((hist) => (
                    <div key={hist.id} className="bg-white p-4 rounded-xl shadow-xs border border-slate-200 flex flex-col justify-between hover:border-indigo-300 transition-colors">
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <span className="bg-indigo-100 text-indigo-800 text-xs font-semibold px-2 py-0.5 rounded-full">{hist.count} Soal</span>
                          <span className="text-xs text-slate-500 flex items-center gap-1"><Clock className="w-3 h-3" /> {hist.timestamp}</span>
                        </div>
                        <h4 className="font-bold text-slate-800 leading-tight mb-1">{hist.subject}</h4>
                        <p className="text-sm text-slate-600 line-clamp-2">{hist.topic || 'Semua Topik'}</p>
                      </div>
                      <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
                        <button
                          type="button"
                          onClick={() => setConfirmDelete({ type: 'history', id: hist.id })}
                          className="text-red-500 hover:text-red-700 hover:bg-red-50 p-1.5 rounded-md transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600"
                          aria-label={`Hapus riwayat ${hist.subject}`}
                          title="Hapus"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const raw = Array.isArray(hist.questions) ? hist.questions : [];
                            const clean = raw.map((q: QuestionData) => ({
                              ...q,
                              Soal: preprocessMarkdown(q.Soal),
                              Isi_Referensi: preprocessMarkdown(q.Isi_Referensi),
                              Pilihan_A: preprocessMarkdown(q.Pilihan_A),
                              Pilihan_B: preprocessMarkdown(q.Pilihan_B),
                              Pilihan_C: preprocessMarkdown(q.Pilihan_C),
                              Pilihan_D: preprocessMarkdown(q.Pilihan_D),
                              Pilihan_E: preprocessMarkdown(q.Pilihan_E),
                              Pilihan_F: preprocessMarkdown(q.Pilihan_F),
                              Jawaban_Essay: preprocessMarkdown(q.Jawaban_Essay),
                            }));
                            setQuestions(clean);
                            setShowHistoryPanel(false);
                          }}
                          className="bg-indigo-50 text-indigo-700 font-medium px-4 py-1.5 rounded-lg text-sm hover:bg-indigo-100 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600"
                        >
                          Buka di Preview
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="p-4 border-t border-slate-100 bg-white rounded-b-xl flex justify-end items-center">
              <button
                type="button"
                onClick={() => setShowHistoryPanel(false)}
                className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editingQuestion && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex justify-center items-center p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-dialog-title"
            className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl flex flex-col max-h-[90vh] border border-slate-100"
          >
            <div className="flex items-center justify-between p-4 border-b border-slate-100 bg-slate-50/80 rounded-t-2xl">
              <div className="flex items-center gap-3">
                <h3 id="edit-dialog-title" className="font-bold text-slate-800 text-base">
                  Edit Soal No {editingQuestion.index + 1}
                </h3>
                <div className="flex bg-slate-200/80 p-0.5 rounded-lg text-xs font-semibold">
                  <button
                    type="button"
                    onClick={() => setEditModalTab('form')}
                    className={`px-3 py-1 rounded-md transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 ${editModalTab === 'form' ? 'bg-white text-indigo-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'}`}
                  >
                    Formulir
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditModalTab('preview')}
                    className={`px-3 py-1 rounded-md transition-colors flex items-center gap-1.5 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 ${editModalTab === 'preview' ? 'bg-white text-indigo-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'}`}
                  >
                    <Eye className="w-3.5 h-3.5" />
                    Pratinjau Langsung
                  </button>
                </div>
              </div>
              <button
                type="button"
                onClick={handleCancelEdit}
                className="text-slate-400 hover:text-slate-600 p-1.5 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600"
                aria-label="Tutup formulir edit"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {editModalTab === 'preview' ? (
              <div className="p-6 overflow-y-auto flex-1 space-y-4 bg-slate-50/50">
                <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
                  {(editingQuestion.data.Judul_Referensi || editingQuestion.data.Isi_Referensi) && (
                    <div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
                      {editingQuestion.data.Judul_Referensi && (
                        <h4 className="font-bold text-slate-800 mb-1 text-sm">{editingQuestion.data.Judul_Referensi}</h4>
                      )}
                      {editingQuestion.data.Isi_Referensi && (
                        <div className="text-sm text-slate-700 leading-relaxed font-normal">
                          <MarkdownText>{editingQuestion.data.Isi_Referensi}</MarkdownText>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="text-sm text-slate-800 font-medium leading-relaxed">
                    <MarkdownText>{editingQuestion.data.Soal || '*(Teks soal masih kosong)*'}</MarkdownText>
                  </div>

                  <div className="space-y-2 pt-2">
                    {(['A', 'B', 'C', 'D', 'E', 'F'] as const).map(opt => {
                      const key = `Pilihan_${opt}` as keyof QuestionData;
                      const text = editingQuestion.data[key];
                      if (!text) return null;
                      const isCorrect = (editingQuestion.data.Kunci_Jawaban_Non_Essay || '').split(',').map(s => s.trim().toUpperCase()).includes(opt);
                      return (
                        <div
                          key={opt}
                          className={`p-3 rounded-lg border flex items-start gap-3 transition-colors ${isCorrect
                              ? 'bg-emerald-50 border-emerald-300 text-emerald-900 font-medium'
                              : 'bg-white border-slate-200 text-slate-700'
                            }`}
                        >
                          <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${isCorrect ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-600'
                            }`}>
                            {opt}
                          </span>
                          <div className="flex-1 text-sm leading-normal">
                            <MarkdownText inline>{text as string}</MarkdownText>
                          </div>
                          {isCorrect && (
                            <span className="text-[11px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded shrink-0">
                              Kunci
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {editingQuestion.data.Jawaban_Essay && (
                    <div className="mt-4 p-3 bg-indigo-50 border border-indigo-200 rounded-lg">
                      <span className="text-xs font-bold text-indigo-900 block mb-1">Pedoman / Jawaban Essay:</span>
                      <div className="text-xs text-indigo-950">
                        <MarkdownText>{editingQuestion.data.Jawaban_Essay}</MarkdownText>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="p-5 overflow-y-auto flex-1 space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1 text-slate-700">Teks Soal</label>
                  <textarea
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 h-28"
                    value={editingQuestion.data.Soal || ''}
                    onChange={e => setEditingQuestion(prev => prev ? { ...prev, data: { ...prev.data, Soal: e.target.value } } : null)}
                  />
                  <p className="text-[11px] text-slate-400 mt-1">Dukung rumus LaTeX ($...$ atau $$...$$), grafik QuickChart, diagram Mermaid, dan gambar.</p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {(['A', 'B', 'C', 'D', 'E', 'F'] as const).map(opt => {
                    const key = `Pilihan_${opt}` as keyof QuestionData;
                    if (editingQuestion.data[key] !== undefined || editingQuestion.data.Jenis_Soal === 'PG' || editingQuestion.data.Jenis_Soal === 'PGK') {
                      return (
                        <div key={key}>
                          <label className="block text-xs font-medium mb-1 text-slate-700">Pilihan {opt}</label>
                          <textarea
                            rows={2}
                            className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-indigo-500"
                            value={editingQuestion.data[key] as string || ''}
                            onChange={e => setEditingQuestion(prev => prev ? { ...prev, data: { ...prev.data, [key]: e.target.value } } : null)}
                          />
                        </div>
                      );
                    }
                    return null;
                  })}
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1 text-slate-700">Kunci Jawaban Non-Essay (Misal: A atau A,C)</label>
                  <input
                    type="text"
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-indigo-500"
                    value={editingQuestion.data.Kunci_Jawaban_Non_Essay || ''}
                    onChange={e => setEditingQuestion(prev => prev ? { ...prev, data: { ...prev.data, Kunci_Jawaban_Non_Essay: e.target.value } } : null)}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1 text-slate-700">Kunci Jawaban Essay (Opsional)</label>
                  <textarea
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm h-20 focus:ring-2 focus:ring-indigo-500"
                    value={editingQuestion.data.Jawaban_Essay || ''}
                    onChange={e => setEditingQuestion(prev => prev ? { ...prev, data: { ...prev.data, Jawaban_Essay: e.target.value } } : null)}
                  />
                </div>
              </div>
            )}

            <div className="p-4 border-t border-slate-100 flex justify-end gap-2 bg-slate-50/80 rounded-b-2xl">
              <button
                type="button"
                onClick={handleCancelEdit}
                className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleSaveEdit}
                className="px-5 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors cursor-pointer shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600"
              >
                Simpan Perubahan
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Konfirmasi Hapus Modal */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs z-[100] flex justify-center items-center p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-dialog-title"
            className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6 text-center"
          >
            <div className="mx-auto w-12 h-12 bg-red-100 text-red-600 rounded-full flex items-center justify-center mb-4">
              <AlertCircle className="w-6 h-6" />
            </div>
            <h3 id="delete-dialog-title" className="text-lg font-bold text-slate-800 mb-2">
              Konfirmasi Hapus
            </h3>
            <p className="text-slate-600 mb-6 font-medium text-sm">
              {confirmDelete.type === 'question' ? 'Yakin ingin menghapus butir soal ini?'
                : confirmDelete.type === 'history' ? 'Yakin ingin menghapus riwayat pembuatan ini?'
                  : 'Yakin ingin membersihkan semua soal dari pratinjau?'}
            </p>
            <div className="flex gap-3 justify-center">
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
                className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={() => {
                  if (confirmDelete.type === 'question' && confirmDelete.id !== undefined) {
                    setQuestions(prev => prev.filter((_, i) => i !== confirmDelete.id));
                  } else if (confirmDelete.type === 'history' && confirmDelete.id !== undefined) {
                    setHistories(prev => prev.filter(h => h.id !== confirmDelete.id));
                  } else if (confirmDelete.type === 'all') {
                    setQuestions([]);
                  }
                  setConfirmDelete(null);
                }}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600"
              >
                Hapus
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

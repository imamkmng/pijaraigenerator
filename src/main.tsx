import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import 'katex/dist/katex.min.css';

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("Application Render Error:", error, errorInfo);
  }

  handleReset = () => {
    try {
      localStorage.removeItem('lastGeneratedQuestions');
      localStorage.removeItem('questionHistories');
    } catch {}
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ 
          padding: '32px 24px', 
          fontFamily: 'system-ui, -apple-system, sans-serif', 
          maxWidth: 620, 
          margin: '60px auto', 
          background: '#ffffff', 
          borderRadius: 16, 
          border: '1px solid #e2e8f0', 
          boxShadow: '0 10px 25px -5px rgba(0,0,0,0.08)' 
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#fee2e2', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#dc2626', fontSize: 20, fontWeight: 'bold' }}>
              !
            </div>
            <div>
              <h2 style={{ color: '#1e293b', fontSize: 18, margin: 0, fontWeight: 'bold' }}>Terjadi Kendala Memuat Aplikasi</h2>
              <p style={{ color: '#64748b', fontSize: 13, margin: '2px 0 0 0' }}>Data cache lama mungkin tidak kompatibel dengan pembaruan.</p>
            </div>
          </div>
          
          <div style={{ 
            background: '#f8fafc', 
            border: '1px solid #e2e8f0', 
            color: '#dc2626', 
            padding: 12, 
            borderRadius: 8, 
            fontSize: 12, 
            fontFamily: 'monospace', 
            marginBottom: 20, 
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            maxHeight: 160,
            overflowY: 'auto'
          }}>
            {this.state.error?.message || String(this.state.error)}
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={this.handleReset}
              style={{ 
                background: '#4f46e5', 
                color: '#ffffff', 
                border: 'none', 
                padding: '10px 18px', 
                borderRadius: 8, 
                fontSize: 13, 
                fontWeight: 600, 
                cursor: 'pointer' 
              }}
            >
              Bersihkan Cache & Muat Ulang
            </button>
            <button
              onClick={() => window.location.reload()}
              style={{ 
                background: '#f1f5f9', 
                color: '#334155', 
                border: '1px solid #cbd5e1', 
                padding: '10px 18px', 
                borderRadius: 8, 
                fontSize: 13, 
                fontWeight: 600, 
                cursor: 'pointer' 
              }}
            >
              Muat Ulang Halaman
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  );
}

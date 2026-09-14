import React, { useState } from 'react';
import { X, ExternalLink, Image as ImageIcon, Copy, Check, Code, Layout, Eye } from 'lucide-react';

interface DirectImagesModalProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigateToScreen: (screen: 'dashboard' | 'event-detail') => void;
}

export const DirectImagesModal: React.FC<DirectImagesModalProps> = ({
  isOpen,
  onClose,
  onNavigateToScreen,
}) => {
  const [activeTab, setActiveTab] = useState<'info' | 'dashboard-img' | 'detail-img' | 'html-code'>('info');
  const [copiedLink, setCopiedLink] = useState<string | null>(null);

  if (!isOpen) return null;

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedLink(label);
    setTimeout(() => setCopiedLink(null), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4">
      <div onClick={onClose} className="absolute inset-0 cursor-pointer" />

      <div className="relative w-full max-w-3xl bg-surface-container-low rounded-xl shadow-2xl overflow-hidden flex flex-col border border-outline-variant/30 z-10 max-h-[85vh]">
        {/* Header */}
        <div className="px-5 py-4 bg-surface-container flex items-center justify-between border-b border-outline-variant/20">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded bg-primary-container/20 text-primary flex items-center justify-center">
              <ImageIcon size={16} />
            </div>
            <div>
              <h3 className="text-[17px] font-bold text-on-surface">
                Links Diretos &amp; Imagens do HTML
              </h3>
              <p className="text-[12px] text-on-surface-variant">
                Respondendo à sua dúvida sobre links de imagens e visualização direta das telas
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded flex items-center justify-center text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors cursor-pointer"
            type="button"
          >
            <X size={18} />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center px-4 pt-3 bg-surface-container-low border-b border-outline-variant/20 gap-2 overflow-x-auto">
          <button
            onClick={() => setActiveTab('info')}
            className={`px-3 py-2 text-[12px] font-semibold tracking-wide border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'info'
                ? 'border-primary text-primary'
                : 'border-transparent text-on-surface-variant hover:text-on-surface'
            }`}
          >
            Como Usar Links Diretos
          </button>
          <button
            onClick={() => setActiveTab('dashboard-img')}
            className={`px-3 py-2 text-[12px] font-semibold tracking-wide border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'dashboard-img'
                ? 'border-primary text-primary'
                : 'border-transparent text-on-surface-variant hover:text-on-surface'
            }`}
          >
            Tela 1: Dashboard (Image 3)
          </button>
          <button
            onClick={() => setActiveTab('detail-img')}
            className={`px-3 py-2 text-[12px] font-semibold tracking-wide border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'detail-img'
                ? 'border-primary text-primary'
                : 'border-transparent text-on-surface-variant hover:text-on-surface'
            }`}
          >
            Tela 2: FURIA vs NAVI (Image 1)
          </button>
          <button
            onClick={() => setActiveTab('html-code')}
            className={`px-3 py-2 text-[12px] font-semibold tracking-wide border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'html-code'
                ? 'border-primary text-primary'
                : 'border-transparent text-on-surface-variant hover:text-on-surface'
            }`}
          >
            Snippet HTML de Imagem
          </button>
        </div>

        {/* Body Content */}
        <div className="p-5 overflow-y-auto space-y-4 text-[13px] leading-relaxed">
          {activeTab === 'info' && (
            <div className="space-y-4">
              <div className="p-4 rounded-lg bg-surface-container border border-primary/20">
                <h4 className="font-bold text-on-surface text-[15px] flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-primary-container"></span>
                  Sim, é perfeitamente possível adicionar links diretos para imagens no HTML!
                </h4>
                <p className="text-on-surface-variant mt-2">
                  Em HTML e React, você pode exibir e referenciar imagens de três formas principais:
                </p>
                <ul className="list-disc list-inside space-y-1.5 mt-2 text-on-surface font-mono text-[12px]">
                  <li>
                    <span className="text-primary font-semibold">Links URL externos:</span>{' '}
                    <code className="text-on-surface-variant">&lt;img src="https://dominio.com/foto.png" alt="..." /&gt;</code>
                  </li>
                  <li>
                    <span className="text-primary font-semibold">Arquivos locais no projeto:</span>{' '}
                    <code className="text-on-surface-variant">&lt;img src="/assets/minha-imagem.png" alt="..." /&gt;</code>
                  </li>
                  <li>
                    <span className="text-primary font-semibold">Links clicáveis que abrem a imagem:</span>{' '}
                    <code className="text-on-surface-variant">&lt;a href="url-da-imagem.png" target="_blank"&gt;Ver Imagem&lt;/a&gt;</code>
                  </li>
                </ul>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div 
                  onClick={() => {
                    onNavigateToScreen('dashboard');
                    onClose();
                  }}
                  className="p-3.5 rounded-lg bg-surface-container hover:bg-surface-container-high transition-colors border border-outline-variant/20 cursor-pointer group"
                >
                  <div className="flex items-center justify-between text-on-surface font-bold text-[14px]">
                    <span className="group-hover:text-primary transition-colors">1. Ir para Dashboard</span>
                    <ExternalLink size={14} />
                  </div>
                  <p className="text-on-surface-variant text-[12px] mt-1">
                    Visão operacional com status dos 4 bookmakers, alertas de divergência, tabela interativa e painel de anomalias.
                  </p>
                </div>

                <div 
                  onClick={() => {
                    onNavigateToScreen('event-detail');
                    onClose();
                  }}
                  className="p-3.5 rounded-lg bg-surface-container hover:bg-surface-container-high transition-colors border border-outline-variant/20 cursor-pointer group"
                >
                  <div className="flex items-center justify-between text-on-surface font-bold text-[14px]">
                    <span className="group-hover:text-primary transition-colors">2. Ir para Detalhes (FURIA vs NAVI)</span>
                    <ExternalLink size={14} />
                  </div>
                  <p className="text-on-surface-variant text-[12px] mt-1">
                    Tela de reconciliação de feeds, matriz de mercados de 3 mapas, histórico quantitativo de odds e payload JSON sanitizado.
                  </p>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'dashboard-img' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-on-surface">Tela 1: Dashboard Geral (Image 3)</h4>
                <button
                  onClick={() => {
                    onNavigateToScreen('dashboard');
                    onClose();
                  }}
                  className="px-3 py-1 rounded bg-primary text-on-primary text-[12px] font-semibold flex items-center gap-1 cursor-pointer"
                >
                  <Eye size={13} />
                  <span>Abrir Tela Interativa</span>
                </button>
              </div>
              <div className="rounded-lg overflow-hidden border border-outline-variant/30 bg-surface-container-lowest">
                <img 
                  src="/Image 3.png" 
                  alt="Dashboard Geral de Odds" 
                  className="w-full h-auto object-contain max-h-[500px]"
                  onError={(e) => {
                    // Fallback visual if direct file is not served directly from root
                    (e.target as HTMLElement).style.display = 'none';
                  }}
                />
              </div>
              <p className="text-[12px] text-on-surface-variant">
                Esta tela exibe a visão operacional completa com 4 provedores (Bet365, Betano, Superbet, Pinnacle), o banner "Data Healthy", a tabela de mercados ativos com destaque para divergências e o drawer "Needs Attention".
              </p>
            </div>
          )}

          {activeTab === 'detail-img' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-on-surface">Tela 2: FURIA vs NAVI Reconciliação (Image 1)</h4>
                <button
                  onClick={() => {
                    onNavigateToScreen('event-detail');
                    onClose();
                  }}
                  className="px-3 py-1 rounded bg-primary text-on-primary text-[12px] font-semibold flex items-center gap-1 cursor-pointer"
                >
                  <Eye size={13} />
                  <span>Abrir Tela Interativa</span>
                </button>
              </div>
              <div className="rounded-lg overflow-hidden border border-outline-variant/30 bg-surface-container-lowest">
                <img 
                  src="/Image 1.png" 
                  alt="Tela de Detalhes FURIA vs NAVI" 
                  className="w-full h-auto object-contain max-h-[500px]"
                  onError={(e) => {
                    (e.target as HTMLElement).style.display = 'none';
                  }}
                />
              </div>
              <p className="text-[12px] text-on-surface-variant">
                Esta tela exibe a reconciliação e normalização de strings de time, matriz de priority markets (Winner, Mirage, Nuke, Inferno), histórico vetorial de odds em tempo real e visualizador de JSON.
              </p>
            </div>
          )}

          {activeTab === 'html-code' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-on-surface">Como linkar imagens diretamente no seu HTML:</h4>
                <button
                  onClick={() =>
                    copyToClipboard(
                      `<img src="https://exemplo.com/sua-imagem.png" alt="Odds Monitor" width="800" height="450" />`,
                      'code'
                    )
                  }
                  className="flex items-center gap-1 text-primary text-[12px] hover:underline cursor-pointer"
                >
                  {copiedLink === 'code' ? <Check size={13} /> : <Copy size={13} />}
                  <span>{copiedLink === 'code' ? 'Copiado!' : 'Copiar Exemplo'}</span>
                </button>
              </div>

              <pre className="p-3 bg-surface-container font-mono text-[12px] rounded border border-outline-variant/20 overflow-x-auto text-on-surface">
{`<!-- 1. Imagem Direta com Link Clicável -->
<a href="https://caminho/imagem.png" target="_blank" rel="noopener noreferrer">
  <img 
    src="https://caminho/imagem.png" 
    alt="Monitor de Odds - CS2" 
    class="rounded-lg shadow-md hover:opacity-95" 
  />
</a>

<!-- 2. Em React / Tailwind -->
<div className="w-full rounded-lg overflow-hidden border border-outline">
  <img 
    src="/caminho-da-imagem.png" 
    alt="Reconciliação FURIA vs NAVI" 
    className="w-full h-auto object-cover" 
    loading="lazy" 
  />
</div>`}
              </pre>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 bg-surface-container flex items-center justify-between border-t border-outline-variant/20">
          <span className="text-[12px] text-on-surface-variant">
            Odds Monitor v2.4 • Ambos os layouts estão 100% integrados
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded bg-surface-container-high hover:bg-surface-bright text-on-surface text-[12px] font-medium transition-colors cursor-pointer"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
};

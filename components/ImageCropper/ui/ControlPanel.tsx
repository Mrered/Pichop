import React, { useState } from 'react';
import { Undo2, Redo2, Download, FoldVertical, FoldHorizontal, Shrink, Eraser, Sparkles, Scissors, Settings2, History } from 'lucide-react';
import { CropMode } from '../../../types';

interface ControlPanelProps {
  historyIndex: number;
  historyLength: number;
  hasSelection: boolean;
  isEditingGrid: boolean;
  smartMode: boolean;
  eraserMode: 'segment' | 'line';
  setEraserMode: (mode: 'segment' | 'line') => void;
  onToggleSmartMode: () => void;
  onToggleEraser: () => void;
  onCrop: (mode: CropMode) => void;
  onUndo: () => void;
  onRedo: () => void;
  onDownload: () => void;
}

type MobileTab = 'crop' | 'tools' | 'history';

export const ControlPanel: React.FC<ControlPanelProps> = ({
  historyIndex, historyLength, hasSelection, isEditingGrid, smartMode,
  eraserMode, setEraserMode,
  onToggleSmartMode, onToggleEraser, onCrop, onUndo, onRedo, onDownload
}) => {
  const [mobileTab, setMobileTab] = useState<MobileTab | null>(null);

  const toggleTab = (tab: MobileTab) => {
    setMobileTab(prev => prev === tab ? null : tab);
  };

  // --- Components for Reusability ---

  const EraserControls = ({ isMobile }: { isMobile?: boolean }) => (
    <div className="space-y-2 w-full">
        <button 
            onClick={onToggleEraser}
            className={`w-full flex items-center justify-center gap-2 p-3 rounded-xl border transition-all ${
                isMobile 
                  ? isEditingGrid 
                      ? 'bg-red-900/30 border-red-500/50 text-red-400' 
                      : 'bg-zinc-800 border-zinc-700 text-zinc-300'
                  : isEditingGrid 
                    ? 'bg-red-50 dark:bg-red-900/20 border-red-500 text-red-600 dark:text-red-400' 
                    : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
            }`}
        >
            <Eraser size={18} />
            <span className="font-medium">{isEditingGrid ? '完成编辑' : '手动擦除表格线'}</span>
        </button>
        
        {isEditingGrid && (
            <div className={`flex rounded-lg p-1 border ${isMobile ? 'bg-zinc-800 border-zinc-700' : 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700'}`}>
            <button 
                onClick={() => setEraserMode('segment')} 
                className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-all ${
                    eraserMode === 'segment' 
                      ? isMobile ? 'bg-zinc-600 text-white' : 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' 
                      : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'
                }`}
            >
                擦除线段
            </button>
            <button 
                onClick={() => setEraserMode('line')} 
                className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-all ${
                    eraserMode === 'line' 
                      ? isMobile ? 'bg-zinc-600 text-white' : 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' 
                      : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'
                }`}
            >
                擦除整行
            </button>
            </div>
        )}
    </div>
  );

  const SmartModeControl = ({ isMobile }: { isMobile?: boolean }) => (
    <div 
        onClick={onToggleSmartMode}
        className={`w-full flex items-center justify-between p-3 rounded-xl border cursor-pointer transition-all ${
            isMobile
            ? smartMode 
                ? 'bg-brand-900/20 border-brand-500/50' 
                : 'bg-zinc-800 border-zinc-700'
            : smartMode 
                ? 'bg-brand-50 dark:bg-brand-900/20 border-brand-500/50' 
                : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700'
        }`}
    >
        <div className={`flex items-center gap-2 ${isMobile ? 'text-zinc-300' : 'text-slate-700 dark:text-slate-300'}`}>
            <Sparkles size={18} className={smartMode ? 'text-brand-500 fill-brand-500/20' : 'text-slate-400'} />
            <span className="font-medium text-sm">智能内容避让</span>
        </div>
        <div className={`w-10 h-6 rounded-full p-1 transition-colors ${smartMode ? 'bg-brand-500' : isMobile ? 'bg-zinc-600' : 'bg-slate-300 dark:bg-slate-600'}`}>
            <div className={`w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${smartMode ? 'translate-x-4' : 'translate-x-0'}`} />
        </div>
    </div>
  );

  const CropButtons = ({ layout, isMobile }: { layout: 'grid' | 'row', isMobile?: boolean }) => (
      <div className={layout === 'grid' ? "grid grid-cols-3 md:grid-cols-1 gap-2 md:gap-3 pb-4" : "flex gap-3 w-full"}>
        <button 
            disabled={!hasSelection || isEditingGrid}
            onClick={() => onCrop('horizontal')}
            className={`
                group flex items-center justify-center p-3 gap-2 rounded-xl border transition-all disabled:opacity-50 disabled:cursor-not-allowed
                ${isMobile 
                    ? 'border-zinc-700 bg-zinc-800/50 hover:bg-zinc-800 text-zinc-300' 
                    : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300'}
                ${layout === 'row' ? 'flex-1 flex-col' : 'flex-col md:flex-row'}
            `}
        >
            <div className={`p-2 rounded-lg transition-colors ${isMobile ? 'bg-zinc-700 group-hover:text-brand-400' : 'bg-slate-200 dark:bg-slate-700 group-hover:bg-brand-500/20 group-hover:text-brand-600 dark:group-hover:text-brand-400'}`}>
                <FoldVertical size={20} />
            </div>
            <div className={layout === 'row' ? "text-center" : "text-center md:text-left"}>
                <div className={`text-xs font-medium ${isMobile ? 'text-zinc-200' : 'text-slate-900 dark:text-slate-200'}`}>删除行</div>
            </div>
        </button>

        <button 
            disabled={!hasSelection || isEditingGrid}
            onClick={() => onCrop('vertical')}
            className={`
                group flex items-center justify-center p-3 gap-2 rounded-xl border transition-all disabled:opacity-50 disabled:cursor-not-allowed
                ${isMobile 
                    ? 'border-zinc-700 bg-zinc-800/50 hover:bg-zinc-800 text-zinc-300' 
                    : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300'}
                ${layout === 'row' ? 'flex-1 flex-col' : 'flex-col md:flex-row'}
            `}
        >
            <div className={`p-2 rounded-lg transition-colors ${isMobile ? 'bg-zinc-700 group-hover:text-brand-400' : 'bg-slate-200 dark:bg-slate-700 group-hover:bg-brand-500/20 group-hover:text-brand-600 dark:group-hover:text-brand-400'}`}>
                <FoldHorizontal size={20} />
            </div>
            <div className={layout === 'row' ? "text-center" : "text-center md:text-left"}>
                <div className={`text-xs font-medium ${isMobile ? 'text-zinc-200' : 'text-slate-900 dark:text-slate-200'}`}>删除列</div>
            </div>
        </button>

        <button 
            disabled={!hasSelection || isEditingGrid}
            onClick={() => onCrop('both')}
            className={`
                group flex items-center justify-center p-3 gap-2 rounded-xl border transition-all disabled:opacity-50 disabled:cursor-not-allowed
                ${isMobile 
                    ? 'border-zinc-700 bg-zinc-800/50 hover:bg-zinc-800 text-zinc-300' 
                    : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300'}
                ${layout === 'row' ? 'flex-1 flex-col' : 'flex-col md:flex-row'}
            `}
        >
            <div className={`p-2 rounded-lg transition-colors ${isMobile ? 'bg-zinc-700 group-hover:text-brand-400' : 'bg-slate-200 dark:bg-slate-700 group-hover:bg-brand-500/20 group-hover:text-brand-600 dark:group-hover:text-brand-400'}`}>
                <Shrink size={20} />
            </div>
            <div className={layout === 'row' ? "text-center" : "text-center md:text-left"}>
                <div className={`text-xs font-medium ${isMobile ? 'text-zinc-200' : 'text-slate-900 dark:text-slate-200'}`}>同时删除</div>
            </div>
        </button>
    </div>
  );

  const HistoryControls = ({ layout, isMobile }: { layout: 'mobile' | 'desktop', isMobile?: boolean }) => (
    <div className={`flex gap-2 ${layout === 'mobile' ? 'w-full' : ''}`}>
        <button 
            disabled={historyIndex <= 0}
            onClick={onUndo}
            className={`flex-1 flex items-center justify-center gap-2 p-2 rounded-lg border transition-colors disabled:opacity-40 
                ${isMobile 
                    ? 'bg-zinc-800 border-zinc-700 hover:bg-zinc-700 text-zinc-300' 
                    : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300'}`}
            title="撤销"
        >
            <Undo2 size={16} /> <span className={layout === 'desktop' ? "hidden md:inline" : ""}>撤销</span>
        </button>
        <button 
            disabled={historyIndex >= historyLength - 1}
            onClick={onRedo}
            className={`flex-1 flex items-center justify-center gap-2 p-2 rounded-lg border transition-colors disabled:opacity-40 
                ${isMobile 
                    ? 'bg-zinc-800 border-zinc-700 hover:bg-zinc-700 text-zinc-300' 
                    : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300'}`}
            title="重做"
        >
            <span className={layout === 'desktop' ? "hidden md:inline" : ""}>重做</span> <Redo2 size={16} />
        </button>
    </div>
  );

  // --- Render ---

  return (
    <>
      <style>{`
        /* Landscape Mobile Layout Adjustments */
        @media (max-width: 768px) and (orientation: landscape) {
            .mobile-panel {
                top: 0;
                right: 0;
                bottom: 0;
                left: auto !important;
                width: 72px;
                height: 100%;
                flex-direction: column;
                border-top: none;
                border-left: 1px solid rgba(255, 255, 255, 0.1);
                padding-bottom: 0 !important;
                justify-content: center;
            }
            .mobile-tabs {
                flex-direction: column;
                width: 100%;
                height: 100%;
                justify-content: center;
                gap: 20px;
                border-top: none !important;
            }
            .secondary-panel {
                position: fixed;
                right: 72px !important;
                top: 0;
                bottom: 0;
                left: auto !important;
                width: 280px;
                height: 100%;
                border-top: none !important;
                border-right: 1px solid rgba(255, 255, 255, 0.1);
                display: flex;
                flex-direction: column;
                justify-content: center;
                background: rgba(9, 9, 11, 0.95); /* zinc-950 */
            }
        }
      `}</style>

      {/* DESKTOP SIDEBAR */}
      <div 
        onMouseDown={(e) => e.stopPropagation()}
        className="
          hidden md:flex
          w-80 flex-col
          bg-white dark:bg-slate-900 
          border-l border-slate-200 dark:border-slate-800 
          z-30 shadow-xl h-full
        "
      >
        <div className="flex-1 overflow-y-auto p-6 min-h-0">
            <h2 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-4">工具</h2>
            <div className="mb-4 space-y-3">
                <EraserControls />
                <SmartModeControl />
                <p className="text-[10px] text-slate-400 px-1 leading-normal">
                    开启智能避让后，自动保护文字不被截断。
                </p>
            </div>

            <h2 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-4">裁切操作</h2>
            <CropButtons layout="grid" />
        </div>

        <div className="flex-none p-6 bg-slate-50 dark:bg-slate-900/50 border-t border-slate-200 dark:border-slate-800 flex flex-col gap-4 z-10">
            <div className="flex-1">
                <div className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-4">历史记录</div>
                <HistoryControls layout="desktop" />
            </div>

            <button 
                onClick={onDownload}
                className="py-4 bg-brand-600 hover:bg-brand-500 active:bg-brand-700 text-white font-bold rounded-xl shadow-lg shadow-brand-500/20 flex items-center justify-center gap-2 transition-all mt-4"
            >
                <Download size={20} />
                下载图片
            </button>
        </div>
      </div>

      {/* MOBILE PANEL */}
      <div 
         onMouseDown={(e) => e.stopPropagation()}
         onTouchStart={(e) => e.stopPropagation()}
         className="mobile-panel md:hidden w-full flex flex-col fixed bottom-0 left-0 right-0 z-40 bg-zinc-950/95 backdrop-blur-xl border-t border-white/10"
      >
         {/* Secondary Toolbar (Floating Context Menu) */}
         {mobileTab && (
             <div className="secondary-panel absolute bottom-full left-0 w-full bg-zinc-900/95 backdrop-blur-xl border-t border-white/10 p-4 transition-all shadow-2xl">
                 {mobileTab === 'crop' && (
                     <div className="flex flex-col gap-2">
                         <div className="flex items-center justify-between mb-2">
                             <h3 className="text-zinc-300 text-sm font-medium">裁切模式</h3>
                             <p className="text-xs text-zinc-500">{hasSelection ? '已选择区域' : '请先框选'}</p>
                         </div>
                         <CropButtons layout="row" isMobile />
                     </div>
                 )}
                 {mobileTab === 'tools' && (
                     <div className="space-y-4">
                         <div className="flex items-center justify-between">
                            <h3 className="text-zinc-300 text-sm font-medium">编辑工具</h3>
                         </div>
                         <div className="flex gap-2">
                             <div className="flex-1"><EraserControls isMobile /></div>
                         </div>
                         <SmartModeControl isMobile />
                     </div>
                 )}
                 {mobileTab === 'history' && (
                     <div className="flex flex-col gap-4">
                         <div className="flex items-center justify-between">
                            <h3 className="text-zinc-300 text-sm font-medium">历史与导出</h3>
                         </div>
                         <HistoryControls layout="mobile" isMobile />
                         <button 
                            onClick={onDownload}
                            className="w-full py-3 bg-brand-600 hover:bg-brand-500 active:bg-brand-700 text-white font-bold rounded-xl shadow-lg shadow-brand-500/20 flex items-center justify-center gap-2"
                        >
                            <Download size={20} />
                            保存图片
                        </button>
                     </div>
                 )}
             </div>
         )}

         {/* Main Tabs */}
         <div className="mobile-tabs flex items-center justify-around pb-safe pt-1">
             <button 
                onClick={() => toggleTab('crop')}
                className={`flex-1 flex flex-col items-center gap-1 py-3 px-2 transition-colors ${mobileTab === 'crop' ? 'text-brand-400' : 'text-zinc-500'}`}
             >
                 <Scissors size={24} className={mobileTab === 'crop' ? "fill-brand-500/10 stroke-[2]" : "stroke-[1.5]"} />
                 <span className="text-[10px] font-medium">裁切</span>
             </button>
             <button 
                onClick={() => toggleTab('tools')}
                className={`flex-1 flex flex-col items-center gap-1 py-3 px-2 transition-colors ${mobileTab === 'tools' ? 'text-brand-400' : 'text-zinc-500'}`}
             >
                 <Settings2 size={24} className={mobileTab === 'tools' ? "fill-brand-500/10 stroke-[2]" : "stroke-[1.5]"} />
                 <span className="text-[10px] font-medium">工具</span>
             </button>
             <button 
                onClick={() => toggleTab('history')}
                className={`flex-1 flex flex-col items-center gap-1 py-3 px-2 transition-colors ${mobileTab === 'history' ? 'text-brand-400' : 'text-zinc-500'}`}
             >
                 <History size={24} className={mobileTab === 'history' ? "fill-brand-500/10 stroke-[2]" : "stroke-[1.5]"} />
                 <span className="text-[10px] font-medium">操作</span>
             </button>
         </div>
      </div>
    </>
  );
};
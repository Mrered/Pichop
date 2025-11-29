
import React from 'react';
import { ZoomIn, ZoomOut, Scan, Maximize2, Smartphone, Trash2, Grid3X3, Eraser } from 'lucide-react';

interface FloatingControlsProps {
  scale: number;
  setScale: React.Dispatch<React.SetStateAction<number>>;
  onFit: (w?: number, h?: number) => void;
  hasSelection: boolean;
  onClearSelection: () => void;
  selectionCount: number;
  isEditingGrid: boolean;
  showToast: boolean;
}

export const FloatingControls: React.FC<FloatingControlsProps> = ({
  scale, setScale, onFit, hasSelection, onClearSelection, selectionCount, isEditingGrid, showToast
}) => {
  const stop = (e: React.MouseEvent | React.TouchEvent) => e.stopPropagation();

  return (
    <>
      <div 
          onMouseDown={stop} onTouchStart={stop} onClick={stop}
          className="absolute bottom-4 left-4 md:bottom-6 md:left-6 flex gap-2 bg-white/90 dark:bg-slate-900/90 backdrop-blur border border-slate-200 dark:border-slate-700 p-1.5 md:p-2 rounded-xl shadow-xl z-20 pointer-events-auto items-center"
      >
        <button onClick={() => setScale(s => Math.max(0.1, s - 0.1))} className="p-1.5 md:p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg text-slate-600 dark:text-slate-300">
            <ZoomOut size={18} />
        </button>
        <div className="w-10 md:w-12 flex items-center justify-center text-xs md:text-sm font-mono text-slate-500 dark:text-slate-400 select-none">
            {Math.round(scale * 100)}%
        </div>
        <button onClick={() => setScale(s => Math.min(5, s + 0.1))} className="p-1.5 md:p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg text-slate-600 dark:text-slate-300">
            <ZoomIn size={18} />
        </button>
        <div className="w-px h-6 md:h-8 bg-slate-200 dark:bg-slate-700 mx-1"></div>
        
        <button onClick={() => setScale(1)} className="p-1.5 md:p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg text-slate-600 dark:text-slate-300" title="实际大小 (1:1)">
            <Scan size={18} />
        </button>
        <button onClick={() => onFit()} className="p-1.5 md:p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg text-slate-600 dark:text-slate-300" title="适应屏幕">
            <Maximize2 size={18} />
        </button>
         <button onClick={() => onFit(window.innerWidth, window.innerHeight)} className="p-1.5 md:p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg text-slate-600 dark:text-slate-300 md:hidden" title="适应设备">
            <Smartphone size={18} />
        </button>
      </div>

      {hasSelection && (
          <button 
              onMouseDown={stop} onTouchStart={stop} onClick={(e) => { stop(e); onClearSelection(); }}
              className="absolute top-4 right-4 bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-2 z-20 text-sm font-medium transition-transform active:scale-95 pointer-events-auto"
          >
              <Trash2 size={16} /> 清除选区 ({selectionCount})
          </button>
      )}
      
      <div className={`absolute top-4 left-1/2 -translate-x-1/2 px-4 py-2 bg-slate-900/80 text-white text-xs rounded-full pointer-events-none backdrop-blur-sm shadow-lg border border-white/10 z-10 flex items-center gap-2 transition-opacity duration-500 ${(showToast || isEditingGrid) ? 'opacity-100' : 'opacity-0'}`}>
          {isEditingGrid ? (
              <>
                  <Eraser size={14} className="text-red-400 animate-pulse" />
                  <span>滑动擦除线段 (按住 Alt 删除整行)</span>
              </>
          ) : (
              <>
                  <Grid3X3 size={14} className="text-brand-400 animate-pulse" />
                  <span>点按单元格自动选中，拖拽手动框选</span>
              </>
          )}
      </div>
    </>
  );
};

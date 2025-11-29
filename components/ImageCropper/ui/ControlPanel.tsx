
import React from 'react';
import { Undo2, Redo2, Download, FoldVertical, FoldHorizontal, Shrink, Eraser } from 'lucide-react';
import { CropMode } from '../../../types';

interface ControlPanelProps {
  historyIndex: number;
  historyLength: number;
  hasSelection: boolean;
  isEditingGrid: boolean;
  onToggleEraser: () => void;
  onCrop: (mode: CropMode) => void;
  onUndo: () => void;
  onRedo: () => void;
  onDownload: () => void;
}

export const ControlPanel: React.FC<ControlPanelProps> = ({
  historyIndex, historyLength, hasSelection, isEditingGrid,
  onToggleEraser, onCrop, onUndo, onRedo, onDownload
}) => {
  return (
    <div 
      onMouseDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      className="
        w-full md:w-80 
        bg-white dark:bg-slate-900 
        border-t md:border-t-0 md:border-l border-slate-200 dark:border-slate-800 
        flex flex-col z-30 shadow-xl
        h-[40vh] md:h-full md:max-h-full
        safe-bottom pointer-events-auto
      "
    >
      <div className="flex-1 overflow-y-auto p-4 md:p-6 min-h-0">
          <h2 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3 md:mb-4">工具</h2>
           <div className="mb-4">
              <button 
                  onClick={onToggleEraser}
                  className={`w-full flex items-center justify-center gap-2 p-3 rounded-xl border transition-all ${isEditingGrid 
                      ? 'bg-red-50 dark:bg-red-900/20 border-red-500 text-red-600 dark:text-red-400' 
                      : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'}`}
              >
                  <Eraser size={18} />
                  <span className="font-medium">{isEditingGrid ? '完成编辑' : '手动擦除表格线'}</span>
              </button>
              <p className="text-[10px] text-slate-400 mt-1.5 px-1 leading-normal">
                  滑动擦除多余线条来合并单元格。<br/>按住 Alt 键可删除整行/整列。
              </p>
           </div>

          <h2 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3 md:mb-4">裁切操作</h2>
          <div className="grid grid-cols-3 md:grid-cols-1 gap-2 md:gap-3 pb-4">
              <button 
                  disabled={!hasSelection || isEditingGrid}
                  onClick={() => onCrop('horizontal')}
                  className="group flex flex-col md:flex-row items-center p-2 md:p-3 gap-2 md:gap-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800 hover:border-brand-500/50 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                  <div className="p-1.5 md:p-2 bg-slate-200 dark:bg-slate-700 rounded-lg group-hover:bg-brand-500/20 group-hover:text-brand-600 dark:group-hover:text-brand-400 transition-colors text-slate-600 dark:text-slate-300">
                      <FoldVertical size={20} />
                  </div>
                  <div className="text-center md:text-left">
                      <div className="text-xs md:text-sm font-medium text-slate-900 dark:text-slate-200">删除行</div>
                      <div className="hidden md:block text-xs text-slate-500">消除垂直高度 (缝合)</div>
                  </div>
              </button>

              <button 
                  disabled={!hasSelection || isEditingGrid}
                  onClick={() => onCrop('vertical')}
                  className="group flex flex-col md:flex-row items-center p-2 md:p-3 gap-2 md:gap-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800 hover:border-brand-500/50 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                  <div className="p-1.5 md:p-2 bg-slate-200 dark:bg-slate-700 rounded-lg group-hover:bg-brand-500/20 group-hover:text-brand-600 dark:group-hover:text-brand-400 transition-colors text-slate-600 dark:text-slate-300">
                      <FoldHorizontal size={20} />
                  </div>
                  <div className="text-center md:text-left">
                      <div className="text-xs md:text-sm font-medium text-slate-900 dark:text-slate-200">删除列</div>
                      <div className="hidden md:block text-xs text-slate-500">消除水平宽度 (缝合)</div>
                  </div>
              </button>

              <button 
                  disabled={!hasSelection || isEditingGrid}
                  onClick={() => onCrop('both')}
                  className="group flex flex-col md:flex-row items-center p-2 md:p-3 gap-2 md:gap-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800 hover:border-brand-500/50 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                  <div className="p-1.5 md:p-2 bg-slate-200 dark:bg-slate-700 rounded-lg group-hover:bg-brand-500/20 group-hover:text-brand-600 dark:group-hover:text-brand-400 transition-colors text-slate-600 dark:text-slate-300">
                      <Shrink size={20} />
                  </div>
                  <div className="text-center md:text-left">
                      <div className="text-xs md:text-sm font-medium text-slate-900 dark:text-slate-200">同时删除</div>
                      <div className="hidden md:block text-xs text-slate-500">删除横纵空白</div>
                  </div>
              </button>
          </div>
      </div>

      <div className="flex-none p-4 md:p-6 bg-slate-50 dark:bg-slate-900/50 border-t border-slate-200 dark:border-slate-800 flex flex-row md:flex-col gap-4 items-center md:items-stretch z-10">
          <div className="flex-1">
              <div className="hidden md:block text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-4">历史记录</div>
              <div className="flex gap-2">
                  <button 
                      disabled={historyIndex <= 0}
                      onClick={onUndo}
                      className="flex-1 flex items-center justify-center gap-2 p-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 disabled:opacity-40 disabled:hover:bg-white dark:disabled:hover:bg-slate-800 transition-colors"
                      title="撤销"
                  >
                      <Undo2 size={16} /> <span className="hidden md:inline">撤销</span>
                  </button>
                  <button 
                      disabled={historyIndex >= historyLength - 1}
                      onClick={onRedo}
                      className="flex-1 flex items-center justify-center gap-2 p-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 disabled:opacity-40 disabled:hover:bg-white dark:disabled:hover:bg-slate-800 transition-colors"
                      title="重做"
                  >
                      <span className="hidden md:inline">重做</span> <Redo2 size={16} />
                  </button>
              </div>
          </div>

          <button 
              onClick={onDownload}
              className="flex-1 md:flex-none py-3 md:py-4 bg-brand-600 hover:bg-brand-500 active:bg-brand-700 text-white font-bold rounded-xl shadow-lg shadow-brand-500/20 flex items-center justify-center gap-2 transition-all md:mt-4 whitespace-nowrap"
          >
              <Download size={20} />
              <span className="md:inline">下载图片</span>
          </button>
      </div>
    </div>
  );
};

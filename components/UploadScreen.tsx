import React, { useRef, useState } from 'react';
import { Upload, FileImage, MousePointer2 } from 'lucide-react';

interface UploadScreenProps {
  onUpload: (file: File) => void;
}

export const UploadScreen: React.FC<UploadScreenProps> = ({ onUpload }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      onUpload(e.target.files[0]);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      onUpload(e.dataTransfer.files[0]);
    }
  };

  return (
    <div className="h-full flex flex-col items-center justify-center p-4 overflow-y-auto">
      <div 
        className={`
          w-full max-w-xl border-2 border-dashed rounded-3xl p-8 md:p-12 transition-all duration-300 ease-in-out
          flex flex-col items-center justify-center gap-6 text-center
          ${isDragging 
            ? 'border-brand-500 bg-brand-500/10 scale-105 shadow-2xl shadow-brand-500/20' 
            : 'border-slate-300 dark:border-slate-700 bg-white/50 dark:bg-slate-900/50 hover:border-slate-400 dark:hover:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800/50'
          }
        `}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className={`p-5 md:p-6 rounded-full ${isDragging ? 'bg-brand-500' : 'bg-slate-100 dark:bg-slate-800'} transition-colors`}>
          <Upload className={`w-8 h-8 md:w-10 md:h-10 ${isDragging ? 'text-white' : 'text-slate-500 dark:text-slate-400'}`} />
        </div>
        
        <div className="space-y-2">
          <h2 className="text-xl md:text-2xl font-bold text-slate-900 dark:text-white">上传图片</h2>
          <p className="text-slate-500 dark:text-slate-400 max-w-xs md:max-w-md mx-auto text-sm md:text-base">
            将截图或图片拖放到此处，或点击下方按钮选择文件。
          </p>
        </div>

        <button 
          onClick={() => inputRef.current?.click()}
          className="px-6 md:px-8 py-3 bg-brand-600 hover:bg-brand-500 active:bg-brand-700 text-white rounded-xl font-medium transition-all shadow-lg hover:shadow-brand-500/25 flex items-center gap-2"
        >
          <FileImage className="w-5 h-5" />
          选择文件
        </button>
        <input 
          ref={inputRef}
          type="file" 
          accept="image/*" 
          className="hidden" 
          onChange={handleFileChange}
        />
      </div>

      {/* Feature hints */}
      <div className="mt-8 md:mt-12 grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6 max-w-4xl w-full px-2">
        <FeatureCard 
          icon={<MousePointer2 className="w-5 h-5" />}
          title="框选区域"
          description="在想要移除的空白区域、行或列上绘制选框。"
        />
        <FeatureCard 
          icon={<div className="flex flex-col items-center gap-[2px]"><div className="w-4 h-[2px] bg-current"></div><div className="w-4 h-[2px] bg-transparent border-t border-b border-dashed border-current h-2"></div><div className="w-4 h-[2px] bg-current"></div></div>}
          title="删除行"
          description="将选区上下的内容缝合，消除垂直高度。"
        />
        <FeatureCard 
           icon={<div className="flex items-center gap-[2px]"><div className="h-4 w-[2px] bg-current"></div><div className="h-4 w-[2px] bg-transparent border-l border-r border-dashed border-current w-2"></div><div className="h-4 w-[2px] bg-current"></div></div>}
          title="删除列"
          description="将选区左右的内容缝合，消除水平宽度。"
        />
      </div>
    </div>
  );
};

const FeatureCard: React.FC<{ icon: React.ReactNode; title: string; description: string }> = ({ icon, title, description }) => (
  <div className="bg-white/60 dark:bg-slate-900/50 p-4 rounded-xl border border-slate-200 dark:border-slate-800 flex flex-col items-center text-center gap-2 shadow-sm">
    <div className="text-brand-600 dark:text-brand-400 mb-1">{icon}</div>
    <h3 className="font-semibold text-slate-800 dark:text-slate-200">{title}</h3>
    <p className="text-xs md:text-sm text-slate-500 dark:text-slate-400">{description}</p>
  </div>
);
import React, { useState } from 'react';
import { ImageCropper } from './components/ImageCropper';
import { UploadScreen } from './components/UploadScreen';
import { Scissors } from 'lucide-react';

const App: React.FC = () => {
  const [imageSrc, setImageSrc] = useState<string | null>(null);

  const handleImageUpload = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      if (e.target?.result) {
        setImageSrc(e.target.result as string);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleReset = () => {
    setImageSrc(null);
  };

  return (
    <div className="flex flex-col h-[100dvh] w-full bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-200 transition-colors duration-300">
      {/* Header */}
      <header className="flex-none h-14 md:h-16 border-b border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/50 backdrop-blur-md px-4 md:px-6 flex items-center justify-between z-10 sticky top-0 safe-top">
        <div className="flex items-center gap-3">
          <div className="p-1.5 md:p-2 bg-brand-500 rounded-lg shadow-lg shadow-brand-500/20">
            <Scissors className="w-4 h-4 md:w-5 md:h-5 text-white" />
          </div>
          <div>
            <h1 className="font-bold text-base md:text-lg tracking-tight">智能切图</h1>
            <p className="text-[10px] md:text-xs text-slate-500 dark:text-slate-400 hidden sm:block">Smart Slice - 表格自动识别与无缝缝合</p>
          </div>
        </div>
        {imageSrc && (
          <button
            onClick={handleReset}
            className="text-xs md:text-sm text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white transition-colors px-3 py-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 font-medium"
          >
            打开新图片
          </button>
        )}
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-hidden relative">
        {imageSrc ? (
          <ImageCropper initialImage={imageSrc} />
        ) : (
          <UploadScreen onUpload={handleImageUpload} />
        )}
      </main>
    </div>
  );
};

export default App;
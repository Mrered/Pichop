import React, { useRef, useState } from 'react';
import { Upload, ImagePlus, Scissors, Layers, Sparkles, ArrowRight } from 'lucide-react';

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
    <div 
      className="h-full w-full flex flex-col bg-zinc-950 text-white relative overflow-hidden"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
        {/* Abstract Background Accents */}
        <div className="absolute top-[-20%] left-[-20%] w-[80%] h-[60%] bg-brand-500/10 blur-[120px] rounded-full pointer-events-none" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[60%] h-[50%] bg-purple-500/10 blur-[100px] rounded-full pointer-events-none" />

        {/* Desktop-specific Overlay for Drag State */}
        {isDragging && (
             <div className="absolute inset-0 z-50 bg-brand-500/20 backdrop-blur-sm border-4 border-brand-500 border-dashed m-4 rounded-3xl flex items-center justify-center">
                 <div className="text-2xl font-bold text-white flex flex-col items-center gap-4 animate-bounce">
                     <Upload className="w-12 h-12" />
                     <span>释放图片以上传</span>
                 </div>
             </div>
        )}

        <div className="flex-1 flex flex-col items-center justify-center p-6 md:p-12 z-10 relative">
            
            {/* Logo / Brand Area */}
            <div className="flex flex-col items-center text-center gap-6 mb-12 md:mb-16 max-w-lg animate-fade-in-up">
                <div className="relative group cursor-default">
                    <div className="absolute -inset-1 bg-gradient-to-r from-brand-500 to-purple-600 rounded-3xl blur opacity-25 group-hover:opacity-50 transition duration-1000"></div>
                    <div className="relative w-24 h-24 md:w-28 md:h-28 bg-gradient-to-br from-zinc-800 to-zinc-900 border border-white/10 rounded-3xl shadow-2xl flex items-center justify-center transform rotate-6 hover:rotate-12 transition-transform duration-500">
                        <Scissors className="w-12 h-12 md:w-14 md:h-14 text-white drop-shadow-lg" strokeWidth={2} />
                    </div>
                </div>
                
                <div className="space-y-4">
                    <h1 className="text-4xl md:text-6xl font-black tracking-tight bg-clip-text text-transparent bg-gradient-to-b from-white via-zinc-200 to-zinc-500">
                        Smart Slice
                    </h1>
                    <p className="text-zinc-400 text-base md:text-lg max-w-[280px] md:max-w-md mx-auto leading-relaxed font-light">
                        智能识别表格间隙，一键无缝拼接。
                        <br className="hidden md:block" />
                        专为截图与长文档设计。
                    </p>
                </div>
            </div>

            {/* Main Action Button */}
            <div className="w-full max-w-sm space-y-8 animate-fade-in-up delay-100">
                <button 
                    onClick={() => inputRef.current?.click()}
                    className="group relative w-full"
                >
                    <div className="absolute -inset-0.5 bg-gradient-to-r from-brand-500 to-purple-600 rounded-2xl blur opacity-60 group-hover:opacity-100 transition duration-500 group-hover:duration-200"></div>
                    <div className="relative w-full bg-zinc-900 hover:bg-zinc-800 border-t border-white/10 text-white rounded-2xl py-4 md:py-5 px-6 flex items-center justify-between transition-all active:scale-[0.98]">
                        <div className="flex items-center gap-4">
                            <div className="w-12 h-12 rounded-full bg-zinc-800 border border-white/5 flex items-center justify-center group-hover:bg-brand-500/20 transition-colors">
                                <ImagePlus className="w-6 h-6 text-brand-400" />
                            </div>
                            <div className="text-left">
                                <div className="font-bold text-lg">选择图片</div>
                                <div className="text-xs text-zinc-500 font-medium">支持 JPG, PNG</div>
                            </div>
                        </div>
                        <ArrowRight className="w-5 h-5 text-zinc-600 group-hover:text-white transition-colors" />
                    </div>
                </button>

                {/* Feature Pills */}
                <div className="grid grid-cols-3 gap-3">
                    <FeaturePill icon={<Layers size={18} />} label="智能识别" color="text-brand-400" bg="bg-brand-500/10" />
                    <FeaturePill icon={<Scissors size={18} />} label="无缝裁切" color="text-purple-400" bg="bg-purple-500/10" />
                    <FeaturePill icon={<Sparkles size={18} />} label="自动避让" color="text-green-400" bg="bg-green-500/10" />
                </div>
            </div>

            <input 
                ref={inputRef}
                type="file" 
                accept="image/*" 
                className="hidden" 
                onChange={handleFileChange}
            />
        </div>
        
        {/* Footer info */}
        <div className="absolute bottom-6 w-full text-center pointer-events-none opacity-50">
            <p className="text-[10px] text-zinc-500 font-medium tracking-wider uppercase">Version 2.0 • Mobile Optimized</p>
        </div>
    </div>
  );
};

const FeaturePill: React.FC<{ icon: React.ReactNode, label: string, color: string, bg: string }> = ({ icon, label, color, bg }) => (
    <div className="flex flex-col items-center gap-2 p-3 rounded-2xl bg-zinc-900/40 border border-white/5 backdrop-blur-sm transition-colors hover:bg-zinc-800/60">
        <div className={`p-2 rounded-full ${bg} ${color}`}>
            {icon}
        </div>
        <span className="text-[10px] md:text-xs text-zinc-400 font-medium whitespace-nowrap">{label}</span>
    </div>
);
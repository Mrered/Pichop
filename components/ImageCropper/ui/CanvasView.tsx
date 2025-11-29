import React, { useRef, useEffect } from 'react';
import { Grid, Rect, GridLine } from '../../../types';
import { EraserHover } from '../types';

interface CanvasViewProps {
  imageSrc: string;
  width: number;
  height: number;
  scale: number;
  pan: { x: number, y: number };
  grid: Grid | null;
  selections: Rect[];
  currentDrag: Rect | null;
  isScanning: boolean;
  isEditingGrid: boolean;
  hoveredCell: Rect | null;
  hoveredSegment: EraserHover | null;
  onPointerDown: (e: React.MouseEvent | React.TouchEvent) => void;
  onPointerMove: (e: React.MouseEvent | React.TouchEvent) => void;
  onPointerUp: (e: React.MouseEvent | React.TouchEvent) => void;
  onWheel: (e: React.WheelEvent) => void;
}

export const CanvasView: React.FC<CanvasViewProps> = ({
  imageSrc, width, height, scale, pan, grid, selections, currentDrag, 
  isScanning, isEditingGrid, hoveredCell, hoveredSegment,
  onPointerDown, onPointerMove, onPointerUp, onWheel
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scanProgressRef = useRef(0);
  const animationRef = useRef(0);

  useEffect(() => {
    // Create image once when src changes
    const img = new Image();
    img.src = imageSrc;

    const render = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
        }

        // Only draw if loaded
        if (img.complete) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, width, height);
        } else {
            // Retry if not loaded
            img.onload = () => render();
        }

        // Draw Grid
        if (grid) {
            ctx.save();
            ctx.lineWidth = 1 / scale;
            const alpha = isScanning ? 0.6 : (isEditingGrid ? 0.4 : 0.2); 
            ctx.strokeStyle = `rgba(56, 189, 248, ${alpha})`;
            
            const drawLines = (lines: GridLine[], type: 'h' | 'v') => {
                 lines.forEach((l, i) => {
                    // Skip if currently hovering this segment (drawn red later)
                    if (isEditingGrid && hoveredSegment && hoveredSegment.type === (type==='h'?'horizontal':'vertical') && hoveredSegment.lineIndex === i && hoveredSegment.isWholeLine) {
                         return; 
                    }
                    
                    ctx.beginPath();
                    if (type === 'h') {
                        ctx.moveTo(l.start, l.pos);
                        ctx.lineTo(l.end, l.pos);
                    } else {
                        ctx.moveTo(l.pos, l.start);
                        ctx.lineTo(l.pos, l.end);
                    }
                    ctx.stroke();
                 });
            };

            drawLines(grid.horizontal, 'h');
            drawLines(grid.vertical, 'v');

            // Eraser Highlight
            if (isEditingGrid && hoveredSegment) {
                ctx.beginPath();
                ctx.strokeStyle = '#ef4444';
                ctx.lineWidth = 3 / scale;
                ctx.shadowColor = '#ef4444';
                ctx.shadowBlur = 5;
                
                if (hoveredSegment.type === 'horizontal') {
                    const line = grid.horizontal[hoveredSegment.lineIndex];
                    if (line) { // Safety check: line might have been deleted
                        const y = line.pos;
                        if (hoveredSegment.isWholeLine) {
                             ctx.moveTo(line.start, y);
                             ctx.lineTo(line.end, y);
                        } else {
                             ctx.moveTo(hoveredSegment.start, y);
                             ctx.lineTo(hoveredSegment.end, y);
                        }
                    }
                } else {
                    const line = grid.vertical[hoveredSegment.lineIndex];
                    if (line) { // Safety check
                        const x = line.pos;
                         if (hoveredSegment.isWholeLine) {
                             ctx.moveTo(x, line.start);
                             ctx.lineTo(x, line.end);
                        } else {
                            ctx.moveTo(x, hoveredSegment.start);
                            ctx.lineTo(x, hoveredSegment.end);
                        }
                    }
                }
                ctx.stroke();
            }
            ctx.restore();
        }

        // Scan Animation
        if (isScanning) {
            ctx.save();
            scanProgressRef.current = (scanProgressRef.current + 25) % (canvas.height + 300);
            const scanY = scanProgressRef.current - 150;
            if (scanY < canvas.height + 50) {
                const gradient = ctx.createLinearGradient(0, scanY - 100, 0, scanY);
                gradient.addColorStop(0, 'rgba(14, 165, 233, 0)');
                gradient.addColorStop(1, 'rgba(56, 189, 248, 0.25)');
                ctx.fillStyle = gradient;
                ctx.fillRect(0, scanY - 100, canvas.width, 100);
                
                ctx.beginPath();
                ctx.moveTo(0, scanY);
                ctx.lineTo(canvas.width, scanY);
                ctx.strokeStyle = '#38bdf8';
                ctx.lineWidth = 2;
                ctx.shadowColor = '#0ea5e9';
                ctx.shadowBlur = 15;
                ctx.stroke();
            }
            ctx.restore();
            animationRef.current = requestAnimationFrame(render);
        }

        // Hover Cell
        if (hoveredCell && !isEditingGrid) {
            ctx.fillStyle = 'rgba(56, 189, 248, 0.15)';
            ctx.strokeStyle = 'rgba(14, 165, 233, 0.9)';
            ctx.lineWidth = 2 / scale;
            ctx.fillRect(hoveredCell.x, hoveredCell.y, hoveredCell.w, hoveredCell.h);
            ctx.strokeRect(hoveredCell.x, hoveredCell.y, hoveredCell.w, hoveredCell.h);
        }

        // Selections
        selections.forEach(s => {
            let rx = s.x;
            let ry = s.y;
            let rw = s.w;
            let rh = s.h;
            if (rw < 0) { rx += rw; rw = Math.abs(rw); }
            if (rh < 0) { ry += rh; rh = Math.abs(rh); }

            ctx.fillStyle = 'rgba(239, 68, 68, 0.25)';
            ctx.fillRect(rx, ry, rw, rh);
            ctx.strokeStyle = '#ef4444';
            ctx.lineWidth = 2 / scale;
            ctx.strokeRect(rx, ry, rw, rh);
            
            if (rw > 12 && rh > 12) {
                ctx.beginPath();
                ctx.moveTo(rx, ry);
                ctx.lineTo(rx + rw, ry + rh);
                ctx.moveTo(rx + rw, ry);
                ctx.lineTo(rx, ry + rh);
                ctx.strokeStyle = 'rgba(239, 68, 68, 0.5)';
                ctx.lineWidth = 1 / scale;
                ctx.stroke();
            }
        });

        // Drag Box
        if (currentDrag && (Math.abs(currentDrag.w) > 2 || Math.abs(currentDrag.h) > 2)) {
            let rx = currentDrag.x;
            let ry = currentDrag.y;
            let rw = currentDrag.w;
            let rh = currentDrag.h;
            if (rw < 0) { rx += rw; rw = Math.abs(rw); }
            if (rh < 0) { ry += rh; rh = Math.abs(rh); }

            ctx.fillStyle = 'rgba(14, 165, 233, 0.2)';
            ctx.strokeStyle = '#0ea5e9';
            ctx.lineWidth = 2 / scale;
            ctx.setLineDash([4, 4]);
            ctx.fillRect(rx, ry, rw, rh);
            ctx.strokeRect(rx, ry, rw, rh);
            ctx.setLineDash([]);
        }
    };

    render();
    return () => cancelAnimationFrame(animationRef.current);
  }, [imageSrc, width, height, scale, pan, grid, selections, currentDrag, isScanning, isEditingGrid, hoveredCell, hoveredSegment]);

  return (
    <div 
        className={`flex-1 bg-slate-100 dark:bg-slate-950 overflow-hidden flex items-center justify-center p-4 md:p-8 relative select-none touch-none w-full h-full min-h-0 ${isEditingGrid ? 'cursor-cell' : 'cursor-crosshair'}`}
        onMouseDown={onPointerDown}
        onMouseMove={onPointerMove}
        onMouseUp={onPointerUp}
        onMouseLeave={onPointerUp}
        onWheel={onWheel}
        onTouchStart={onPointerDown}
        onTouchMove={onPointerMove}
        onTouchEnd={onPointerUp}
    >
        <div 
            style={{ 
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`, 
                transformOrigin: 'center',
                transition: currentDrag ? 'none' : 'transform 0.05s linear' // Faster transition for smooth pan/zoom
            }}
            className={`shadow-2xl shadow-black/20 dark:shadow-black/50 ${isScanning ? 'opacity-90' : 'opacity-100'}`}
        >
            <canvas ref={canvasRef} className="block bg-white dark:bg-slate-800" />
        </div>
    </div>
  );
};
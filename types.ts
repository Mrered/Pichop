export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface GridLine {
  pos: number;      // Center position (x or y)
  thickness: number; // Estimated thickness
  start: number;    // Start coordinate (e.g., if line doesn't span full image)
  end: number;      // End coordinate
}

export interface Grid {
  horizontal: GridLine[];
  vertical: GridLine[];
}

export type CropMode = 'horizontal' | 'vertical' | 'both';

export interface HistoryItem {
  dataUrl: string;
  width: number;
  height: number;
}
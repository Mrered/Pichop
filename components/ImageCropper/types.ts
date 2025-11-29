
import { Rect, Grid } from '../../types';

export interface Segment {
  id: number;
  pos: number;
  start: number;
  end: number;
  length: number;
}

export interface EraserHover {
  type: 'horizontal' | 'vertical';
  lineIndex: number;
  start: number;
  end: number;
  isWholeLine: boolean;
}

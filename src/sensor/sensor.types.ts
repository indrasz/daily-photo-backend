export interface CopSample {
  x: number;
  y: number;
  timestamp: number;
}

export interface ExamMetrics {
  spl: number;
  aoe: number;
  vAP: number;
  vML: number;
  splSeries: { time: number; value: number }[];
  velocitySeries: { time: number; vAP: number; vML: number }[];
  copScatter: { x: number; y: number }[];
}

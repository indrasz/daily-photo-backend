import { Injectable } from '@nestjs/common';
import { CopSample, ExamMetrics } from './sensor.types';

@Injectable()
export class SensorService {
  /**
   * Compute full ExamMetrics from all collected CoP samples.
   * Mirrors the scan.py final calculation.
   */
  computeMetrics(samples: CopSample[]): ExamMetrics {
    const splSeries = this.computeSplSeries(samples);
    const spl = splSeries[splSeries.length - 1]?.value ?? 0;

    const aoe = this.computeAoe(samples);

    const velocitySeries = this.computeVelocitySeries(samples);
    const vML = this.computeAvgVml(samples);
    const vAP = this.computeAvgVap(samples);

    const copScatter = samples.map((s) => ({ x: s.x, y: s.y }));

    return { spl, aoe, vAP, vML, splSeries, velocitySeries, copScatter };
  }

  /** SPL at each step (cumulative). Returns array of length n. */
  computeSplSeries(samples: CopSample[]): { time: number; value: number }[] {
    let cumulative = 0;
    return samples.map((s, i) => {
      if (i > 0) {
        const dx = s.x - samples[i - 1].x;
        const dy = s.y - samples[i - 1].y;
        cumulative += Math.sqrt(dx * dx + dy * dy);
      }
      return { time: i, value: cumulative };
    });
  }

  /** Per-sample velocity (V-AP and V-ML), dt = 1 s. First sample has velocity 0. */
  computeVelocitySeries(
    samples: CopSample[],
  ): { time: number; vAP: number; vML: number }[] {
    return samples.map((s, i) => {
      if (i === 0) return { time: i, vAP: 0, vML: 0 };
      return {
        time: i,
        vAP: Math.abs(s.y - samples[i - 1].y),
        vML: Math.abs(s.x - samples[i - 1].x),
      };
    });
  }

  /** Average V-ML = sum(|diff_x|) / (n * dt), dt = 1 */
  computeAvgVml(samples: CopSample[]): number {
    const n = samples.length;
    if (n < 2) return 0;
    let sum = 0;
    for (let i = 1; i < n; i++)
      sum += Math.abs(samples[i].x - samples[i - 1].x);
    return sum / n;
  }

  /** Average V-AP = sum(|diff_y|) / (n * dt), dt = 1 */
  computeAvgVap(samples: CopSample[]): number {
    const n = samples.length;
    if (n < 2) return 0;
    let sum = 0;
    for (let i = 1; i < n; i++)
      sum += Math.abs(samples[i].y - samples[i - 1].y);
    return sum / n;
  }

  /**
   * Area of 95% Confidence Ellipse.
   * AoE = π × sqrt(5.991 × eig0) × sqrt(5.991 × eig1)
   * where eig0, eig1 are eigenvalues of the 2×2 covariance matrix.
   */
  computeAoe(samples: CopSample[]): number {
    const n = samples.length;
    if (n < 2) return 0;

    const meanX = samples.reduce((s, p) => s + p.x, 0) / n;
    const meanY = samples.reduce((s, p) => s + p.y, 0) / n;

    let cxx = 0,
      cyy = 0,
      cxy = 0;
    for (const s of samples) {
      const dx = s.x - meanX;
      const dy = s.y - meanY;
      cxx += dx * dx;
      cyy += dy * dy;
      cxy += dx * dy;
    }
    // sample covariance (divide by n-1)
    cxx /= n - 1;
    cyy /= n - 1;
    cxy /= n - 1;

    // Eigenvalues of [[cxx, cxy], [cxy, cyy]] via closed-form formula
    const trace = cxx + cyy;
    const det = cxx * cyy - cxy * cxy;
    const discriminant = Math.max(0, (trace / 2) ** 2 - det);
    const sqrtDisc = Math.sqrt(discriminant);
    const eig0 = trace / 2 + sqrtDisc;
    const eig1 = trace / 2 - sqrtDisc;

    if (eig0 < 0 || eig1 < 0) return 0;

    return Math.PI * Math.sqrt(5.991 * eig0) * Math.sqrt(5.991 * eig1);
  }
}

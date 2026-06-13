# Postur-App Backend — API Documentation

Backend NestJS yang membaca data sensor Arduino via USB Serial, memproses metrik keseimbangan postur, dan mengirim data real-time ke frontend.

---

## Base URL

```
HTTP  : http://localhost:3000
WS    : http://localhost:3000  (socket.io)
```

Frontend Next.js diasumsikan berjalan di `http://localhost:3001`.

---

## Alur Kerja (Flow)

```
Frontend                          Backend                       Arduino
   |                                 |                              |
   |── POST /patients ──────────────>|                              |
   |<─ { id, name, ... } ───────────|                              |
   |                                 |                              |
   |── WS: connect ─────────────────>|                              |
   |── WS: emit("start_exam") ──────>|── open serial port ─────────>|
   |                                 |<── DATA:x,y (30x) ──────────|
   |<── WS: "cop_sample" (x30) ─────|                              |
   |<── WS: "metrics_update" (x30) ─|                              |
   |<── WS: "exam_complete" ─────────|── close port ───────────────>|
   |                                 |                              |
   |── GET /exams/:id ──────────────>|                              |
   |<─ { spl, aoe, vAP, vML, ... } ─|                              |
```

---

## REST API

### Patients

#### `POST /patients`

Simpan data pasien sebelum memulai sesi scan.

**Request Body**

```json
{
  "name": "Budi Santoso",
  "age": 35,
  "gender": "male",
  "height": 170,
  "weight": 65,
  "notes": "Keluhan punggung bawah"
}
```

| Field    | Type     | Required | Keterangan                   |
|----------|----------|----------|------------------------------|
| `name`   | `string` | Ya       | Nama lengkap pasien          |
| `age`    | `number` | Ya       | Usia (tahun)                 |
| `gender` | `string` | Ya       | `"male"` atau `"female"`     |
| `height` | `number` | Tidak    | Tinggi badan (cm)            |
| `weight` | `number` | Tidak    | Berat badan (kg)             |
| `notes`  | `string` | Tidak    | Catatan tambahan             |

**Response `201`**

```json
{
  "id": "uuid-pasien",
  "name": "Budi Santoso",
  "age": 35,
  "gender": "male",
  "height": 170,
  "weight": 65,
  "notes": "Keluhan punggung bawah",
  "created_at": "2024-01-01T08:00:00.000Z"
}
```

---

#### `GET /patients/:id`

Ambil data pasien berdasarkan ID.

**Response `200`**

```json
{
  "id": "uuid-pasien",
  "name": "Budi Santoso",
  "age": 35,
  "gender": "male",
  "height": 170,
  "weight": 65,
  "notes": "Keluhan punggung bawah",
  "created_at": "2024-01-01T08:00:00.000Z"
}
```

**Response `404`** — pasien tidak ditemukan.

---

### Exams

#### `POST /exams/start`

Mulai sesi scan. Membuka serial port Arduino dan mulai membaca data.

> Hanya satu sesi yang bisa berjalan bersamaan. Panggil `/exams/stop` terlebih dahulu jika ada sesi aktif.

**Request Body**

```json
{
  "patientId": "uuid-pasien",
  "stage": 1
}
```

| Field       | Type         | Required | Keterangan         |
|-------------|--------------|----------|--------------------|
| `patientId` | `string`     | Ya       | ID pasien dari DB  |
| `stage`     | `1` atau `2` | Ya       | Tahap pengukuran   |

**Response `201`**

```json
{
  "examId": "uuid-exam"
}
```

**Response `500`** — serial port gagal dibuka, atau sesi sudah berjalan.

---

#### `POST /exams/stop`

Hentikan sesi scan secara paksa sebelum 30 sampel terkumpul.

**Response `200`**

```json
{
  "message": "Exam dihentikan"
}
```

---

#### `GET /exams/:id`

Ambil hasil exam yang sudah tersimpan di Supabase.

**Response `200`**

```json
{
  "id": "uuid-exam",
  "patient_id": "uuid-pasien",
  "stage": 1,
  "spl": 12.45,
  "aoe": 3.21,
  "v_ap": 0.41,
  "v_ml": 0.38,
  "spl_series": [
    { "time": 0, "value": 0 },
    { "time": 1, "value": 0.42 }
  ],
  "velocity_series": [
    { "time": 0, "vAP": 0, "vML": 0 },
    { "time": 1, "vAP": 0.3, "vML": 0.25 }
  ],
  "cop_scatter": [
    { "x": 24.3, "y": 1.2 },
    { "x": 24.1, "y": 0.8 }
  ],
  "created_at": "2024-01-01T08:00:00.000Z"
}
```

---

## WebSocket (Socket.IO)

### Koneksi

```typescript
import { io } from 'socket.io-client';

const socket = io('http://localhost:3000');

socket.on('connect', () => {
  console.log('Connected:', socket.id);
});
```

---

### Events: Frontend → Backend

#### `start_exam`

Mulai sesi scan via WebSocket (alternatif dari `POST /exams/start`).

```typescript
socket.emit('start_exam', {
  patientId: 'uuid-pasien',
  stage: 1,
});
```

| Field       | Type         | Keterangan        |
|-------------|--------------|-------------------|
| `patientId` | `string`     | ID pasien dari DB |
| `stage`     | `1` atau `2` | Tahap pengukuran  |

---

#### `stop_exam`

Hentikan sesi scan paksa via WebSocket.

```typescript
socket.emit('stop_exam', {});
```

---

### Events: Backend → Frontend

#### `exam_started`

Dikirim setelah `start_exam` berhasil.

```typescript
socket.on('exam_started', (data: { examId: string }) => {
  console.log('Exam ID:', data.examId);
});
```

---

#### `cop_sample`

Dikirim setiap kali ada sampel baru dari Arduino (~1 detik/sampel, total 30x).

```typescript
socket.on('cop_sample', (data: {
  x: number;      // ML CoP (Medio-Lateral), kisaran 0–50 cm
  y: number;      // AP CoP (Anterior-Posterior), kisaran -15–15 cm
  index: number;  // nomor sampel saat ini (1–30)
  total: number;  // target total sampel (30)
}) => {
  const progress = (data.index / data.total) * 100;
  console.log(`Sampel ${data.index}/${data.total} — X: ${data.x} | Y: ${data.y}`);
});
```

---

#### `metrics_update`

Dikirim bersamaan dengan setiap `cop_sample`, berisi metrik yang dihitung secara kumulatif.

```typescript
socket.on('metrics_update', (data: {
  spl: number;   // Sway Path Length (cm) — kumulatif sampai sampel ini
  aoe: number;   // Area of Ellipse (cm²) — dihitung dari semua sampel sejauh ini
  vAP: number;   // Rata-rata kecepatan Anterior-Posterior (cm/s)
  vML: number;   // Rata-rata kecepatan Medio-Lateral (cm/s)
  index: number; // nomor sampel saat ini
}) => {
  console.log(`SPL: ${data.spl.toFixed(2)} cm`);
});
```

---

#### `exam_complete`

Dikirim setelah 30 sampel terkumpul. Berisi hasil final lengkap.

```typescript
socket.on('exam_complete', (data: {
  examId: string;
  spl: number;
  aoe: number;
  vAP: number;
  vML: number;
  splSeries: { time: number; value: number }[];
  velocitySeries: { time: number; vAP: number; vML: number }[];
  copScatter: { x: number; y: number }[];
}) => {
  console.log('Exam selesai:', data.examId);
  // navigasi ke halaman hasil
});
```

---

#### `exam_error`

Dikirim jika terjadi error (serial port gagal buka, data tidak cukup, dll).

```typescript
socket.on('exam_error', (data: { message: string }) => {
  console.error('Error:', data.message);
});
```

---

## Tipe Data

```typescript
// Satu sampel CoP dari Arduino
interface CopSample {
  x: number;         // ML (cm)
  y: number;         // AP (cm)
  timestamp: number; // epoch ms
}

// Hasil final setelah 30 sampel
interface ExamMetrics {
  spl: number;       // Sway Path Length (cm)
  aoe: number;       // Area of Ellipse 95% (cm²)
  vAP: number;       // Average Velocity AP (cm/s)
  vML: number;       // Average Velocity ML (cm/s)
  splSeries: { time: number; value: number }[];
  velocitySeries: { time: number; vAP: number; vML: number }[];
  copScatter: { x: number; y: number }[];
}
```

---

## Penjelasan Metrik

| Metrik  | Satuan | Deskripsi |
|---------|--------|-----------|
| **SPL** | cm     | Total jarak yang ditempuh titik CoP selama sesi (Sway Path Length) |
| **AoE** | cm²    | Luas ellips 95% confidence yang mencakup pergerakan CoP (Area of Ellipse) |
| **vAP** | cm/s   | Rata-rata kecepatan pergerakan CoP arah Anterior-Posterior |
| **vML** | cm/s   | Rata-rata kecepatan pergerakan CoP arah Medio-Lateral |

---

## Contoh Integrasi Next.js

### `hooks/useExam.ts`

```typescript
import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';

interface CopSample {
  x: number;
  y: number;
  index: number;
  total: number;
}

interface ExamMetrics {
  spl: number;
  aoe: number;
  vAP: number;
  vML: number;
  index: number;
}

interface ExamResult extends Omit<ExamMetrics, 'index'> {
  examId: string;
  splSeries: { time: number; value: number }[];
  velocitySeries: { time: number; vAP: number; vML: number }[];
  copScatter: { x: number; y: number }[];
}

export function useExam() {
  const socketRef = useRef<Socket | null>(null);
  const [sample, setSample] = useState<CopSample | null>(null);
  const [metrics, setMetrics] = useState<ExamMetrics | null>(null);
  const [result, setResult] = useState<ExamResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  useEffect(() => {
    const socket = io('http://localhost:3000');
    socketRef.current = socket;

    socket.on('cop_sample', (data: CopSample) => setSample(data));
    socket.on('metrics_update', (data: ExamMetrics) => setMetrics(data));
    socket.on('exam_complete', (data: ExamResult) => {
      setResult(data);
      setIsRunning(false);
    });
    socket.on('exam_error', (data: { message: string }) => {
      setError(data.message);
      setIsRunning(false);
    });
    socket.on('exam_started', () => setIsRunning(true));

    return () => {
      socket.disconnect();
    };
  }, []);

  const startExam = (patientId: string, stage: 1 | 2) => {
    setResult(null);
    setError(null);
    setSample(null);
    setMetrics(null);
    socketRef.current?.emit('start_exam', { patientId, stage });
  };

  const stopExam = () => {
    socketRef.current?.emit('stop_exam', {});
    setIsRunning(false);
  };

  return { sample, metrics, result, error, isRunning, startExam, stopExam };
}
```

### `app/form/page.tsx` — Simpan pasien

```typescript
async function createPatient(formData: {
  name: string;
  age: number;
  gender: 'male' | 'female';
  height?: number;
  weight?: number;
  notes?: string;
}) {
  const res = await fetch('http://localhost:3000/patients', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(formData),
  });

  if (!res.ok) throw new Error('Gagal menyimpan pasien');
  return res.json() as Promise<{ id: string }>;
}
```

### `app/scan/page.tsx` — Halaman scan

```typescript
'use client';
import { useExam } from '@/hooks/useExam';

export default function ScanPage({ patientId }: { patientId: string }) {
  const { sample, metrics, result, error, isRunning, startExam, stopExam } = useExam();

  return (
    <div>
      {!isRunning && !result && (
        <button onClick={() => startExam(patientId, 1)}>Mulai Stage 1</button>
      )}

      {isRunning && (
        <>
          <p>Sampel: {sample?.index ?? 0} / {sample?.total ?? 30}</p>
          <p>SPL: {metrics?.spl.toFixed(2)} cm</p>
          <button onClick={stopExam}>Hentikan</button>
        </>
      )}

      {result && (
        <div>
          <h2>Hasil Scan</h2>
          <p>SPL: {result.spl.toFixed(2)} cm</p>
          <p>AoE: {result.aoe.toFixed(2)} cm²</p>
          <p>V-AP: {result.vAP.toFixed(2)} cm/s</p>
          <p>V-ML: {result.vML.toFixed(2)} cm/s</p>
        </div>
      )}

      {error && <p style={{ color: 'red' }}>Error: {error}</p>}
    </div>
  );
}
```

---

## Error Responses

Semua error mengikuti format NestJS default:

```json
{
  "statusCode": 500,
  "message": "Gagal membuka serial port: ...",
  "error": "Internal Server Error"
}
```

| Status | Kondisi |
|--------|---------|
| `400`  | Validasi body gagal (field wajib kosong, tipe salah) |
| `404`  | Pasien / exam tidak ditemukan |
| `500`  | Serial port error, Supabase error, sesi sudah berjalan |

---

## Supabase — Schema Tabel

### `patients`

```sql
CREATE TABLE patients (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name        TEXT NOT NULL,
  age         INT NOT NULL,
  gender      TEXT NOT NULL CHECK (gender IN ('male', 'female')),
  height      NUMERIC,
  weight      NUMERIC,
  notes       TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);
```

### `exams`

```sql
CREATE TABLE exams (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id       UUID REFERENCES patients(id),
  stage            INT NOT NULL CHECK (stage IN (1, 2)),
  spl              NUMERIC,
  aoe              NUMERIC,
  v_ap             NUMERIC,
  v_ml             NUMERIC,
  spl_series       JSONB,
  velocity_series  JSONB,
  cop_scatter      JSONB,
  created_at       TIMESTAMPTZ DEFAULT now()
);
```

### `exam_logs`

Tabel untuk menyimpan log error dan event penting selama sesi berlangsung. Dipakai untuk debugging saat uji coba.

```sql
CREATE TABLE exam_logs (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  exam_id     UUID,             -- nullable: bisa null jika error sebelum exam terbuat
  level       TEXT NOT NULL CHECK (level IN ('info', 'warn', 'error')),
  context     TEXT NOT NULL,    -- nama service asal log (ExamService, SerialService)
  message     TEXT NOT NULL,
  metadata    JSONB,            -- data tambahan (patientId, stage, sampleCount, dll)
  created_at  TIMESTAMPTZ DEFAULT now()
);
```

**Event yang dicatat otomatis:**

| Level   | Context        | Kondisi |
|---------|----------------|---------|
| `info`  | ExamService    | Exam berhasil dimulai |
| `info`  | ExamService    | Exam selesai (30 sampel terkumpul) + hasil metrik |
| `warn`  | ExamService    | Sampel < 2, metrik tidak bisa dihitung |
| `error` | ExamService    | Gagal insert exam ke Supabase |
| `error` | ExamService    | Gagal membuka serial port |
| `error` | ExamService    | Gagal update hasil exam ke Supabase |
| `error` | SerialService  | Error dari serial port saat exam berlangsung |

---

## Environment Variables

Buat file `.env` di root project backend:

```env
DB_URL=https://<project-id>.supabase.co
DB_PUBLISH_KEY=<anon-or-service-role-key>
SERIAL_PORT=/dev/tty.usbserial-1410
```

> `SERIAL_PORT` default ke `/dev/tty.usbserial-1410` jika tidak diset. Di Windows biasanya `COM3`, `COM4`, dst.

---

## Instalasi & Menjalankan

```bash
# Install dependencies
npm install

# Development
npm run start:dev

# Production
npm run build
npm run start:prod
```

Backend berjalan di `http://localhost:3000`.

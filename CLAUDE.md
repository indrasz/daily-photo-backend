# Postur-App — NestJS Backend (daily-photo-backend)

## Konteks Proyek

Backend NestJS untuk aplikasi **Static Posturografi** yang membaca data sensor dari **Arduino via USB Serial**, memproses metrik keseimbangan postur, dan mengirim data real-time ke frontend Next.js (`daily-photo/`).

Ini adalah konversi dari script Python `scan.py` yang sebelumnya dijalankan manual.

---

## Teknologi & Dependencies

Semua sudah terinstall di `package.json`:
- **NestJS 11** (framework)
- **serialport ^13** + **@serialport/parser-readline** — komunikasi Arduino
- **@nestjs/websockets** + **@nestjs/platform-socket.io** + **socket.io** — WebSocket real-time
- **class-validator** + **class-transformer** — validasi DTO
- **@nestjs/config** — baca `.env` via `ConfigService`
- **@supabase/supabase-js** — Supabase client untuk database

---

## Supabase Config

Credentials dibaca dari `.env`:
```
DB_URL=https://<project>.supabase.co        ← Supabase project URL
DB_PUBLISH_KEY=<anon-or-service-role-key>   ← Supabase API key
DB_CONNECT=postgresql://...                 ← direct Postgres URL (opsional, tidak dipakai JS client)
```

`SupabaseService` sudah tersedia sebagai **global provider** via `SupabaseModule` (di-import di `AppModule`).
Inject di service mana pun tanpa import ulang:
```typescript
constructor(private supabase: SupabaseService) {}
// akses: this.supabase.supabase.from('table').select()
```

### Tabel Supabase yang dibutuhkan
| Tabel | Dipakai oleh | Keterangan |
|-------|-------------|------------|
| `patients` | `PatientService` | Data pasien dari form |
| `exams` | `ExamService` | Hasil sesi scan (metrics) |

---

## Arsitektur Sistem

```
Arduino (USB Serial, 115200 baud)
       ↓ format: "DATA:x_val,y_val"
  SerialService  →  filter noise  →  emit EventEmitter
       ↓
  SensorService  →  hitung SPL, AoE, Velocity per sampel
       ↓
  ExamGateway (WebSocket)  →  emit ke frontend tiap sampel
       ↓
  ExamService              →  simpan hasil ke Supabase (tabel: exams)
       ↓
  ExamController (REST)    →  start/stop/get hasil
       ↓
  PatientService           →  simpan/baca pasien dari Supabase (tabel: patients)
       ↓
  PatientController (REST) →  simpan data pasien dari form
```

Frontend (daily-photo/) connect via:
- `POST /patients` — simpan data pasien dari halaman `/form`
- `POST /exams/start` — mulai sesi scan
- `POST /exams/stop` — hentikan sesi
- WebSocket event `start_exam` → stream `cop_sample`, `metrics_update`, `exam_complete`

---

## Logika Arduino (dari scan.py)

Arduino mengirim data via serial dengan format:
```
DATA:24.3,1.2
DATA:24.1,0.8
```
- `x` = ML CoP (Medio-Lateral), kisaran valid: `0–50 cm`
- `y` = AP CoP (Anterior-Posterior), kisaran valid: `-15` sampai `15 cm`
- Sampel pertama diperiksa lebih ketat: `x: 0–28`, `y: -3–3`
- Target: **30 sampel** (1 sampel ≈ 1 detik, karena `read_average(5)` di Arduino)

---

## Kalkulasi Metrik (dari scan.py → SensorService)

### SPL — Sway Path Length
```
diff_x = x[i] - x[i-1]
diff_y = y[i] - y[i-1]
step_distance = sqrt(diff_x² + diff_y²)
spl = cumulative_sum(step_distances)
```

### AoE — Area of Ellipse (95% Confidence Ellipse)
```
x_centered = x - mean(x)
y_centered = y - mean(y)
covariance_matrix = cov([x_centered, y_centered])
eigenvalues = eigh(covariance_matrix)
aoe = π × sqrt(5.991 × eig[0]) × sqrt(5.991 × eig[1])
```

### Velocity (V-AP dan V-ML)
```
dt = 1.0  (1 detik per sampel)
v_ml[i] = |x[i] - x[i-1]| / dt
v_ap[i] = |y[i] - y[i-1]| / dt
avg_v_ap = sum(|diff_y|) / (n_samples × dt)
avg_v_ml = sum(|diff_x|) / (n_samples × dt)
```

---

## Struktur Folder Target

```
src/
├── supabase/
│   ├── supabase.module.ts      ← @Global() module, export SupabaseService
│   └── supabase.service.ts     ← createClient(DB_URL, DB_PUBLISH_KEY)
├── serial/
│   ├── serial.module.ts
│   ├── serial.service.ts       ← buka COM port, parse DATA:x,y, filter noise
│   └── serial.config.ts        ← PORT, BAUD_RATE, SAMPEL_TARGET, batas fisik
├── sensor/
│   ├── sensor.module.ts
│   ├── sensor.service.ts       ← kalkulasi SPL, AoE, Velocity
│   └── sensor.types.ts         ← CopSample, ExamMetrics, SensorConfig
├── exam/
│   ├── exam.module.ts
│   ├── exam.controller.ts      ← POST /exams/start, POST /exams/stop, GET /exams/:id
│   ├── exam.service.ts         ← state sesi, simpan hasil ke Supabase (tabel: exams)
│   ├── exam.gateway.ts         ← WebSocket: emit tiap sampel & hasil akhir
│   └── dto/
│       └── start-exam.dto.ts
├── patient/
│   ├── patient.module.ts
│   ├── patient.controller.ts   ← POST /patients, GET /patients/:id
│   ├── patient.service.ts      ← CRUD ke Supabase (tabel: patients)
│   └── dto/
│       └── create-patient.dto.ts
├── app.module.ts
└── main.ts
```

---

## WebSocket Events

### Frontend → Backend
| Event | Payload | Keterangan |
|-------|---------|------------|
| `start_exam` | `{ patientId: string, stage: 1 \| 2 }` | Mulai scan |
| `stop_exam` | `{}` | Hentikan scan paksa |

### Backend → Frontend
| Event | Payload | Keterangan |
|-------|---------|------------|
| `cop_sample` | `{ x, y, index, total }` | Tiap sampel baru (30x) |
| `metrics_update` | `{ spl, aoe, vAP, vML }` | Metrik terkini tiap sampel |
| `exam_complete` | `{ spl, aoe, vAP, vML, splSeries, velocitySeries, copScatter }` | Hasil final |
| `exam_error` | `{ message }` | Error (port gagal buka, dll.) |

---

## REST API

| Method | Endpoint | Body | Response |
|--------|----------|------|----------|
| `POST` | `/patients` | `CreatePatientDto` | `{ id, ...data }` |
| `GET` | `/patients/:id` | — | Patient object |
| `POST` | `/exams/start` | `StartExamDto` | `{ examId }` |
| `POST` | `/exams/stop` | — | ExamMetrics final |
| `GET` | `/exams/:id` | — | Exam result |

---

## Data Types (sensor.types.ts)

```typescript
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
```

---

## CORS & Koneksi Frontend

Main.ts harus enable CORS untuk Next.js:
```typescript
app.enableCors({ origin: 'http://localhost:3001' });
```
Frontend Next.js berjalan di port 3001 (karena backend di 3000).

WebSocket socket.io client di frontend:
```typescript
const socket = io('http://localhost:3000');
```

---

## Status Saat Ini

- [x] NestJS project ter-setup
- [x] Semua dependencies terinstall
- [x] `@supabase/supabase-js` terinstall
- [x] `SupabaseModule` + `SupabaseService` — sudah dibuat (`src/supabase/`)
- [x] `ConfigModule.forRoot({ isGlobal: true })` — sudah di `app.module.ts`
- [x] `app.module.ts` — sudah import `ConfigModule` dan `SupabaseModule`
- [x] Module `serial` - sudah dibuat
- [x] Module `sensor` — sudah dibuat
- [x] Module `exam` (controller + service + gateway) — sudah dibuat
- [x] Module `patient` (controller + service) — sudah dibuat
- [x] `main.ts` — sudah diupdate (CORS, WebSocket adapter, ValidationPipe transform)

---

## Instruksi untuk Agent

Ketika diminta melanjutkan, generate dan implementasikan modul-modul di atas **satu per satu** mulai dari:
1. `sensor.types.ts` — definisi types terlebih dahulu
2. `serial/` module — baca port, filter noise
3. `sensor/` module — kalkulasi metrik
4. `exam/` module — gateway + controller + service
5. `patient/` module — CRUD pasien
6. Update `app.module.ts` dan `main.ts`

Selalu gunakan logika dari `scan.py` sebagai referensi utama kalkulasi.
Gunakan `EventEmitter2` atau NestJS built-in `EventEmitter` untuk komunikasi antar service.

### Aturan Wajib: Setiap modul yang generate data harus pakai Supabase

- **`PatientService`** — semua operasi CRUD pasien wajib via `SupabaseService`:
  ```typescript
  // insert
  await this.supabase.supabase.from('patients').insert(data).select().single();
  // select
  await this.supabase.supabase.from('patients').select('*').eq('id', id).single();
  ```

- **`ExamService`** — simpan hasil exam setelah sesi selesai:
  ```typescript
  await this.supabase.supabase.from('exams').insert({
    patient_id: patientId,
    stage: stage,
    spl, aoe, v_ap, v_ml,
    spl_series, velocity_series, cop_scatter,
    created_at: new Date().toISOString(),
  }).select().single();
  ```

- **`SupabaseService` sudah `@Global()`** — inject langsung tanpa import module:
  ```typescript
  constructor(private supabase: SupabaseService) {}
  ```

- **Selalu handle error** dari Supabase:
  ```typescript
  const { data, error } = await this.supabase.supabase.from('...').insert(...);
  if (error) throw new InternalServerErrorException(error.message);
  ```

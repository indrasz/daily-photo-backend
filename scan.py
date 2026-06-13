import serial
import numpy as np
import matplotlib.pyplot as plt

# --- CONFIG ---
PORT_ARDUINO = 'COM4'  # Port sesuai yang berhasil terhubung di Spyder lu
BAUD_RATE = 115200
SAMPEL_TARGET = 30     # 30 sampel = 30 detik data secara riil di alat lu

x_data = []
y_data = []

print(f"Mencoba koneksi di {PORT_ARDUINO}...")

try:
    ser = serial.Serial(PORT_ARDUINO, BAUD_RATE, timeout=1)
    
    # --- TAMBAHAN FIX 1: Nonaktifkan DTR/RTS Pins ---
    ser.setDTR(False)
    ser.setRTS(False)
    
    # --- TAMBAHAN FIX 2: Clear Buffer Masuk & Keluar ---
    ser.reset_input_buffer()
    ser.reset_output_buffer()
    
    print("Koneksi Berhasil! Silakan berdiri tegak di atas platform...")
    
    while len(x_data) < SAMPEL_TARGET:
        try:
            line = ser.readline().decode('utf-8', errors='ignore').strip()
            
            if "DATA:" in line:
                try:
                    # Ambil bagian setelah "DATA:"
                    raw_coords = line.split("DATA:")[1]
                    x_val, y_val = map(float, raw_coords.split(","))
                    
                    # PENGAMAN: Cek apakah koordinat masuk akal (Batas fisik alat lu)
                    # XCoP total normalnya di kisaran fw + df/2 (sekitar 24 cm)
                    if len(x_data) == 0 and (x_val < 0 or x_val > 28 or y_val < -3 or y_val > 3):
                        print("[INFO] Sampel pertama tidak stabil/noise. Otomatis diabaikan.")
                        continue  # Skip sampel acak ini, tunggu sampel berikutnya yang stabil
                    
                    # Jika koordinat menembus batas fisik platform, langsung diabaikan
                    if (x_val < 0 or x_val > 50 or y_val < -15 or y_val > 15):
                        print(f"[INFO] Data noise terdeteksi (X: {x_val} | Y: {y_val}). Otomatis diabaikan.")
                        continue  # Skip baris ini, langsung nunggu data serial berikutnya
                    
                    x_data.append(x_val)
                    y_data.append(y_val)
                    
                    print(f"[{len(x_data)}/{SAMPEL_TARGET}] Merekam -> X: {x_val} | Y: {y_val}")
                except:
                    continue
        
        except Exception as serial_error:
            print(f"\nPerekaman terputus: {serial_error}")
            break

    ser.close()
    print("Perekaman Selesai! Menyusun Grafik Sesuai Protokol 30 Detik...")

except Exception as conn_error:
    print(f"Gagal membuka Port Serial: {conn_error}")

# --- PEMROSESAN DATA & VISUALISASI 3 GRAFIK ---
if len(x_data) > 5:
    x = np.array(x_data)
    y = np.array(y_data)
    
    # dt diubah jadi 1.0 karena 1 sampel = 1 detik akibat read_average(5)
    dt = 1.0  
    time_axis = np.arange(len(x)) * dt
    
    # 1. Hitung array pergeseran dan akumulasi SPL tiap waktu
    diff_x = np.diff(x)
    diff_y = np.diff(y)
    step_distances = np.sqrt(diff_x**2 + diff_y**2)
    spl_over_time = np.zeros(len(x))
    spl_over_time[1:] = np.cumsum(step_distances)
    spl_final = spl_over_time[-1]

    # 2. Hitung Nilai Instantaneous Velocity untuk Grafik 3
    v_ml = np.zeros(len(x))
    v_ap = np.zeros(len(x))
    v_ml[1:] = np.abs(diff_x) / dt
    v_ap[1:] = np.abs(diff_y) / dt
    
    # Kecepatan rata-rata total (Total jarak dibagi total waktu 30 detik)
    avg_v_ap = np.sum(np.abs(diff_y)) / (len(x) * dt)
    avg_v_ml = np.sum(np.abs(diff_x)) / (len(x) * dt)

    # 3. Hitung Luas 95% Confidence Ellipse (AoE)
    x_centered = x - np.mean(x)
    y_centered = y - np.mean(y)
    cov = np.cov(x_centered, y_centered)
    eig_vals, _ = np.linalg.eigh(cov)
    eig_vals[eig_vals < 0] = 0
    aoe_final = np.pi * np.sqrt(5.991 * eig_vals[0]) * np.sqrt(5.991 * eig_vals[1])


    # ========================================================
    # GRAFIK 1: Sway Path Length (SPL)
    # ========================================================
    plt.figure(1, figsize=(8, 5))
    plt.plot(time_axis, spl_over_time, color='#1f77b4', marker='o', markersize=3, label='Sway Path Length')
    plt.title("Grafik 1: Sway Path Length (SPL)")
    plt.xlabel("Waktu (detik)")
    plt.ylabel("SPL (cm)")
    plt.xlim(0, 30)  # Mengunci rentang sumbu X dari 0-30 detik
    plt.grid(True, linestyle=':', alpha=0.6)
    plt.legend(loc='lower right')
    
    # Box nilai akhir di bawah grafik
    plt.gcf().text(0.15, 0.02, f"SPL Saat Ini: {spl_final:.1f} cm", 
                   fontsize=11, weight='bold', bbox=dict(facecolor='#e6f2ff', edgecolor='none', boxstyle='round,pad=0.5'))
    plt.tight_layout(rect=[0, 0.08, 1, 1])


    # ========================================================
    # GRAFIK 2: Area of Ellipse (Stabilogram)
    # ========================================================
    plt.figure(2, figsize=(8, 5))
    plt.plot(x_centered, y_centered, color='#9467bd', alpha=0.5, zorder=1)
    plt.scatter(x_centered, y_centered, color='#9467bd', s=15, label='Center of Pressure', zorder=2)
    plt.title("Grafik 2: Area of Ellipse (Stabilogram)")
    plt.xlabel("ML CoP (cm)")
    plt.ylabel("AP CoP (cm)")
    plt.axhline(0, color='black', linewidth=0.5, linestyle='--')
    plt.axvline(0, color='black', linewidth=0.5, linestyle='--')
    plt.grid(True, linestyle=':', alpha=0.6)
    plt.legend(loc='upper right')
    
    # Box nilai akhir di bawah grafik
    plt.gcf().text(0.15, 0.02, f"AoE Saat Ini: {aoe_final:.4f} cm²", 
                   fontsize=11, weight='bold', bbox=dict(facecolor='#f9f2ff', edgecolor='none', boxstyle='round,pad=0.5'))
    plt.tight_layout(rect=[0, 0.08, 1, 1])


    # ========================================================
    # GRAFIK 3: Average CoP Velocity
    # ========================================================
    plt.figure(3, figsize=(8, 5))
    plt.plot(time_axis, v_ap, color='#1f77b4', label='V-AP', alpha=0.8)
    plt.plot(time_axis, v_ml, color='#ff7f0e', label='V-ML', alpha=0.8)
    plt.title("Grafik 3: Average CoP Velocity")
    plt.xlabel("Waktu (detik)")
    plt.ylabel("Velocity (cm/s)")
    plt.xlim(0, 30)  # Mengunci rentang sumbu X dari 0-30 detik
    plt.grid(True, linestyle=':', alpha=0.6)
    plt.legend(loc='upper right')
    
    # Box nilai rata-rata di bawah grafik
    vel_text = f"V-AP Rata-rata: {avg_v_ap:.3f} cm/s          V-ML Rata-rata: {avg_v_ml:.3f} cm/s"
    plt.gcf().text(0.15, 0.02, vel_text, 
                   fontsize=10, weight='bold', bbox=dict(facecolor='#effbf3', edgecolor='none', boxstyle='round,pad=0.5'))
    plt.tight_layout(rect=[0, 0.08, 1, 1])

    # Tampilkan semua jendela grafik terpisah
    plt.show()

else:
    print("\n[Error] Data terekam terlalu sedikit untuk membuat grafik.")
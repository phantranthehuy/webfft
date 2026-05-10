# WebFFT

**WebFFT** là ứng dụng web đơn trang (SPA) chạy hoàn toàn trên trình duyệt: mô phỏng toán học **DFT/FFT** và thí nghiệm **xử lý tín hiệu âm thanh thời gian thực** (phổ, DTMF, khử nhiễu, lên dây nhạc cụ). Dữ liệu âm thanh được xử lý cục bộ, không gửi lên máy chủ.

---

## Các chức năng

| Tab | Mô tả ngắn |
|-----|------------|
| **Simulator** | Mô phỏng DFT từng bước, nhập **thực** hoặc **phức** (N cặp `re,im`), sơ đồ **bướm FFT** tương tác; KaTeX. |
| **Analyzer** | **Phân tích phổ** và **spectrogram** thời gian thực từ micro; overlay so sánh **Hann / Hamming / Blackman + FFT dsp**. |
| **DTMF Decoder** | **Phát** và **nhận dạng** tín hiệu đa tần DTMF (Dual-Tone Multi-Frequency). |
| **Noise Reduction** | Demo **khử nhiễu** kiểu trừ phổ (spectral subtraction) qua **AudioWorklet**. |
| **Instrument Tuner** | **Ước lượng cao độ** (pitch) và độ lệch **cent** từ micro, dựa trên thuật toán **YIN**. |

Ứng dụng còn hỗ trợ **PWA** (manifest + service worker), điều hướng tab bằng **URL hash**, và phím **mũi ti trái/phải** khi focus đang ở thanh tab.

---

## Cách sử dụng

### Yêu cầu môi trường

- Trình duyệt hiện đại (Chrome, Firefox, Safari, Edge).
- **HTTPS** hoặc **`localhost`** — bắt buộc để trình duyệt cho phép **microphone** (`getUserMedia`).
- **Node.js** (khuyến nghị) — chỉ cần khi chạy máy chủ tĩnh hoặc `npm test`.

### Chạy ứng dụng

Không nên mở trực tiếp file `file://` vì **ES modules** và **AudioWorklet** cần nguồn gốc HTTP(S) hợp lệ.

```bash
cd /đường/dẫn/tới/Code
npx --yes serve .
```

Hoặc:

```bash
python3 -m http.server 8080
```

Mở trình duyệt tại địa chỉ máy chủ in ra (ví dụ `http://localhost:3000` hoặc `http://localhost:8080`).

### Luồng thao tác điển hình

1. Bấm **Start Audio** ở header để khởi tạo `AudioContext` và (khi tab cần) xin quyền micro.
2. Chọn tab **Simulator**, **Analyzer**, **DTMF Decoder**, **Noise Reduction**, hoặc **Instrument Tuner** tùy mục đích.
3. **iOS / Safari:** thường phải có **cử chỉ người dùng** (bấm nút) trước khi audio/micro hoạt động ổn định — luôn bấm **Start Audio** trước khi dùng các chế độ cần micro.
4. Nếu trình duyệt **tạm dừng** `AudioContext` (tab nền, chính sách năng lượng), dùng nút **Resume audio** (xuất hiện khi cần).

### DFT Simulator: nhập thực hay phức

- **Thực:** nhập đúng **N** số (cách nhau bằng dấu phẩy hoặc khoảng trắng), ví dụ `1, 0, 0, 0`.
- **Phức:** chọn kiểu «Phức», nhập **N** cặp `re,im`; mỗi cặp trên một dòng hoặc cách nhau bằng dấu `;`. Ví dụ với N = 4: `1,0; 0,1; -1,0; 0,-1`. Phần thập phân dùng **dấu chấm** (tránh nhầm với dấu phẩy trong cặp).
- Khi tín hiệu có phần ảo khác không, phần so sánh tham chiếu với FFT radix‑2 dùng **DFT O(N²) phức** thay cho `fft()` (vì `fft()` trong dsp chỉ nhận chuỗi mẫu **thực**).

### DTMF Decoder: «Nguồn phân tích» là gì?

Đây là **chọn luồng âm thanh đi vào cùng một `AnalyserNode`** (chỗ app «lắng nghe» để vẽ FFT và giải mã):

1. **Oscillator nội bộ** — Tín hiệu phân tích là **tone do chính trang web tạo** khi bạn bấm phím DTMF (hai `OscillatorNode` hợp thành một tone, đi qua `Gain` rồi vào nhánh **tap** nối với `Analyser`). Phù hợp khi không có micro hoặc muốn demo nhanh.
2. **Micro** — Tín hiệu phân tích là **âm thanh thu từ micro** (`MediaStreamAudioSourceNode` nối vào cùng nhánh tap). Dùng khi bạn phát DTMF từ điện thoại/loa khác vào micro máy tính.

**Vì sao khi chọn micro thì bấm phím ảo không phát tone?** Để **không trộn** hai nguồn (tone nội bộ + tiếng phòng qua micro). Muốn thử phím ảo, chọn lại **Oscillator nội bộ**.

Luồng xử lý giải mã (cả hai nguồn): lấy buffer **miền thời gian** từ `Analyser` → nhân cửa sổ **Hann** → **FFT** (module `dsp`) → tìm hai đỉnh trong dải tần hàng/cột chuẩn ITU → suy ra phím.

### Điều hướng nhanh bằng URL

Sau khi chọn tab, địa chỉ cập nhật dạng `#<tên-tab>`:

| Hash | Tab |
|------|-----|
| `#simulator` | DFT Simulator |
| `#analyzer` | Spectrum Analyzer |
| `#dtmf` | DTMF Decoder |
| `#noise` | Noise Reduction |
| `#tuner` | Instrument Tuner |

Có thể dán URL có sẵn hash để mở thẳng tab tương ứng.

### Kiểm thử (unit test)

```bash
npm test
```

Chạy bộ test Node (`node --test`) cho các module DSP, dữ liệu butterfly, DTMF và YIN trong thư mục `tests/`.

### Triển khai tĩnh (ví dụ GitHub Pages)

Đưa toàn bộ nội dung repo (có `index.html` ở thư mục gốc) lên hosting tĩnh hoặc nhánh Pages. Ứng dụng dùng `manifest.json` và `sw.js` để cài đặt PWA và cache tài nguyên (kể cả một số asset từ CDN được khai báo trong service worker).

---

## Công nghệ đã sử dụng

| Hạng mục | Chi tiết |
|----------|----------|
| **Ngôn ngữ & module** | JavaScript **ES modules** (`"type": "module"` trong `package.json`), không framework UI lớn. |
| **Web Audio** | `AudioContext`, nút âm thanh, **AudioWorklet** (`pcmCapture`, `noiseReducer`) cho bắt PCM và xử lý khử nhiễu trên luồng audio. |
| **Media** | `getUserMedia` cho micro thời gian thực. |
| **DSP (tự triển khai)** | Số phức, DFT, FFT/IFFT, STFT, dữ liệu butterfly, thuật toán **YIN** cho pitch. |
| **Hiển thị toán & đồ thị** | **KaTeX** (CDN) cho công thức; **D3.js v7** (ESM qua jsDelivr) cho SVG butterfly tương tác. |
| **Giao diện** | HTML5, CSS tùy chỉnh (`assets/css/style.css`), Canvas cho phổ/spectrogram và tuner. |
| **PWA** | `manifest.json`, **Service Worker** (`sw.js`) — cache tài nguyên cục bộ và CDN cố định. |
| **Kiểm thử** | **Node.js** built-in test runner (`node --test`). |

---

## Cấu trúc thư mục

```
Code/
├── index.html              # Điểm vào SPA, tab, panel, KaTeX/CSS
├── manifest.json           # PWA: tên, icon, theme
├── sw.js                   # Service worker + danh sách cache
├── package.json            # script npm test
├── LICENSE
├── README.md
│
├── assets/
│   ├── css/
│   │   └── style.css       # Giao diện toàn app
│   └── icons/
│       ├── icon-192.png
│       └── icon-512.png
│
├── src/
│   ├── app.js              # Khởi tạo tab, hash, Start Audio, đăng ký SW
│   ├── audioEngine.js      # AudioContext dùng chung, micro, Resume UI
│   ├── dsp.js              # Re-export DFT/FFT/Complex
│   │
│   ├── dsp/                # Thuật toán DSP thuần JS
│   │   ├── complex.js
│   │   ├── dft.js
│   │   ├── fft.js
│   │   ├── stft.js
│   │   ├── butterflyData.js
│   │   └── yin.js
│   │
│   ├── audioWorklet/       # Chạy trên audio render thread
│   │   ├── pcmCapture.js
│   │   └── noiseReducer.js
│   │
│   ├── ui/                 # Logic từng chế độ + quản lý tab
│   │   ├── uiManager.js
│   │   ├── dftSimulator.js
│   │   ├── spectrumAnalyzer.js
│   │   ├── dtmfDecoder.js
│   │   ├── noiseReduction.js
│   │   └── tuner.js
│   │
│   ├── visualization/      # Canvas / SVG helpers
│   │   ├── butterflySvg.js
│   │   ├── spectrumCanvas.js
│   │   └── tunerDisplay.js
│   │
│   └── utils/
│       ├── domHelpers.js
│       └── format.js
│
└── tests/
    ├── dsp.test.js
    ├── butterflyData.test.js
    ├── dtmf.test.js
    └── yin.test.js
```

---

## Quyền riêng tư

Toàn bộ buffer âm thanh được xử lý **trên máy khách**; ứng dụng **không** gửi âm thanh lên máy chủ (thông điệp tương tự cũng có ở footer trong app).

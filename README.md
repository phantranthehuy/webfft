# WebFFT

Ứng dụng web (SPA) mô phỏng DFT/FFT và xử lý âm thanh thời gian thực trên trình duyệt: **DFT Simulator**, **Spectrum Analyzer**, **DTMF Decoder**, **Noise Reduction** (spectral subtraction), **Instrument Tuner**.

## Yêu cầu

- Trình duyệt hiện đại (Chrome, Firefox, Safari, Edge).
- **HTTPS** (hoặc `localhost`) để dùng microphone (`getUserMedia`).
- Trên iOS/Safari: bấm **Start Audio** (hoặc thao tác tương đương) trước khi phát/ghi âm.

## Chạy tĩnh

Mở `index.html` qua máy chủ tĩnh (không mở trực tiếp `file://` nếu cần ES modules / worklet):

```bash
npx --yes serve .
# hoặc: python3 -m http.server 8080
```

Truy cập `http://localhost:3000` (hoặc cổng tương ứng).

## Kiểm thử

```bash
npm test
```

Chạy unit test cho module DSP, butterfly và giải mã DTMF (`tests/*.test.js`).

## GitHub Pages

Đặt nội dung repo (gồm `index.html` ở gốc) lên nhánh/site Pages; ứng dụng dùng `manifest.json` và `sw.js` cho PWA / cache tài nguyên.

## Quyền riêng tư

Toàn bộ âm thanh được xử lý cục bộ trên máy khách; không gửi buffer lên máy chủ (xem footer trong app).

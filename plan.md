# Kế hoạch triển khai dự án (Plan.md)

## 1. Tổng quan dự án
- **Tên dự án**: WebFFT – Công cụ mô phỏng giải thuật DFT và xử lý âm thanh thời gian thực
- **Mô tả ngắn**: Xây dựng một Single Page Application (SPA) chạy trực tiếp trên trình duyệt, cho phép người dùng vừa học tập nguyên lý biến đổi Fourier rời rạc (DFT) qua mô phỏng từng bước, vừa ứng dụng FFT vào các tác vụ xử lý âm thanh thời gian thực như phân tích phổ, giải mã DTMF, lọc nhiễu và chỉnh âm nhạc cụ.
- **Công nghệ chính**: Web Audio API, JavaScript (ES6+), Canvas/Chart.js, HTML5/CSS3. Triển khai tĩnh trên GitHub Pages.
- **Đối tượng**: Sinh viên ngành Điện – Điện tử, Công nghệ thông tin, Kỹ sư DSP, người yêu thích âm thanh.

## 2. Mục tiêu
### Mục tiêu chung
- Tạo ra một công cụ trực quan, dễ tiếp cận, đa nền tảng, minh họa rõ ràng thuật toán DFT/FFT và chứng minh ứng dụng của nó trong xử lý tín hiệu âm thanh thời gian thực.

### Mục tiêu cụ thể
1. **Mô phỏng thuật toán**: Người dùng có thể nhập tín hiệu nhỏ, quan sát từng bước tính DFT (twiddle factors, nhân ma trận) và so sánh với kết quả FFT thư viện.  
   *Trang mô phỏng sẽ giúp hiểu sâu bản chất toán học bên trong DFT, làm rõ cách FFT lợi dụng tính đối xứng và tuần hoàn của các hệ số twiddle để tính DFT nhanh hơn, đồng thời minh họa trực quan cấu trúc cánh bướm (butterfly diagram) của FFT phân chia miền thời gian.*

2. **Phân tích phổ thời gian thực**: Hiển thị phổ biên độ và spectrogram từ microphone với nhiều cửa sổ và thang đo.  
   *Người dùng chọn kích thước FFT, loại cửa sổ (Hanning, Hamming) và kiểu hiển thị (bar, waterfall) để quan sát đặc trưng tần số của âm thanh môi trường hoặc giọng nói.*

3. **Giải mã DTMF**: Nhận dạng trực tiếp các phím số qua micro hoặc qua buffer nội bộ, thể hiện phát hiện tần số bằng DFT.  
   *Tín hiệu DTMF được tạo nội bộ hoặc thu từ loa ngoài, sau đó phân tích phổ để phát hiện hai tần số thành phần, từ đó suy ra phím được nhấn.*

4. **Khử nhiễu âm thanh**: Cài đặt thuật toán Spectral Subtraction dựa trên FFT/IFFT tự viết, cho phép người dùng trải nghiệm loại bỏ tiếng ồn tĩnh.  
   *Người dùng ghi lại một đoạn tiếng ồn nền, sau đó hệ thống ước lượng và trừ phổ nhiễu khỏi tín hiệu giọng nói theo thời gian thực, có thể điều chỉnh mức khử.*

5. **Bộ chỉnh âm nhạc cụ (Tuner)**: Phát hiện tần số cơ bản và hiển thị nốt nhạc tương ứng.  
   *Âm thanh từ nhạc cụ hoặc giọng hát được phân tích FFT để tìm tần số cơ bản, sau đó ánh xạ sang nốt nhạc gần nhất và hiển thị sai số (cents) giúp người dùng lên dây đàn chính xác.*

6. **Đa nền tảng**: Hoạt động đồng nhất trên Chrome, Edge, Safari, Firefox (máy tính và di động), không cần cài đặt.  
   *Người dùng chỉ cần mở trình duyệt và truy cập URL, mọi tính năng đều sử dụng ngay được nhờ thiết kế responsive và các API web chuẩn.*

## 3. Phạm vi dự án
### Trong phạm vi
- Xây dựng giao diện web responsive với 5 phần chính: 
  - Trang mô phỏng DFT (DFT Simulator)
  - Spectrum Analyzer (Real‑time)
  - DTMF Decoder
  - Noise Reduction (Spectral Subtraction)
  - Instrument Tuner  
  *Các phần này được điều hướng qua tab hoặc menu, độc lập với nhau nhưng dùng chung module xử lý số và kết nối audio.*

- Tự lập trình DFT/FFT (cả giải thuật O(N²) và FFT cơ số 2) bằng JavaScript để phục vụ mô phỏng và khử nhiễu.  
  *Module `dsp` sẽ chứa đầy đủ các hàm: DFT ngây thơ, FFT cơ số 2, cửa sổ (window), và STFT để người học thấy được sự khác biệt về tốc độ.*

- Sử dụng `AnalyserNode` cho phân tích phổ nhanh ở chế độ Analyzer và Tuner.  
  *Đây là phương pháp nhẹ nhất, tận dụng phần cứng đồ họa và bộ đệm của trình duyệt để vẽ phổ mượt mà mà không tiêu tốn CPU cho FFT.*

- Sử dụng `AudioWorkletNode` cho quá trình xử lý khử nhiễu thời gian thực (nếu cần hiệu năng cao) hoặc `ScriptProcessorNode` cho đơn giản hóa ban đầu.  
  *AudioWorklet cho phép xử lý âm thanh trên luồng riêng, tránh giật lag khi tính toán FFT/IFFT, trong khi ScriptProcessorNode dễ cài đặt hơn để prototype nhanh.*

- Tạo tín hiệu DTMF nội bộ (dùng `OscillatorNode`) để kiểm tra mà không cần thu âm.  
  *Khi chưa có micro hoặc muốn demo nhanh, người dùng có thể bấm nút trên bàn phím ảo và xem ngay kết quả giải mã.*

- Hỗ trợ xuất file âm thanh đã khử nhiễu.  
  *Sau khi xử lý, buffer âm thanh sạch có thể được ghi ra định dạng WAV để người dùng tải về hoặc so sánh.*

- Triển khai lên GitHub Pages (tĩnh).  
  *Dự án chỉ gồm HTML, CSS, JS và các asset tĩnh, không cần server, tận dụng GitHub Pages để host miễn phí với HTTPS.*

### Ngoài phạm vi
- Các thuật toán học máy, nhận dạng giọng nói, nhận dạng bài hát phức tạp.
- Nén âm thanh, triệt tiếng vọng thích nghi phức tạp.
- Xử lý đa kênh (chỉ hỗ trợ mono để đơn giản).
- Backend server; toàn bộ xử lý chỉ ở client.

## 4. Yêu cầu hệ thống
- **Chức năng**:
  - F1: Cho phép nhập tín hiệu và xem mô phỏng DFT.  
    *Người dùng nhập dãy số (thực hoặc phức), chọn độ dài DFT, hệ thống hiển thị ma trận twiddle và từng bước tính xuất ra kết quả cuối cùng.*
  - F2: Vẽ biểu đồ phổ theo thời gian thực từ microphone.  
    *Tín hiệu micro liên tục được cắt khung, áp dụng cửa sổ, tính FFT và biểu diễn trên canvas dưới dạng thanh biên độ hoặc waterfall spectrogram.*
  - F3: Phát hiện và hiển thị số đã nhấn trên bàn phím DTMF ảo.  
    *Khi người dùng click nút trên giao diện hoặc phát âm thanh từ file, chương trình phân tích phổ và ánh xạ chính xác sang ký tự tương ứng (0-9, *, #, A-D).*
  - F4: Thu mẫu nhiễu, áp dụng Spectral Subtraction và phát lại giọng đã lọc.  
    *Người dùng bấm “Sample Noise” để ghi lại 1-2 giây tiếng ồn nền, sau đó bật chế độ khử và nói vào micro, tín hiệu đầu ra sẽ giảm nhiễu rõ rệt.*
  - F5: Nhận dạng tần số cơ bản và hiển thị nốt nhạc.  
    *Một bộ đếm tần số (frequency counter) từ phổ FFT, có nội suy để đạt độ chính xác cao, hiển thị tên nốt (C, C#, D...) và sai số dưới dạng đồng hồ kim hoặc thanh lệch.*

- **Phi chức năng**:
  - Hoạt động trên các trình duyệt phổ biến (Chrome, Edge, Firefox, Safari phiên bản gần đây).
  - Giao diện thân thiện, có responsive tối thiểu cho di động.
  - Thời gian phản hồi của luồng audio dưới 100ms để đạt “thời gian thực mềm”.
  - Ứng dụng phải được phục vụ qua HTTPS (bắt buộc khi dùng `getUserMedia`).
  - Mã nguồn có cấu trúc module rõ ràng, dễ bảo trì.
  - **Bảo mật & quyền riêng tư**: Tất cả dữ liệu âm thanh chỉ xử lý tại client, không lưu trữ trên server, không gửi ra ngoài. Cam kết hiển thị rõ trong giao diện (footer).
  - **Khả năng tiếp cận (Accessibility)**: Hỗ trợ điều hướng bằng bàn phím, nhãn `aria-label` cho nút bấm, độ tương phản màu cơ bản (WCAG AA).
  - **Khả năng phục hồi lỗi**: Tự động phát hiện trạng thái `AudioContext` (suspended/closed) và cung cấp nút “Resume Audio” hoặc khởi tạo lại context; không yêu cầu reload trang.

## 5. Các bước thực hiện (kế hoạch triển khai chi tiết)
*Để đảm bảo chất lượng và dễ dàng sửa lỗi, mỗi giai đoạn dưới đây sẽ tuân theo chu trình:*
1. *Thiết kế interface (hàm, dữ liệu vào/ra) trước khi code.*
2. *Viết unit test cho module (đặc biệt với dsp).*
3. *Code và chạy test nội bộ.*
4. *Tích hợp vào nhánh chính sau khi review (nếu làm nhóm).*
5. *Demo thử và ghi nhận lỗi trước khi chuyển giai đoạn.*

*Toàn bộ mã nguồn sẽ được quản lý bằng Git, sử dụng nhánh `main` cho bản ổn định, nhánh `dev` cho phát triển chính và các nhánh feature cho từng chế độ.*

### Giai đoạn 1: Khởi tạo dự án (1 tuần)
- [ ] Chọn cấu trúc thư mục (ví dụ `src/`, `lib/`, `assets/`).  
  *Phân chia module rõ ràng: `src/dsp/` cho thuật toán, `src/audioEngine.js` quản lý Web Audio, `src/ui/` cho từng chế độ, `assets/` chứa âm thanh mẫu nếu có.*
- [ ] Thiết lập môi trường phát triển: VS Code, Git, Vite (nếu dùng framework), ESLint.  
  *Cài đặt các extension cần thiết, khởi tạo repo Git, cấu hình Vite để build module nhanh (nếu dùng JS module) hoặc quyết định dùng vanilla JS thuần túy không cần build.*
- [ ] Tạo file `index.html` cơ bản, CSS nền.  
  *Thiết lập layout chính với container cho navigation và các panel, áp dụng font chữ và màu sắc chủ đạo theo phong cách kỹ thuật.*
- [ ] Đăng ký domain GitHub Pages hoặc chọn tên repo.  
  *Tạo repository trên GitHub (public), thiết lập branch `gh-pages` hoặc dùng `/docs` để sau này deploy tự động.*
- [ ] Chuẩn hóa dữ liệu vào/ra cho module DSP (chuẩn biểu diễn complex, cấu trúc mảng tín hiệu).  
  *Thống nhất rằng tất cả tín hiệu là mảng `Float64Array` (hoặc mảng số thực), số phức dùng class `Complex` với `.re` và `.im`; tài liệu hóa ngắn gọn trong `README.md` để các module khác tuân thủ.*
- **Đầu ra**: Repository với boilerplate chạy được, hiển thị trang chủ rỗng.

### Giai đoạn 2: Xây dựng lõi xử lý DFT/FFT (2 tuần)
- [ ] Xây dựng class `Complex` và các phép toán số phức.  
  *Tạo lớp đối tượng biểu diễn số phức với các phương thức: cộng, trừ, nhân, chia, độ lớn, pha, và liên hợp.*
- [ ] Cài đặt thuật toán DFT chậm O(N²) và kiểm thử.  
  *Viết hàm `dft(signal)` duyệt hai vòng lặp lồng, tính từng hệ số X[k], so sánh kết quả với ví dụ tính tay để xác nhận đúng.*
- [ ] Cài đặt FFT cơ số 2 (Cooley-Tukey) với bit-reversal và sinh dữ liệu mô tả sơ đồ cánh bướm cho từng tầng; kiểm thử so sánh với DFT ngây thơ và với thư viện chuẩn.  
  *Hàm `fft(signal)` đệ quy hoặc lặp, kèm sắp xếp đảo bit, chỉ nhận mảng có độ dài lũy thừa 2; kiểm tra độ chính xác với nhiều tín hiệu test (sin, xung, ngẫu nhiên).*
- [ ] Viết hàm `STFT` (Short-Time Fourier Transform) để tạo spectrogram.  
  *Chia tín hiệu thành các khung chồng lấn, áp dụng cửa sổ, gọi FFT cho từng khung, trả về ma trận phổ theo thời gian.*
- [ ] Xây dựng hàm `generateButterflyData(N, type)` để sinh cấu trúc dữ liệu mô tả sơ đồ cánh bướm.  
  *Hàm này trả về danh sách các stage, mỗi stage chứa các butterfly (cặp nút trên‑dưới, hệ số twiddle, dấu trừ) phục vụ cho việc vẽ SVG ở bước sau.*
- [ ] Đóng gói thành module `dsp`.  
  *Xuất các hàm với interface rõ ràng:*
  - `dft(signal: Float64Array): Complex[]` – DFT O(N²).
  - `fft(signal: Float64Array): Complex[]` – FFT cơ số 2, chỉ nhận độ dài lũy thừa 2.
  - `ifft(spectrum: Complex[]): Float64Array` – IFFT tương ứng.
  - `stft(signal, fftSize, hopSize, windowType): Complex[][]` – STFT với chồng lấn 50% hoặc 75%.
  - `windowFunctions` gồm `hanning(N)`, `hamming(N)`, `blackman(N)`, trả về `Float64Array`.
  *Xuất khẩu các hàm cần thiết: `dft`, `fft`, `ifft`, `stft`, `windowFunctions` (Hanning, Hamming,...) để các phần khác sử dụng.*
- [ ] Thực hiện benchmark tốc độ FFT với N=512, 1024, 2048 trên ba trình duyệt chính.  
  *Ghi lại thời gian thực thi trung bình vào file `benchmark.md`; đảm bảo dưới 5ms cho N=2048 trên máy trung bình để kịp xử lý real‑time.*
- **Đầu ra**: Module DSP hoạt động chính xác, có unit test và báo cáo tốc độ.

### Giai đoạn 3: Phát triển chế độ mô phỏng DFT (1 tuần)
- [ ] Tạo giao diện nhập mảng số thực/phức.  
  *Một textarea cho phép nhập dãy số phân cách bởi dấu phẩy, lựa chọn định dạng (chỉ phần thực hoặc cặp số thực/ảo).*
- [ ] In ra ma trận hệ số twiddle.  
  *Hiển thị bảng N x N, mỗi ô là giá trị W^(k,n) dưới dạng a+bi, giúp người học thấy được tính tuần hoàn.*
- [ ] Từng bước hiển thị phép tính nhân ma trận và kết quả cuối cùng.  
  *Cho phép nhấn nút “Step” để thấy từng vòng lặp DFT: tính cột k, hiển thị tổng tích lũy, rồi kết quả X[k].*
- [ ] Vẽ sơ đồ cánh bướm tương tác bằng SVG và D3.js.  
  *Dùng D3.js để sinh SVG từ dữ liệu `generateButterflyData(N, type)`. Quy ước:*
  - **Lưới toạ độ**: Trục ngang là các stage (cách đều 120px). Trục dọc là các wire (cách đều 40px). Mỗi cặp (stage, wire) là một nút giao cắt (vòng tròn bán kính 4px).
  - **Dây tín hiệu**: Vẽ đường ngang liên tục cho từng wire, màu xám nhạt.
  - **Butterfly**: Với mỗi butterfly giữa wire `top` và `bottom` tại stage `s`, vẽ hai đường chéo có mũi tên (dùng marker SVG `arrowhead`). Đường từ input top đến output bottom kèm nhãn “‑1” ở gần đầu mũi tên. Đường từ input bottom đến output top kèm nhãn hệ số twiddle (render bằng KaTeX, font 12px) đặt cạnh điểm giao chéo.
  - **Nhãn vào/ra**: Đầu trái ghi `x(0), x(1), …` (theo thứ tự bit-reversed nếu DIT). Đầu phải ghi `X(0), X(1), …` (thứ tự tự nhiên nếu DIT).
  - **Tuỳ chọn tương tác**: Khi rê chuột lên một butterfly, highlight đường đó bằng màu cam và hiển thị tooltip ghi rõ phép toán (vd: `A' = A + W·B`, `B' = A - W·B`).
  - Hỗ trợ zoom/pan bằng `d3.zoom()` để xem rõ N lớn (tối đa 16).
- [ ] Hỗ trợ chọn N (tối đa 16) và kiểu DIT/DIF, kết hợp KaTeX để hiển thị ký hiệu toán học \(W_N^k\).  
  *Người dùng có thể thay đổi N (giới hạn 16 để giữ rõ ràng) và chuyển đổi giữa thuật toán phân chia thời gian (DIT) và phân chia tần số (DIF); các công thức được render đẹp mắt bằng KaTeX.*
- [ ] So sánh kết quả giữa DFT ngây thơ, FFT và `fft.js` (thư viện tham khảo).  
  *Thêm một bảng so sánh kết quả và thời gian thực thi của ba phương pháp trên cùng một tín hiệu.*
- **Đầu ra**: Trang DFT Simulator hoàn chỉnh, có tính giáo dục.

### Giai đoạn 4: Tích hợp chế độ Spectrum Analyzer (1 tuần)
- [ ] Truy cập microphone bằng `getUserMedia`.  
  *Yêu cầu quyền micro từ người dùng, xử lý trường hợp từ chối hoặc không có thiết bị bằng thông báo thân thiện.*
- [ ] Tạo `AudioContext` và `AnalyserNode`.  
  *Kết nối luồng micro vào AnalyserNode, cấu hình `fftSize` (1024, 2048...), tần suất lấy mẫu mặc định theo AudioContext.*
- [ ] Dùng `requestAnimationFrame` để vẽ phổ lên canvas (bar chart và waterfall).  
  *Mỗi frame animation, gọi `getByteFrequencyData()` để lấy mảng biên độ, vẽ các cột màu lên canvas; chế độ waterfall vẽ từng dòng phổ từ dưới lên.*
- [ ] Cho phép chọn kích cỡ FFT, cửa sổ (Hanning, Hamming…), thang đo.  
  *Thêm dropdown cho fftSize, loại cửa sổ (analyser thường không có cửa sổ, nhưng có thể vẽ minh họa ảnh hưởng của cửa sổ khi dùng dsp riêng), và chuyển đổi giữa thang tuyến tính/logarithmic.*
- **Đầu ra**: Analyzer hoạt động mượt trên cả desktop và mobile.

### Giai đoạn 5: Chế độ DTMF Decoder (1.5 tuần)
- [ ] Thiết kế bàn phím DTMF ảo (HTML/CSS).  
  *Tạo lưới 4x4 phím (1..9, 0, *, #, A..D) với hiệu ứng khi nhấn, mô phỏng bàn phím điện thoại cổ điển.*
- [ ] Tạo âm thanh DTMF bằng `OscillatorNode` (hai tần số mỗi phím).  
  *Khi bấm một nút, nối hai OscillatorNode (tần số thấp và cao) thông qua GainNode để tạo âm thanh DTMF chuẩn, tự động dừng sau khoảng 100ms.*
- [ ] Thu tín hiệu từ buffer (hoặc qua ScriptProcessor) và áp dụng DFT để tìm hai đỉnh tần số.  
  *Lấy một buffer có độ dài phù hợp, áp dụng cửa sổ, tính FFT, sau đó tìm các đỉnh phổ và khớp với cặp tần số đã định nghĩa.*
- [ ] So khớp với bảng tần số và hiển thị kết quả.  
  *Dùng bảng tra cứu 4x4 (tần số thấp và cao) để suy ra ký tự, hiển thị số đó trên màn hình và có thể lưu lại chuỗi đã nhận dạng.*
- [ ] Hỗ trợ giải mã từ micro thật.  
  *Cho phép người dùng dùng điện thoại khác hoặc loa phát DTMF, thu qua micro, xử lý real-time và giải mã.*
- [ ] Bảng tần số DTMF và quy tắc phát hiện.  
  *Tần số hàng: 697, 770, 852, 941 Hz; tần số cột: 1209, 1336, 1477, 1633 Hz. Để phát hiện, tìm 2 đỉnh biên độ lớn nhất sau FFT. Nếu cả hai nằm trong dung sai ±1.5% và chênh lệch biên độ không quá 10 dB thì xác nhận phím. Khoảng cách tối thiểu giữa hai lần nhấn là 80 ms để tránh dội.*
- **Đầu ra**: Nhấn nút ảo, nghe âm và hiển thị đúng số.

### Giai đoạn 6: Chế độ Noise Reduction (2 tuần)
- [ ] Giao diện: nút “Sample Noise”, thanh điều chỉnh hệ số alpha.  
  *Thiết kế panel đơn giản với nút bấm để ghi nhiễu, thanh trượt alpha (điều khiển mức trừ nhiễu), và đồng hồ trạng thái.*
- [ ] Ghi buffer nhiễu, tính phổ nhiễu trung bình (FFT tự viết).  
  *Sử dụng ScriptProcessorNode hoặc AudioWorklet để ghi N mẫu nhiễu (ví dụ 2048), tính FFT, lấy biên độ và lưu trung bình phổ nhiễu.*
- [ ] Thiết lập `AudioWorkletProcessor` (hoặc `ScriptProcessorNode`) để xử lý real-time:  
  *Tạo một AudioWorklet với buffer kích thước 512/1024 mẫu, bên trong gọi `process(inputs, outputs)` để đọc dữ liệu vào.*
  - Lấy buffer, cửa sổ, FFT.  
    *Mỗi khung được nhân với cửa sổ Hanning trước khi tính FFT bằng module `dsp`.*
  - Trừ phổ (spectral subtraction).  
    *Với mỗi khung tín hiệu, tính phổ biên độ |X(k)|. Phổ nhiễu ước lượng |N(k)| là trung bình của 5‑10 khung nhiễu. Thực hiện trừ: |S(k)| = max(0, |X(k)| - α·|N(k)|) với α (hệ số oversubtraction) từ 2‑4, mặc định 2. Pha giữ nguyên. Sau đó kết hợp với pha gốc để tạo phổ phức mới trước IFFT. Thêm noise floor -60 dB để tránh musical noise.*
  - IFFT, overlap-add, xuất ra loa.  
    *Biến đổi ngược FFT để lấy tín hiệu miền thời gian, sau đó overlap-add 50% để tránh artifact và xuất ra kênh output.*
- [ ] Thêm nút “Record & Save” cho phép lưu âm thanh đã xử lý.  
  *Kết nối một MediaStreamDestination sau node xử lý, dùng MediaRecorder để ghi lại một đoạn, rồi xuất file WAV tải về.*
- [ ] Kiểm tra và chống clipping sau overlap‑add.  
  *Sau khi IFFT và cộng chồng tín hiệu, quét biên độ mẫu; nếu vượt [-1, 1] thì normalize toàn bộ buffer trước khi xuất ra loa, đồng thời hiển thị cảnh báo cho người dùng.*
- **Đầu ra**: Người dùng nói vào mic, tiếng ồn giảm rõ rệt khi bật chế độ khử nhiễu.

### Giai đoạn 7: Chế độ Instrument Tuner (1 tuần)
- [ ] Thu tín hiệu micro qua `AnalyserNode`.  
  *Sử dụng một AnalyserNode riêng, cấu hình fftSize lớn (4096 hoặc 8192) để tăng độ phân giải tần số.*
- [ ] Thực hiện FFT, phát hiện đỉnh tần số cơ bản (dùng parabolic interpolation).  
  *Dùng AnalyserNode với fftSize 4096. Tìm đỉnh biên độ lớn nhất trong dải 60‑2000 Hz. Dùng nội suy parabol trên 3 bin lân cận để ước lượng tần số chính xác đến 0.1 Hz. Nếu tín hiệu yếu (dưới ngưỡng -40 dB), bỏ qua và giữ kết quả trước đó.*
- [ ] Ánh xạ tần số sang nốt nhạc (A4=440Hz), hiển thị sai số (cents).  
  *Tính số cents lệch giữa tần số đo và tần số chuẩn của nốt gần nhất, hiển thị tên nốt và vạch báo lệch (âm/dương).*
- [ ] Vẽ đồng hồ đo analog hoặc indicator đơn giản.  
  *Dùng canvas để vẽ kim chỉ hoặc thanh ngang hiển thị sai số dạng đồng hồ đo tần số, giúp người dùng dễ căn chỉnh.*
- **Đầu ra**: Khi đàn guitar hoặc giọng hát, màn hình hiển thị đúng tên nốt và sai số.

### Giai đoạn 8: Tích hợp tổng thể và hoàn thiện giao diện (1 tuần)
- [ ] Tạo navigation bar hoặc tab chuyển chế độ.  
  *Thanh điều hướng trên cùng hoặc bên trái với các biểu tượng, nhấn vào sẽ ẩn/hiện panel tương ứng, giữ nguyên trạng thái audio context chung.*
- [ ] Triển khai cơ chế dừng/khởi động lại audio khi chuyển tab.  
  *Trong `uiManager.js`, mỗi chế độ xuất ra hàm `enter()` và `exit()`. Khi rời chế độ (exit), gọi `disconnect()` tất cả node, dừng `requestAnimationFrame`, xóa buffer. Nếu không còn chế độ nào cần micro, gọi `audioContext.suspend()` để tiết kiệm pin. Khi vào lại (enter), khởi tạo lại node cần thiết và `resume()` context.*
- [ ] Đảm bảo giao diện responsive (dùng CSS Flexbox/Grid, media queries).  
  *Kiểm tra trên các kích thước màn hình khác nhau, điều chỉnh bố cục sao cho các nút bấm và biểu đồ không bị vỡ trên mobile.*
- [ ] Tối ưu trải nghiệm người dùng (loading states, thông báo lỗi nếu không có micro).  
  *Hiển thị spinner khi khởi tạo, cảnh báo rõ ràng nếu người dùng chưa cấp quyền micro hoặc trình duyệt không hỗ trợ.*
- [ ] Đóng gói thành PWA (service worker, manifest) để có thể cài đặt trên điện thoại.  
  *Tạo file `manifest.json` với tên app, icon, màu sắc; viết service worker cơ bản để cache tài nguyên và cho phép hoạt động offline một phần.*
- **Đầu ra**: Sản phẩm hoàn chỉnh, chạy mượt trên các chế độ.

### Giai đoạn 9: Kiểm thử và sửa lỗi (1 tuần)
- [ ] Kiểm tra trên Chrome, Firefox, Safari, Edge (desktop và mobile).  
  *Thực hiện các kịch bản test: mở từng chế độ, cấp quyền micro, chuyển tab liên tục, kiểm tra lỗi hiển thị và chức năng trên mỗi trình duyệt.*
- [ ] Kiểm tra hiệu năng (frame rate khi vẽ phổ, độ trễ audio).  
  *Dùng DevTools Performance để đo FPS khi vẽ waterfall, đo độ trễ audio qua feedback loop hoặc ước tính buffer delay, đảm bảo dưới 100ms.*
- [ ] Phát hiện và sửa các lỗi memory leak (đặc biệt với AudioContext và worker).  
  *Kiểm tra xem sau thời gian dài chạy, bộ nhớ có tăng không; đảm bảo đóng các node audio không dùng và release buffer đúng cách.*
- [ ] Nhờ người dùng thử nghiệm, thu thập phản hồi.  
  *Đưa cho 2-3 người dùng không chuyên test thử, ghi nhận các khó khăn hoặc lỗi phát sinh để sửa.*
- **Đầu ra**: Phiên bản ổn định, không lỗi nghiêm trọng.

### Giai đoạn 10: Triển khai và viết tài liệu (1 tuần)
- [ ] Deploy lên GitHub Pages, kiểm tra HTTPS.  
  *Push code lên branch `main`, cấu hình GitHub Pages trỏ vào thư mục gốc hoặc `/docs`, xác nhận truy cập được qua `https://<username>.github.io/<repo>`.*
- [ ] Viết README chi tiết, hướng dẫn sử dụng.  
  *Mô tả dự án, cách cài đặt (nếu tự host), hướng dẫn sử dụng từng chế độ kèm ảnh chụp màn hình, liệt kê công nghệ và cấu trúc mã nguồn.*
- [ ] Tạo video demo (tuỳ chọn).  
  *Quay màn hình thao tác các chế độ, giới thiệu tính năng, có thể lồng giọng thuyết minh để tăng tính thuyết phục.*
- [ ] Chuẩn bị báo cáo, slide bảo vệ.  
  *Soạn báo cáo mô tả cơ sở lý thuyết (DFT, FFT, spectral subtraction), kiến trúc hệ thống, kết quả đạt được và hướng phát triển; làm slide ngắn gọn để trình bày.*
- **Đầu ra**: Link truy cập công khai, tài liệu hoàn chỉnh.

## 6. Công nghệ và công cụ
- **Frontend**: HTML5, CSS3, JavaScript ES6+, React (tùy chọn, nếu muốn quản lý state phức tạp) hoặc Vanilla JS.  
  *Dùng Vanilla JS để giảm phụ thuộc, nhưng có thể chọn React nếu nhóm quen thuộc và muốn tổ chức component rõ ràng; Vite được dùng để đóng gói và tối ưu.*
- **Audio**: Web Audio API (`AudioContext`, `MediaStreamSource`, `AnalyserNode`, `AudioWorkletNode`).  
  *Đây là API lõi, cung cấp đồ thị xử lý âm thanh, cho phép kết nối các node và truy xuất dữ liệu mẫu trực tiếp.*
- **Đồ họa**: Canvas API cho vẽ phổ, Chart.js cho biểu đồ đơn giản (nếu cần), D3.js cho waterfall và vẽ sơ đồ cánh bướm, KaTeX để render ký hiệu toán học (twiddle factors).  
  *Canvas 2D là lựa chọn hiệu năng cao cho vẽ thời gian thực; D3.js giúp xây dựng waterfall đẹp và tương tác, đồng thời vẽ sơ đồ cánh bướm dễ dàng hơn.*
- **Tính toán**: Module DSP tự viết (`dsp`), có thể tham khảo `fft.js` để kiểm tra chéo.  
  *Việc tự cài đặt DFT/FFT giúp hiểu sâu thuật toán; thư viện `fft.js` được dùng để đối chiếu kết quả và đo hiệu năng.*
- **Build & Deploy**: Vite, Git, GitHub Pages, Workbox (cho PWA).  
  *Quy trình CI/CD cơ bản: push lên `dev` kích hoạt preview (nếu dùng Netlify/Vercel), merge vào `main` sẽ deploy tự động lên GitHub Pages.*
- **Quản lý chất lượng**: ESLint (kiểm tra code style), Jest (unit testing), Lighthouse (audit), `tests/fixtures/` để kiểm thử DSP.
- **Kiểm thử**: Browser DevTools, Lighthouse.  
  *DevTools dùng để debug audio, kiểm tra memory, profile hiệu năng; Lighthouse cho điểm PWA và performance.*

## 7. Kiến trúc hệ thống dự kiến
```
┌─────────────────────────────────────────────┐
│             Giao diện người dùng               │
│  (Navbar: Simulator | Analyzer | DTMF |       │
│   NoiseReduction | Tuner)                     │
└─────────────────┬───────────────────────────┘
                  │
    ┌─────────────▼──────────────┐
    │    AudioEngine.js           │
    │  - Khởi tạo AudioContext    │
    │  - Quản lý stream micro    │
    │  - Kết nối các node Web Audio│
    └───┬──────────┬─────────────┘
        │          │
        ▼          ▼
 ┌──────────┐  ┌───────────────┐
 │ Analyzer │  │  CustomProcessor│ (AudioWorklet)
 │ (FFT sẵn)│  │  - FFT/IFFT      │
 └──────────┘  │  - Spectral Sub  │
               └─────┬─────────┘
                     │
               ┌─────▼─────┐
               │  dsp.js   │
               │  DFT/FFT/ │
               │  Window   │
               └───────────┘
                     │
               ┌─────▼─────┐
               │  Visualizer│ (Canvas / Chart.js)
               └───────────┘
```
*AudioEngine chịu trách nhiệm khởi tạo và quản lý AudioContext; các chế độ chỉ việc kết nối vào các node cần thiết. dsp cung cấp các phép biến đổi không phụ thuộc Web Audio, trong khi Visualizer đọc kết quả và vẽ lên canvas.*

- Tất cả chạy trên một trang duy nhất, chuyển chế độ bằng JavaScript (ẩn/hiện các panel).

## 8. Cấu trúc mã nguồn và nguyên tắc module hóa
Mục tiêu: tổ chức code thành các module độc lập, giảm phụ thuộc, dễ kiểm thử và bảo trì.

### Cây thư mục dự kiến
```
webfft/
├── index.html                  # Trang chính, layout
├── manifest.json               # PWA manifest
├── sw.js                       # Service worker (cache)
├── assets/
│   ├── css/
│   │   └── style.css           # CSS toàn cục và responsive
│   ├── icons/                  # Icon cho PWA
│   └── samples/                # File audio mẫu (nếu có)
├── src/
│   ├── app.js                  # Khởi tạo ứng dụng, điều phối chế độ
│   ├── audioEngine.js          # Quản lý AudioContext, stream micro
│   ├── dsp/
│   │   ├── complex.js          # Lớp số phức
│   │   ├── dft.js              # DFT O(N^2)
│   │   ├── fft.js              # FFT cơ số 2, DIT/DIF
│   │   ├── stft.js             # STFT, window functions
│   │   └── butterflyData.js    # Hàm generateButterflyData()
│   ├── ui/
│   │   ├── uiManager.js        # Ẩn/hiện panel, điều hướng
│   │   ├── dftSimulator.js     # Giao diện mô phỏng DFT + cánh bướm
│   │   ├── spectrumAnalyzer.js # Máy phân tích phổ
│   │   ├── dtmfDecoder.js      # Bàn phím và giải mã DTMF
│   │   ├── noiseReduction.js   # Giao diện khử nhiễu
│   │   └── tuner.js            # Giao diện tuner
│   ├── visualization/
│   │   ├── butterflySvg.js     # Vẽ sơ đồ cánh bướm bằng D3.js/SVG
│   │   ├── spectrumCanvas.js   # Vẽ phổ lên Canvas
│   │   └── tunerDisplay.js     # Vẽ đồng hồ tuner
│   └── utils/
│       ├── domHelpers.js       # Tiện ích DOM
│       └── format.js           # Định dạng số, tần số, note...
├── tests/
│   ├── fixtures/               # File audio mẫu để kiểm thử DSP
│   │   ├── dtmf_1.wav          # DTMF phím 1
│   │   ├── noise_white.wav     # Tiếng ồn trắng
│   │   ├── tone_440hz.wav      # Sin chuẩn 440 Hz
│   │   └── voice_sample.wav    # Giọng nói mẫu
│   ├── dsp.test.js
│   ├── butterflyData.test.js
│   └── dtmf.test.js
└── docs/                       # Tài liệu bổ sung (nếu cần)
```

### Nguyên tắc module hóa
- **Mỗi file chỉ đảm nhiệm một trách nhiệm**: `fft.js` chỉ tính FFT, không vẽ giao diện; `butterflySvg.js` chỉ nhận dữ liệu và vẽ SVG.
- **Giao tiếp qua interface rõ ràng**: Các module dsp xuất hàm thuần túy; module ui gọi đến audioEngine và dsp.
- **Không dùng biến toàn cục**: Sử dụng module pattern (ES6 modules) hoặc IIFE, truyền phụ thuộc qua tham số.
- **Dễ kiểm thử**: Các hàm xử lý số (dsp) hoàn toàn có thể test tự động mà không cần trình duyệt.
- **Quản lý trạng thái khi chuyển chế độ**: Khi người dùng chuyển tab (Simulator, Analyzer, DTMF…), `uiManager.js` phải gọi `disconnect()` tất cả node audio không dùng, reset buffer, và chỉ giữ `AnalyserNode` nếu còn dùng real‑time. Điều này tránh rò rỉ bộ nhớ và giảm tải CPU.
## 9. Rủi ro và biện pháp đối phó
| Rủi ro | Mức độ | Giải pháp dự phòng |
|--------|--------|-------------------|
| **FFT JavaScript tự viết không đủ nhanh để xử lý real‑time (khử nhiễu)** | Cao | Sử dụng `AudioWorklet` + tối ưu code (precompute sin/cos, unroll loop). Nếu vẫn chậm, giảm kích thước buffer (512 mẫu). Phương án cuối: dùng WebAssembly cho FFT. |
| **Trình duyệt không hỗ trợ `AudioWorklet` (các trình duyệt cũ)** | Trung bình | Ban đầu dùng `ScriptProcessorNode` (deprecated nhưng vẫn hoạt động), ghi chú khuyến nghị trình duyệt mới. |
| **Quyền truy cập micro bị từ chối** | Thấp | Hiển thị thông báo hướng dẫn mở quyền, cung cấp chế độ offline (dùng file audio mẫu). |
| **Hiệu suất vẽ phổ trên di động yếu** | Trung bình | Giảm tần suất vẽ (dùng `requestAnimationFrame` vẫn được nhưng skip frame nếu cần), giảm điểm FFT hiển thị (ví dụ 1024 thay vì 4096). |
| **Không triển khai được PWA do thiếu service worker hoặc HTTPS** | Thấp | GitHub Pages luôn có HTTPS, service worker có thể tham khảo mẫu đơn giản từ Workbox. |
| **Độ trễ audio quá cao (cảm giác vọng)** | Trung bình | Chọn `AudioContext` sample rate phù hợp, giảm buffer (256/512), kiểm tra các xử lý đồng bộ. |
| **Sample rate không đồng nhất giữa các trình duyệt** (44.1kHz vs 48kHz) dẫn đến sai tần số DTMF/Tuner | Trung bình | Luôn đọc `audioContext.sampleRate` thực tế, tính lại bin width theo runtime. |
| **iOS/Safari yêu cầu cử chỉ người dùng (gesture) trước khi khởi tạo AudioContext** | Cao | Thêm nút “Start Audio” trên giao diện; chỉ khởi tạo context sau khi người dùng click. Hiển thị hướng dẫn rõ ràng. |
| **ScriptProcessorNode bị throttled hoặc deprecated gây độ trễ cao** | Trung bình | Ưu tiên `AudioWorkletNode` cho khử nhiễu; nếu trình duyệt không hỗ trợ, tự động chuyển sang `ScriptProcessorNode` và tăng buffer size lên 2048 mẫu. |
| **Khử nhiễu tạo “musical noise” (tiếng lạ như nhạc nước)** | Thấp | Áp dụng smoothing phổ (trung bình động EMA) cho ước lượng nhiễu và đặt noise floor tối thiểu (-60dB) trước khi trừ. |
| **DTMF bị nhiễu chéo trong môi trường ồn** | Trung bình | Kết hợp band‑pass filter cho 8 tần số DTMF và kiểm tra tỉ lệ biên độ giữa hai đỉnh (peak ratio) để loại bỏ nhiễu ngẫu nhiên. |

## 10. Tiêu chí đánh giá thành công
- ✅ 100% các chế độ hoạt động đúng chức năng trên Chrome, Firefox, Safari (phiên bản mới nhất).
- ✅ Kết quả mô phỏng DFT khớp chính xác với công thức toán học và thư viện chuẩn.
- ✅ DTMF decoder nhận dạng đúng ít nhất 95% trong môi trường ít nhiễu.
- ✅ Chức năng khử nhiễu cải thiện SNR ít nhất 5dB với nhiễu tĩnh mô phỏng.
- ✅ Tuner cho sai số dưới ±2 cents đối với tín hiệu sin đơn.
- ✅ Ứng dụng tải và chạy trong dưới 3 giây trên kết nối 4G.
- ✅ Điểm Lighthouse Performance > 70, Accessibility > 90.

## 11. Phụ lục
- Sơ đồ thuật toán DFT, sơ đồ cánh bướm của FFT (DIT và DIF), Spectral Subtraction.  
  *Các lưu đồ hoặc sơ đồ khối sẽ được vẽ và đính kèm trong báo cáo để minh họa rõ các bước biến đổi.*
- Sơ đồ cây thư mục (xem mục 8) và mô tả vai trò từng file.
- Bảng phân công công việc (nếu làm nhóm).  
  *Liệt kê nhiệm vụ từng giai đoạn, người phụ trách, thời hạn, và mức độ ưu tiên.*
- Danh sách các nguồn tham khảo: Web Audio API specification, Alan V. Oppenheim “Discrete-Time Signal Processing”, bài báo Spectral Subtraction (Boll 1979).
- Bảng tra cứu tần số nốt nhạc (A4 = 440 Hz, dải từ C3 đến B5) dùng cho Tuner.  
  *Các tần số được tính theo công thức \(f = 440 \times 2^{(n-69)/12}\) với n là MIDI note number. Kèm theo bảng liệt kê tên nốt và tần số tương ứng để dễ tham chiếu khi code.*
  *Các tài liệu này cung cấp cơ sở lý thuyết vững chắc và hướng dẫn triển khai thực tế.*
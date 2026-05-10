# Template Báo Cáo / Đồ Án — BKU (Bách Khoa TP.HCM)

Template LaTeX dùng cho báo cáo, đồ án môn học tại Trường ĐH Bách Khoa TP.HCM.

---

## Yêu cầu

Cài đặt một trong hai bộ sau (chọn 1):

| Bộ | Hệ điều hành | Link |
|---|---|---|
| **TeX Live** | Windows / Linux / macOS | https://www.tug.org/texlive/ |
| **MiKTeX** | Windows | https://miktex.org/ |

> Nếu dùng **VS Code**, cài thêm extension **LaTeX Workshop** để biên dịch và xem PDF ngay trong editor.

---

## Cấu trúc thư mục

```
template/
├── bkureport.cls       ← Class chứa toàn bộ style (KHÔNG cần chỉnh)
├── main.tex            ← File chính — CHỈ CẦN CHỈNH FILE NÀY khi bắt đầu
├── bia.tex             ← Trang bìa
├── loicamon.tex        ← Lời cảm ơn
├── tomtat.tex          ← Tóm tắt đề tài
├── viettat.tex         ← Danh mục chữ viết tắt
├── chap1.tex           ← Mẫu Chương 1 (nhân bản để có chap2, chap3, …)
├── ketluan.tex         ← Kết luận
├── tlthamkhao.tex      ← Tài liệu tham khảo
└── images/
    └── logo-bku.png    ← Logo trường (thay bằng logo khoa nếu cần)
```

---

## Bắt đầu với báo cáo mới

### Bước 1 — Copy template

Sao chép **toàn bộ** thư mục `template/` ra vị trí mới, ví dụ:

```
MyProject/
├── bkureport.cls
├── main.tex
├── ...
```

> **Lưu ý:** File `bkureport.cls` phải nằm **cùng thư mục** với `main.tex`.

---

### Bước 2 — Điền thông tin vào `main.tex`

Mở `main.tex`, tìm phần **CẤU HÌNH** ở đầu file và chỉnh 6 dòng:

```latex
\newcommand{\BKUsubject}{Đồ án môn học 2}   % Tên môn / loại báo cáo
\newcommand{\TenDeTai}{TÊN ĐỀ TÀI}          % Tiêu đề hiển thị trên bìa
\newcommand{\TenGVHD}{Tên Giảng Viên}        % Giảng viên hướng dẫn
\newcommand{\TenSVTH}{Họ và Tên Sinh Viên}   % Sinh viên thực hiện
\newcommand{\MSSV}{2xxxxxxx}                 % Mã số sinh viên
\newcommand{\NgayBaoCao}{tháng 1 năm 2026}   % Tháng năm nộp báo cáo
```

Các thông tin này sẽ tự động xuất hiện trên **trang bìa** và **lời cảm ơn** — không cần chỉnh hai file đó.

---

### Bước 3 — Viết nội dung

Mỗi phần báo cáo nằm trong một file `.tex` riêng:

| File | Nội dung cần điền |
|---|---|
| `tomtat.tex` | Tóm tắt đề tài (1–2 đoạn) |
| `viettat.tex` | Thêm/xóa chữ viết tắt vào bảng |
| `chap1.tex` | Nội dung Chương 1 |
| `ketluan.tex` | Kết quả và hướng phát triển |
| `tlthamkhao.tex` | Danh sách tài liệu tham khảo |

**Thêm chương mới:**

1. Tạo file `chap2.tex` (sao chép từ `chap1.tex`)
2. Mở `main.tex`, thêm dòng `\include{chap2}` sau `\include{chap1}`

---

### Bước 4 — Thêm hình ảnh

Đặt file ảnh vào thư mục `images/`, sau đó dùng lệnh:

```latex
\begin{figure}[h]
    \centering
    \includegraphics[width=0.8\textwidth]{images/ten-anh.png}
    \caption{Chú thích hình}
    \label{fig:ten-anh}
\end{figure}
```

---

### Bước 5 — Biên dịch

Class `bkureport` dùng gói **fontspec** → phải biên dịch bằng **LuaLaTeX** hoặc **XeLaTeX**. **`pdflatex` không dùng được** (sẽ báo lỗi kiểu *fontspec requires either XeTeX or LuaTeX*).

**Dùng VS Code (LaTeX Workshop):**
- Đặt recipe/build mặc định là **LuaLaTeX** (hoặc XeLaTeX) cho thư mục báo cáo.
- Nhấn `Ctrl+Alt+B` để build
- Nhấn `Ctrl+Alt+V` để xem PDF

**Dùng terminal (LuaLaTeX — khuyến nghị):**
```bash
lualatex main.tex
lualatex main.tex   # chạy 2 lần để mục lục cập nhật đúng
```

**Tuỳ chọn:** `latexmk -lualatex main.tex` (hoặc `xelatex main.tex` hai lần nếu bạn thích XeLaTeX).

> Nếu bị lỗi thiếu package, MiKTeX sẽ tự tải về. Với TeX Live, chạy `tlmgr install <tên-package>`.

---

## Các lệnh LaTeX hay dùng

```latex
% In đậm
\textbf{chữ in đậm}

% In nghiêng
\textit{chữ in nghiêng}

% Danh sách gạch đầu dòng
\begin{itemize}
    \item Mục 1
    \item Mục 2
\end{itemize}

% Danh sách đánh số
\begin{enumerate}
    \item Mục 1
    \item Mục 2
\end{enumerate}

% Chèn bảng đơn giản
\begin{table}[h]
    \centering
    \caption{Tên bảng}
    \begin{tabular}{|c|c|c|}
        \hline
        Cột 1 & Cột 2 & Cột 3 \\ \hline
        A     & B     & C     \\ \hline
    \end{tabular}
    \label{tab:ten-bang}
\end{table}

% Tham chiếu hình/bảng
Hình \ref{fig:ten-anh} cho thấy...
Bảng \ref{tab:ten-bang} liệt kê...
```

---

## Xử lý lỗi thường gặp

| Lỗi | Nguyên nhân | Cách sửa |
|---|---|---|
| `File bkureport.cls not found` | `.cls` không cùng thư mục với `main.tex` | Đặt lại đúng vị trí |
| Mục lục/số trang sai | Chưa build đủ số lần | Chạy `lualatex` (hoặc `xelatex`) thêm 1 lần nữa |
| Lỗi fontspec / XeTeX / LuaTeX | Dùng `pdflatex` với class này | Đổi sang **LuaLaTeX** hoặc **XeLaTeX** |
| Ký tự tiếng Việt bị lỗi | Encoding file không phải UTF-8 | Lưu lại file với encoding UTF-8 |
| Hình không hiển thị | Đường dẫn ảnh sai | Kiểm tra tên file và thư mục `images/` |

---

## Lưu ý

- **Không xóa hoặc đổi tên** `bkureport.cls` — file này chứa toàn bộ định dạng.
- Khi copy template cho báo cáo mới, luôn copy **cả thư mục**, không chỉ copy `main.tex`.
- Các file `.aux`, `.log`, `.synctex.gz` sinh ra sau khi build là file tạm, có thể xóa thoải mái.

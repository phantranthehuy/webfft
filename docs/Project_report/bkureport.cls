%===============================================================
% bkureport.cls — Lớp báo cáo/đồ án BKU (Bách Khoa TP.HCM)
% Cách dùng: \documentclass[12pt,a4paper]{bkureport}
%===============================================================
\NeedsTeXFormat{LaTeX2e}
\ProvidesClass{bkureport}[2026/04/06 BKU Project Report Class]

% --- Truyền tùy chọn xuống lớp report gốc ---
\DeclareOption*{\PassOptionsToClass{\CurrentOption}{report}}
\ProcessOptions\relax
\LoadClass{report}

%===============================================================
% PACKAGES
%===============================================================
\RequirePackage{graphicx}
\RequirePackage{fancybox}
\RequirePackage{geometry}
\RequirePackage{scrextend}
\RequirePackage[hidelinks]{hyperref}
\RequirePackage{xcolor}
\RequirePackage{fancyhdr}
\RequirePackage{array}
\RequirePackage{multirow}
\RequirePackage{arydshln}
\RequirePackage{makecell}
\RequirePackage{caption}
\RequirePackage{indentfirst}
\RequirePackage{array, booktabs, multicol, siunitx, tabularx}
\RequirePackage{tikz}
\RequirePackage{fontspec}
\setmainfont{Latin Modern Roman}
\setsansfont{Latin Modern Sans}
\setmonofont{Latin Modern Mono}

\usetikzlibrary{calc}

%===============================================================
% PAGE GEOMETRY
%===============================================================
% Lề theo bkthesis.sty: trái 3cm, phải 2cm, trên 2cm, dưới 3cm
% (total={160mm,247mm}, left=30mm, top=20mm trên A4 210×297mm)
\geometry{a4paper, left=3cm, right=2cm, top=2cm, bottom=3cm}
\setlength{\headheight}{16.92604pt}
\addtolength{\topmargin}{-1.716pt}
\setlength{\headsep}{25pt}
\setlength{\dashlinedash}{0.7pt}

%===============================================================
% INDENT AFTER HEADING
%===============================================================
\makeatletter
\g@addto@macro\@afterheading{\parindent15pt}
\makeatother

%===============================================================
% PAGE STYLES
%===============================================================

% plain — trang đầu chương, front matter: chỉ số trang, không kẻ
\fancypagestyle{plain}{
	\fancyhf{}
	\fancyfoot[C]{\thepage}
	\renewcommand{\headrulewidth}{0pt}
	\renewcommand{\footrulewidth}{0pt}
}

% "Chapter" → "Chương"
\renewcommand{\chaptername}{Chương}

% Header hiển thị "Chương X. Tên chương"
\renewcommand{\chaptermark}[1]{\markboth{Chương \thechapter.\ #1}{}}

% fancy — các chương nội dung
% \BKUsubject được định nghĩa trong main.tex (vd: Đồ án môn học 2)
\providecommand{\BKUsubject}{Báo cáo}
\fancypagestyle{fancy}{
	\fancyhf{}
	\fancyhead[L]{\BKUsubject}
	\fancyhead[R]{\leftmark}
	\fancyfoot[C]{\thepage}
	\renewcommand{\headrulewidth}{1pt}
	\renewcommand{\footrulewidth}{1pt}
}

% chapter-plain — trang đầu mỗi chương có header/footer
\fancypagestyle{chapterplain}{
	\fancyhf{}
	\fancyhead[L]{\BKUsubject}
	\fancyhead[R]{\leftmark}
	\fancyfoot[C]{\thepage}
	\renewcommand{\headrulewidth}{1pt}
	\renewcommand{\footrulewidth}{1pt}
}

%===============================================================
% TABLE OF CONTENTS / LIST OF FIGURES / TABLES — tên tiếng Việt
%===============================================================
\renewcommand{\bibname}{TÀI LIỆU THAM KHẢO}
\renewcommand{\contentsname}{\Large\begin{center}\textbf{MỤC LỤC}\end{center}}
\renewcommand{\listfigurename}{\Large\begin{center}\textbf{DANH MỤC ẢNH MINH HỌA}\end{center}}
\renewcommand{\listtablename}{\Large\begin{center}\textbf{DANH MỤC BẢNG}\end{center}}

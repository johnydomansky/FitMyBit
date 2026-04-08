# FitMyBit: Image Studio

[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-v4-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![Vite](https://img.shields.io/badge/Vite-6-646CFF?logo=vite&logoColor=white)](https://vitejs.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-4fb325.svg)](https://opensource.org/licenses/MIT)

FitMyBit is a lightweight, high-performance web image editor. It is designed for developers and creators who need a fast way to manipulate images without the overhead of heavy software or external processing.

> **Privacy-First:** All image processing occurs locally in the browser. No data is ever uploaded to a server, ensuring your files remain secure and private.

---

## Core Features

* **Custom Canvas Control:** Set precise dimensions or use built-in presets for 1080p and Social Media. Supports saving custom user presets for repetitive workflows.
* **Visual Crop Tool:** Interactive canvas-based cropping with a rule-of-thirds grid and intuitive handle controls.
* **Background Engine:** Toggle between transparency, solid colors, or a modern blurred background effect generated dynamically from the source image.
* **Bulk Processing:** Apply consistent canvas settings to multiple images and export them all at once, significantly reducing manual work.
* **State Management:** Full Undo/Redo history with OS-aware keyboard shortcuts (Cmd/Ctrl + Z/Y).
* **Format Flexibility:** Export in PNG, JPEG, or WebP formats with adjustable quality control.

---

## Technical Architecture

The project focuses on a minimalist footprint with modern tooling. The entire application logic is contained within a single optimized component file.

| Technology | Role |
| :--- | :--- |
| **React 18** | UI framework and state management |
| **Tailwind CSS 4** | Utility-first styling engine |
| **Vite 6** | Build tool and fast development server |
| **Canvas API** | Native client-side image manipulation |

---

## Getting Started

### Prerequisites

* Node.js 18 or later
* npm or yarn

### Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/fitmybit-image-studio.git
```

2. Navigate to the project directory:
```bash
cd fitmybit-image-studio
```

3. Install dependencies:
```bash
npm install
```

4. Run the development server:
```bash
npm run dev
```

The application will be available at `http://localhost:5173` (or the next available port if 5173 is taken).



---

## Motivation

> This tool was developed to solve the need for a quick, browser-based utility for standardizing image sizes and formats. FitMyBit utilizes local browser resources to handle everyday image processing tasks instantly, ensuring maximum speed and data security.

---

## License

This project is licensed under the **MIT License**. See the `LICENSE` file for more details.

---

## Author

Developed by [Johny Domanský](https://johnydomansky.com/) in collaboration with **Claude Code**.

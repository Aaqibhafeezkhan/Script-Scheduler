# 🗂️ Script Scheduler (Frontend‑Only POV)

A fully front-end, browser-based script scheduler built using **vanilla JavaScript**. No backend, no frameworks—just HTML, CSS, JS, and **LocalStorage + `setTimeout`** magic.

---

## ⚙️ Key Features

### 1. 📁 Upload Form
- Drag-and-drop style file input
- Accepts `.sh` (Linux/macOS) and `.bat` (Windows) files (max 1 MB)
- Auto-fills script name from filename
- Platform selection and validation
- Real-time validation and error messages

### 2. 🕒 Scheduling Form
- Flexible frequency settings: minutes / hours / days
- Start time and optional end time pickers
- “Run immediately” option
- Full form validation with user feedback

### 3. 🔁 Persistence & Scheduling Engine
- In-memory job storage (can be replaced with `localStorage` or API calls)
- Scheduled execution using `setTimeout`
- Jobs persist across interactions
- Auto-rescheduling after page reload

### 4. 🖥️ Script Execution Simulation
- Simulates script execution with:
  - Line-by-line `> ` prefixed output
  - Random success/failure simulation
  - Duration tracking
  - Timestamped logs

### 5. 📊 Status View ("My Jobs")
- Displays all scheduled jobs with:
  - Script name, platform icon, and frequency
  - Last and next run times
  - Success/failure badge
- Action buttons:
  - `View Logs` (modal with logs)
  - `Cancel Job`
  - `Delete Job`
- Search and filter functionality
- Auto-refresh every 30 seconds

### 6. ✨ UI & UX
- Clean, responsive UI with modern **glassmorphism** design
- Soft shadows, gradients, and rounded corners
- Tabbed navigation
- Toast notifications and loading indicators
- Mobile-first layout with CSS grid and flexbox
- Semantic HTML

---

## 🧠 Technical Implementation

- ✅ 100% **Vanilla JavaScript**
- 🧩 Class-based architecture (`JobScheduler`)
- 📦 Modular design with separation of concerns
- 🔄 Event-driven UI interactions
- 🚫 No frameworks or external dependencies
- 🔧 Error handling throughout

---

## 🔧 Easily Backend-Ready

This system can be easily converted to work with a real backend by replacing:

```js
loadJobs(), saveJobs()

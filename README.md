# 🚀 CodeSync - Real-time Collaborative Code Editor

![License](https://img.shields.io/badge/License-MIT-blue.svg)
![React](https://img.shields.io/badge/Frontend-React%20%2B%20Vite-blue)
![Node.js](https://img.shields.io/badge/Backend-Node.js-green)
![Socket.io](https://img.shields.io/badge/RealTime-Socket.io-white)

> **A real-time collaborative coding platform for pair programming and technical interviews.**

**🔗 Live Demo:** [INSERT YOUR VERCEL/DEPLOYMENT LINK HERE]

---

## 📖 Overview

**CodeSync** is a lightweight, real-time code editor that allows multiple users to write, edit, and run code simultaneously in shared rooms. It mimics the experience of Google Docs but for developers. 

Built to solve the problem of remote technical interviews and pair programming, CodeSync ensures low-latency synchronization and provides an integrated compiler for multiple languages.

---

## ✨ Key Features

- **⚡ Real-time Collaboration:** Instant code syncing across all users in a room using WebSockets.
- **🏃‍♂️ Remote Code Execution:** Compile and run code in JS, Python, Java, and C++ directly in the browser.
- **🎨 Modern IDE Experience:** Syntax highlighting, auto-completion, and bracket matching using **Monaco Editor** (VS Code's core).
- **🔒 Isolated Rooms:** Generate unique Room IDs to create private coding sessions.
- **🌓 Dark Mode UI:** Developer-friendly dark interface for long coding sessions.

---

## 🏗️ System Architecture

The application follows a standard Client-Server architecture powered by **Socket.io** for bidirectional communication.



1.  **Frontend:** React.js handles the UI and captures code changes via the Monaco Editor instance.
2.  **WebSocket Layer:** Listens for `code_change` events and broadcasts them to other clients in the specific `roomId`.
3.  **Backend:** Node.js/Express server routes API requests and manages active socket connections.
4.  **Compiler:** Code execution is offloaded to the **Piston API**, which runs code in secured Docker containers to prevent server-side vulnerabilities.

---

## 🛠️ Tech Stack

| Component | Technology |
| :--- | :--- |
| **Frontend** | React.js, Vite, React Router, Hot Toast |
| **Editor** | Monaco Editor |
| **Backend** | Node.js, Express.js |
| **Real-time** | Socket.io (WebSockets) |
| **API** | Piston API (for code execution) |
| **Deployment** | Vercel (Frontend), Render/Railway (Backend) |

---

## 📸 Screenshots

| Landing Page | Collaborative Editor |
| :---: | :---: |
| ![Landing](./screenshots/landing.png) | ![Editor](./screenshots/editor.png) |

*(Note: Create a folder named `screenshots` in your repo and add your images there)*

---

## 🚀 Getting Started

Follow these steps to run the project locally.

### Prerequisites
- Node.js (v14 or higher)
- npm or yarn

### 1. Clone the Repository
```bash
git clone [https://github.com/your-username/codesync.git](https://github.com/your-username/codesync.git)
cd codesync
```
## 2. Setup Backend
```bash
cd server
npm install
npm run dev
# Server will start on port 5000
```

## 3. Setup Frontend
Open a new terminal window:

```bash

cd client
npm install
npm run dev
# App will run on http://localhost:5173

```
## 🧠 Engineering Challenges & Learnings
1. Handling Race Conditions
Challenge: When multiple users type simultaneously, updates can conflict, causing an infinite loop of updates. Solution: Implemented a socket logic where changes are broadcasted to socket.in(roomId) excluding the sender (socket.broadcast). This ensures the user typing doesn't receive their own update back.

2. Secure Remote Execution
Challenge: Allowing users to run code on the server is a security risk (e.g., infinite loops or malicious scripts). Solution: Integrated the Piston API, which executes code in ephemeral Docker containers. This keeps the main server stateless and secure.

🤝 Contributing
Contributions are welcome!

Fork the project.

Create your Feature Branch (git checkout -b feature/AmazingFeature).

Commit your changes (git commit -m 'Add some AmazingFeature').

Push to the Branch (git push origin feature/AmazingFeature).

Open a Pull Request.

📄 License
Distributed under the MIT License. See LICENSE for more information.

👤 Author
Aryan Kumar

LinkedIn: https://www.linkedin.com/in/aryan7k/

GitHub: https://github.com/aryanB1706
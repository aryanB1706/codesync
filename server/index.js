/* server/index.js - CLEAN VERSION */
const express = require('express');
const app = express();
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

app.use(cors());
app.use(express.json());

const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
    },
});

const userSocketMap = {};

io.on('connection', (socket) => {
    console.log('User Connected', socket.id);

    socket.on('join', ({ roomId, username }) => {
        userSocketMap[socket.id] = username;
        socket.join(roomId);
        const clients = getAllConnectedClients(roomId);
        clients.forEach(({ socketId }) => {
            io.to(socketId).emit('joined', {
                clients,
                username,
                socketId: socket.id,
            });
        });
    });

    // Code Sync
    socket.on('code_change', ({ roomId, code, fileName }) => {
        socket.in(roomId).emit('code_change', { code, fileName }); 
    });

    // File Creation Sync
    socket.on('file_created', ({ roomId, fileName, language, value }) => {
        socket.in(roomId).emit('file_created', { fileName, language, value });
    });

    socket.on('disconnecting', () => {
        const rooms = [...socket.rooms];
        rooms.forEach((roomId) => {
            socket.in(roomId).emit('disconnected', {
                socketId: socket.id,
                username: userSocketMap[socket.id],
            });
        });
        delete userSocketMap[socket.id];
        socket.leave();
    });
});

function getAllConnectedClients(roomId) {
    return Array.from(io.sockets.adapter.rooms.get(roomId) || []).map(
        (socketId) => {
            return {
                socketId,
                username: userSocketMap[socketId],
            };
        }
    );
}

// Simple Execute Route
app.post('/execute', async (req, res) => {
    const { files, mainFile, language } = req.body;
    if (!files || !mainFile || !language) return res.status(400).json({ error: "Missing data" });

    // Piston API Logic
    const orderedFiles = [
        { name: mainFile.name, content: mainFile.value },
        ...files.filter(f => f.name !== mainFile.name).map(f => ({ name: f.name, content: f.value }))
    ];

    try {
        const response = await axios.post('https://emkc.org/api/v2/piston/execute', {
            "language": language, "version": "*", "files": orderedFiles
        });
        res.json(response.data);
    } catch (error) {
        console.error("Exec Error:", error);
        res.status(500).json({ error: "Failed to execute code" });
    }
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
// server/index.js
const express = require('express');
const app = express();
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const axios = require('axios');

app.use(cors());
app.use(express.json());

const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*", // React ka URL
        methods: ["GET", "POST"],
    },
});

const userSocketMap = {}; // Track kaun user kahan hai

io.on('connection', (socket) => {
    console.log('User Connected', socket.id);

    // Jab koi Room Join kare
    socket.on('join', ({ roomId, username }) => {
        userSocketMap[socket.id] = username;
        socket.join(roomId);
        
        // Room mein baaki logon ko batao ki naya banda aaya hai
        const clients = getAllConnectedClients(roomId);
        clients.forEach(({ socketId }) => {
            io.to(socketId).emit('joined', {
                clients,
                username,
                socketId: socket.id,
            });
        });
    });

    // Jab code change ho
    socket.on('code_change', ({ roomId, code }) => {
        // Sender ko chhod ke baaki sabko code bhejo
        socket.in(roomId).emit('code_change', { code }); 
    });

    // Jab user disconnect ho
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

// Helper function to get all users in a room
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
app.post('/execute', async (req, res) => {
    const { code, language } = req.body;

    // Piston API ko request bhejo
    try {
        const response = await axios.post('https://emkc.org/api/v2/piston/execute', {
            "language": language,
            "version": "*",
            "files": [
                {
                    "content": code
                }
            ]
        });
        
        // Output bhejo frontend ko
        res.json(response.data);
    } catch (error) {
        console.error("Error executing code:", error);
        res.status(500).json({ error: "Failed to execute code" });
    }
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
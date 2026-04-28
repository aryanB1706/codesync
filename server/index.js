/* server/index.js - CLEAN VERSION */
const express = require('express');
const app = express();
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const axios = require('axios');
const socketHandler = require('./socket/socketHandler');
require('dotenv').config();

const JUDGE0_BASE_URL = (process.env.JUDGE0_BASE_URL || 'https://ce.judge0.com').replace(/\/$/, '');
const JUDGE0_API_KEY = process.env.JUDGE0_API_KEY || '';
const JUDGE0_API_KEY_HEADER = process.env.JUDGE0_API_KEY_HEADER || 'X-Auth-Token';
const JUDGE0_RAPIDAPI_HOST = process.env.JUDGE0_RAPIDAPI_HOST || '';
const JUDGE0_POLL_INTERVAL_MS = 700;
const JUDGE0_MAX_POLLS = 20;
const languageIds = {
    c: 50,
    cpp: 54,
    java: 62,
    javascript: 63,
    python: 71,
};

app.use(cors());
app.use(express.json());

const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
    },
});

io.on('connection', (socket) => {
    socketHandler(io, socket);
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const getJudge0Headers = () => {
    if (!JUDGE0_API_KEY) return {};
    if (JUDGE0_RAPIDAPI_HOST) {
        return {
            'X-RapidAPI-Key': JUDGE0_API_KEY,
            'X-RapidAPI-Host': JUDGE0_RAPIDAPI_HOST,
        };
    }
    return { [JUDGE0_API_KEY_HEADER]: JUDGE0_API_KEY };
};

const getLanguageId = (language) => {
    const normalized = String(language || '').toLowerCase();
    return languageIds[normalized];
};

const toPistonCompatibleResponse = (submission) => {
    const stdout = submission.stdout || '';
    const stderr = submission.stderr || '';
    const compileOutput = submission.compile_output || '';
    const message = submission.message || '';
    const status = submission.status || {};
    const output = stdout || stderr || compileOutput || message || status.description || 'No Output';

    return {
        status,
        time: submission.time,
        memory: submission.memory,
        run: {
            stdout,
            stderr: stderr || compileOutput || message,
            output,
            code: status.id === 3 ? 0 : status.id,
            signal: status.id > 3 ? status.description : null,
        },
        compile: compileOutput ? { output: compileOutput, stderr: compileOutput } : undefined,
    };
};

// Simple Execute Route
app.post('/execute', async (req, res) => {
    const { files, mainFile, language } = req.body;
    if (!files || !mainFile || !language) return res.status(400).json({ error: "Missing data" });

    const languageId = getLanguageId(language);
    if (!languageId) {
        return res.status(400).json({
            error: `Language "${language}" is not supported by the Judge0 runner yet.`,
        });
    }

    try {
        const createResponse = await axios.post(`${JUDGE0_BASE_URL}/submissions`, {
            language_id: languageId,
            source_code: mainFile.value || '',
            stdin: req.body.stdin || '',
            cpu_time_limit: 3,
            wall_time_limit: 10,
        }, {
            headers: getJudge0Headers(),
            params: { base64_encoded: false, wait: false },
            timeout: 10000,
        });

        const token = createResponse.data?.token;
        if (!token) {
            return res.status(502).json({ error: 'Judge0 did not return a submission token.' });
        }

        for (let attempt = 0; attempt < JUDGE0_MAX_POLLS; attempt += 1) {
            await sleep(JUDGE0_POLL_INTERVAL_MS);
            const resultResponse = await axios.get(`${JUDGE0_BASE_URL}/submissions/${token}`, {
                headers: getJudge0Headers(),
                params: {
                    base64_encoded: false,
                    fields: 'stdout,stderr,compile_output,message,status,time,memory,token',
                },
                timeout: 10000,
            });

            const submission = resultResponse.data;
            if (submission.status?.id > 2) {
                return res.json(toPistonCompatibleResponse(submission));
            }
        }

        return res.status(504).json({ error: 'Judge0 execution timed out while waiting for result.' });
    } catch (error) {
        const status = error.response?.status || 500;
        const judge0Error = error.response?.data?.error || error.response?.data?.message;
        const validationError = error.response?.data && typeof error.response.data === 'object'
            ? Object.entries(error.response.data)
                .map(([field, messages]) => `${field}: ${Array.isArray(messages) ? messages.join(', ') : messages}`)
                .join('; ')
            : null;
        const message = judge0Error || validationError || error.message || "Failed to execute code";

        console.error("Judge0 Exec Error:", {
            status,
            message,
            judge0: error.response?.data,
        });
        res.status(status).json({ error: message });
    }
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));

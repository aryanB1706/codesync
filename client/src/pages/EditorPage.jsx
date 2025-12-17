import React, { useEffect, useState, useRef } from 'react';
import Editor from '@monaco-editor/react';
import { io } from 'socket.io-client';
import axios from 'axios';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';

const EditorPage = () => {
    const socketRef = useRef(null);
    const location = useLocation();
    const { roomId } = useParams();
    const navigate = useNavigate();
    
    const [code, setCode] = useState("// Write your code here...");
    const [output, setOutput] = useState("");
    const [language, setLanguage] = useState("javascript");
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        if (!location.state) {
            toast.error("Username is required");
            navigate('/');
        }
    }, [location.state, navigate]);

    useEffect(() => {
        // === MOBILE FIX START ===
        const initSocket = async () => {
            socketRef.current = io('https://codesync-backend-sj9z.onrender.com', {
                // Mobile networks ke liye polling zaroori hai
                transports: ['websocket', 'polling', 'flashsocket'], 
                reconnectionAttempts: 5,
                reconnectionDelay: 1000,
                forceNew: true, // Har baar naya connection force karo
                timeout: 10000,
            });

            // Error Handling
            socketRef.current.on('connect_error', (err) => handleErrors(err));
            socketRef.current.on('connect_failed', (err) => handleErrors(err));

            function handleErrors(e) {
                console.log('socket error', e);
                toast.error('Socket connection failed, try again later.');
                navigate('/');
            }

            // Room Join
            socketRef.current.emit('join', {
                roomId,
                username: location.state?.username,
            });

            // Listen for Code Changes
            socketRef.current.on('code_change', ({ code }) => {
                if (code !== null) {
                    setCode(code);
                }
            });

            // Listen for New User Join
            socketRef.current.on('joined', ({ username, socketId }) => {
                if (username !== location.state.username) {
                    toast.success(`${username} joined the room.`);
                    // OPTIONAL: Sync code on join (Jo pehle se room me hai wo apna code nayi user ko bheje)
                    // socketRef.current.emit('sync_code', { code: codeRef.current, socketId });
                }
            });
        };

        initSocket();
        // === MOBILE FIX END ===

        return () => {
            // Cleanup: Component unmount hone par disconnect karo
            if (socketRef.current) {
                socketRef.current.disconnect();
                socketRef.current.off('code_change');
                socketRef.current.off('joined');
            }
        };
    }, []);

    const handleEditorChange = (value) => {
        setCode(value);
        if (socketRef.current) {
            socketRef.current.emit('code_change', {
                roomId,
                code: value,
            });
        }
    };

    const runCode = async () => {
        setIsLoading(true);
        try {
            const response = await axios.post('https://codesync-backend-sj9z.onrender.com/execute', {
                code: code,
                language: language
            });
            const result = response.data.run;
            setOutput(result.output || "No Output");
        } catch (error) {
            console.error(error);
            setOutput("Error: Failed to execute code.");
        } finally {
            setIsLoading(false);
        }
    };

    if (!location.state) {
        return null; 
    }

    return (
        <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#0d0d0d' }}>
            <div style={{ padding: '10px', background: '#1e1e1e', color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                    <span style={{ fontWeight: 'bold', color: '#4aed88' }}>CodeSync</span> 
                    <span style={{ marginLeft: '10px', fontSize: '14px', color: '#888' }}>Room: {roomId}</span>
                </div>
                <div style={{ display: 'flex', gap: '10px' }}>
                    <select
                        value={language}
                        onChange={(e) => setLanguage(e.target.value)}
                        style={{ padding: '5px', borderRadius: '4px' }}
                    >
                        <option value="javascript">JavaScript</option>
                        <option value="python">Python</option>
                        <option value="cpp">C++</option>
                        <option value="java">Java</option>
                    </select>
                    <button
                        onClick={runCode}
                        disabled={isLoading}
                        style={{
                            padding: '5px 15px',
                            background: '#28a745',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer'
                        }}
                    >
                        {isLoading ? "Running..." : "Run Code ▶"}
                    </button>
                    <button 
                        onClick={() => {
                            navigator.clipboard.writeText(roomId);
                            toast.success('Room ID copied');
                        }}
                        style={{ background: '#444', color: '#fff', border: 'none', padding: '5px 10px', borderRadius: '4px', cursor: 'pointer'}}
                    >
                        Copy ID
                    </button>
                </div>
            </div>

            <div style={{ display: 'flex', flex: 1 }}>
                <div style={{ flex: 2, borderRight: '1px solid #333' }}>
                    <Editor
                        height="100%"
                        theme="vs-dark"
                        language={language}
                        value={code}
                        onChange={handleEditorChange}
                        options={{ minimap: { enabled: false }, fontSize: 16 }}
                    />
                </div>
                <div style={{ flex: 1, background: '#1e1e1e', color: '#0f0', padding: '10px', fontFamily: 'monospace', overflowY: 'auto' }}>
                    <h4 style={{ marginTop: 0, color: '#888' }}>Output:</h4>
                    <pre style={{ whiteSpace: 'pre-wrap' }}>{output}</pre>
                </div>
            </div>
        </div>
    );
};

export default EditorPage;
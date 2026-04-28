import React, { useLayoutEffect, useRef } from 'react';
import { Terminal as XTerm } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';

const Terminal = ({ socket, roomId }) => {
    const terminalRef = useRef(null);

    useLayoutEffect(() => {
        if (!socket || !roomId || !terminalRef.current) return undefined;

        let isDisposed = false;
        let frameId = null;
        const host = terminalRef.current;
        const term = new XTerm({
            cursorBlink: true,
            convertEol: true,
            fontFamily: "'Fira Code', 'Cascadia Code', Consolas, monospace",
            fontSize: 13,
            scrollback: 1000,
            screenReaderMode: false,
            theme: {
                background: '#111111',
                foreground: '#d4d4d4',
                cursor: '#4aed88',
                selectionBackground: '#264f78',
                black: '#000000',
                red: '#cd3131',
                green: '#0dbc79',
                yellow: '#e5e510',
                blue: '#2472c8',
                magenta: '#bc3fbc',
                cyan: '#11a8cd',
                white: '#e5e5e5',
                brightBlack: '#666666',
                brightRed: '#f14c4c',
                brightGreen: '#23d18b',
                brightYellow: '#f5f543',
                brightBlue: '#3b8eea',
                brightMagenta: '#d670d6',
                brightCyan: '#29b8db',
                brightWhite: '#ffffff',
            },
        });
        const fitAddon = new FitAddon();

        term.loadAddon(fitAddon);
        term.open(host);

        const fitAndResize = () => {
            if (isDisposed || !host.isConnected || host.clientWidth === 0 || host.clientHeight === 0) {
                return;
            }

            try {
                fitAddon.fit();
                socket.emit('terminal:resize', {
                    roomId,
                    cols: term.cols,
                    rows: term.rows,
                });
            } catch (error) {
                console.warn('Terminal resize skipped:', error);
            }
        };

        const scheduleFit = () => {
            if (frameId) cancelAnimationFrame(frameId);
            frameId = requestAnimationFrame(() => {
                frameId = null;
                fitAndResize();
            });
        };

        const onTerminalData = (data) => {
            if (isDisposed) return;
            term.write(data);
        };

        const dataDisposable = term.onData((data) => {
            if (isDisposed) return;
            socket.emit('terminal:write', { roomId, data });
        });

        const focusDisposable = term.onKey(() => {
            if (!isDisposed) term.focus();
        });

        const resizeObserver = new ResizeObserver(scheduleFit);
        resizeObserver.observe(host);

        socket.on('terminal:data', onTerminalData);
        window.addEventListener('resize', scheduleFit);
        scheduleFit();
        term.focus();

        return () => {
            isDisposed = true;
            if (frameId) cancelAnimationFrame(frameId);
            resizeObserver.disconnect();
            window.removeEventListener('resize', scheduleFit);
            socket.off('terminal:data', onTerminalData);
            dataDisposable.dispose();
            focusDisposable.dispose();
            term.dispose();
        };
    }, [roomId, socket]);

    return <div ref={terminalRef} className="terminalHost" />;
};

export default Terminal;

import React, { useEffect, useRef, useState } from 'react';
import './SessionTape.css';

export default function SessionTape({ tape, onScrub, isReplaying, onExitReplay }) {
    const [sliderIndex, setSliderIndex] = useState(Math.max(0, tape.length - 1));
    const [isPlaying, setIsPlaying] = useState(false);
    const [playSpeed, setPlaySpeed] = useState(500);
    const intervalRef = useRef(null);
    const maxIndex = Math.max(0, tape.length - 1);
    const visibleSliderIndex = isReplaying ? Math.min(sliderIndex, maxIndex) : maxIndex;

    useEffect(() => {
        if (!isPlaying) return undefined;

        intervalRef.current = setInterval(() => {
            setSliderIndex((prev) => {
                if (prev >= tape.length - 1) {
                    setIsPlaying(false);
                    return prev;
                }

                const next = prev + 1;
                onScrub(next);
                return next;
            });
        }, playSpeed);

        return () => clearInterval(intervalRef.current);
    }, [isPlaying, onScrub, playSpeed, tape.length]);

    const scrubTo = (index) => {
        const nextIndex = Math.max(0, Math.min(index, maxIndex));
        setSliderIndex(nextIndex);
        onScrub(nextIndex);
    };

    const formatTime = (timestamp) => (
        new Date(timestamp).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
        })
    );

    const currentEvent = tape[visibleSliderIndex];

    return (
        <div className="session-tape-bar">
            {isReplaying && (
                <div className="replay-banner">
                    <span>Replay Mode - Viewing history</span>
                    <button className="exit-replay-btn" onClick={onExitReplay}>
                        Exit Replay
                    </button>
                </div>
            )}

            <div className="tape-controls">
                <button
                    className="tape-btn"
                    onClick={() => setIsPlaying((playing) => !playing)}
                    title={isPlaying ? 'Pause' : 'Auto-Play'}
                    type="button"
                >
                    {isPlaying ? 'Pause' : 'Play'}
                </button>

                <button
                    className="tape-btn"
                    onClick={() => scrubTo(visibleSliderIndex - 1)}
                    title="Step Back"
                    type="button"
                >
                    Back
                </button>

                <button
                    className="tape-btn"
                    onClick={() => scrubTo(visibleSliderIndex + 1)}
                    title="Step Forward"
                    type="button"
                >
                    Forward
                </button>

                <div className="tape-slider-wrapper">
                    <input
                        type="range"
                        min={0}
                        max={maxIndex}
                        value={visibleSliderIndex}
                        onChange={(event) => scrubTo(Number(event.target.value))}
                        className="tape-slider"
                    />
                    <div className="tape-markers">
                        {tape.map((event, index) => (
                            <div
                                key={event.eventIndex ?? index}
                                className={`tape-marker ${
                                    event.type === 'FILE_CREATE'
                                        ? 'marker-create'
                                        : event.type === 'FILE_DELETE'
                                            ? 'marker-delete'
                                            : 'marker-edit'
                                }`}
                                style={{ left: `${(index / Math.max(tape.length - 1, 1)) * 100}%` }}
                                title={`${event.username}: ${event.type} on ${event.filePath}`}
                            />
                        ))}
                    </div>
                </div>

                <select
                    className="speed-select"
                    value={playSpeed}
                    onChange={(event) => setPlaySpeed(Number(event.target.value))}
                    title="Playback Speed"
                >
                    <option value={1000}>0.5x</option>
                    <option value={500}>1x</option>
                    <option value={250}>2x</option>
                    <option value={100}>4x</option>
                </select>

                {currentEvent && (
                    <div className="tape-event-info">
                        <span className="event-index">#{visibleSliderIndex + 1}/{tape.length}</span>
                        <span className="event-user">{currentEvent.username}</span>
                        <span className="event-file">{currentEvent.filePath}</span>
                        <span className="event-time">{formatTime(currentEvent.timestamp)}</span>
                    </div>
                )}

                {isReplaying && (
                    <button className="tape-btn live-btn" onClick={onExitReplay} type="button">
                        Live
                    </button>
                )}
            </div>
        </div>
    );
}

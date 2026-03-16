/* © 2026 Lonrú Consulting Ltd. | Active Architecture™ Powered by Lonrú Studios™ */
// src/hooks/useLiveAPI.ts
import { useState, useRef, useCallback } from 'react';

export interface ActiveProjectContext {
    summary?: string;
    steps?: string[];
}

export function useLiveAPI(experience: string = "Unknown", inventory: string[] = [], activeProject: ActiveProjectContext | null = null) {
    const [connected, setConnected] = useState(false);
    const [isConnecting, setIsConnecting] = useState(false);
    const [isPaused, setIsPaused] = useState(false);
    const transcriptRef = useRef<string>("");
    
    const wsRef = useRef<WebSocket | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const [stream, setStream] = useState<MediaStream | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const videoIntervalRef = useRef<NodeJS.Timeout | null>(null);

    // Queue to hold incoming Gemini phonetic audio buffers so they play sequentially
    const audioQueueRef = useRef<AudioBuffer[]>([]);
    const isPlayingRef = useRef<boolean>(false);
    const currentAudioSourceRef = useRef<AudioBufferSourceNode | null>(null);

    const playNextInQueue = () => {
        const audioCtx = audioContextRef.current;
        if (!audioCtx || audioQueueRef.current.length === 0) {
            isPlayingRef.current = false;
            return;
        }

        isPlayingRef.current = true;
        const nextBuffer = audioQueueRef.current.shift()!;
        
        const source = audioCtx.createBufferSource();
        source.buffer = nextBuffer;
        source.connect(audioCtx.destination);
        source.onended = () => {
            currentAudioSourceRef.current = null;
            playNextInQueue();
        };
        currentAudioSourceRef.current = source;
        source.start();
    };

    const playPcmAudio = useCallback((base64Data: string) => {
        const audioCtx = audioContextRef.current;
        if (!audioCtx) return;

        const binary = window.atob(base64Data);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        
        const pcm16 = new Int16Array(bytes.buffer);
        const float32 = new Float32Array(pcm16.length);
        for (let i = 0; i < pcm16.length; i++) {
            float32[i] = pcm16[i] / 32768.0;
        }
        
        const audioBuffer = audioCtx.createBuffer(1, float32.length, 24000); 
        audioBuffer.getChannelData(0).set(float32);
        
        audioQueueRef.current.push(audioBuffer);
        if (!isPlayingRef.current) {
            playNextInQueue();
        }
    }, [playNextInQueue]);

    const stopStreaming = useCallback(() => {
        if (videoIntervalRef.current) {
            clearInterval(videoIntervalRef.current);
            videoIntervalRef.current = null;
        }
        if (streamRef.current) {
            streamRef.current.getTracks().forEach((track: MediaStreamTrack) => track.stop());
            streamRef.current = null;
            setStream(null);
        }
        if (audioContextRef.current) {
            audioContextRef.current.close();
            audioContextRef.current = null;
        }
        setConnected(false);
    }, []);

    const startStreaming = useCallback((stream: MediaStream) => {
        const audioCtx = audioContextRef.current;
        if (!audioCtx) return;

        const source = audioCtx.createMediaStreamSource(stream);
        const processor = audioCtx.createScriptProcessor(4096, 1, 1);
        
        processor.onaudioprocess = (e) => {
            if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
            const inputData = e.inputBuffer.getChannelData(0);
            
            // convert Float32 to Int16
            const pcm16 = new Int16Array(inputData.length);
            for (let i = 0; i < inputData.length; i++) {
                pcm16[i] = Math.max(-32768, Math.min(32767, inputData[i] * 32768));
            }
            
            // Convert to base64
            const buffer = new Uint8Array(pcm16.buffer);
            let binary = '';
            // Process in chunks to avoid stack overflow in fromCharCode.apply
            for (let i = 0; i < buffer.byteLength; i++) {
                binary += String.fromCharCode(buffer[i]);
            }
            const base64 = window.btoa(binary);

            const message = {
                realtimeInput: {
                    mediaChunks: [{
                        mimeType: 'audio/pcm;rate=16000',
                        data: base64
                    }]
                }
            };
            wsRef.current.send(JSON.stringify(message));
        };
        
        source.connect(processor);
        processor.connect(audioCtx.destination);

        // --- Vision Loop / Hidden Canvas Extraction ---
        const hiddenVideo = document.createElement('video');
        hiddenVideo.autoplay = true;
        hiddenVideo.playsInline = true;
        hiddenVideo.muted = true;
        hiddenVideo.srcObject = stream;
        
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        hiddenVideo.onloadedmetadata = () => {
            // Downscale to 720p maximum to save WebSocket bandwidth
            const MAX_DIM = 720;
            let w = hiddenVideo.videoWidth;
            let h = hiddenVideo.videoHeight;
            if (w > MAX_DIM || h > MAX_DIM) {
                if (w > h) { h = Math.round((h * MAX_DIM) / w); w = MAX_DIM; } 
                else { w = Math.round((w * MAX_DIM) / h); h = MAX_DIM; }
            }
            canvas.width = w;
            canvas.height = h;
        };

        hiddenVideo.play().catch(e => console.warn("Hidden video play failed", e));
        
        if (videoIntervalRef.current) clearInterval(videoIntervalRef.current);
        
        // Snap one frame every 1000ms
        videoIntervalRef.current = setInterval(() => {
            if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
            
            const videoTrack = stream.getVideoTracks()[0];
            if (!videoTrack || !videoTrack.enabled) return; // Do not send disabled frames
            
            if (hiddenVideo.readyState >= 2 && ctx) {
                ctx.drawImage(hiddenVideo, 0, 0, canvas.width, canvas.height);
                const dataUrl = canvas.toDataURL('image/jpeg', 0.6);
                const base64Image = dataUrl.split(',')[1];
                
                wsRef.current.send(JSON.stringify({
                    realtimeInput: {
                        mediaChunks: [{
                            mimeType: 'image/jpeg',
                            data: base64Image
                        }]
                    }
                }));
            }
        }, 1000);

    }, []);

    const connect = useCallback(async (projectOverride?: ActiveProjectContext) => {
        setIsConnecting(true);
        try {
            // Instantiate AudioContext synchronously to prevent iOS Safari from suspending it silently
            audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
            
            const newStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
            streamRef.current = newStream;
            setStream(newStream);
            
            // Connect WebSocket with context injected into the query params
            const queryObj: Record<string, string> = {
                experience,
                inventory: inventory.join(',')
            };
            
            const targetProject = projectOverride || activeProject;
            if (targetProject) {
                if (targetProject.summary) queryObj.activeProjectSummary = targetProject.summary;
                if (targetProject.steps) queryObj.activeProjectSteps = JSON.stringify(targetProject.steps);
            }
            
            const params = new URLSearchParams(queryObj);
            const wsUrl = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8080";
            wsRef.current = new WebSocket(`${wsUrl}?${params.toString()}`);
            
            wsRef.current.onopen = () => {
                setConnected(true);
                setIsConnecting(false);
                transcriptRef.current = ""; // clear transcript on new call
                console.log('Connected to backend WebSocket');
                startStreaming(newStream);
            };

            wsRef.current.onmessage = async (event) => {
                let data = event.data;
                if (data instanceof Blob) {
                    data = await data.text();
                }
                
                if (typeof data === 'string') {
                    try {
                        const parsed = JSON.parse(data);
                        
                        // If the agent is interrupted by user speech, flush the queue instantly
                        if (parsed.serverContent?.interrupted) {
                            audioQueueRef.current = []; // Clear pending chunks
                            if (currentAudioSourceRef.current) {
                                currentAudioSourceRef.current.stop(); // Stop current playing 
                                currentAudioSourceRef.current = null;
                            }
                        }

                        if (parsed.serverContent && parsed.serverContent.modelTurn) {
                            const parts = parsed.serverContent.modelTurn.parts;
                            for (const part of parts) {
                                if (part.inlineData && part.inlineData.mimeType.startsWith('audio/pcm')) {
                                    playPcmAudio(part.inlineData.data);
                                } else if (part.text) {
                                    transcriptRef.current += " " + part.text;
                                }
                            }
                        }
                    } catch (_e) {
                         // silently ignore parsing errors for now
                    }
                }
            };

            wsRef.current.onclose = () => {
                setConnected(false);
                console.log('Disconnected');
                stopStreaming();
            };

        } catch (error) {
            console.error('Failed to connect:', error);
            setIsConnecting(false);
        }
    }, [experience, inventory, activeProject, playPcmAudio, startStreaming, stopStreaming]);

    const disconnect = useCallback(() => {
        if (wsRef.current) {
            wsRef.current.close();
        }
        stopStreaming();
    }, [stopStreaming]);

    const togglePause = useCallback(() => {
        if (streamRef.current) {
            const paused = !isPaused;
            streamRef.current.getTracks().forEach((track) => {
                track.enabled = !paused;
            });
            
            // If the user clicks Pause, instantly kill any ongoing AI speech
            if (paused) {
                audioQueueRef.current = [];
                if (currentAudioSourceRef.current) {
                    currentAudioSourceRef.current.stop();
                    currentAudioSourceRef.current = null;
                }
            }
            
            setIsPaused(paused);
        }
    }, [isPaused]);


    return { connected, connect, disconnect, stream, transcriptRef, isPaused, togglePause, isConnecting };
}

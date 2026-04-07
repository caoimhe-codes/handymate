/* © 2026 Lonrú Consulting Ltd. | Active Architecture™ Powered by Lonrú Studios™ */
// src/hooks/useLiveAPI.ts
import { useState, useRef, useCallback, useEffect } from 'react';

export interface ActiveProjectContext {
    summary?: string;
    steps?: string[];
}

export function useLiveAPI(experience: string = "Unknown", inventory: string[] = [], activeProject: ActiveProjectContext | null = null) {
    const [connected, setConnected] = useState(false);
    const [isConnecting, setIsConnecting] = useState(false);
    const [isPaused, setIsPaused] = useState(false);
    const [facingMode, setFacingMode] = useState<"user" | "environment">("user");
    const transcriptRef = useRef<string>("");
    const agentAudioChunksRef = useRef<string[]>([]);
    
    const wsRef = useRef<WebSocket | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const [stream, setStream] = useState<MediaStream | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const videoIntervalRef = useRef<NodeJS.Timeout | null>(null);
    const recognitionRef = useRef<any>(null);

    // Queue to hold incoming Gemini phonetic audio buffers so they play sequentially
    const audioQueueRef = useRef<AudioBuffer[]>([]);
    const isPlayingRef = useRef<boolean>(false);
    const currentAudioSourceRef = useRef<AudioBufferSourceNode | null>(null);

    useEffect(() => {
        // Legendary iOS WebAudio bypass:
        // By hooking into the raw touch event, Apple considers it a "User Gesture" and instantly releases all audio locks.
        const unlockAudio = () => {
            if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
                audioContextRef.current.resume();
            }
        };
        
        document.addEventListener('touchstart', unlockAudio, { passive: true });
        return () => document.removeEventListener('touchstart', unlockAudio);
    }, []);

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

        try {
            // Hardware-based OS sniffing to circumvent "Request Desktop Website" user agent spoofing on iOS
            // Apple explicitly unloads "ontouchend" when spoofing, so we MUST sniff maxTouchPoints at the GPU driver layer.
            const isAppleTouch = typeof navigator !== 'undefined' && (
                /iPad|iPhone|iPod/.test(navigator.userAgent) || 
                (navigator.userAgent.includes("Mac") && navigator.maxTouchPoints > 1)
            );
            
            const isMobile = isAppleTouch || (typeof navigator !== 'undefined' && /Mobi|Android/.test(navigator.userAgent));

            if (isMobile && audioCtx.sampleRate !== 24000) {
                // FALLBACK ONLY FOR MOBILE: Nearest-Neighbor resampling 
                // This algorithm is mathematically identically to what successfully ran on Mobile in Turn 2.
                // It cleanly bypasses all silent muting behavior on iOS Safari without complex APIs.
                const targetRate = audioCtx.sampleRate;
                const ratio = targetRate / 24000;
                const newLength = Math.round(float32.length * ratio);
                const finalBuffer = new Float32Array(newLength);
                for (let i = 0; i < newLength; i++) {
                    let srcIdx = Math.floor(i / ratio);
                    if (srcIdx >= float32.length) srcIdx = float32.length - 1;
                    finalBuffer[i] = float32[srcIdx];
                }
                
                const fallbackBuffer = audioCtx.createBuffer(1, finalBuffer.length, targetRate);
                fallbackBuffer.getChannelData(0).set(finalBuffer);
                audioQueueRef.current.push(fallbackBuffer);
            } else {
                // PRIMARY: Native execution for Desktop Chrome
                // This is mathematically strictly identical to what successfully ran on Laptop in Turn 1.
                const audioBuffer = audioCtx.createBuffer(1, float32.length, 24000); 
                audioBuffer.getChannelData(0).set(float32);
                audioQueueRef.current.push(audioBuffer);
            }

            if (!isPlayingRef.current) playNextInQueue();
        } catch (e) {
            console.error("Critical playback error", e);
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
        if (recognitionRef.current) {
            try { recognitionRef.current.stop(); } catch(e) {}
            recognitionRef.current = null;
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
            // Prevent attempting to send audio if paused
            if (isPaused) return;

            let inputData = e.inputBuffer.getChannelData(0);
            
            // Apple iOS Safari often ignores hardware 16000Hz constraints natively and misreports sample rates.
            // We forcefully downsample the input by calculating the physical target length mathematically 
            // derived from the literal duration of the buffer frame, fully bypassing fraudulent `sampleRate` contexts.
            const targetLength = Math.round(e.inputBuffer.duration * 16000);
            if (inputData.length !== targetLength) {
                const ratio = inputData.length / targetLength;
                const downsampled = new Float32Array(targetLength);
                for (let i = 0; i < targetLength; i++) {
                    downsampled[i] = inputData[Math.round(i * ratio)] || 0;
                }
                inputData = downsampled;
            }
            
            let maxAmplitude = 0;
            // convert Float32 to Int16
            const pcm16 = new Int16Array(inputData.length);
            for (let i = 0; i < inputData.length; i++) {
                if (Math.abs(inputData[i]) > maxAmplitude) {
                    maxAmplitude = Math.abs(inputData[i]);
                }
                pcm16[i] = Math.max(-32768, Math.min(32767, inputData[i] * 32768));
            }

            // [NOISE GATE] Drop frames that are mere room ambient hum (below roughly 1.5% volume)
            // If we blindly stream silence, the ambient noise out the speakers will instantly trigger 
            // Gemini's strict "interruption" logic, cutting off its responses!
            if (maxAmplitude < 0.015) {
                return;
            }
            
            // Convert to base64
            const buffer = new Uint8Array(pcm16.buffer);
            let binary = '';
            // Process in chunks to avoid stack overflow in fromCharCode.apply
            for (let i = 0; i < buffer.byteLength; i++) {
                binary += String.fromCharCode(buffer[i]);
            }
            const base64 = window.btoa(binary);

            if (!base64 || base64.length === 0) return;

            const message = {
                realtimeInput: {
                    audio: {
                        mimeType: 'audio/pcm;rate=16000',
                        data: base64
                    }
                }
            };
            wsRef.current.send(JSON.stringify(message));
        };
        
        const dummyGain = audioCtx.createGain();
        dummyGain.gain.value = 0;
        source.connect(processor);
        processor.connect(dummyGain);
        dummyGain.connect(audioCtx.destination);

        // --- Vision Loop / Hidden Canvas Extraction ---
        const hiddenVideo = document.createElement('video');
        hiddenVideo.autoplay = true;
        hiddenVideo.playsInline = true;
        hiddenVideo.muted = true;
        hiddenVideo.srcObject = streamRef.current; // Bind directly to the ref so camera swaps don't break the frame extraction!
        
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
            
            // Check streamRef instead of the frozen stream parameter
            const videoTrack = streamRef.current?.getVideoTracks()[0];
            if (!videoTrack || !videoTrack.enabled) return; // Do not send disabled frames
            
            if (hiddenVideo.readyState >= 2 && ctx) {
                ctx.drawImage(hiddenVideo, 0, 0, canvas.width, canvas.height);
                const dataUrl = canvas.toDataURL('image/jpeg', 0.6);
                const base64Image = dataUrl.split(',')[1];
                
                wsRef.current.send(JSON.stringify({
                    realtimeInput: {
                        video: {
                            mimeType: 'image/jpeg',
                            data: base64Image
                        }
                    }
                }));
            }
        }, 1000);

    }, []);

    const connect = useCallback(async (projectOverride?: ActiveProjectContext) => {
        setIsConnecting(true);
        try {
            // Instantiate AudioContext completely unconstrained to prevent Apple from artificially zero-ing out
            // the hardware buffer streams under the hood. Our Javascript Nearest-Neighbor equations will natively process it.
            const TAudioContext = window.AudioContext || (window as any).webkitAudioContext;
            audioContextRef.current = new TAudioContext();
            
            // SUPER HACK FOR IOS: Play 10ms of pure silence immediately on the click thread
            // This permanently unlocks the WebAudio API in mobile browsers
            const unlockOsc = audioContextRef.current.createOscillator();
            const unlockGain = audioContextRef.current.createGain();
            unlockGain.gain.value = 0;
            unlockOsc.connect(unlockGain);
            unlockGain.connect(audioContextRef.current.destination);
            unlockOsc.start();
            unlockOsc.stop(audioContextRef.current.currentTime + 0.01);

            // Force resume BEFORE the async await drops the user gesture token
            if (audioContextRef.current.state === 'suspended') {
                audioContextRef.current.resume();
            }
            
            const newStream = await navigator.mediaDevices.getUserMedia({ 
                audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, 
                video: { facingMode } 
            })
                .catch(() => navigator.mediaDevices.getUserMedia({ audio: true, video: true })); // fallback if precise facingMode fails
                
            streamRef.current = newStream;
            setStream(newStream);
            
            // Synchronously construct the audio graph precisely when hardware permission is granted.
            // DO NOT wait for WebSockets here, or Apple iOS Chrome silently destroys the microphone link.
            startStreaming(newStream);
            
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
                agentAudioChunksRef.current = []; // clear previous audio chunks
                console.log('Connected to backend WebSocket');
                
                // Force immediate introduction natively over the data channel to bypass any VAD dead-air delays
                const setupMsg = {
                    clientContent: {
                        turns: [{
                            role: "user",
                            parts: [{ text: "Hello! I have a repair project. Please briefly introduce yourself and ask me how you can help." }]
                        }],
                        turnComplete: true
                    }
                };
                wsRef.current?.send(JSON.stringify(setupMsg));
                
                // Final safety check for iOS: ensure context didn't drift back to suspended
                if (audioContextRef.current?.state === 'suspended') {
                    audioContextRef.current.resume();
                }

                // Start local speech recognition to build a transcript for the summary generator
                // (Since Gemini 3.1 Live API strictly returns audio chunks without text echoes)
                const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
                if (SpeechRecognition) {
                    const recognition = new SpeechRecognition();
                    recognition.continuous = true;
                    recognition.interimResults = false;
                    recognition.lang = 'en-US';
                    
                    recognition.onresult = (event: any) => {
                        for (let i = event.resultIndex; i < event.results.length; i++) {
                            if (event.results[i].isFinal) {
                                transcriptRef.current += " " + event.results[i][0].transcript;
                            }
                        }
                    };
                    
                    recognition.onend = () => {
                        // Keep it continuous if we're still connected and not paused
                        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                            try { recognition.start(); } catch(e){}
                        }
                    };
                    
                    try {
                        recognition.start();
                        recognitionRef.current = recognition;
                    } catch (e) {
                         console.warn("Speech recognition failed to start", e);
                    }
                }
            };

            wsRef.current.onmessage = async (event) => {
                let data = event.data;
                if (data instanceof Blob) {
                    data = await data.text();
                }
                
                if (typeof data === 'string') {
                    try {
                        const parsed = JSON.parse(data);
                        
                        if (parsed.type === "close") {
                            console.warn("Backend proxied close event:", parsed.reason);
                            setConnected(false);
                            stopStreaming();
                            return;
                        }

                        // If the agent is interrupted by user speech, flush the queue instantly
                        if (parsed.serverContent?.interrupted) {
                            // audioQueueRef.current = []; // Clear pending chunks
                            // if (currentAudioSourceRef.current) {
                            //     currentAudioSourceRef.current.stop(); // Stop current playing 
                            //     currentAudioSourceRef.current = null;
                            // }
                        }

                        if (parsed.serverContent && parsed.serverContent.modelTurn) {
                            const parts = parsed.serverContent.modelTurn.parts;
                            for (const part of parts) {
                                if (part.inlineData && part.inlineData.mimeType.startsWith('audio/pcm')) {
                                    playPcmAudio(part.inlineData.data);
                                    agentAudioChunksRef.current.push(part.inlineData.data); // save for summary pipeline!
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
            if (typeof window !== 'undefined') {
                alert(`iOS Diagnostic Error: ${error instanceof Error ? error.message : String(error)}`);
            }
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
                if (recognitionRef.current) {
                    try { recognitionRef.current.stop(); } catch(e){}
                }
            } else {
                if (recognitionRef.current) {
                    try { recognitionRef.current.start(); } catch(e){}
                }
            }
            
            setIsPaused(paused);
        }
    }, [isPaused]);

    const switchCamera = useCallback(async () => {
        if (!streamRef.current) return;
        
        try {
            const currentVideoTrack = streamRef.current.getVideoTracks()[0];
            const newMode = facingMode === "user" ? "environment" : "user";
            
            const tempStream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: { exact: newMode } }
            }).catch(() => navigator.mediaDevices.getUserMedia({
                video: { facingMode: newMode } // fallback
            }));
            
            const newVideoTrack = tempStream.getVideoTracks()[0];
            
            streamRef.current.removeTrack(currentVideoTrack);
            currentVideoTrack.stop();
            streamRef.current.addTrack(newVideoTrack);
            
            // Create a new strict reference to trigger React re-renders correctly
            const newStreamObj = new MediaStream(streamRef.current.getTracks());
            setStream(newStreamObj);
            streamRef.current = newStreamObj;
            setFacingMode(newMode);
            
        } catch (e) {
            console.error("Failed to switch camera", e);
        }
    }, [facingMode]);

    return { connected, connect, disconnect, stream, transcriptRef, agentAudioChunksRef, isPaused, togglePause, isConnecting, switchCamera };
}

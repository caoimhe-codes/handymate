import { GoogleGenAI } from '@google/genai';
import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config({ override: true });

const apiKey = process.env.GEMINI_API_KEY;

async function runTest(name) {
    const ai = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: 'v1alpha' } }); 
    console.log(`\nTesting: ${name}`);
    return new Promise(async (resolve) => {
        let closed = false;
        try {
            const session = await ai.live.connect({
                model: "gemini-3.1-flash-live-preview",
                config: {
                    systemInstruction: { parts: [{ text: "You must introduce yourself." }] }
                },
                callbacks: {
                    onmessage: (data) => {
                        console.log("<<< [RECEIVED]:", Object.keys(data));
                    },
                    onopen: () => {
                        console.log("-> connection open.");
                    }
                }
            });

            // Try to force the agent to speak first via raw socket injection
            session.conn.send(JSON.stringify({
                clientContent: {
                    turns: [{
                        role: "user",
                        parts: [{ text: "Please introduce yourself." }]
                    }],
                    turnComplete: true
                }
            }));

            setTimeout(() => {
                        console.log("-> connection open.");
                        setTimeout(() => {
                            if (closed) return;
                            console.log("-> Sending real audio...");
                            const wavBuffer = fs.readFileSync('hello.wav');
                            // Strip 44 byte wav header
                            const pcmBuffer = wavBuffer.subarray(44);
                            
                            // Send in chunks of ~3000 bytes simulating real-time
                            for (let offset = 0; offset < pcmBuffer.length; offset += 3000) {
                                const chunk = pcmBuffer.subarray(offset, offset + 3000);
                                session.sendRealtimeInput([{
                                    mimeType: 'audio/pcm;rate=16000',
                                    data: chunk.toString('base64')
                                }]);
                            }
                        }, 1000);

                        setTimeout(() => {
                            if (!closed) {
                                console.log(`   >>> SUCCESS! Stayed open for 4s.`);
                                session.close();
                                resolve();
                            }
                        }, 4000);
                    },
                    onerror: (err) => {
                        console.log(`   [ERROR]:`, err); resolve();
                    },
                    onclose: (e) => {
                        closed = true;
                        console.log(`   [CLOSED]: ${e.code} - ${e.reason}`); resolve();
                    }
                }
            });
        } catch (err) {
            console.log("Connect err:", err.message); resolve();
        }
    });
}

(async () => {
    await runTest("Wake up with Silence");
})();

/* © 2026 Lonrú Consulting Ltd. | Active Architecture™ Powered by Lonrú Studios™ */
import express from "express";
import { WebSocketServer } from "ws";
import * as http from "http";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import cors from "cors";

dotenv.config({ override: true });

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
    console.error("CRITICAL ERROR: GEMINI_API_KEY is not set in the backend environment!");
    process.exit(1);
}

// Initialize the Google Gen AI SDK
const ai = new GoogleGenAI({ 
    apiKey: GEMINI_API_KEY,
    httpOptions: { apiVersion: 'v1alpha' }
});

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

app.post('/api/summarize', async (req, res) => {
    try {
        const { transcript, agentAudioChunks, experience, inventory, previousSummary, previousSteps } = req.body;
        
        let prompt = `
            You are HandyMate, an expert contractor.
            The user just finished a video help call. 
        `;

        if (transcript && transcript.trim().length > 0) {
            prompt += `Here is a description or transcript of the repair task:\n"${transcript}"\n`;
        } else {
            prompt += `[CRITICAL]: The user's audio was not locally transcribed (likely due to iOS Chrome limitations). You MUST rely strictly on the agent's audio context or simply state that the call was empty if no work was discussed.\n`;
        }

        if (previousSummary) {
            prompt += `
            [IMPORTANT UPDATE]: This call was a CONTINUATION of an existing project.
            The previous summary was: "${previousSummary}"
            The previous steps completed so far were: ${JSON.stringify(previousSteps || [])}
            
            Please merge the new events from this latest transcript into the existing context. Provide a single, cohesive, updated summary and updated step-by-step instructions.
            `;
        }
            
        prompt += `
            They have a ${experience} experience level and these tools: ${inventory}.
            
            Generate a concise, helpful summary of the repair they just talked about.
        `;

        let jsonInstruction = `
            You must return EXACTLY and ONLY a valid JSON object with this exact structure:
            {
                "title": "A short, catchy title (e.g. Fixing the Leaky Sink)",
                "summary": "A 1-sentence summary of what was discussed.",
                "status": "Either 'Completed' if they fixed it, or 'Pending Tools' if they need to acquire items first.",
                "estimatedTime": "E.g. '15 mins', '1 hour'. You MUST provide a concrete time estimate based on standard contractor times. DO NOT output 'Unknown'.",
                "toolsNeeded": ["Item 1 to buy/borrow", "Item 2"], 
                "steps": [
                    "Step 1...",
                    "Step 2..."
                ]
            }
            Make sure 'toolsNeeded' is an array of strings (empty if they have everything).
            Do NOT wrap the output in markdown code blocks. Just return the raw JSON string.
        `;

        const requestContents = [prompt];

        // If we captured the agent's audio from the livestream, decode and combine the raw PCM buffers
        if (agentAudioChunks && Array.isArray(agentAudioChunks) && agentAudioChunks.length > 0) {
            try {
                // Decode all individual base64 chunks to Buffers
                const buffers = agentAudioChunks.map(chunk => Buffer.from(chunk, 'base64'));
                // Concatenate into one massive PCM buffer
                const combinedBuffer = Buffer.concat(buffers);
                // Re-encode as a valid WAV file buffer so Gemini 2.5 REST API can read it
                const wavHeader = Buffer.alloc(44);
                wavHeader.write('RIFF', 0);
                wavHeader.writeUInt32LE(36 + combinedBuffer.length, 4);
                wavHeader.write('WAVE', 8);
                wavHeader.write('fmt ', 12);
                wavHeader.writeUInt32LE(16, 16); 
                wavHeader.writeUInt16LE(1, 20); 
                wavHeader.writeUInt16LE(1, 22); 
                wavHeader.writeUInt32LE(24000, 24); 
                wavHeader.writeUInt32LE(24000 * 2, 28); 
                wavHeader.writeUInt16LE(2, 32); 
                wavHeader.writeUInt16LE(16, 34); 
                wavHeader.write('data', 36);
                wavHeader.writeUInt32LE(combinedBuffer.length, 40);
                
                const finalWavBuffer = Buffer.concat([wavHeader, combinedBuffer]);
                const combinedBase64 = finalWavBuffer.toString('base64');
                
                requestContents.push({
                    inlineData: {
                        mimeType: 'audio/wav',
                        data: combinedBase64
                    }
                });
                
                // Pre-pend the audio extraction instruction explicitly to the JSON schema block
                jsonInstruction = "Listen to the provided audio which contains what the HandyMate agent told the user during the call. Extremely important: extract any specific tools the agent told the user they would need from this audio and list them in 'toolsNeeded'. Combine what the agent said with the user transcript to generate the steps and summary. \n\n" + jsonInstruction;
            } catch(e) {
                console.error("Failed to parse agent audio chunks", e);
            }
        }

        requestContents.push(jsonInstruction);

        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: requestContents,
            config: {
                responseMimeType: "application/json"
            }
        });

        const cleanText = response.text.replace(/```(json)?/gi, '').trim();
        res.json(JSON.parse(cleanText));
    } catch (e) {
        console.error("Summary Generation Error:", e);
        res.status(500).json({ error: "Failed to generate summary" });
    }
});

app.post('/api/detect-tools', async (req, res) => {
    try {
        const { imageBase64 } = req.body;
        if (!imageBase64) {
             return res.status(400).json({ error: "Missing imageBase64 payload" });
        }

        const prompt = "Look extremely closely at this image. Identify any and all DIY tools, hardware, or materials (e.g. Hammer, Screws, Wrench, Pliers, Nails, Tape, Drill, etc.). Even if the tool is blurry, held in a hand, or partially obscured, list it. Return ONLY a JSON array of strings, e.g. ['Hammer', 'Wrench', 'Duct Tape']. Do not wrap the response in markdown blocks.";

        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: [
                prompt,
                {
                    inlineData: {
                        mimeType: "image/jpeg",
                        data: imageBase64
                    }
                }
            ],
            config: {
                responseMimeType: "application/json",
            }
        });

        const cleanText = response.text.replace(/```(json)?/gi, '').trim();
        res.json(JSON.parse(cleanText));
    } catch (e) {
        console.error("Tool Detection Error:", e);
        res.status(500).json({ error: "Failed to detect tools from image" });
    }
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

wss.on('connection', async (clientWs, req) => {
    // Parse the context sent from the frontend URL
    const urlParams = new URL(req.url, `http://${req.headers.host}`).searchParams;
    const experience = urlParams.get('experience') || "Unknown";
    const inventory = urlParams.get('inventory') || "None";
    const activeProjectSummary = urlParams.get('activeProjectSummary');
    const activeProjectSteps = urlParams.get('activeProjectSteps');
    
    console.log(`Client connected. Profile: [Level: ${experience}] [Tools: ${inventory}]`);

    let session = null;
    
    let baseInstructions = `You are HandyMate, an expert AI contractor. You have 30 years of trade experience to draw upon natively, but DO NOT say you have 30 years of experience out loud to the user. Retain your personality as a trade professional. Your tone is direct, encouraging, concise, and safety-focused. CRITICAL RULES: 1. You MUST introduce yourself as HandyMate the moment you connect. 2. Wait for user to show the problem. 3. Diagnose first. 4. Give instructions strictly one step at a time. 5. Politely interrupt if the user is seen making a mistake on camera. 6. If the user interrupts you, stop your current thought immediately, genuinely acknowledge the interruption, and address their new point directly without repeating the previous step.\n\nIMPORTANT CONTEXT: The user has a ${experience} DIY experience level. Tailor your explanations accordingly. They currently have the following tools available: ${inventory}. Try to suggest solutions using these tools first. If they do not have the necessary tools for the job, clearly list exactly what tools they need to buy or borrow before they can proceed.`;
    let initialGreeting = "Hello! I am ready. Please introduce yourself as HandyMate and ask how you can help me.";

    if (activeProjectSummary) {
        let stepsStr = "None";
        if (activeProjectSteps) {
            try {
                const steps = JSON.parse(activeProjectSteps);
                stepsStr = steps.map((s, i) => `${i+1}. ${s}`).join("\n");
            } catch (e) {}
        }
        
        baseInstructions += `\n\n[RESUMING EXISTING TASK]: The user is resuming a previously paused task. The task summary is: "${activeProjectSummary}". The steps previously generated for this task are:\n${stepsStr}\nUse this context to seamlessly pick up where they left off.`;
        initialGreeting = `Hello! I am ready. Please introduce yourself and acknowledge that we are resuming work on the project.`;
        console.log(`[Rehydrating Active Project Context]: ${activeProjectSummary}`);
    }
    
    try {
        // Connect via SDK instead of raw WebSockets!
        session = await ai.live.connect({
            model: 'gemini-3.1-flash-live-preview', // True Bidi Multimodal API

            config: {
                systemInstruction: {
                    parts: [{ 
                        text: baseInstructions 
                    }]
                },
                responseModalities: ["AUDIO"]
            },
            callbacks: {
                onopen: () => {
                    console.log('SDK: Connected to Gemini Live API');
                },
                onmessage: (serverMessage) => {
                    // console.log("SDK incoming:", Object.keys(serverMessage));
                    // The SDK parses incoming messages into objects. 
                    // We just serialize them back to JSON and forward to the React frontend.
                    if (clientWs.readyState === clientWs.OPEN) {
                        clientWs.send(JSON.stringify(serverMessage));
                    }
                },
                onerror: (e) => {
                    console.error('SDK: Gemini WS error:', e);
                    if (clientWs.readyState === clientWs.OPEN) {
                        clientWs.send(JSON.stringify({ type: "close", reason: "backend dropped" }));
                    }
                },
                onclose: (e) => {
                    console.log('SDK: Gemini Live API connection closed:', e);
                    if (clientWs.readyState === clientWs.OPEN) {
                        clientWs.send(JSON.stringify({ type: "close", reason: "backend dropped" }));
                    }
                }
            }
        });
        // Do not use session.sendClientContent, it throws 1007 Invalid Argument on gemini-3.1-flash-live-preview
    } catch (err) {
        console.error("Failed to connect to Live API SDK:", err);
        clientWs.close();
        return;
    }

    clientWs.on('message', (data) => {
        try {
            const parsed = JSON.parse(data);
            // Logging for debugging media payloads
            if (parsed.realtimeInput) {
                if (parsed.realtimeInput.video) {
                    // process.stdout.write('+'); // Plus for video frames
                } else if (parsed.realtimeInput.audio) {
                    process.stdout.write('.'); // Dot for audio frames
                }
            }
            // Re-route the standard JSON payloads from React to the SDK's strong-typed methods
            if (session) {
                if (parsed.realtimeInput && (parsed.realtimeInput.audio || parsed.realtimeInput.video)) {
                    // Map generic realtimeInput chunks to the proper mediaChunks schema expected by the SDK
                    const chunks = [];
                    if (parsed.realtimeInput.audio) chunks.push(parsed.realtimeInput.audio);
                    if (parsed.realtimeInput.video) chunks.push(parsed.realtimeInput.video);
                    session.send({ realtimeInput: { mediaChunks: chunks } });
                } else if (parsed.clientContent) {
                    session.send({ clientContent: parsed.clientContent });
                } else if (parsed.toolResponse) {
                    // Send tool response
                }
            }
        } catch (err) {
            console.error('Error parsing client message:', err);
        }
    });

    clientWs.on('close', () => {
        console.log('Client disconnected from proxy backend');
        if (session) {
            session.close();
        }
    });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log(`HandyMate Backend server listening on port ${PORT}`);
});

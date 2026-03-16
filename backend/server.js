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
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

const app = express();
app.use(cors());
app.use(express.json());

app.post('/api/summarize', async (req, res) => {
    try {
        const { transcript, experience, inventory, previousSummary, previousSteps } = req.body;
        
        let prompt = `
            You are HandyMate, an expert contractor.
            The user just finished a video help call. Here is a description or transcript of the repair task:
            "${transcript}"
        `;

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
            You must return EXACTLY and ONLY a valid JSON object with this exact structure:
            {
                "title": "A short, catchy title (e.g. Fixing the Leaky Sink)",
                "summary": "A 1-sentence summary of what was discussed.",
                "status": "Either 'Completed' if they fixed it, or 'Pending Tools' if they need to acquire items first.",
                "estimatedTime": "E.g. '30 minutes', '2 hours', or 'Unknown'",
                "toolsNeeded": ["Item 1 to buy/borrow", "Item 2"], 
                "steps": [
                    "Step 1...",
                    "Step 2..."
                ]
            }
            Make sure 'toolsNeeded' is an array of strings (empty if they have everything).
            Do NOT wrap the output in markdown code blocks. Just return the raw JSON string.
        `;

        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: prompt,
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
    
    let baseInstructions = `You are HandyMate, an expert contractor with 30 years experience. Your tone is direct, encouraging, concise, and safety-focused. CRITICAL RULES: 1. You MUST introduce yourself as HandyMate the moment you connect. 2. Wait for user to show the problem. 3. Diagnose first. 4. Give instructions strictly one step at a time. 5. Politely interrupt if the user is seen making a mistake on camera. 6. If the user interrupts you, stop your current thought immediately, genuinely acknowledge the interruption, and address their new point directly without repeating the previous step.\n\nIMPORTANT CONTEXT: The user has a ${experience} DIY experience level. Tailor your explanations accordingly. They currently have the following tools available: ${inventory}. Try to suggest solutions using these tools first. If they do not have the necessary tools for the job, clearly list exactly what tools they need to buy or borrow before they can proceed.`;
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
            model: 'gemini-2.5-flash-native-audio-latest', // The new audio model released today
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
                },
                onclose: (e) => {
                    console.log('SDK: Gemini Live API connection closed:', e);
                }
            }
        });
        
        // Kick off the conversation explicitly
        session.sendClientContent({
            turns: [{
                parts: [{ text: initialGreeting }],
                role: "user"
            }],
            turnComplete: true
        });
    } catch (err) {
        console.error("Failed to connect to Live API SDK:", err);
        clientWs.close();
        return;
    }

    clientWs.on('message', (data) => {
        try {
            const parsed = JSON.parse(data);
            // console.log("Received client payload with keys:", Object.keys(parsed));
            if (parsed.realtimeInput && parsed.realtimeInput.mediaChunks) {
                const chunk = parsed.realtimeInput.mediaChunks[0];
                if (chunk.mimeType.startsWith('image/')) {
                    console.log(`-> received video frame: ${chunk.data.length} bytes`);
                }
            }
            
            // Re-route the standard JSON payloads from React to the SDK's strong-typed methods
            if (session) {
                if (parsed.realtimeInput && parsed.realtimeInput.mediaChunks && parsed.realtimeInput.mediaChunks.length > 0) {
                    session.sendRealtimeInput({
                        media: parsed.realtimeInput.mediaChunks // Pass the full array as 'media', which the SDK maps to 'mediaChunks'
                    });
                } else if (parsed.clientContent) {
                    session.sendClientContent(parsed.clientContent);
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

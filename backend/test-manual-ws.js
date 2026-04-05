import WebSocket from 'ws';
import dotenv from 'dotenv';
dotenv.config({ override: true });

const apiKey = process.env.GEMINI_API_KEY;
const HOST = 'generativelanguage.googleapis.com';
const WS_URL = `wss://${HOST}/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${apiKey}`;

const ws = new WebSocket(WS_URL);

ws.on('open', () => {
    console.log('>>> RAW WS CONNECTED');
    const setupMessage = {
        setup: {
            model: "models/gemini-2.0-flash",
            generationConfig: {
                responseModalities: ["AUDIO"]
            }
        }
    };
    ws.send(JSON.stringify(setupMessage));
});

ws.on('message', (data) => {
    const text = data.toString();
    console.log('<<< MESSAGE START >>>');
    
    // Once setup is done, send clientContent
    if (text.includes("setupComplete")) {
        console.log("-> Sending client content");
        ws.send(JSON.stringify({
            clientContent: {
                turns: [{ role: "user", parts: [{ text: "Hello" }] }],
                turnComplete: true
            }
        }));
    }
});

ws.on('close', (code, reason) => {
    console.log(`<<< CLOSED: ${code} - ${reason.toString()}`);
});

ws.on('error', (err) => {
    console.log('<<< ERROR:', err);
});

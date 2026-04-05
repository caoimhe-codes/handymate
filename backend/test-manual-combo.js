import WebSocket from 'ws';
import dotenv from 'dotenv';
dotenv.config({ override: true });

const apiKey = process.env.GEMINI_API_KEY;
const HOST = 'generativelanguage.googleapis.com';

const modelNames = [
    "models/gemini-2.0-flash-exp",
    "models/gemini-2.0-flash",
    "models/gemini-2.0-flash-001",
    "gemini-2.0-flash-exp",
    "gemini-2.0-flash",
    "gemini-2.5-flash"
];

const apiVersions = [
    "v1alpha",
    "v1beta",
    "v1"
];

async function testCombos() {
    for (const api of apiVersions) {
        for (const model of modelNames) {
            console.log(`\nTesting manual WS: ${api} + ${model}`);
            await new Promise((resolve) => {
                const WS_URL = `wss://${HOST}/ws/google.ai.generativelanguage.${api}.GenerativeService.BidiGenerateContent?key=${apiKey}`;
                const ws = new WebSocket(WS_URL);
                
                let closed = false;

                ws.on('open', () => {
                    const setupMessage = {
                        setup: { model }
                    };
                    ws.send(JSON.stringify(setupMessage));
                });

                ws.on('close', (code, reason) => {
                    closed = true;
                    console.log(`   [CLOSED]: ${code} - ${reason.toString()}`);
                    resolve();
                });

                ws.on('error', (err) => {
                    closed = true;
                    console.log(`   [ERROR]: ${err.message}`);
                    resolve();
                });

                setTimeout(() => {
                    if (!closed) {
                        console.log(`   >>> SUCCESS! Stays open!`);
                        ws.close();
                        resolve();
                    }
                }, 3000);
            });
        }
    }
}

testCombos();

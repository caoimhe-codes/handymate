import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config({ override: true });
const apiKey = process.env.GEMINI_API_KEY;
const models = ["gemini-3.1-flash-live-preview", "gemini-2.5-flash-native-audio-latest"];
const versions = ["v1alpha", "v1beta"];

async function runTest() {
    for (const v of versions) {
        for (const m of models) {
            console.log(`Testing ${m} on ${v}...`);
            await new Promise((resolve) => {
                let closed = false;
                const ai = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: v } });
                ai.live.connect({
                    model: m,
                    callbacks: {
                        onopen: () => {
                            setTimeout(() => {
                                if (!closed) {
                                    console.log(`   >>> SUCCESS: ${m} stayed open on ${v}!`);
                                    resolve();
                                }
                            }, 2000);
                        },
                        onclose: (e) => {
                            closed = true;
                            console.log(`   [CLOSED]: ${e.reason || "No reason"}`);
                            resolve();
                        },
                        onerror: (e) => {
                            closed = true;
                            console.log(`   [ERROR]: ${e.message}`);
                            resolve();
                        }
                    }
                }).catch(e => {
                    console.log(`   [EXCEPTION]: ${e.message}`);
                    resolve();
                });
            });
        }
    }
}
runTest();

import { initializeApp } from "firebase/app";
import { getFirestore, collectionGroup, query, getDocs } from "firebase/firestore";
import * as fs from "fs";

import "dotenv/config";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app, "google-agents-handymate");

async function run() {
    try {
        console.log("Fetching feedback without index restrictions...");
        const q = query(collectionGroup(db, "feedback"));
        const querySnapshot = await getDocs(q);
        if (querySnapshot.empty) {
            console.log("No feedback documents found.");
            process.exit(0);
        }
        
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const allDocs: any[] = [];
        querySnapshot.forEach((doc) => {
            allDocs.push({ id: doc.id, ...doc.data() });
        });
        
        // sort by createdAt desc
        allDocs.sort((a, b) => {
            const timeA = a.createdAt?.toMillis() || 0;
            const timeB = b.createdAt?.toMillis() || 0;
            return timeB - timeA;
        });
        
        const latestDoc = allDocs[0];
        console.log("Found Latest Feedback ID:", latestDoc.id);
        
        if (latestDoc.screenshot) {
            const base64Data = latestDoc.screenshot.replace(/^data:image\/\w+;base64,/, "");
            const buffer = Buffer.from(base64Data, 'base64');
            const filepath = "/Users/caoimhenicantsaoir/.gemini/antigravity/brain/f86f675f-1ac1-4fde-a882-c3d0f2e67c43/latest_feedback.jpg";
            fs.writeFileSync(filepath, buffer);
            console.log("Saved feedback screenshot to:", filepath);
        } else {
            console.log("No screenshot found in the latest document.");
        }
    } catch (e) {
        console.error("Error:", e);
    }
    process.exit(0);
}

run();

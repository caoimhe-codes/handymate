import fetch from "node-fetch";

async function testSummarize() {
    const res = await fetch("http://localhost:8080/api/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            transcript: "User says their sink is leaking. I told them to turn off the water, then I told them to tighten the PVC pipe underneath the basin. They did it and the leak stopped.",
            experience: "Beginner",
            inventory: "Wrench, Towel",
            previousSummary: null,
            previousSteps: null
        })
    });
    const text = await res.text();
    console.log("Status:", res.status);
    console.log("Response:", text);
}

testSummarize();

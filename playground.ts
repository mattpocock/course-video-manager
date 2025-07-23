const API_URL = "http://localhost:5173/api/repos/update";

const payload = {
  filePath: "/home/mattpocock/repos/ai/ai-typescript-toolkit/exercises",
  modifiedLessons: {
    "20-reference/101-stream-object-partial-object-stream":
      "101-reference/101-stream-object-partial-object-stream",
  },
  deletedLessons: [],
  addedLessons: [],
};

async function main() {
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await res.text();
    console.log("Status:", res.status);
    console.log("Response:", data);
  } catch (err) {
    console.error("Error:", err);
  }
}

main();

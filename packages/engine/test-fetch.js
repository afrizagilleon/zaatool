async function test() {
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer dummy`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [{ role: "user", content: "hello" }],
      }),
    });
    console.log(res.status);
    console.log(await res.text());
  } catch (err) {
    console.error("fetch failed:", err);
  }
}

test();

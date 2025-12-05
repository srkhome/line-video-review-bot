const axios = require("axios");
const FormData = require("form-data");

const LINE_REPLY_URL = "https://api.line.me/v2/bot/message/reply";
const LINE_CONTENT_URL = "https://api-data.line.me/v2/bot/message";

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  try {
    const body = req.body || {};
    const events = body.events || [];

    for (const event of events) {
      if (event.type !== "message") continue;

      const replyToken = event.replyToken;
      const message = event.message;

      if (message.type === "text") {
        await handleTextMessage(replyToken, message.text);
      } else if (message.type === "video") {
        await handleVideoMessage(replyToken, message.id);
      }
    }

    res.status(200).send("OK");
  } catch (err) {
    console.error("Webhook error:", err && (err.response && err.response.data || err));
    res.status(500).send("Error");
  }
};

async function handleTextMessage(replyToken, text) {
  const isUrl = /^https?:\/\//i.test((text || "").trim());

  if (!isUrl) {
    await replyMessage(replyToken, "請貼上影片網址，或直接上傳影片檔給我 👍");
    return;
  }

  const prompt =
    "你是一位影片腳本與故事行銷顧問。\n\n" +
    "使用者貼了一支影片連結：\n" +
    text +
    "\n\n請你根據「一般商業行銷影片」的假設，提供：\n" +
    "1. 以 1～10 分評價這支影片可能的表現（假設拍攝普通、有解說、有產品）\n" +
    "2. 列出 3 個可能的優點\n" +
    "3. 列出 3 個可以優化的地方\n" +
    "4. 幫我重寫一個「60 秒影片腳本」，用「故事行銷＋反差開場」方式，請用繁體中文。";

  try {
    const aiResult = await askGPT(prompt);
    await replyMessage(replyToken, aiResult);
  } catch (err) {
    console.error("handleTextMessage error:", err && (err.response && err.response.data || err));
    await replyMessage(
      replyToken,
      "影片評估時發生錯誤，請稍後再試，或先改用貼網址/短一點的影片 🙏"
    );
  }
}

async function handleVideoMessage(replyToken, messageId) {
  try {
    const videoBuffer = await downloadLineContent(messageId);
    const transcript = await speechToText(videoBuffer);

    const prompt =
      "你是一位影片腳本與故事行銷顧問。\n\n" +
      "以下是某支行銷影片的逐字稿內容（可能是繁體或口語中文）：\n「" +
      transcript +
      "」\n\n請你：\n" +
      "1. 幫這支影片打分數（1～10 分），並簡短說明原因\n" +
      "2. 條列說明這支影片的優點（最多 3 點）\n" +
      "3. 條列說明可以優化的地方（最多 3 點）\n" +
      "4. 幫我重寫一個「60 秒影片腳本」，風格要求：\n" +
      "   - 故事行銷＋反差開場\n" +
      "   - 一開頭要有強烈對比（現實困境 vs 理想畫面）\n" +
      "   - 段落請清楚分行\n" +
      "   - 使用繁體中文，口語一點，適合拍成短影片配音。";

    const aiResult = await askGPT(prompt);
    await replyMessage(replyToken, aiResult);
  } catch (err) {
    console.error("handleVideoMessage error:", err && (err.response && err.response.data || err));
    await replyMessage(
      replyToken,
      "影片分析時發生錯誤，請稍後再試，或先改用貼網址的方式 🙏"
    );
  }
}

async function downloadLineContent(messageId) {
  const res = await axios.get(LINE_CONTENT_URL + "/" + messageId + "/content", {
    responseType: "arraybuffer",
    headers: {
      Authorization: "Bearer " + process.env.LINE_CHANNEL_ACCESS_TOKEN,
    },
  });
  return Buffer.from(res.data);
}

async function speechToText(audioBuffer) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");

  const form = new FormData();
  form.append("file", audioBuffer, {
    filename: "input.mp4",
    contentType: "video/mp4",
  });
  form.append("model", "whisper-1");
  form.append("response_format", "text");

  const res = await axios.post(
    "https://api.openai.com/v1/audio/transcriptions",
    form,
    {
      headers: Object.assign(
        {
          Authorization: "Bearer " + apiKey,
        },
        form.getHeaders()
      ),
      timeout: 120000,
    }
  );

  return typeof res.data === "string" ? res.data : res.data.text;
}

async function askGPT(prompt) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");

  const res = await axios.post(
    "https://api.openai.com/v1/chat/completions",
    {
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content:
            "你是一位擅長故事行銷與短影片腳本設計的專業顧問，請用繁體中文回答。",
        },
        { role: "user", content: prompt },
      ],
    },
    {
      headers: {
        Authorization: "Bearer " + apiKey,
        "Content-Type": "application/json",
      },
      timeout: 120000,
    }
  );

  return res.data.choices[0].message.content.trim();
}

async function replyMessage(replyToken, text) {
  let msg = text || "(沒有內容)";
  const maxLen = 4900;
  if (msg.length > maxLen) {
    msg = msg.slice(0, maxLen - 10) + "...\n(內容過長已截斷)";
  }

  await axios.post(
    LINE_REPLY_URL,
    {
      replyToken: replyToken,
      messages: [{ type: "text", text: msg }],
    },
    {
      headers: {
        Authorization: "Bearer " + process.env.LINE_CHANNEL_ACCESS_TOKEN,
        "Content-Type": "application/json",
      },
    }
  );
}

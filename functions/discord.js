export async function onRequestPost({ request, env }) { // 注意這裡多了 env
    try {
      // 1. 你的 Discord Webhook URL (建議之後改用環境變數，現在先寫死測試)
      const WEBHOOK_URL = env.DISCORD_WEBHOOK_URL;

      if (!WEBHOOK_URL) throw new Error("Webhook URL not configured");

      // 2. 讀取前端傳來的資料 (例如檔名、時長)
      const data = await request.json();
      
      // 3. 構建 Discord 訊息
      const payload = {
        content: "🎉 **有人 Export 影片啦！**",
        embeds: [{
          title: "New Export Triggered",
          color: 5814783, // 藍色
          fields: [
            { name: "Filename", value: data.filename || "Unknown", inline: true },
            { name: "Duration", value: `${data.duration}s`, inline: true },
            { name: "Time", value: new Date().toLocaleString(), inline: false }
          ]
        }]
      };
  
      // 4. 由 Cloudflare 伺服器發送請求給 Discord (這不會有 CORS 問題)
      const response = await fetch(WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
  
      return new Response(JSON.stringify({ success: true }), {
        headers: { "Content-Type": "application/json" }
      });
  
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
  }
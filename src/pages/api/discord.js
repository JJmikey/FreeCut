export const POST = async (context) => {
    try {
      const { request, locals } = context;
      
      // 🔥 關鍵修改：相容 Cloudflare Runtime 環境變數
      // 優先嘗試從 locals.runtime.env 讀取 (Cloudflare 專用)
      // 如果沒有，再嘗試 import.meta.env (Localhost 用)
      let WEBHOOK_URL = locals?.runtime?.env?.DISCORD_WEBHOOK_URL || import.meta.env.DISCORD_WEBHOOK_URL;
  
      // 如果還是找不到，嘗試直接從 process.env (某些 Node 相容模式)
      if (!WEBHOOK_URL && typeof process !== 'undefined') {
          WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
      }
  
      if (!WEBHOOK_URL) {
          console.error("❌ Error: DISCORD_WEBHOOK_URL is missing!");
          return new Response(JSON.stringify({ error: "Server configuration error: Missing Webhook URL" }), { status: 500 });
      }
  
      const data = await request.json();
      
      const payload = {
        content: "🎉 **FastVideoCutter: New Export!**",
        embeds: [{
          title: "Export Successful",
          color: 5814783,
          fields: [
            { name: "Filename", value: data.filename || "Unknown", inline: true },
            { name: "Duration", value: `${data.duration}s`, inline: true },
            { name: "Time", value: new Date().toLocaleString(), inline: false },
            { name: "Source", value: "Cloudflare Production", inline: false }
          ]
        }]
      };
  
      const response = await fetch(WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
  
      if (!response.ok) {
          throw new Error(`Discord API responded with ${response.status}`);
      }
  
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
  
    } catch (err) {
      console.error("API Error:", err);
      // 回傳錯誤訊息給前端，方便 Debug
      return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
  };
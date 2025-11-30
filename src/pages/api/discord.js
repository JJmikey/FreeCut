export const POST = async (context) => {
  try {
    const { request, locals } = context;
    
    // 讀取環境變數
    let WEBHOOK_URL = locals?.runtime?.env?.DISCORD_WEBHOOK_URL || import.meta.env.DISCORD_WEBHOOK_URL;

    if (!WEBHOOK_URL) {
        return new Response(JSON.stringify({ error: "Missing Webhook URL" }), { status: 500 });
    }

    const data = await request.json();
    const type = data.type; // 'export', 'import', 'sample', 'visit'

    // 🔥 定義不同事件的樣式
    let title = "New Activity";
    let color = 10070709; // 預設灰色
    let description = "";

    switch (type) {
        case 'export':
            title = "🚀 New Video Exported!";
            color = 5814783; // 綠色 (Green)
            break;
        case 'import':
            title = "📂 User Imported Media";
            color = 3901635; // 藍色 (Blue)
            break;
        case 'sample':
            title = "🧪 User Loaded Sample Project";
            color = 11665663; // 紫色 (Purple)
            break;
        case 'visit':
            title = "👀 New Visitor";
            color = 9807270; // 灰`色
            break;
        case 'error':
            title = "error";
            color = 15158332; // 灰色
            break;
         // 🔥 新增：開始導出
         case 'export_start':
          title = "⏳ Export Started..."; // 進行中 (黃色)
          color = 16776960; 
          break;
    }

    // 構建 Fields
    const fields = [];
    
    if (data.filename) fields.push({ name: "File", value: data.filename, inline: true });
    if (data.fileCount) fields.push({ name: "Count", value: `${data.fileCount} files`, inline: true });
    if (data.duration) fields.push({ name: "Duration", value: `${data.duration}s`, inline: true });
    
    fields.push({ name: "Time", value: new Date().toLocaleString(), inline: false });

    const payload = {
      embeds: [{
        title: title,
        color: color,
        description: description,
        fields: fields
      }]
    };

    const response = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    return new Response(JSON.stringify({ success: true }), { status: 200 });

  } catch (err) {
    console.error("API Error:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};
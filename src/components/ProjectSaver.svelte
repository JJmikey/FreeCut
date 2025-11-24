<script>
    import { onMount } from 'svelte';
    // 🔥 引入 uploadedFiles
    import { mainTrackClips, audioTrackClips, uploadedFiles } from '../stores/timelineStore';
    import { saveProject, loadProject } from '../utils/projectManager';

    onMount(async () => {
        console.log("✅ ProjectSaver: 組件已掛載，準備啟動...");

        try {
            console.log("📂 ProjectSaver: 正在讀取資料庫...");
            const success = await loadProject();
            console.log(success ? "🎉 ProjectSaver: 專案恢復成功！" : "ℹ️ ProjectSaver: 沒有舊存檔，建立新專案。");
        } catch (err) {
            console.error("❌ ProjectSaver: 讀取失敗", err);
        }

        let timer;
        const autoSave = () => {
            // console.log("⏳ ProjectSaver: 偵測到變動...");
            clearTimeout(timer);
            timer = setTimeout(async () => {
                try {
                    await saveProject();
                    console.log("💾 ProjectSaver: 存檔完成！");
                } catch (e) {
                    console.error("❌ ProjectSaver: 存檔失敗", e);
                }
            }, 1000);
        };

        const unsubscribeMain = mainTrackClips.subscribe(autoSave);
        const unsubscribeAudio = audioTrackClips.subscribe(autoSave);
        // 🔥 訂閱素材庫變動
        const unsubscribeFiles = uploadedFiles.subscribe(autoSave);

        return () => {
            unsubscribeMain();
            unsubscribeAudio();
            unsubscribeFiles();
        };
    });
</script>

<!-- 為了測試，我們加一個臨時按鈕，確定它真的有渲染出來 -->
<div class="fixed bottom-4 right-4 z-50 bg-red-600 text-white px-2 py-1 text-xs rounded opacity-50 hover:opacity-100 cursor-pointer" on:click={() => saveProject()}>
    Force Save (Debug)
</div>
<script>
  import { startExportTrigger, isExporting } from '../stores/exportStore';
  import { clearProject } from '../utils/projectManager';

  function handleExport() {
    startExportTrigger.update(n => n + 1);
  }

  async function handleNewProject() {
    console.log("🗑️ [Header] New Project 按鈕被點擊");

    if (!confirm("Are you sure you want to start a new project? All current progress will be lost.")) {
        return;
    }

    try {
        console.log("正在清除資料庫...");
        await clearProject();
        
        console.log("資料庫已清除，正在重新整理頁面...");
        // 🔥 強制重新整理：這是最穩健的重置方式
        // 它會自動清空所有 Store (selectedClipIds, draggedFile 等)，無需手動 set([])
        window.location.reload();

    } catch (e) {
        console.error("❌ New Project Error:", e);
        alert("Error resetting project. Check console.");
    }
  }
</script>

<header class="h-14 border-b border-gray-700 flex justify-between items-center px-4 bg-[#181818] flex-shrink-0">
  <div class="flex items-center gap-6">
    <div class="flex items-center gap-2 cursor-pointer">
      <div class="w-6 h-6 bg-cyan-600 rounded flex items-center justify-center font-bold text-white text-xs">C</div>
      <span class="text-gray-100 font-bold text-lg">CapCut Clone</span>
    </div>
    
    <div class="h-4 w-[1px] bg-gray-600"></div>
    <span class="text-sm text-gray-400">Untitled Project</span>

    <button 
        on:click={handleNewProject}
        class="text-xs text-gray-400 hover:text-white flex items-center gap-1 px-2 py-1 rounded hover:bg-white/10 transition-colors"
        title="Start New Project (Clear All)"
    >
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>
        New
    </button>
  </div>
  
  <button 
    on:click={handleExport}
    disabled={$isExporting}
    class="bg-cyan-600 hover:bg-cyan-500 disabled:bg-gray-600 disabled:cursor-not-allowed text-white px-4 py-1.5 rounded text-sm font-medium flex items-center gap-2 transition-colors"
  >
    {#if $isExporting}
      <div class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
      Exporting...
    {:else}
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
      Export
    {/if}
  </button>
</header>
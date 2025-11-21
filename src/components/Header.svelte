<!-- src/components/Header.svelte -->
<script>
    import { startExportTrigger, isExporting } from '../stores/exportStore';
  
    function handleExport() {
      // 觸發信號，次數 +1 代表一個新的動作
      startExportTrigger.update(n => n + 1);
    }
  </script>
  
  <header class="h-14 border-b border-gray-700 flex justify-between items-center px-4 bg-[#181818] flex-shrink-0">
    <div class="flex items-center gap-6">
      <div class="flex items-center gap-2 cursor-pointer">
        <span class="text-cyan-400 font-bold text-lg">CapCut AI</span>
      </div>
      <div class="h-4 w-[1px] bg-gray-600"></div>
      <span class="text-sm text-gray-400">Untitled Project</span>
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
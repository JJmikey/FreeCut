<script>
  import { currentVideoSource } from '../stores/playerStore';
  import { draggedFile, uploadedFiles } from '../stores/timelineStore'; // 🔥 引入 uploadedFiles
  import { generateThumbnails } from '../utils/thumbnailGenerator';

  let fileInput;
  // ❌ 移除舊的: let files = [];
  // 我們現在直接操作 $uploadedFiles

  let activeFilter = 'all';


  function handleClick() {
      console.log("🖱️ Import 按鈕被點擊了");
      
      if (!fileInput) {
          console.error("❌ 錯誤：找不到 fileInput 元素！請檢查 bind:this");
          return;
      }
      
      console.log("✅ 觸發 fileInput.click()");
      fileInput.click();
  }

  function getMediaDuration(file, url) {
    return new Promise((resolve) => {
      if (file.type.startsWith('image')) {
        resolve(3); 
      } else if (file.type.startsWith('video')) {
        const video = document.createElement('video');
        video.preload = 'metadata';
        video.onloadedmetadata = () => resolve(video.duration);
        video.onerror = () => resolve(5);
        video.src = url;
      } else if (file.type.startsWith('audio')) {
        const audio = new Audio();
        audio.onloadedmetadata = () => resolve(audio.duration);
        audio.onerror = () => resolve(5);
        audio.src = url;
      } else {
        resolve(5);
      }
    });
  }

  async function handleFileChange(e) {
    const newRawFiles = Array.from(e.target.files);
    const processedPromises = newRawFiles.map(async (file) => {
      if (file.size > 2 * 1024 * 1024 * 1024) {
          alert(`File "${file.name}" too large! Please use files under 2GB.`);
          return null;
      }
      const url = URL.createObjectURL(file);
      const duration = await getMediaDuration(file, url);

       // 🔥 2. 生成縮圖 Blob
       const thumbnailBlobs = await generateThumbnails(file);
       const thumbnailUrls = thumbnailBlobs.map(b => URL.createObjectURL(b));

      
      return {
        name: file.name,
        type: file.type,
        url: url,
        duration: duration,
        file: file,
        // 🔥 儲存縮圖資訊
        thumbnails: thumbnailBlobs, 
        thumbnailUrls: thumbnailUrls
      };
    });

    const results = await Promise.all(processedPromises);
    const validFiles = results.filter(result => result !== null);
    
    // 🔥 更新 Store (使用 update)
    uploadedFiles.update(currentFiles => [...currentFiles, ...validFiles]);
    
    e.target.value = '';
    activeFilter = 'all';
  }

  function selectMedia(file) {
    if (file.type.startsWith('video') || file.type.startsWith('image') || file.type.startsWith('audio')) {
      currentVideoSource.set(file);
    }
  }

  function handleDragStart(e, file) {
    draggedFile.set({ 
        file: file.file,
        thumbnails: file.thumbnails // 這是重點！
    });
    const dragData = JSON.stringify({
        url: file.url,
        name: file.name,
        type: file.type,
        duration: file.duration,
        // 🔥 3. 把縮圖 URL 也傳給 Timeline 
        thumbnailUrls: file.thumbnailUrls 
    });
    e.dataTransfer.setData('application/json', dragData);
    e.dataTransfer.effectAllowed = 'copy';
  }

  function handleDelete(e, fileToDelete) {
      e.stopPropagation(); 
      if (!confirm(`確定要從素材庫移除 "${fileToDelete.name}" 嗎？`)) return;

      // 🔥 更新 Store
      uploadedFiles.update(currentFiles => currentFiles.filter(f => f !== fileToDelete));

      currentVideoSource.update(curr => {
          if (curr && curr.url === fileToDelete.url) return null;
          return curr;
      });
  }

  // 🔥 使用 $uploadedFiles 進行過濾
  $: filteredFiles = $uploadedFiles.filter(f => {
      if (activeFilter === 'all') return true;
      return f.type.startsWith(activeFilter);
  });

  // 🔥 使用 $uploadedFiles 計算數量
  $: countVideo = $uploadedFiles.filter(f => f.type.startsWith('video')).length;
  $: countAudio = $uploadedFiles.filter(f => f.type.startsWith('audio')).length;
  $: countImage = $uploadedFiles.filter(f => f.type.startsWith('image')).length;
</script>

<div class="flex flex-col h-full">
    
    <!-- Import Button -->
    <div class="shrink-0 mb-4">
        <button on:click={handleClick} class="w-full border-2 border-dashed border-gray-600 rounded-lg h-24 flex flex-col justify-center items-center gap-2 cursor-pointer hover:border-gray-500 hover:bg-[#2a2a2a] transition-colors group">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-gray-400 group-hover:text-gray-200"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/></svg>
            <span class="text-xs text-gray-400 group-hover:text-gray-200">Import Media</span>
        </button>
        <input bind:this={fileInput} type="file" class="hidden" multiple accept="image/*,video/*,audio/*" on:change={handleFileChange} />
    </div>

    <!-- Filter Tabs -->
    <div class="flex items-center gap-2 mb-2 shrink-0 overflow-x-auto no-scrollbar pb-1">
        <button class="px-3 py-1 rounded-full text-[10px] font-medium border transition-colors whitespace-nowrap {activeFilter === 'all' ? 'bg-gray-200 text-black border-gray-200' : 'bg-transparent text-gray-400 border-gray-600 hover:border-gray-400'}" on:click={() => activeFilter = 'all'}>All ({$uploadedFiles.length})</button>
        <button class="px-3 py-1 rounded-full text-[10px] font-medium border transition-colors whitespace-nowrap {activeFilter === 'video' ? 'bg-cyan-900 text-cyan-400 border-cyan-500' : 'bg-transparent text-gray-400 border-gray-600 hover:border-gray-400'}" on:click={() => activeFilter = 'video'}>Video ({countVideo})</button>
        <button class="px-3 py-1 rounded-full text-[10px] font-medium border transition-colors whitespace-nowrap {activeFilter === 'audio' ? 'bg-green-900 text-green-400 border-green-500' : 'bg-transparent text-gray-400 border-gray-600 hover:border-gray-400'}" on:click={() => activeFilter = 'audio'}>Audio ({countAudio})</button>
        <button class="px-3 py-1 rounded-full text-[10px] font-medium border transition-colors whitespace-nowrap {activeFilter === 'image' ? 'bg-purple-900 text-purple-400 border-purple-500' : 'bg-transparent text-gray-400 border-gray-600 hover:border-gray-400'}" on:click={() => activeFilter = 'image'}>Image ({countImage})</button>
    </div>

    <!-- File List -->
    {#if filteredFiles.length > 0}
        <div class="grid grid-cols-2 gap-2 overflow-y-auto flex-1 pr-1 custom-scrollbar content-start">
            {#each filteredFiles as file}
            <div 
                draggable="true"
                on:dragstart={(e) => handleDragStart(e, file)}
                on:click={() => selectMedia(file)}
                class="relative bg-black rounded overflow-hidden group border border-transparent hover:border-cyan-400 cursor-grab active:cursor-grabbing
                       {file.type.startsWith('audio') ? 'h-12 col-span-2 flex items-center px-2 gap-2' : 'aspect-square'}" 
                role="button" 
                tabindex="0"
            >
                <button 
                    on:click={(e) => handleDelete(e, file)}
                    class="absolute top-1 left-1 w-5 h-5 bg-black/60 hover:bg-red-600 rounded flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-all z-20"
                    title="Remove file"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </button>

                {#if file.type.startsWith('image')}
                    <img src={file.url} alt={file.name} class="w-full h-full object-cover pointer-events-none" />
                    <div class="absolute top-1 right-1 bg-purple-600/80 px-1 rounded text-[8px] text-white">IMG</div>
                {:else if file.type.startsWith('video')}
                    <video src={file.url} class="w-full h-full object-cover pointer-events-none"></video>
                    <div class="absolute top-1 right-1 bg-cyan-600/80 px-1 rounded text-[8px] text-white">{Math.floor(file.duration)}s</div>
                {:else if file.type.startsWith('audio')}
                    <div class="w-8 h-8 rounded-full bg-green-900 flex items-center justify-center shrink-0">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-green-400"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
                    </div>
                    <div class="flex-1 min-w-0 flex flex-col justify-center">
                        <p class="text-[10px] text-white truncate leading-tight">{file.name}</p>
                        <p class="text-[9px] text-gray-400">{Math.floor(file.duration)}s</p>
                    </div>
                {/if}

                {#if !file.type.startsWith('audio')}
                    <div class="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 to-transparent p-1 pt-4 truncate">
                        <p class="text-[10px] text-white leading-none">{file.name}</p>
                    </div>
                {/if}
            </div>
            {/each}
        </div>
    {:else}
        <div class="flex-1 flex flex-col items-center justify-center text-gray-600 gap-2">
            <p class="text-xs">No {activeFilter !== 'all' ? activeFilter : ''} files</p>
        </div>
    {/if}
</div>

<style>
  .custom-scrollbar::-webkit-scrollbar { width: 4px; }
  .custom-scrollbar::-webkit-scrollbar-thumb { background: #444; border-radius: 2px; }
  .no-scrollbar::-webkit-scrollbar { display: none; }
  .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
</style>
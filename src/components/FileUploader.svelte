<script>
    import { currentVideoSource } from '../stores/playerStore';
    // 引入 Stores (包含 resolveOverlaps)
    import { draggedFile, uploadedFiles, textTrackClips, createTextClip, resolveOverlaps } from '../stores/timelineStore';
    // 🔥 新增：引入 History Store
    import { addToHistory } from '../stores/historyStore';
    
    // 引入工具函式
    import { generateThumbnails } from '../utils/thumbnailGenerator';
    import { generateWaveform } from '../utils/waveformGenerator'; 
    import { get } from 'svelte/store';
    
    let fileInput;
    
    // UI 狀態
    let isProcessing = false;
    let activeFilter = 'all'; // 'all', 'video', 'audio', 'image'
    let activeTab = 'media';  // 'media' or 'text'
  
    function handleClick() { 
        if (isProcessing) return; 
        fileInput.click(); 
    }
  
    // 🔥 Helper: 取得檔案真實長度
    function getMediaDuration(file, url) {
      return new Promise((resolve) => {
        if (file.type.startsWith('image')) { resolve(3); return; } 
  
        const isVideo = file.type.startsWith('video') || file.name.toLowerCase().endsWith('.mov');
        const element = isVideo ? document.createElement('video') : document.createElement('audio');
        
        element.preload = 'auto'; 
        element.muted = true;
        element.src = url;
        if (isVideo) element.playsInline = true;
  
        const isMov = file.name.toLowerCase().endsWith('.mov') || file.type === 'video/quicktime';
        let isResolved = false;
  
        const timeout = setTimeout(() => {
            if (isResolved) return;
            isResolved = true;
            if (isMov) {
                alert(`Load Failed: ${file.name}\n\nYour system may not support this video format (likely HEVC). Please use MP4 or try Chrome/Safari.`);
                resolve(null);
            } else {
                console.warn("⚠️ [Debug] Read timeout, returning default 30s");
                resolve(30);
            }
        }, 4000);
  
        element.onloadedmetadata = () => {
            if (isResolved) return;
  
            if (element instanceof HTMLVideoElement) {
                if (element.videoWidth === 0 || element.videoHeight === 0) {
                    isResolved = true;
                    clearTimeout(timeout);
                    alert(`Format Not Supported: ${file.name}`);
                    resolve(null);
                    return;
                }
                try {
                    element.currentTime = 0.1; 
                    const cvs = document.createElement('canvas');
                    cvs.width = 16; cvs.height = 16;
                    const ctx = cvs.getContext('2d');
                    ctx.drawImage(element, 0, 0, 16, 16);
                } catch (e) {
                    console.warn("Pixel read warning:", e);
                }
            }
  
            const rawDuration = element.duration;
            const isWebM = file.type === 'video/webm' || file.name.toLowerCase().endsWith('.webm');
  
            if (!isWebM && rawDuration !== Infinity && !isNaN(rawDuration)) {
                isResolved = true;
                clearTimeout(timeout);
                resolve(rawDuration);
                return;
            }
  
            console.log("⚠️ [Debug] Starting WebM duration fix...");
            element.currentTime = 1e7; 
            
            element.onseeked = () => {
                if (isResolved) return;
                isResolved = true;
                clearTimeout(timeout);
  
                let realDuration = element.currentTime;
                
                if (Math.abs(realDuration - rawDuration) < 1 || realDuration > 36000) {
                    if (element.buffered.length > 0) {
                        const bufferedEnd = element.buffered.end(element.buffered.length - 1);
                        if (bufferedEnd > 0) realDuration = bufferedEnd;
                    }
                }
  
                if (realDuration === 0 && rawDuration > 0 && rawDuration !== Infinity) {
                     resolve(rawDuration);
                } else {
                     resolve(realDuration);
                }
            };
        };
  
        element.onerror = () => { 
            if (isResolved) return;
            isResolved = true;
            clearTimeout(timeout);
            if (isMov) {
                alert(`Cannot Load: ${file.name}\nFormat not supported.`);
                resolve(null);
            } else {
                resolve(5); 
            }
        };
      });
    }
  
    // 處理檔案上傳
    async function handleFileChange(e) {
      const newRawFiles = Array.from(e.target.files);
      if (newRawFiles.length === 0) return;
  
      isProcessing = true;
  
      try {
          const processedPromises = newRawFiles.map(async (file) => {
              if (file.size > 2 * 1024 * 1024 * 1024) {
                  alert(`File "${file.name}" is too large! Please use files under 2GB.`);
                  return null;
              }
  
              const url = URL.createObjectURL(file);
              const duration = await getMediaDuration(file, url);
              
              if (duration === null) return null;

              // 長影片警告
              const DURATION_LIMIT = 1800; 
              if (duration > DURATION_LIMIT) {
                  const confirmLarge = window.confirm(
                      `⚠️ Large File Warning: "${file.name}"\n\n` +
                      `This video is over 30 minutes long (${Math.floor(duration/60)} mins).\n` +
                      `Browser-based editing may run out of memory and crash with large files.\n\n` +
                      `We recommend trimming it into shorter segments.\n` +
                      `Do you still want to proceed?`
                  );
                  if (!confirmLarge) return null;
              }
              
              const thumbnailBlobs = await generateThumbnails(file, duration);
              const thumbnailUrls = thumbnailBlobs.map(b => URL.createObjectURL(b));
  
              let waveform = null;
              const isVideo = file.type.startsWith('video') || file.name.toLowerCase().endsWith('.mov');
              const isAudio = file.type.startsWith('audio');
              
              if (isVideo || isAudio) {
                  waveform = await generateWaveform(file);
              }
              
              return {
                  name: file.name,
                  type: file.type || (isVideo ? 'video/quicktime' : 'application/octet-stream'),
                  url: url,
                  duration: duration,
                  file: file, 
                  thumbnails: thumbnailBlobs, 
                  waveform: waveform, 
                  thumbnailUrls: thumbnailUrls 
              };
          });
  
          const results = await Promise.all(processedPromises);
          const validFiles = results.filter(result => result !== null);
          
          uploadedFiles.update(currentFiles => [...currentFiles, ...validFiles]);
          
          // Import 通知
        if (validFiles.length > 0) {
            const firstFile = validFiles[0];
            fetch('/api/discord', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: 'import',
                    filename: firstFile.name,
                    fileCount: validFiles.length,
                    duration: firstFile.duration ? Math.round(firstFile.duration) : 0
                })
            }).catch(e => console.warn("Webhook failed", e));
        }

          e.target.value = '';
          activeFilter = 'all'; 
  
      } catch (error) {
          console.error("Import failed:", error);
          alert("Import failed. See console for details.");
      } finally {
          isProcessing = false;
      }
    }
  
    function selectMedia(file) {
      const type = file.type || '';
      if (type.startsWith('video') || type.startsWith('image') || type.startsWith('audio') || file.name.endsWith('.mov')) {
        currentVideoSource.set(file);
      }
    }
  
    function handleDragStart(e, file) {
      draggedFile.set({ 
          file: file.file,
          thumbnails: file.thumbnails,
          waveform: file.waveform 
      });
  
      const dragData = JSON.stringify({
          url: file.url,
          name: file.name,
          type: file.type,
          duration: file.duration,
          thumbnailUrls: file.thumbnailUrls || [],
          waveform: file.waveform 
      });
      
      e.dataTransfer.setData('application/json', dragData);
      e.dataTransfer.effectAllowed = 'copy';
    }
  
    function handleDelete(e, fileToDelete) {
        e.stopPropagation(); 
        if (!confirm(`Are you sure to delete "${fileToDelete.name}" ?`)) return;
  
        uploadedFiles.update(currentFiles => currentFiles.filter(f => f !== fileToDelete));
  
        currentVideoSource.update(curr => {
            if (curr && curr.url === fileToDelete.url) return null;
            return curr;
        });
    }
  
    // 🔥🔥🔥 核心修改：新增文字前呼叫 addToHistory 🔥🔥🔥
    function addTextToTimeline() {
        // 1. 先存檔
        addToHistory();

        // 2. 再執行修改
        const clips = get(textTrackClips);
        const currentMaxTime = clips.length > 0 ? Math.max(...clips.map(c => c.startOffset + c.duration)) : 0;
        const newClip = createTextClip(currentMaxTime);
        textTrackClips.update(currentClips => {
            const newClips = [...currentClips, newClip];
            return resolveOverlaps(newClips, newClip.id);
        });
    }
  
    $: safeFiles = $uploadedFiles || [];
    $: filteredFiles = safeFiles.filter(f => {
        if (activeFilter === 'all') return true;
        const type = f.type || '';
        if (activeFilter === 'video') return type.startsWith('video') || f.name.endsWith('.mov');
        return type.startsWith(activeFilter);
    });
    $: countVideo = safeFiles.filter(f => (f.type || '').startsWith('video') || f.name.endsWith('.mov')).length;
    $: countAudio = safeFiles.filter(f => (f.type || '').startsWith('audio')).length;
    $: countImage = safeFiles.filter(f => (f.type || '').startsWith('image')).length;
  
  </script>
  
  <div class="flex flex-col h-full">
      
      <div class="flex border-b border-gray-700 mb-4 shrink-0">
          <button class="flex-1 py-3 text-sm font-medium {activeTab === 'media' ? 'text-cyan-400 border-b-2 border-cyan-400 bg-[#252525]' : 'text-gray-400 hover:text-gray-200'}" on:click={() => activeTab = 'media'}>Media</button>
          <button class="flex-1 py-3 text-sm font-medium {activeTab === 'text' ? 'text-cyan-400 border-b-2 border-cyan-400 bg-[#252525]' : 'text-gray-400 hover:text-gray-200'}" on:click={() => activeTab = 'text'}>Text</button>
      </div>
  
      {#if activeTab === 'media'}
          
          <div class="shrink-0 mb-4">
              <button 
                  on:click={handleClick} 
                  disabled={isProcessing}
                  class="w-full border-2 border-dashed border-gray-600 rounded-lg h-24 flex flex-col justify-center items-center gap-2 cursor-pointer hover:border-gray-500 hover:bg-[#2a2a2a] transition-colors group disabled:opacity-50 disabled:cursor-not-allowed"
              >
                  {#if isProcessing}
                      <div class="w-6 h-6 border-2 border-gray-400 border-t-cyan-400 rounded-full animate-spin"></div>
                      <span class="text-xs text-cyan-400 font-bold animate-pulse">Processing...</span>
                  {:else}
                      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-gray-400 group-hover:text-gray-200"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/></svg>
                      <span class="text-xs text-gray-400 group-hover:text-gray-200">Import Media</span>
                  {/if}
              </button>
              <input id="global-file-input" bind:this={fileInput} type="file" class="hidden" multiple accept="image/*,video/*,audio/*,.mov,.mkv" on:change={handleFileChange} />
          </div>
  
          <div class="flex items-center gap-2 mb-2 shrink-0 overflow-x-auto no-scrollbar pb-1">
              <button class="px-3 py-1 rounded-full text-[10px] font-medium border transition-colors whitespace-nowrap {activeFilter === 'all' ? 'bg-gray-200 text-black border-gray-200' : 'bg-transparent text-gray-400 border-gray-600 hover:border-gray-400'}" on:click={() => activeFilter = 'all'}>All ({safeFiles.length})</button>
              <button class="px-3 py-1 rounded-full text-[10px] font-medium border transition-colors whitespace-nowrap {activeFilter === 'video' ? 'bg-cyan-900 text-cyan-400 border-cyan-500' : 'bg-transparent text-gray-400 border-gray-600 hover:border-gray-400'}" on:click={() => activeFilter = 'video'}>Video ({countVideo})</button>
              <button class="px-3 py-1 rounded-full text-[10px] font-medium border transition-colors whitespace-nowrap {activeFilter === 'audio' ? 'bg-green-900 text-green-400 border-green-500' : 'bg-transparent text-gray-400 border-gray-600 hover:border-gray-400'}" on:click={() => activeFilter = 'audio'}>Audio ({countAudio})</button>
              <button class="px-3 py-1 rounded-full text-[10px] font-medium border transition-colors whitespace-nowrap {activeFilter === 'image' ? 'bg-purple-900 text-purple-400 border-purple-500' : 'bg-transparent text-gray-400 border-gray-600 hover:border-gray-400'}" on:click={() => activeFilter = 'image'}>Image ({countImage})</button>
          </div>
  
          {#if filteredFiles.length > 0}
              <div class="grid grid-cols-2 gap-2 overflow-y-auto flex-1 pr-1 custom-scrollbar content-start">
                  {#each filteredFiles as file}
                  <div 
                      draggable="true"
                      on:dragstart={(e) => handleDragStart(e, file)}
                      on:click={() => selectMedia(file)}
                      class="relative bg-black rounded overflow-hidden group border border-transparent hover:border-cyan-400 cursor-grab active:cursor-grabbing
                             {file.type && file.type.startsWith('audio') ? 'h-12 col-span-2 flex items-center px-2 gap-2' : 'aspect-square'}" 
                      role="button" 
                      tabindex="0"
                  >
                      <button on:click={(e) => handleDelete(e, file)} class="absolute top-1 left-1 w-5 h-5 bg-black/60 hover:bg-red-600 rounded flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-all z-20" title="Remove file"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>
  
                      {#if file.type && file.type.startsWith('image')}
                          <img src={file.url} alt={file.name} class="w-full h-full object-cover pointer-events-none" />
                          <div class="absolute top-1 right-1 bg-purple-600/80 px-1 rounded text-[8px] text-white">IMG</div>
                      {:else if (file.type && file.type.startsWith('video')) || file.name.endsWith('.mov')}
                          <video src={file.url} class="w-full h-full object-cover pointer-events-none"></video>
                          <div class="absolute top-1 right-1 bg-cyan-600/80 px-1 rounded text-[8px] text-white">{Math.floor(file.duration)}s</div>
                      {:else if file.type && file.type.startsWith('audio')}
                          <div class="w-8 h-8 rounded-full bg-green-900 flex items-center justify-center shrink-0"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-green-400"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></div>
                          <div class="flex-1 min-w-0 flex flex-col justify-center">
                              <p class="text-[10px] text-white truncate leading-tight">{file.name}</p>
                              <p class="text-[9px] text-gray-400">{Math.floor(file.duration)}s</p>
                          </div>
                      {/if}
  
                      {#if !(file.type && file.type.startsWith('audio'))}
                          <div class="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 to-transparent p-1 pt-4 truncate"><p class="text-[10px] text-white leading-none">{file.name}</p></div>
                      {/if}
                  </div>
                  {/each}
              </div>
          {:else}
              <div class="flex-1 flex flex-col items-center justify-center text-gray-600 gap-2"><p class="text-xs">No {activeFilter !== 'all' ? activeFilter : ''} files</p></div>
          {/if}
  
      {:else if activeTab === 'text'}
          <div class="flex flex-col gap-4 p-2">
              <button on:click={addTextToTimeline} class="w-full py-3 bg-cyan-900/50 hover:bg-cyan-900/80 text-cyan-400 border border-cyan-700 rounded text-sm transition-colors flex items-center justify-center gap-2"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14"/><path d="M12 5v14"/></svg>Add Default Text</button>
              <div class="text-xs text-gray-500 text-center mt-4">Click button to add a text layer to timeline.<br>Then edit properties in the right panel.</div>
          </div>
      {/if}
  </div>
  
  <style>
    .custom-scrollbar::-webkit-scrollbar { width: 4px; }
    .custom-scrollbar::-webkit-scrollbar-thumb { background: #181818; }
    .no-scrollbar::-webkit-scrollbar { display: none; }
    .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
  </style>
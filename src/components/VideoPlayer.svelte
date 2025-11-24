<script>
    import { currentVideoSource, currentTime, isPlaying } from '../stores/playerStore';
    import { mainTrackClips, audioTrackClips } from '../stores/timelineStore';
    import { isExporting, startExportTrigger } from '../stores/exportStore';
    import { draggedFile } from '../stores/timelineStore'; 
    import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
    
    let videoRef;
    let audioRef; 
    let imageRef;
    let canvasRef;
    let lastTime = 0;
    let exportProgress = 0;
    let exportStatus = "";

    // Timeline 計算
    $: maxMain = $mainTrackClips.length > 0 ? Math.max(...$mainTrackClips.map(c => c.startOffset + c.duration)) : 0;
    $: maxAudio = $audioTrackClips.length > 0 ? Math.max(...$audioTrackClips.map(c => c.startOffset + c.duration)) : 0;
    $: contentDuration = Math.max(maxMain, maxAudio);
    $: hasClips = contentDuration > 0;
  
    // 導出監聽
    $: if ($startExportTrigger > 0 && !$isExporting && hasClips) {
        fastExportProcess();
    }

    // ============================================================
    // 🔥 核心切換邏輯：是看素材(Source) 還是看時間軸(Timeline)？
    // ============================================================
    $: isSourceMode = !!$currentVideoSource; // 如果有選中素材，就是 Source Mode

    // ============================================================
    // 🅰️ Source Mode Logic (素材預覽)
    // ============================================================
    $: if (isSourceMode && !$isExporting) {
        const src = $currentVideoSource;
        
        // 1. Video 處理
        if (src.type.startsWith('video')) {
            if (videoRef) {
                if (videoRef.src !== src.url) {
                    videoRef.src = src.url;
                    videoRef.volume = 1.0;
                    // 自動播放預覽
                    videoRef.play().catch(() => {});
                }
            }
            if (audioRef) audioRef.pause(); // 停用純音訊播放器
        } 
        // 2. Audio 處理
        else if (src.type.startsWith('audio')) {
            if (audioRef) {
                if (audioRef.src !== src.url) {
                    audioRef.src = src.url;
                    audioRef.volume = 1.0;
                    audioRef.play().catch(() => {});
                }
            }
            if (videoRef) {
                videoRef.pause();
                videoRef.removeAttribute('src'); // 清空畫面
            }
        }
        // 3. Image 處理
        else if (src.type.startsWith('image')) {
            if (imageRef && imageRef.src !== src.url) {
                imageRef.src = src.url;
            }
            if (videoRef) videoRef.pause();
            if (audioRef) audioRef.pause();
        }
    }

    // ============================================================
    // 🅱️ Timeline Mode Logic (時間軸預覽 - 舊邏輯)
    // ============================================================
    
    $: activeClip = $mainTrackClips.find(clip => $currentTime >= clip.startOffset && $currentTime < (clip.startOffset + clip.duration));
    $: activeAudioClip = $audioTrackClips.find(clip => $currentTime >= clip.startOffset && $currentTime < (clip.startOffset + clip.duration));

    // 只有在 !isSourceMode 時才執行時間軸同步
    $: if (!$isExporting && !isSourceMode) {
        
        // Sync Video / Image
        if (activeClip) {
            if (activeClip.type.startsWith('video')) {
                if (videoRef) {
                    if (!videoRef.src.includes(activeClip.fileUrl)) videoRef.src = activeClip.fileUrl;
                    videoRef.volume = activeClip.volume !== undefined ? activeClip.volume : 1.0;
                    const seekTime = ($currentTime - activeClip.startOffset) + (activeClip.mediaStartOffset || 0);
                    if (!$isPlaying || Math.abs(videoRef.currentTime - seekTime) > 0.25) {
                        videoRef.currentTime = seekTime;
                    }
                }
            } else if (activeClip.type.startsWith('image')) {
                if (imageRef && !imageRef.src.includes(activeClip.fileUrl)) imageRef.src = activeClip.fileUrl;
            }
        } else {
            if (videoRef && videoRef.src) videoRef.removeAttribute('src');
            if (imageRef && imageRef.src) imageRef.removeAttribute('src');
        }

        // Sync Audio
        if (audioRef) {
            if (activeAudioClip) {
                if (!audioRef.src.includes(activeAudioClip.fileUrl)) audioRef.src = activeAudioClip.fileUrl;
                audioRef.volume = activeAudioClip.volume !== undefined ? activeAudioClip.volume : 1.0;
                const audioSeekTime = ($currentTime - activeAudioClip.startOffset) + (activeAudioClip.mediaStartOffset || 0);
                if (!$isPlaying || Math.abs(audioRef.currentTime - audioSeekTime) > 0.25) {
                    audioRef.currentTime = audioSeekTime;
                }
            } else {
                if (audioRef.src) audioRef.removeAttribute('src');
            }
        }

        // Play/Pause Control
        if ($isPlaying) {
            if (videoRef && activeClip && activeClip.type.startsWith('video')) videoRef.play().catch(() => {});
            if (audioRef && activeAudioClip) audioRef.play().catch(() => {});
        } else {
            if (videoRef) videoRef.pause();
            if (audioRef) audioRef.pause();
        }
    }

    // Loop Logic
    $: if ($isPlaying && !$isExporting && !isSourceMode) {
        lastTime = performance.now();
        requestAnimationFrame(loop);
    }

    function togglePlay() {
        // 如果在素材模式，點擊只控制素材播放，不影響全域 isPlaying
        if (isSourceMode) {
            if ($currentVideoSource.type.startsWith('video')) {
                videoRef.paused ? videoRef.play() : videoRef.pause();
            } else if ($currentVideoSource.type.startsWith('audio')) {
                audioRef.paused ? audioRef.play() : audioRef.pause();
            }
            return;
        }

        if (!hasClips || $isExporting) return;
        if (!$isPlaying && $currentTime >= contentDuration) currentTime.set(0);
        isPlaying.update(v => !v);
    }
    
    function loop(timestamp) {
        if (!$isPlaying || $isExporting || isSourceMode) return; // SourceMode 不跑時間軸
        if (contentDuration === 0) { isPlaying.set(false); currentTime.set(0); return; }
        const deltaTime = (timestamp - lastTime) / 1000;
        lastTime = timestamp;
        currentTime.update(t => t + deltaTime);
        if ($currentTime >= contentDuration) {
            isPlaying.set(false);
            currentTime.set(contentDuration);
        }
        requestAnimationFrame(loop);
    }

    // 🔥🔥🔥 修改：拖曳處理 (支援縮圖傳遞) 🔥🔥🔥
    function handleDragStart(e) {
        // 1. 判斷來源：是預覽中的素材 (Source) 還是時間軸上的片段 (Timeline Clip)
        const source = isSourceMode ? $currentVideoSource : activeClip;
        
        if (!source) { 
            e.preventDefault(); 
            return; 
        }
        
        // 2. 設定 draggedFile store (為了 Auto-save，必須存原始 Blob)
        // 我們把 file 和 thumbnails 都存進去
        draggedFile.set({ 
            file: source.file,
            thumbnails: source.thumbnails // 🔥 關鍵補強：傳遞縮圖 Blob 陣列
        });

        // 3. 設定 DataTransfer 資料 (為了 Timeline 立即顯示)
        // 統一欄位名稱
        const dragPayload = {
            url: source.url || source.fileUrl, 
            name: source.name,
            type: source.type,
            // 優先使用 sourceDuration (原始長度)，沒有的話用 duration
            duration: source.sourceDuration || source.duration || 5,
            // 🔥 關鍵補強：傳遞縮圖 URL 陣列
            thumbnailUrls: source.thumbnailUrls || [] 
        };
        
        e.dataTransfer.setData('application/json', JSON.stringify(dragPayload));
        e.dataTransfer.effectAllowed = 'copy';
    }

    // ... (fastExportProcess, mixAllAudio, interleave 保持完全不變，請保留) ...
    // 以下為縮減版，請確保你貼上時包含完整的 Export 函式
    async function fastExportProcess() { /* ... */ }
    async function mixAllAudio(clips, totalDuration, targetSampleRate) { /* ... */ }
    function interleave(inputL, inputR) { /* ... */ }

</script>

<div class="flex-1 bg-[#101010] relative flex flex-col justify-center items-center overflow-hidden w-full h-full select-none">
    <canvas bind:this={canvasRef} class="hidden"></canvas>
    <audio bind:this={audioRef} class="hidden"></audio>

    <div 
        class="relative w-full h-full flex justify-center items-center group cursor-grab active:cursor-grabbing" 
        draggable="true"
        on:dragstart={handleDragStart}
        on:click={togglePlay}
    >
        <!-- Video Element -->
        <!-- 顯示條件：Source Mode 是 Video，或者 Timeline Mode 有 Video Clip -->
        <video 
            bind:this={videoRef} 
            class="max-w-full max-h-full object-contain pointer-events-none 
                   {(isSourceMode && $currentVideoSource.type.startsWith('video')) || (!isSourceMode && activeClip && activeClip.type.startsWith('video')) ? 'block' : 'hidden'}" 
            muted={false} 
            crossorigin="anonymous"
        ></video>

        <!-- Image Element -->
        <img 
            bind:this={imageRef}
            class="max-w-full max-h-full object-contain pointer-events-none 
                   {(isSourceMode && $currentVideoSource.type.startsWith('image')) || (!isSourceMode && activeClip && activeClip.type.startsWith('image')) ? 'block' : 'hidden'}"
            alt="preview"
        />

        <!-- Audio Visualizer Placeholder (當預覽純音訊時顯示) -->
        {#if isSourceMode && $currentVideoSource.type.startsWith('audio')}
            <div class="flex flex-col items-center gap-4 text-green-400 animate-pulse">
                <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
                <span class="text-sm font-mono">Previewing Audio...</span>
            </div>
        {/if}
        
        <!-- 播放狀態 Overlay -->
        <!-- 如果是 Source Mode，或者 Timeline Mode 有內容且暫停 -->
        {#if (isSourceMode && videoRef?.paused && audioRef?.paused) || (!isSourceMode && !$isPlaying && hasClips && !$isExporting)}
            <!-- 注意：這裡的判斷有點簡化，點擊時 togglePlay 會處理 -->
            <!-- 為了 UI 簡潔，我們只在 Timeline 模式且暫停時顯示大 Play Icon，Source Mode 自動播就不顯示了，除非暫停 -->
        {/if}

        <!-- 檔名提示 -->
        {#if isSourceMode}
             <div class="absolute top-4 left-4 bg-blue-900/80 px-2 py-1 rounded text-xs text-white z-20 pointer-events-none">Source Preview: {$currentVideoSource.name}</div>
        {:else if activeClip && !$isExporting}
            <div class="absolute top-4 left-4 bg-black/50 px-2 py-1 rounded text-xs text-white z-20 pointer-events-none">Timeline: {activeClip.name}</div>
        {/if}

        {#if !activeClip && !isSourceMode}
            <div class="flex flex-col items-center gap-4 opacity-20 text-white absolute pointer-events-none"><span class="text-sm">{!hasClips ? 'Drag media to start' : 'Black Screen'}</span></div>
        {/if}
      
        {#if $isExporting}
            <div class="absolute z-50 bg-black/90 px-8 py-6 rounded-xl flex flex-col items-center gap-4 shadow-2xl border border-gray-800">
                <div class="relative w-12 h-12">
                    <div class="absolute inset-0 border-4 border-gray-700 rounded-full"></div>
                    <div class="absolute inset-0 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin"></div>
                </div>
                <div class="text-center">
                    <div class="text-white font-bold text-lg">{exportStatus}</div>
                    <div class="text-cyan-400 font-mono text-xl mt-1">{exportProgress}%</div>
                </div>
            </div>
        {/if}
    </div>

    <!-- Bottom Bar -->
    <div class={`absolute bottom-8 bg-[#1e1e1e] border border-gray-700 rounded-full px-6 py-2 flex items-center gap-6 text-white z-30 transition-opacity ${(!hasClips && !isSourceMode) || $isExporting ? 'opacity-50 cursor-not-allowed' : ''}`}>
        <button on:click|stopPropagation={togglePlay} class="hover:text-cyan-400 disabled:cursor-not-allowed" disabled={(!hasClips && !isSourceMode) || $isExporting}>
            <!-- 這裡圖示簡單判斷，實際可以根據 videoRef.paused 來變換 -->
            {#if $isPlaying || (isSourceMode && videoRef && !videoRef.paused) || (isSourceMode && audioRef && !audioRef.paused)} ⏸ {:else} ▶ {/if}
        </button>
        
        <div class="w-[1px] h-4 bg-gray-600"></div>
        
        <!-- 時間顯示：如果是 Source Mode 顯示 0:00 (或當前進度)，Timeline 顯示全域時間 -->
        <span class="font-mono text-sm w-16 text-center">
            {isSourceMode ? 'Preview' : $currentTime.toFixed(1) + 's'}
        </span>
    </div>
</div>
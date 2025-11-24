<script>
    import { mainTrackClips, audioTrackClips, generateId, selectedClipId, draggedFile } from '../stores/timelineStore';
    // 👇 1. 引入 currentVideoSource
    import { currentTime, isPlaying, currentVideoSource } from '../stores/playerStore';
    import { onMount } from 'svelte';
    import { get } from 'svelte/store';

    let pixelsPerSecond = 20; 
    let timelineContainer; 
    
    // ... (狀態變數保持不變) ...
    let totalDuration = 60;     
    let resizingClipId = null;  
    let resizingTrack = null; 
    let resizingEdge = null;  
    let initialX = 0;           
    let initialDuration = 0;    
    let initialStartOffset = 0; 
    let initialMediaStart = 0; 
    let maxDurationLimit = 0;   
    let movingClipId = null;
    let movingTrack = null;
    let moveInitialX = 0;
    let moveInitialStart = 0;
    let showGuide = false;    
    let guideX = 0;           
    let guideTimeText = "";   

    // ... (Reactive 計算總長度保持不變) ...
    $: {
        const maxMain = $mainTrackClips.length > 0 
            ? Math.max(...$mainTrackClips.map(c => c.startOffset + c.duration)) : 0;
        const maxAudio = $audioTrackClips.length > 0
            ? Math.max(...$audioTrackClips.map(c => c.startOffset + c.duration)) : 0;
        const maxClipEnd = Math.max(maxMain, maxAudio);
        totalDuration = Math.max(60, maxClipEnd + 30);
    }

    // 🔥 2. 新增：統一重置 Source Mode 的 Helper
    function resetSourceMode() {
        // 如果目前正在 Source Mode，強制退出，回到 Timeline Mode
        currentVideoSource.set(null);
    }

    function handleDragOver(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }

    // src/components/Timeline.svelte

    // src/components/Timeline.svelte

    function handleDrop(e) {
        e.preventDefault();
        resetSourceMode();
        const data = e.dataTransfer.getData('application/json');
        if (data) {
            const fileData = JSON.parse(data);
            if (fileData.type.startsWith('audio')) { alert("Audio -> Audio Track"); return; }
            
            // 從 Store 取出原始檔案資料
            const actualFileObject = get(draggedFile); 

            const currentMaxTime = $mainTrackClips.length > 0 ? Math.max(...$mainTrackClips.map(c => c.startOffset + c.duration)) : 0;
            const originalDuration = fileData.duration || 5;
            const isImage = fileData.type.startsWith('image'); 

            const newClip = { 
                id: generateId(), 
                fileUrl: fileData.url, 
                name: fileData.name, 
                type: fileData.type, 
                startOffset: currentMaxTime, 
                duration: originalDuration, 
                sourceDuration: isImage ? Infinity : originalDuration,
                mediaStartOffset: 0,
                volume: 1.0,
                
                // 1. 儲存主檔案
                file: actualFileObject ? actualFileObject.file : null,
                
                // 🔥 2. 關鍵新增：儲存縮圖原始 Blobs (為了存檔)
                thumbnails: actualFileObject ? actualFileObject.thumbnails : [],
                
                // 3. 這是目前的顯示網址 (暫時的)
                thumbnailUrls: fileData.thumbnailUrls 
            };
            
            mainTrackClips.update(clips => {
                const newClips = [...clips, newClip];
                return resolveOverlaps(newClips, newClip.id); 
            });
            
            draggedFile.set(null); 
        }
    }

    function handleAudioDrop(e) {
        e.preventDefault();
        resetSourceMode(); // 🔥 Drop 時也重置
        const data = e.dataTransfer.getData('application/json');
        if (data) {
            // ... (內容保持不變) ...
            const fileData = JSON.parse(data);
            if (!fileData.type.startsWith('audio')) { alert("Video -> Main Track"); return; }
            const actualFileObject = get(draggedFile);
            const currentMaxTime = $audioTrackClips.length > 0 ? Math.max(...$audioTrackClips.map(c => c.startOffset + c.duration)) : 0;
            const originalDuration = fileData.duration || 5;
            
            const newClip = { 
                id: generateId(), 
                fileUrl: fileData.url, 
                name: fileData.name, 
                type: fileData.type, 
                startOffset: currentMaxTime, 
                duration: originalDuration, 
                sourceDuration: originalDuration,
                mediaStartOffset: 0,
                volume: 1.0,
                file: actualFileObject ? actualFileObject.file : null
            };
            
            audioTrackClips.update(clips => {
                const newClips = [...clips, newClip];
                return resolveOverlaps(newClips, newClip.id);
            });
            draggedFile.set(null);
        }
    }

    // ... (resolveOverlaps 保持不變) ...
    function resolveOverlaps(clips, activeId = null) {
        if (clips.length === 0) return [];
        const sortedClips = [...clips].sort((a, b) => {
            if (a.id === b.id) return 0;
            const diff = a.startOffset - b.startOffset;
            if (Math.abs(diff) < 0.1) {
                if (a.id === activeId) return -1; 
                if (b.id === activeId) return 1; 
            }
            return diff;
        });
        for (let i = 1; i < sortedClips.length; i++) {
            const prevClip = sortedClips[i - 1];
            const currentClip = sortedClips[i];
            const prevEnd = prevClip.startOffset + prevClip.duration;
            if (currentClip.startOffset < prevEnd) {
                currentClip.startOffset = prevEnd; 
            }
        }
        return sortedClips;
    }

    // --- Split Logic ---
    import { splitClip } from '../stores/timelineStore';
    function handleSplit() {
        if (!$selectedClipId) { alert("請先點選要分割的片段"); return; }
        resetSourceMode(); // 🔥 操作時重置
        splitClip($selectedClipId, $currentTime);
        selectedClipId.set(null);
    }

    // --- 刪除邏輯 (保持不變) ---
    function deleteSelected() {
        if (!$selectedClipId) return;
        mainTrackClips.update(clips => clips.filter(c => c.id !== $selectedClipId));
        audioTrackClips.update(clips => clips.filter(c => c.id !== $selectedClipId));
        selectedClipId.set(null);
    }
    function handleKeyDown(e) { 
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        if (e.key === 'Delete' || e.key === 'Backspace') deleteSelected(); 
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
            e.preventDefault();
            handleSplit();
        }
    }
    function handleContextMenu(e, clipId) { 
        e.preventDefault(); 
        resetSourceMode(); // 🔥 右鍵選取時重置
        selectedClipId.set(clipId); 
        deleteSelected(); 
    }
    function selectClip(e, clipId) { 
        e.stopPropagation(); 
        resetSourceMode(); // 🔥 點選 Clip 時重置 (這是關鍵修復！)
        selectedClipId.set(clipId); 
    }

    // --- Resize Logic ---
    function startResize(e, clip, trackType, edge) {
        e.stopPropagation();
        resetSourceMode(); // 🔥 縮放時重置
        selectedClipId.set(clip.id);
        resizingClipId = clip.id;
        resizingTrack = trackType;
        resizingEdge = edge; 
        initialX = e.clientX;
        initialDuration = clip.duration;
        initialStartOffset = clip.startOffset;
        initialMediaStart = clip.mediaStartOffset || 0;
        maxDurationLimit = clip.sourceDuration || clip.duration;
        
        showGuide = true;
        window.addEventListener('mousemove', handleResizeMove);
        window.addEventListener('mouseup', stopResize);
    }

    // ... (handleResizeMove, stopResize 保持不變) ...
    function handleResizeMove(e) {
        if (!resizingClipId) return;
        const deltaX = e.clientX - initialX;
        const deltaSeconds = deltaX / pixelsPerSecond; 
        let newDuration = initialDuration;
        let newStartOffset = initialStartOffset;
        let newMediaStart = initialMediaStart;
        const snapThreshold = 15 / pixelsPerSecond;
        const targetTime = $currentTime;

        if (resizingEdge === 'end') {
            let tempEnd = initialStartOffset + initialDuration + deltaSeconds;
            if (Math.abs(tempEnd - targetTime) < snapThreshold) tempEnd = targetTime;
            const maxAllowedDuration = maxDurationLimit - initialMediaStart;
            newDuration = tempEnd - initialStartOffset;
            newDuration = Math.max(0.5, newDuration); 
            newDuration = Math.min(maxAllowedDuration, newDuration); 
        } else if (resizingEdge === 'start') {
            let tempStart = initialStartOffset + deltaSeconds;
            if (Math.abs(tempStart - targetTime) < snapThreshold) tempStart = targetTime;
            const change = tempStart - initialStartOffset;
            let attemptedDuration = initialDuration - change;
            if (attemptedDuration < 0.5) {
                newStartOffset = initialStartOffset + (initialDuration - 0.5);
                newDuration = 0.5;
                newMediaStart = initialMediaStart + (initialDuration - 0.5);
            } else if (initialMediaStart + change < 0) {
                newMediaStart = 0;
                newStartOffset = initialStartOffset - initialMediaStart;
                newDuration = initialDuration + initialMediaStart;
            } else {
                newStartOffset = tempStart;
                newDuration = attemptedDuration;
                newMediaStart = initialMediaStart + change;
            }
            if (newStartOffset < 0) newStartOffset = 0;
        }

        const updateLogic = (clips) => clips.map(c => c.id === resizingClipId ? { 
            ...c, startOffset: newStartOffset, duration: newDuration, mediaStartOffset: newMediaStart
        } : c);

        if (resizingTrack === 'main') mainTrackClips.update(updateLogic);
        else if (resizingTrack === 'audio') audioTrackClips.update(updateLogic);

        guideX = e.clientX;
        const currentEdgeTime = resizingEdge === 'end' ? (newStartOffset + newDuration) : newStartOffset;
        const isSnapped = Math.abs(currentEdgeTime - $currentTime) < 0.001;
        guideTimeText = (isSnapped ? "🧲 " : "") + `${currentEdgeTime.toFixed(2)}s`;
    }

    function stopResize() {
        resizingClipId = null;
        resizingTrack = null;
        resizingEdge = null;
        showGuide = false;
        window.removeEventListener('mousemove', handleResizeMove);
        window.removeEventListener('mouseup', stopResize);
    }

    // --- Move Logic ---
    function startMoveClip(e, clip, trackType) {
        e.stopPropagation();
        resetSourceMode(); // 🔥 移動 Clip 時重置
        selectedClipId.set(clip.id);
        movingClipId = clip.id;
        movingTrack = trackType;
        moveInitialX = e.clientX;
        moveInitialStart = clip.startOffset;
        
        showGuide = true;
        window.addEventListener('mousemove', handleMoveClip);
        window.addEventListener('mouseup', stopMoveClip);
    }

    // ... (handleMoveClip, stopMoveClip 保持不變) ...
    function handleMoveClip(e) {
        if (!movingClipId) return;
        const deltaX = e.clientX - moveInitialX;
        const deltaSeconds = deltaX / pixelsPerSecond;
        let newStartOffset = Math.max(0, moveInitialStart + deltaSeconds);
        if (movingTrack === 'main') {
            mainTrackClips.update(clips => clips.map(c => c.id === movingClipId ? { ...c, startOffset: newStartOffset } : c));
        } else if (movingTrack === 'audio') {
            audioTrackClips.update(clips => clips.map(c => c.id === movingClipId ? { ...c, startOffset: newStartOffset } : c));
        }
        currentTime.set(newStartOffset);
        guideX = e.clientX;
        guideTimeText = `Start: ${newStartOffset.toFixed(2)}s`;
    }

    function stopMoveClip() {
        const currentId = movingClipId;
        if (movingTrack === 'main') {
            mainTrackClips.update(clips => resolveOverlaps(clips, currentId));
        } else if (movingTrack === 'audio') {
            audioTrackClips.update(clips => resolveOverlaps(clips, currentId));
        }
        movingClipId = null;
        movingTrack = null;
        showGuide = false;
        window.removeEventListener('mousemove', handleMoveClip);
        window.removeEventListener('mouseup', stopMoveClip);
    }

    // --- Scrubbing Logic (背景點擊/拖曳) ---
    function handleTimelineMouseDown(e) {
        selectedClipId.set(null);
        resetSourceMode(); // 🔥 點擊背景時重置 (原本就有，但改用 helper 更整齊)
        updateTimeFromEvent(e);
        window.addEventListener('mousemove', handleTimelineMouseMove);
        window.addEventListener('mouseup', handleTimelineMouseUp);
    }
    function handleTimelineMouseMove(e) { updateTimeFromEvent(e); }
    function handleTimelineMouseUp() {
        window.removeEventListener('mousemove', handleTimelineMouseMove);
        window.removeEventListener('mouseup', handleTimelineMouseUp);
    }
    function updateTimeFromEvent(e) {
        if (!timelineContainer) return;
        const rect = timelineContainer.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const timelineX = x - 96; 
        const newTime = Math.max(0, timelineX / pixelsPerSecond);
        currentTime.set(newTime);
    }
</script>

<!-- HTML 部分保持不變 (省略，因為沒有改動) -->
<svelte:window on:keydown={handleKeyDown} />

<div class="h-[35%] bg-[#181818] border-t border-gray-700 flex flex-col relative select-none overflow-hidden">
    
    <!-- Toolbar -->
    <div class="h-8 bg-[#252525] border-b border-gray-700 flex items-center px-4 justify-between z-50 relative">
        <!-- Left: Tools -->
        <div class="flex items-center gap-2">
            <button 
                on:click={handleSplit}
                class="text-gray-400 hover:text-white flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-700 transition-colors text-xs"
                title="Split (Ctrl+B)"
            >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" x2="8.12" y1="4" y2="15.88"/><line x1="14.47" x2="20" y1="14.48" y2="20"/><line x1="8.12" x2="12" y1="8.12" y2="12"/></svg>
                Split
            </button>
        </div>

        <!-- Right: Zoom -->
        <div class="flex items-center gap-3">
            <span class="text-xs text-gray-400">Zoom</span>
            <svg class="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 12H4"/></svg>
            <input type="range" min="10" max="100" step="5" bind:value={pixelsPerSecond} class="w-32 accent-cyan-500 h-1 bg-gray-600 rounded appearance-none cursor-pointer">
            <svg class="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
            <span class="text-xs text-gray-500 w-8 text-right">{pixelsPerSecond}px</span>
        </div>
    </div>

    <!-- Timeline Container -->
    <div class="flex-1 overflow-x-auto overflow-y-hidden custom-scrollbar relative">
        <div bind:this={timelineContainer} class="relative h-full flex flex-col min-w-full" style="width: {totalDuration * pixelsPerSecond + 100}px;" on:mousedown={handleTimelineMouseDown}>

            <!-- Ruler -->
            <div class="h-6 border-b border-gray-700 flex text-[10px] text-gray-500 bg-[#181818] sticky left-0 z-20">
                <div class="w-24 border-r border-gray-700 shrink-0 bg-[#181818] sticky left-0 z-30"></div> 
                <div class="flex-1 relative">
                    {#each Array(Math.ceil(totalDuration / 5)) as _, i}
                        <div class="absolute border-l border-gray-700 pl-1 h-full" style="left: {i * 5 * pixelsPerSecond}px">{i * 5}s</div>
                    {/each}
                </div>
            </div>

            <!-- Playhead -->
            <div class="absolute top-0 bottom-0 w-[1px] bg-cyan-400 z-40 pointer-events-none will-change-transform" style="left: 0; transform: translateX({96 + ($currentTime * pixelsPerSecond)}px) translateZ(0);">
                <div class="absolute top-0 left-1/2 -translate-x-1/2 w-3 h-3 -mt-1.5 rotate-45 bg-cyan-400 rounded-sm"></div>
            </div>

            <!-- Guide -->
            {#if showGuide}
                <div class="fixed top-[calc(60%-1px)] bottom-0 w-[1px] bg-white/50 z-[60] pointer-events-none border-l border-dashed border-white" style="left: {guideX}px;">
                    <div class="absolute -top-8 -left-8 bg-black/90 text-white text-[10px] px-2 py-1 rounded border border-gray-600 whitespace-nowrap">{guideTimeText}</div>
                </div>
            {/if}

            <div class="flex-1 relative">
                <!-- Main Track -->
                <div class="flex h-24 border-b border-gray-800 group relative" on:dragover={handleDragOver} on:drop={handleDrop}>
                    <div class="w-24 shrink-0 border-r border-gray-700 flex flex-col justify-center pl-3 text-xs text-gray-400 bg-[#181818] z-30 sticky left-0 h-full">
                        <div class="flex items-center gap-2"><span>Main Track</span></div>
                    </div>
                    <div class="flex-1 relative h-full bg-[#151515]">
                        {#each $mainTrackClips as clip (clip.id)}
                            <div 
                                class="absolute top-2 bottom-2 rounded overflow-hidden border border-cyan-600 bg-cyan-900/50 group/clip cursor-move { $selectedClipId === clip.id ? 'border-white ring-1 ring-white z-10' : 'border-cyan-600' }" 
                                style="left: {clip.startOffset * pixelsPerSecond}px; width: {clip.duration * pixelsPerSecond}px;" 
                                title={clip.name} 
                                on:mousedown={(e) => startMoveClip(e, clip, 'main')} 
                                on:click={(e) => selectClip(e, clip.id)} 
                                on:contextmenu={(e) => handleContextMenu(e, clip.id)}
                            >
                                <!-- Filmstrip -->
                                {#if clip.thumbnailUrls && clip.thumbnailUrls.length > 0}
                                    <div class="absolute inset-0 flex w-full h-full overflow-hidden pointer-events-none select-none opacity-50">
                                        {#each clip.thumbnailUrls as url}
                                            <div class="flex-1 h-full min-w-0 border-r border-white/20 last:border-0">
                                                <img src={url} class="w-full h-full object-cover" alt="frame" draggable="false" />
                                            </div>
                                        {/each}
                                    </div>
                                {/if}

                                <div class="w-full h-full flex items-center justify-center pointer-events-none relative z-10">
                                    <span class="text-[10px] text-white truncate px-1 drop-shadow-md font-medium">{clip.name} ({clip.duration.toFixed(1)}s)</span>
                                </div>
                                <div class="absolute top-0 bottom-0 left-0 w-4 cursor-ew-resize z-50 hover:bg-cyan-400/50 transition-colors flex items-center justify-center" on:mousedown={(e) => startResize(e, clip, 'main', 'start')} on:click|stopPropagation><div class="w-[2px] h-4 bg-white/50 rounded-full"></div></div>
                                <div class="absolute top-0 bottom-0 right-0 w-4 cursor-ew-resize z-50 hover:bg-cyan-400/50 transition-colors flex items-center justify-center" on:mousedown={(e) => startResize(e, clip, 'main', 'end')} on:click|stopPropagation><div class="w-[2px] h-4 bg-white/50 rounded-full"></div></div>
                            </div>
                        {/each}
                    </div>
                </div>
                
                <!-- Audio Track -->
                <div class="flex h-16 border-b border-gray-800 relative" on:dragover={handleDragOver} on:drop={handleAudioDrop}>
                     <div class="w-24 shrink-0 border-r border-gray-700 flex items-center pl-3 text-xs text-gray-400 bg-[#181818] z-30 sticky left-0 h-full">Audio</div>
                    <div class="flex-1 bg-[#151515] relative h-full">
                        {#each $audioTrackClips as clip (clip.id)}
                            <div class="absolute top-2 bottom-2 rounded overflow-hidden border bg-green-900/50 group/clip cursor-move { $selectedClipId === clip.id ? 'border-white ring-1 ring-white z-10' : 'border-green-600' }" style="left: {clip.startOffset * pixelsPerSecond}px; width: {clip.duration * pixelsPerSecond}px;" title={clip.name} on:mousedown={(e) => startMoveClip(e, clip, 'audio')} on:click={(e) => selectClip(e, clip.id)} on:contextmenu={(e) => handleContextMenu(e, clip.id)}>
                                <div class="w-full h-full flex items-center justify-center pointer-events-none"><span class="text-[10px] text-white truncate px-1">🎵 {clip.name} ({clip.duration.toFixed(1)}s)</span></div>
                                <div class="absolute top-0 bottom-0 left-0 w-4 cursor-ew-resize z-50 hover:bg-green-400/50 transition-colors flex items-center justify-center" on:mousedown={(e) => startResize(e, clip, 'audio', 'start')} on:click|stopPropagation><div class="w-[2px] h-4 bg-white/50 rounded-full"></div></div>
                                <div class="absolute top-0 bottom-0 right-0 w-4 cursor-ew-resize z-50 hover:bg-green-400/50 transition-colors flex items-center justify-center" on:mousedown={(e) => startResize(e, clip, 'audio', 'end')} on:click|stopPropagation><div class="w-[2px] h-4 bg-white/50 rounded-full"></div></div>
                            </div>
                        {/each}
                    </div>
                </div>
            </div>
        </div>
    </div>
</div>

<style>
  .custom-scrollbar::-webkit-scrollbar { height: 8px; }
  .custom-scrollbar::-webkit-scrollbar-track { background: #181818; }
  .custom-scrollbar::-webkit-scrollbar-thumb { background: #444; border-radius: 4px; }
  .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #555; }
  .cursor-ew-resize { cursor: ew-resize; }
  .cursor-move { cursor: grab; }
  .cursor-move:active { cursor: grabbing; }
</style>
<script>
    // 🔥 引入 selectedClipIds (複數)
    import { mainTrackClips, audioTrackClips, generateId, selectedClipIds, draggedFile } from '../stores/timelineStore';
    import { currentTime, isPlaying, currentVideoSource } from '../stores/playerStore';
    import { onMount } from 'svelte';
    import { get } from 'svelte/store';
    import { splitClip } from '../stores/timelineStore';

    let pixelsPerSecond = 20; 
    let timelineContainer; 
    let scrollContainer; // 🔥 綁定捲動容器，用於計算框選座標
    
    // --- 狀態變數 ---
    let totalDuration = 60;     
    
    // Resize 變數
    let resizingClipId = null;  
    let resizingTrack = null; 
    let resizingEdge = null;  
    let initialX = 0;           
    let initialDuration = 0;    
    let initialStartOffset = 0; 
    let initialMediaStart = 0; 
    let maxDurationLimit = 0;   
    
    // Move 變數 (批次移動)
    let isMovingClips = false;
    let moveInitialX = 0;
    // 🔥 記錄所有被移動 Clip 的初始位置: { id: startOffset }
    let groupInitialOffsets = {}; 

    // 🔥 Marquee Selection (框選) 變數
    let isSelecting = false;
    let selectStartX = 0;
    let selectStartY = 0;
    let selectBox = { x: 0, y: 0, width: 0, height: 0 };

    // UI 輔助
    let showGuide = false;    
    let guideX = 0;           
    let guideTimeText = "";   

    // --- Reactive: 計算總長度 ---
    $: {
        const maxMain = $mainTrackClips.length > 0 
            ? Math.max(...$mainTrackClips.map(c => c.startOffset + c.duration)) : 0;
        const maxAudio = $audioTrackClips.length > 0
            ? Math.max(...$audioTrackClips.map(c => c.startOffset + c.duration)) : 0;
        const maxClipEnd = Math.max(maxMain, maxAudio);
        totalDuration = Math.max(60, maxClipEnd + 30);
    }

    function handleDragOver(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }

    // --- Ripple Logic (保持不變) ---
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

    // --- Drop Logic (保持不變) ---
    function handleDrop(e) {
        e.preventDefault();
        const data = e.dataTransfer.getData('application/json');
        if (data) {
            const fileData = JSON.parse(data);
            if (fileData.type.startsWith('audio')) { alert("Audio -> Audio Track"); return; }
            
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
                
                // 1. 原始影片檔案 (Blob)
                file: actualFileObject ? actualFileObject.file : null,
                
                // 🔥🔥🔥 2. 關鍵修正：必須儲存原始縮圖 Blob 陣列！ 🔥🔥🔥
                // 如果這裡沒存，IndexedDB 就沒有東西可以恢復
                thumbnails: actualFileObject ? actualFileObject.thumbnails : [],
                
                // 3. 暫時的 URL
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
        const data = e.dataTransfer.getData('application/json');
        if (data) {
            const fileData = JSON.parse(data);
            if (!fileData.type.startsWith('audio')) { alert("Video -> Main Track"); return; }
            const actualFileObject = get(draggedFile);
            const currentMaxTime = $audioTrackClips.length > 0 ? Math.max(...$audioTrackClips.map(c => c.startOffset + c.duration)) : 0;
            const originalDuration = fileData.duration || 5;
            const newClip = { 
                id: generateId(), fileUrl: fileData.url, name: fileData.name, type: fileData.type, 
                startOffset: currentMaxTime, duration: originalDuration, 
                sourceDuration: originalDuration, mediaStartOffset: 0, volume: 1.0, 
                file: actualFileObject ? actualFileObject.file : null
            };
            audioTrackClips.update(clips => {
                const newClips = [...clips, newClip];
                return resolveOverlaps(newClips, newClip.id);
            });
            draggedFile.set(null);
        }
    }

    // --- Split & Delete Logic ---
    function handleSplit() {
        if ($selectedClipIds.length !== 1) {
            alert("請只選取一個片段進行分割");
            return;
        }
        splitClip($selectedClipIds[0], $currentTime);
        selectedClipIds.set([]); // 分割後清空選取
    }

    function deleteSelected() {
        if ($selectedClipIds.length === 0) return;
        // 🔥 批次刪除
        mainTrackClips.update(clips => clips.filter(c => !$selectedClipIds.includes(c.id)));
        audioTrackClips.update(clips => clips.filter(c => !$selectedClipIds.includes(c.id)));
        selectedClipIds.set([]);
    }

    function handleKeyDown(e) { 
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        if (e.key === 'Delete' || e.key === 'Backspace') deleteSelected(); 
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
            e.preventDefault();
            handleSplit();
        }
    }

    function selectClip(e, clipId) {
        e.stopPropagation(); 
        
        // 🔥 2. 關鍵：點選 Clip 時，也要切回 Timeline 模式
        switchToTimeline();

        if (e.shiftKey) {
            // Shift: 加選/減選
            selectedClipIds.update(ids => {
                if (ids.includes(clipId)) return ids.filter(id => id !== clipId);
                return [...ids, clipId];
            });
        } else {
            // Normal Click:
            if (!$selectedClipIds.includes(clipId)) {
                selectedClipIds.set([clipId]);
            }
        }
    }

    function handleContextMenu(e, clipId) { 
        e.preventDefault(); 
        if (!$selectedClipIds.includes(clipId)) selectedClipIds.set([clipId]);
        deleteSelected(); 
    }

    // --- Resize Logic (保持單一操作) ---
    function startResize(e, clip, trackType, edge) {
        switchToTimeline();

        e.stopPropagation();
        selectedClipIds.set([clip.id]); // Resize 時強制單選
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
            } else if (attemptedDuration > maxDurationLimit) { 
                 newDuration = maxDurationLimit;
                 newStartOffset = initialStartOffset - (maxDurationLimit - initialDuration);
                 if (initialMediaStart + change < 0) newMediaStart = 0;
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

    // --- 🔥 改良版：批次移動邏輯 (Batch Move) ---
    function startMoveClip(e, clip, trackType) {
        switchToTimeline();

        e.stopPropagation();
        
        // 如果點擊的 clip 尚未被選取，且沒按 Shift -> 單選它
        if (!$selectedClipIds.includes(clip.id) && !e.shiftKey) {
            selectedClipIds.set([clip.id]);
        }
        // 如果按了 Shift 且未選取 -> 加選
        else if (!$selectedClipIds.includes(clip.id) && e.shiftKey) {
            selectedClipIds.update(ids => [...ids, clip.id]);
        }

        isMovingClips = true;
        moveInitialX = e.clientX;
        
        // 記錄所有被選取 Clip 的初始位置，方便計算 delta
        groupInitialOffsets = {};
        
        const allClips = [...$mainTrackClips, ...$audioTrackClips];
        allClips.forEach(c => {
            if ($selectedClipIds.includes(c.id)) {
                groupInitialOffsets[c.id] = c.startOffset;
            }
        });
        
        showGuide = true;
        window.addEventListener('mousemove', handleMoveClip);
        window.addEventListener('mouseup', stopMoveClip);
    }

    function handleMoveClip(e) {
        if (!isMovingClips) return;
        
        const deltaX = e.clientX - moveInitialX;
        const deltaSeconds = deltaX / pixelsPerSecond;
        
        // 更新 Main Track
        mainTrackClips.update(clips => clips.map(c => {
            if ($selectedClipIds.includes(c.id)) {
                const initStart = groupInitialOffsets[c.id];
                return { ...c, startOffset: Math.max(0, initStart + deltaSeconds) };
            }
            return c;
        }));

        // 更新 Audio Track
        audioTrackClips.update(clips => clips.map(c => {
            if ($selectedClipIds.includes(c.id)) {
                const initStart = groupInitialOffsets[c.id];
                return { ...c, startOffset: Math.max(0, initStart + deltaSeconds) };
            }
            return c;
        }));

        guideX = e.clientX;
        // 顯示移動量，因為是多個 clip，顯示 start time 不太準確
        guideTimeText = deltaSeconds > 0 ? `+${deltaSeconds.toFixed(2)}s` : `${deltaSeconds.toFixed(2)}s`;
    }

    function stopMoveClip() {
        // 移動結束，對兩個軌道分別進行重排
        // 注意：批次移動時，暫時使用最後一個被選中的作為 activeId 傳入，或者不傳 (讓它自然排序)
        // 為了簡單，我們不指定 activeId，讓它們根據時間自然落位
        mainTrackClips.update(clips => resolveOverlaps(clips));
        audioTrackClips.update(clips => resolveOverlaps(clips));

        isMovingClips = false;
        showGuide = false;
        window.removeEventListener('mousemove', handleMoveClip);
        window.removeEventListener('mouseup', stopMoveClip);
    }

    // --- 🔥 新增：框選邏輯 (Marquee Selection) ---
    function handleTimelineMouseDown(e) {
        // 🔥 1. 關鍵：只要點擊時間軸區域，立刻切回 Timeline 模式
        switchToTimeline();

        // 點擊背景 -> 清空選取
        if (!e.shiftKey) selectedClipIds.set([]);
        
        // 檢測點擊目標是否是 Track 背景
        const isTrackArea = e.target.classList.contains('track-bg');
        
        if (isTrackArea) {
            startMarquee(e);
        } else {
            updateTimeFromEvent(e);
            window.addEventListener('mousemove', handleTimelineMouseMove);
            window.addEventListener('mouseup', handleTimelineMouseUp);
        }
    }

    function startMarquee(e) {
        isSelecting = true;
        const rect = scrollContainer.getBoundingClientRect();
        // 記錄相對於 scrollContainer 的起始點 (考慮 scrollLeft)
        const startX = e.clientX - rect.left + scrollContainer.scrollLeft;
        const startY = e.clientY - rect.top + scrollContainer.scrollTop; // 雖然 Y 軸不捲動，但保持一致
        
        selectStartX = startX;
        selectStartY = startY;
        selectBox = { x: startX, y: startY, width: 0, height: 0 };

        window.addEventListener('mousemove', handleMarqueeMove);
        window.addEventListener('mouseup', stopMarquee);
    }

    function handleMarqueeMove(e) {
        if (!isSelecting) return;
        
        const rect = scrollContainer.getBoundingClientRect();
        const currentX = e.clientX - rect.left + scrollContainer.scrollLeft;
        const currentY = e.clientY - rect.top + scrollContainer.scrollTop;

        // 計算 Box 尺寸 (支援反向拉)
        const x = Math.min(selectStartX, currentX);
        const y = Math.min(selectStartY, currentY);
        const width = Math.abs(currentX - selectStartX);
        const height = Math.abs(currentY - selectStartY);

        selectBox = { x, y, width, height };

        // 計算碰撞選取
        // 我們需要把 Box 轉回「時間範圍」和「軌道位置」
        // 這裡簡化：檢查 visual collision (像素重疊)
        // 我們需要取得所有 clip 的 DOM 元素位置比較麻煩
        // 替代方案：把 clip 的邏輯位置轉換成像素位置進行比較
        
        const newSelected = [];
        const allClips = [...$mainTrackClips, ...$audioTrackClips]; // 這裡需要區分軌道高度，有點複雜
        // 簡單做法：只檢查 X 軸 (時間重疊)，並檢查 Y 軸是否涵蓋該軌道
        // Main Track Y: 24px (header) + ? 
        // Audio Track Y: ...
        // 這太依賴 CSS。
        
        // ✅ 推薦做法：計算時間範圍，並選取「該時間範圍內」的所有 Clips (不管軌道)
        // 因為框選通常是跨軌道的
        const startTime = x / pixelsPerSecond;
        const endTime = (x + width) / pixelsPerSecond;
        
        // 檢查 Main Track
        $mainTrackClips.forEach(clip => {
            const clipEnd = clip.startOffset + clip.duration;
            // 判斷時間重疊
            if (clip.startOffset < endTime && clipEnd > startTime) {
                // 進一步：檢查 Y 軸 (簡單判斷：selectBox.y 是否覆蓋到了 Main Track 的區域)
                // 假設 Main Track 在上面，Audio 在下面。
                // 這裡我們簡化：只要時間重疊就選取 (全軌道框選)
                // 或者你可以根據 selectBox.y 來過濾
                newSelected.push(clip.id);
            }
        });
        $audioTrackClips.forEach(clip => {
            const clipEnd = clip.startOffset + clip.duration;
            if (clip.startOffset < endTime && clipEnd > startTime) {
                newSelected.push(clip.id);
            }
        });

        selectedClipIds.set(newSelected);
    }

    function stopMarquee() {
        isSelecting = false;
        selectBox = { x: 0, y: 0, width: 0, height: 0 };
        window.removeEventListener('mousemove', handleMarqueeMove);
        window.removeEventListener('mouseup', stopMarquee);
    }

    // Scrubbing Helpers
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

    function switchToTimeline() {
        // 強制清空素材來源 -> 回到時間軸模式
        currentVideoSource.set(null);
    }


</script>

<svelte:window on:keydown={handleKeyDown} />

<div class="h-[35%] bg-[#181818] border-t border-gray-700 flex flex-col relative select-none overflow-hidden">
    
    <!-- Toolbar -->
    <div class="h-8 bg-[#252525] border-b border-gray-700 flex items-center px-4 justify-between z-50 relative">
        <div class="flex items-center gap-2">
            <button on:click={handleSplit} class="text-gray-400 hover:text-white flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-700 transition-colors text-xs" title="Split (Ctrl+B)">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" x2="8.12" y1="4" y2="15.88"/><line x1="14.47" x2="20" y1="14.48" y2="20"/><line x1="8.12" x2="12" y1="8.12" y2="12"/></svg>
                Split
            </button>
        </div>
        <div class="flex items-center gap-3">
            <span class="text-xs text-gray-400">Zoom</span>
            <input type="range" min="10" max="100" step="5" bind:value={pixelsPerSecond} class="w-32 accent-cyan-500 h-1 bg-gray-600 rounded appearance-none cursor-pointer">
            <span class="text-xs text-gray-500 w-8 text-right">{pixelsPerSecond}px</span>
        </div>
    </div>

    <!-- Timeline Container (綁定 scrollContainer) -->
    <div 
        bind:this={scrollContainer}
        class="flex-1 overflow-x-auto overflow-y-hidden custom-scrollbar relative"
    >
        <div 
            bind:this={timelineContainer} 
            class="relative h-full flex flex-col min-w-full" 
            style="width: {totalDuration * pixelsPerSecond + 100}px;" 
            on:mousedown={handleTimelineMouseDown}
        >

            <!-- Ruler -->
            <div class="h-6 border-b border-gray-700 flex text-[10px] text-gray-500 bg-[#181818] sticky left-0 z-20 pointer-events-none">
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

            <!-- 🔥 Marquee Selection Box -->
            {#if isSelecting}
                <div 
                    class="absolute border border-cyan-500 bg-cyan-500/20 z-50 pointer-events-none"
                    style="left: {selectBox.x}px; top: {selectBox.y}px; width: {selectBox.width}px; height: {selectBox.height}px;"
                ></div>
            {/if}

            <!-- Guide -->
            {#if showGuide}
                <div class="fixed top-[calc(60%-1px)] bottom-0 w-[1px] bg-white/50 z-[60] pointer-events-none border-l border-dashed border-white" style="left: {guideX}px;">
                    <div class="absolute -top-8 -left-8 bg-black/90 text-white text-[10px] px-2 py-1 rounded border border-gray-600 whitespace-nowrap">{guideTimeText}</div>
                </div>
            {/if}

            <div class="flex-1 relative">
                <!-- Main Track (加入 class="track-bg" 識別背景) -->
                <div class="flex h-24 border-b border-gray-800 group relative track-bg" on:dragover={handleDragOver} on:drop={handleDrop}>
                    <div class="w-24 shrink-0 border-r border-gray-700 flex flex-col justify-center pl-3 text-xs text-gray-400 bg-[#181818] z-30 sticky left-0 h-full">
                        <div class="flex items-center gap-2"><span>Main Track</span></div>
                    </div>
                    <div class="flex-1 relative h-full bg-[#151515] track-bg">
                        {#each $mainTrackClips as clip (clip.id)}
                            <div 
                                class="absolute top-2 bottom-2 rounded overflow-hidden border bg-cyan-900/50 group/clip cursor-move 
                                       { $selectedClipIds.includes(clip.id) ? 'border-white ring-1 ring-white z-10' : 'border-cyan-600' }" 
                                style="left: {clip.startOffset * pixelsPerSecond}px; width: {clip.duration * pixelsPerSecond}px;" 
                                title={clip.name} 
                                on:mousedown={(e) => startMoveClip(e, clip, 'main')} 
                                on:click={(e) => selectClip(e, clip.id)} 
                                on:contextmenu={(e) => handleContextMenu(e, clip.id)}
                            >
                                <!-- Filmstrip -->
                                {#if clip.thumbnailUrls && clip.thumbnailUrls.length > 0}
                                    <div class="absolute top-0 bottom-0 flex overflow-hidden pointer-events-none select-none opacity-50 h-full" style="left: {clip.sourceDuration === Infinity ? 0 : -(clip.mediaStartOffset || 0) * pixelsPerSecond}px; width: {clip.sourceDuration === Infinity ? '100%' : (clip.sourceDuration * pixelsPerSecond) + 'px'};">
                                        {#each clip.thumbnailUrls as url}
                                            <div class="flex-1 h-full min-w-0 border-r border-white/20 last:border-0"><img src={url} class="w-full h-full object-cover" alt="frame" draggable="false" /></div>
                                        {/each}
                                    </div>
                                {/if}
                                <div class="w-full h-full flex items-center justify-center pointer-events-none relative z-10"><span class="text-[10px] text-white truncate px-1 drop-shadow-md font-medium">{clip.name} ({clip.duration.toFixed(1)}s)</span></div>
                                <div class="absolute top-0 bottom-0 left-0 w-4 cursor-ew-resize z-50 hover:bg-cyan-400/50 transition-colors flex items-center justify-center" on:mousedown={(e) => startResize(e, clip, 'main', 'start')} on:click|stopPropagation><div class="w-[2px] h-4 bg-white/50 rounded-full"></div></div>
                                <div class="absolute top-0 bottom-0 right-0 w-4 cursor-ew-resize z-50 hover:bg-cyan-400/50 transition-colors flex items-center justify-center" on:mousedown={(e) => startResize(e, clip, 'main', 'end')} on:click|stopPropagation><div class="w-[2px] h-4 bg-white/50 rounded-full"></div></div>
                            </div>
                        {/each}
                    </div>
                </div>
                
                <!-- Audio Track (加入 class="track-bg") -->
                <div class="flex h-16 border-b border-gray-800 relative track-bg" on:dragover={handleDragOver} on:drop={handleAudioDrop}>
                     <div class="w-24 shrink-0 border-r border-gray-700 flex items-center pl-3 text-xs text-gray-400 bg-[#181818] z-30 sticky left-0 h-full">Audio</div>
                    <div class="flex-1 bg-[#151515] relative h-full track-bg">
                        {#each $audioTrackClips as clip (clip.id)}
                            <div 
                                class="absolute top-2 bottom-2 rounded overflow-hidden border bg-green-900/50 group/clip cursor-move 
                                       { $selectedClipIds.includes(clip.id) ? 'border-white ring-1 ring-white z-10' : 'border-green-600' }" 
                                style="left: {clip.startOffset * pixelsPerSecond}px; width: {clip.duration * pixelsPerSecond}px;" 
                                title={clip.name} 
                                on:mousedown={(e) => startMoveClip(e, clip, 'audio')} 
                                on:click={(e) => selectClip(e, clip.id)} 
                                on:contextmenu={(e) => handleContextMenu(e, clip.id)}
                            >
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
<script>
    import { selectedClipIds, mainTrackClips, audioTrackClips, textTrackClips, projectSettings, uploadedFiles } from '../stores/timelineStore';
    import { addToHistory } from '../stores/historyStore';
    
    let selectedClip = null;
    let isMultiSelection = false;
    let trackType = null; 

    // 原始解析度狀態
    let originalRes = null;

    $: {
        if ($selectedClipIds.length === 0) {
            selectedClip = null;
            isMultiSelection = false;
            trackType = null;
        } 
        else if ($selectedClipIds.length === 1) {
            isMultiSelection = false;
            const id = $selectedClipIds[0];
            let clip = $mainTrackClips.find(c => c.id === id);
            if (clip) { trackType = 'main'; } 
            else {
                clip = $audioTrackClips.find(c => c.id === id);
                if (clip) { trackType = 'audio'; } 
                else {
                    clip = $textTrackClips.find(c => c.id === id);
                    if (clip) trackType = 'text';
                }
            }
            selectedClip = clip || null;
        } 
        else {
            isMultiSelection = true;
            trackType = 'multi'; 
            selectedClip = { name: `${$selectedClipIds.length} items`, type: 'Multi-Selection', duration: 0, volume: 1 };
        }
    }

    // 自動偵測 Timeline 第一個影片的原始尺寸
    $: {
        const firstVideoClip = $mainTrackClips.find(c => c.type.startsWith('video') || c.name.endsWith('.mov'));
        
        if (firstVideoClip) {
            const sourceFile = $uploadedFiles.find(f => f.url === firstVideoClip.fileUrl);
            if (sourceFile && sourceFile.width && sourceFile.height) {
                originalRes = { width: sourceFile.width, height: sourceFile.height };
            } else {
                originalRes = null;
            }
        } else {
            originalRes = null;
        }
    }

    function saveSnapshot() {
        addToHistory();
    }

    // 🔥🔥🔥 關鍵修改：還原原始解析度按鈕功能 🔥🔥🔥
    function setOriginalResolution() {
        if (!originalRes) return;
        saveSnapshot();
        
        projectSettings.update(s => ({
            ...s,
            width: originalRes.width,
            height: originalRes.height,
            aspectRatio: 'original' // 明確設定狀態，避免跟 16:9 衝突
        }));
    }

    function updateProperty(key, value) {
        const updateLogic = (clips) => clips.map(c => $selectedClipIds.includes(c.id) ? { ...c, [key]: value } : c);
        if (trackType === 'main') mainTrackClips.update(updateLogic);
        else if (trackType === 'audio') audioTrackClips.update(updateLogic);
        else if (trackType === 'text') textTrackClips.update(updateLogic);
        else if (trackType === 'multi') {
            mainTrackClips.update(updateLogic);
            audioTrackClips.update(updateLogic);
            textTrackClips.update(updateLogic);
        }
    }

    function updateText(e) { updateProperty('text', e.target.value); }
    function updateColor(e) { updateProperty('color', e.target.value); }
    function updateFontSize(e) { updateProperty('fontSize', parseInt(e.target.value)); }
    function updateFontFamily(e) { updateProperty('fontFamily', e.target.value); }
    function updateTextX(e) { updateProperty('x', parseInt(e.target.value)); }
    function updateTextY(e) { updateProperty('y', parseInt(e.target.value)); }
    function updateShowBg(e) { updateProperty('showBackground', e.target.checked); }
    
    function updateBgColor(e) { 
        const newColor = e.target.value; 
        const currentHex = selectedClip.backgroundColor || '#000000ff';
        const currentAlpha = currentHex.length === 9 ? currentHex.substring(7, 9) : 'ff';
        updateProperty('backgroundColor', newColor + currentAlpha);
    }

    function updateBgOpacity(e) {
        const opacity = parseInt(e.target.value);
        const hexAlpha = Math.round((opacity / 100) * 255).toString(16).padStart(2, '0');
        const currentHex = selectedClip.backgroundColor || '#000000';
        const baseColor = currentHex.substring(0, 7);
        updateProperty('backgroundColor', baseColor + hexAlpha);
    }

    $: bgOpacityValue = (() => {
        const hex = selectedClip?.backgroundColor;
        if (!hex || hex.length !== 9) return 100;
        return Math.round((parseInt(hex.substring(7, 9), 16) / 255) * 100);
    })();

    function updateStrokeWidth(e) { updateProperty('strokeWidth', parseInt(e.target.value)); }
    function updateStrokeColor(e) { updateProperty('strokeColor', e.target.value); }

    function updateScale(e) { updateProperty('scale', parseFloat(e.target.value)); }
    function updatePosX(e) { updateProperty('positionX', parseInt(e.target.value)); }
    function updatePosY(e) { updateProperty('positionY', parseInt(e.target.value)); }
    function updateVolume(e) { updateProperty('volume', parseFloat(e.target.value)); }

    function setAspectRatio(ratio) {
        saveSnapshot(); 
        if (ratio === '16:9') projectSettings.set({ width: 1280, height: 720, aspectRatio: '16:9' });
        else if (ratio === '9:16') projectSettings.set({ width: 720, height: 1280, aspectRatio: '9:16' });
        else if (ratio === '1:1') projectSettings.set({ width: 1080, height: 1080, aspectRatio: '1:1' });
        else if (ratio === '4:5') projectSettings.set({ width: 1080, height: 1350, aspectRatio: '4:5' });
    }

    // 手動更新寬高
    function onDimensionInput(e, prop) {
        const val = parseInt(e.target.value);
        if (!isNaN(val) && val > 0) {
            projectSettings.update(s => ({ ...s, [prop]: val, aspectRatio: 'custom' }));
        }
    }

    function onDimensionChange(e, prop) {
        let val = parseInt(e.target.value);
        if (isNaN(val) || val <= 0) return;
        if (val % 2 !== 0) {
            val -= 1;
            e.target.value = val; 
            projectSettings.update(s => ({ ...s, [prop]: val, aspectRatio: 'custom' }));
        }
    }

    function handleDelete() {
        if ($selectedClipIds.length === 0) return;
        if (confirm(`Delete ${$selectedClipIds.length} items?`)) {
            saveSnapshot();
            mainTrackClips.update(clips => clips.filter(c => !$selectedClipIds.includes(c.id)));
            audioTrackClips.update(clips => clips.filter(c => !$selectedClipIds.includes(c.id)));
            textTrackClips.update(clips => clips.filter(c => !$selectedClipIds.includes(c.id)));
            selectedClipIds.set([]); 
        }
    }

    const fonts = [
        { name: 'Sans Serif', value: 'Arial, sans-serif' },
        { name: 'Serif', value: '"Times New Roman", serif' },
        { name: 'Monospace', value: '"Courier New", monospace' },
        { name: 'Impact', value: 'Impact, sans-serif' },
        { name: 'Comic Sans', value: '"Comic Sans MS", "Chalkboard SE", sans-serif' },
        { name: 'Verdana', value: 'Verdana, sans-serif' },
        { name: 'Georgia', value: 'Georgia, serif' },
        { name: 'JhengHei', value: '"Microsoft JhengHei", sans-serif' }
    ];
</script>

<aside class="w-[300px] border-l border-gray-700 bg-[#181818] flex-shrink-0 flex flex-col">
    <div class="h-12 border-b border-gray-700 flex items-center px-4 font-medium text-sm bg-[#252525]">Properties</div>
    <div class="p-4 flex-1 overflow-y-auto custom-scrollbar">
        {#if !selectedClip}
            <!-- Global Settings -->
            <div class="space-y-4">
                <span class="text-xs text-gray-500 uppercase font-bold tracking-wider">Canvas Settings</span>
                <div class="bg-[#202020] p-4 rounded border border-gray-700 space-y-3">
                    <label class="text-xs text-gray-400">Aspect Ratio</label>
                    
                    <div class="grid grid-cols-2 gap-2">
                        <!-- 🔥🔥🔥 修正版 Original Button：只判斷 aspectRatio === 'original' 🔥🔥🔥 -->
                        {#if originalRes}
                            <button 
                                on:click={setOriginalResolution} 
                                class="col-span-2 px-2 py-2 rounded text-xs border transition-colors flex flex-col items-center justify-center gap-0.5 
                                {$projectSettings.aspectRatio === 'original' 
                                    ? 'bg-cyan-900/50 border-cyan-500 text-white' 
                                    : 'border-gray-600 text-gray-300 hover:bg-gray-700'}"
                            >
                                <span class="font-bold">Original</span>
                                <span class="text-[9px] opacity-70">({originalRes.width} x {originalRes.height})</span>
                            </button>
                        {/if}

                        <!-- 其他按鈕保持不變，它們會跟著 aspectRatio 狀態自動切換 -->
                        <button on:click={() => setAspectRatio('16:9')} class="px-2 py-2 rounded text-xs border transition-colors {$projectSettings.aspectRatio === '16:9' ? 'bg-cyan-900/50 border-cyan-500 text-white' : 'border-gray-600 text-gray-400 hover:bg-gray-700'}">16:9 (YouTube)</button>
                        <button on:click={() => setAspectRatio('9:16')} class="px-2 py-2 rounded text-xs border transition-colors {$projectSettings.aspectRatio === '9:16' ? 'bg-cyan-900/50 border-cyan-500 text-white' : 'border-gray-600 text-gray-400 hover:bg-gray-700'}">9:16 (TikTok)</button>
                        <button on:click={() => setAspectRatio('1:1')} class="px-2 py-2 rounded text-xs border transition-colors {$projectSettings.aspectRatio === '1:1' ? 'bg-cyan-900/50 border-cyan-500 text-white' : 'border-gray-600 text-gray-400 hover:bg-gray-700'}">1:1 (Square)</button>
                        <button on:click={() => setAspectRatio('4:5')} class="px-2 py-2 rounded text-xs border transition-colors {$projectSettings.aspectRatio === '4:5' ? 'bg-cyan-900/50 border-cyan-500 text-white' : 'border-gray-600 text-gray-400 hover:bg-gray-700'}">4:5 (Portrait)</button>
                    </div>
                    
                    <div class="grid grid-cols-2 gap-2 pt-2 border-t border-gray-700/50">
                        <div>
                            <label class="text-[10px] text-gray-500 mb-1 block">Width (px)</label>
                            <input 
                                type="number" 
                                value={$projectSettings.width} 
                                on:focus={saveSnapshot} 
                                on:input={(e) => onDimensionInput(e, 'width')} 
                                on:change={(e) => onDimensionChange(e, 'width')}
                                class="w-full bg-[#2a2a2a] text-white text-xs rounded border border-gray-600 px-2 py-1 text-center focus:border-cyan-500 outline-none"
                            />
                        </div>
                        <div>
                            <label class="text-[10px] text-gray-500 mb-1 block">Height (px)</label>
                            <input 
                                type="number" 
                                value={$projectSettings.height} 
                                on:focus={saveSnapshot} 
                                on:input={(e) => onDimensionInput(e, 'height')} 
                                on:change={(e) => onDimensionChange(e, 'height')}
                                class="w-full bg-[#2a2a2a] text-white text-xs rounded border border-gray-600 px-2 py-1 text-center focus:border-cyan-500 outline-none"
                            />
                        </div>
                    </div>
                    <div class="text-[10px] text-gray-600 text-center">Export will use this resolution.</div>
                </div>
            </div>

        {:else}
            <!-- Clip Properties -->
            <div class="flex flex-col gap-6">
                <!-- Info -->
                <div class="space-y-2">
                    <span class="text-xs text-gray-500 uppercase font-bold tracking-wider">Info</span>
                    <div class="bg-[#202020] p-3 rounded border border-gray-700">
                        <p class="text-sm text-white truncate mb-1" title={selectedClip.name}>{selectedClip.name}</p>
                        <div class="flex justify-between text-xs text-gray-400">
                            {#if !isMultiSelection}
                                <span>Duration: {selectedClip.duration.toFixed(1)}s</span>
                                <span class="uppercase px-1.5 py-0.5 rounded bg-gray-700 text-[10px]">{selectedClip.type.split('/')[0]}</span>
                            {:else}
                                <span>Batch Edit Mode</span>
                            {/if}
                        </div>
                    </div>
                </div>

                <!-- Video Transform -->
                {#if (selectedClip.type.startsWith('video') || selectedClip.type.startsWith('image')) && !isMultiSelection}
                    <div class="space-y-4 border-t border-gray-700 pt-4">
                        <span class="text-xs text-gray-500 uppercase font-bold tracking-wider">Transform</span>
                        <div class="space-y-1">
                            <div class="flex justify-between"><label class="text-xs text-gray-400">Scale</label><span class="text-xs text-cyan-400">{(selectedClip.scale || 1).toFixed(2)}x</span></div>
                            <input type="range" min="0.1" max="5" step="0.1" value={selectedClip.scale || 1} on:pointerdown={saveSnapshot} on:input={updateScale} class="w-full accent-cyan-500 h-1 bg-gray-600 rounded appearance-none cursor-pointer">
                        </div>
                        <div class="space-y-1">
                            <label class="text-xs text-gray-400">Position (X / Y)</label>
                            <div class="flex gap-2 mb-1">
                                <input type="number" value={selectedClip.positionX || 0} on:focus={saveSnapshot} on:input={updatePosX} class="flex-1 min-w-0 bg-[#2a2a2a] border border-gray-600 rounded p-1 text-xs text-white text-center">
                                <input type="number" value={selectedClip.positionY || 0} on:focus={saveSnapshot} on:input={updatePosY} class="flex-1 min-w-0 bg-[#2a2a2a] border border-gray-600 rounded p-1 text-xs text-white text-center">
                            </div>
                            <div class="grid grid-cols-2 gap-2">
                                <input type="range" min="-600" max="600" value={selectedClip.positionX || 0} on:pointerdown={saveSnapshot} on:input={updatePosX} class="accent-cyan-500 h-1 bg-gray-600 rounded appearance-none cursor-pointer">
                                <input type="range" min="-600" max="600" value={selectedClip.positionY || 0} on:pointerdown={saveSnapshot} on:input={updatePosY} class="accent-cyan-500 h-1 bg-gray-600 rounded appearance-none cursor-pointer">
                            </div>
                        </div>
                    </div>
                {/if}

                <!-- Text Editor -->
                {#if selectedClip.type === 'text' && !isMultiSelection}
                    <div class="space-y-4 border-t border-gray-700 pt-4">
                        <span class="text-xs text-gray-500 uppercase font-bold tracking-wider">Text Style</span>
                        
                        <div class="space-y-1">
                            <label class="text-xs text-gray-400">Content</label>
                            <textarea value={selectedClip.text} on:focus={saveSnapshot} on:input={updateText} class="w-full bg-[#2a2a2a] border border-gray-600 rounded p-2 text-sm text-white focus:border-cyan-500 outline-none" rows="2"></textarea>
                        </div>
                        
                        <div class="space-y-1">
                            <label class="text-xs text-gray-400">Font</label>
                            <select value={selectedClip.fontFamily} on:mousedown={saveSnapshot} on:change={updateFontFamily} class="w-full bg-[#2a2a2a] border border-gray-600 rounded p-1 text-sm text-white focus:border-cyan-500 outline-none">
                                {#each fonts as font} <option value={font.value}>{font.name}</option> {/each}
                            </select>
                        </div>
                        
                        <div class="flex gap-2">
                            <div class="w-1/3 space-y-1">
                                <label class="text-xs text-gray-400">Color</label>
                                <input type="color" value={selectedClip.color} on:click={saveSnapshot} on:input={updateColor} class="w-full h-8 bg-transparent border border-gray-600 rounded cursor-pointer p-0">
                            </div>
                            <div class="flex-1 space-y-1">
                                <label class="text-xs text-gray-400">Size</label>
                                <input type="range" min="10" max="200" value={selectedClip.fontSize} on:pointerdown={saveSnapshot} on:input={updateFontSize} class="w-full accent-cyan-500 h-1 bg-gray-600 rounded appearance-none cursor-pointer">
                            </div>
                        </div>

                        <div class="space-y-1">
                            <label class="text-xs text-gray-400">Position (X / Y %)</label>
                            <div class="grid grid-cols-2 gap-2">
                                <input type="range" min="0" max="100" value={selectedClip.x} on:pointerdown={saveSnapshot} on:input={updateTextX} class="accent-cyan-500 h-1 bg-gray-600 rounded appearance-none cursor-pointer">
                                <input type="range" min="0" max="100" value={selectedClip.y} on:pointerdown={saveSnapshot} on:input={updateTextY} class="accent-cyan-500 h-1 bg-gray-600 rounded appearance-none cursor-pointer">
                            </div>
                        </div>

                        <div class="border-t border-gray-700 pt-2 mt-2 space-y-3">
                            <div class="space-y-2">
                                <div class="flex items-center gap-2">
                                    <input type="checkbox" checked={selectedClip.showBackground} on:mousedown={saveSnapshot} on:change={updateShowBg} class="accent-cyan-500 h-4 w-4">
                                    <label class="text-xs text-gray-400 font-bold">Background</label>
                                </div>
                                
                                {#if selectedClip.showBackground}
                                    <div class="flex items-center gap-2 pl-2">
                                        <input type="color" value={selectedClip.backgroundColor.substring(0, 7)} on:click={saveSnapshot} on:input={updateBgColor} class="w-8 h-8 bg-transparent border border-gray-600 rounded cursor-pointer p-0 shrink-0">
                                        <div class="flex-1 flex flex-col">
                                            <div class="flex justify-between text-[10px] text-gray-500"><span>Opacity</span><span>{bgOpacityValue}%</span></div>
                                            <input type="range" min="0" max="100" value={bgOpacityValue} on:pointerdown={saveSnapshot} on:input={updateBgOpacity} class="w-full accent-cyan-500 h-1 bg-gray-600 rounded appearance-none cursor-pointer">
                                        </div>
                                    </div>
                                {/if}
                            </div>

                            <div class="space-y-1">
                                <div class="flex justify-between items-center">
                                    <label class="text-xs text-gray-400">Stroke</label>
                                    <input type="color" value={selectedClip.strokeColor} on:click={saveSnapshot} on:input={updateStrokeColor} class="w-4 h-4 bg-transparent border-0 p-0 cursor-pointer">
                                </div>
                                <input type="range" min="0" max="10" value={selectedClip.strokeWidth} on:pointerdown={saveSnapshot} on:input={updateStrokeWidth} class="w-full accent-cyan-500 h-1 bg-gray-600 rounded appearance-none cursor-pointer">
                            </div>
                        </div>
                    </div>
                {/if}

                <!-- Volume -->
                {#if selectedClip.type !== 'text' && !selectedClip.type.startsWith('image')}
                    <div class="space-y-2 border-t border-gray-700 pt-4">
                        <div class="flex justify-between items-center"><span class="text-xs text-gray-500 uppercase font-bold tracking-wider">Volume</span><span class="text-xs text-cyan-400">{Math.round((selectedClip.volume || 1) * 100)}%</span></div>
                        <input type="range" min="0" max="1" step="0.01" value={selectedClip.volume ?? 1} on:pointerdown={saveSnapshot} on:input={updateVolume} class="w-full accent-cyan-500 h-1 bg-gray-600 rounded appearance-none cursor-pointer">
                    </div>
                {/if}

                <!-- Delete -->
                <div class="pt-4 border-t border-gray-700">
                    <button on:click={handleDelete} class="w-full py-2 bg-red-900/30 hover:bg-red-900/50 text-red-400 border border-red-900/50 rounded text-sm transition-colors flex items-center justify-center gap-2">Delete {isMultiSelection ? 'Selected' : 'Clip'}</button>
                </div>
            </div>
        {/if}
    </div>
</aside>
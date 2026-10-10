const fs = require('fs');

let content = fs.readFileSync('features/workspace/utils/buildGenerationParameters.ts', 'utf8');

const targetReplacement = `  if (useMultiviewReconstruction) {
    endpoint = '/api/v1/multiview/reconstruct-3d';
    body = {
      asset_id: settings.multiviewAssetId || undefined,
      images: settings.multiviewViews || undefined,
      model_preference: settings.aiModel,
      output_format: 'glb',
      topology_mode: settings.topologyMode || (settings.quadTopology ? 'quad' : 'triangle'),
      quad_topology: Boolean(settings.quadTopology || settings.topologyMode === 'quad'),
      physics_enabled: shouldEnablePhysics(settings.generateCollision ?? false, isPaintModel, settings.generateTexture ?? true),
      model_parameters: modelParameters,
      target_polycount: settings.autoOptimizeSettings?.targetPolycount ?? 50000,
      generateLOD: settings.generateLOD !== false,
      lodPreset: settings.lodPreset || 'high',
      lodCount: settings.lodCount || 4,
      quality: settings.meshQuality || 'high',
      texture_resolution: isTextured ? ({ low: 512, medium: 1024, high: 2048, ultra: 4096, '8k': 4096 }[settings.textureQuality || 'high'] || 2048) : undefined,
    };`;

content = content.replace(/  if \(useMultiviewReconstruction\) \{[\s\S]*?    \};/m, targetReplacement);

fs.writeFileSync('features/workspace/utils/buildGenerationParameters.ts', content);

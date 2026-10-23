interface JobData {
  id: string;
  status: string;
  productionStatus?: string;
  result?: Record<string, any>;
}

export function getJobPresentation(job: JobData) {
  const result = job.result || {};
  const artifacts = result.artifacts || {};
  const productionStatus = String(
    job.productionStatus || result.production_status || result.productionStatus || ''
  ).toLowerCase();
  const master = artifacts.master;
  const masterAvailable = master && typeof master.status === 'string'
    ? master.status === 'ready'
    : Boolean(result.asset_root);
  const masterUrl = masterAvailable
    ? master?.url || result.high_fidelity_url || result.source_model_url ||
      `/api/v1/system/jobs/${job.id}/download?artifact_format=master`
    : null;
  const gameReady = artifacts.game_ready?.glb;
  const productionComplete = productionStatus === 'ready' || productionStatus === 'degraded';
  const gameReadyUrl = gameReady?.status === 'ready' && gameReady.url
    ? gameReady.url
    : (!gameReady && productionComplete)
      ? result.game_ready_url || result.model_url || `/api/v1/system/jobs/${job.id}/download?artifact_format=glb`
      : null;
  const usesGameReady = Boolean(gameReadyUrl && productionComplete);
  const outputUrl = usesGameReady
    ? gameReadyUrl
    : masterUrl || (job.status === 'completed' && !productionStatus ? result.model_url || null : null);

  return {
    productionStatus,
    outputUrl,
    outputKind: usesGameReady
      ? 'game-ready' as const
      : masterUrl
        ? 'master' as const
        : outputUrl
          ? 'inference-output' as const
          : null,
    canRetryPostprocess: masterAvailable &&
      productionStatus !== 'ready' &&
      productionStatus !== 'degraded' &&
      (productionStatus === 'failed' || job.status === 'failed'),
    title: productionStatus === 'ready'
      ? gameReady && !gameReadyUrl
        ? 'Production Complete — Game-ready GLB Unavailable'
        : 'Production Asset Ready'
      : productionStatus === 'degraded'
        ? 'Production Complete — Some Artifacts Unavailable'
        : productionStatus === 'failed'
          ? job.status === 'completed'
            ? 'Inference Complete — Production Failed'
            : 'Production Processing Failed'
          : job.status === 'completed'
            ? 'Inference Complete'
            : 'Generation Failed',
  };
}

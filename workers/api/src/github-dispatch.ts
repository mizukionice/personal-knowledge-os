/**
 * GitHub repository_dispatch を送信してバッチ（process-job.yml）を起動する（TDD §4 / 06_API）。
 */
export async function dispatchProcessJob(
  repo: string,
  token: string,
  jobId: string,
): Promise<void> {
  const response = await fetch(`https://api.github.com/repos/${repo}/dispatches`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'pkos-api',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      event_type: 'process_job',
      client_payload: { job_id: jobId },
    }),
  });
  // 成功時は204 No Content
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`repository_dispatch failed with status ${response.status}: ${body}`);
  }
}

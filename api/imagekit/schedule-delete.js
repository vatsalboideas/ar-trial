module.exports = function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const fileId = req.body?.fileId;
  if (!fileId || typeof fileId !== 'string') {
    return res.status(400).json({ error: 'fileId is required.' });
  }

  // Serverless functions are not durable workers. Keep this endpoint best-effort
  // and move timed deletions to ImageKit lifecycle rules or a cron worker.
  return res.status(200).json({
    ok: true,
    fileId,
    note: 'Deletion scheduling should be handled by ImageKit lifecycle rules or cron.',
  });
};

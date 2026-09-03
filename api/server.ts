/**
 * local server entry file, for local development
 */
import app from './app.js';

/**
 * start server with port
 */
const PORT = Number(process.env.PORT) || 3001;

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server ready on port ${PORT}`);
  console.log(`  Local:    http://localhost:${PORT}`);
  console.log(`  Network:  http://0.0.0.0:${PORT}`);
  // 5 分钟后首次 checkpoint，之后每小时一次
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const runCheckpoint = () => { try { (require('./db.js') as { checkpoint?: (mode?: 'PASSIVE' | 'FULL') => void }).checkpoint?.('PASSIVE') } catch { /* 启动早期 db 模块尚未就绪 */ } }
  setTimeout(() => runCheckpoint(), 5 * 60_000)
  setInterval(runCheckpoint, 60 * 60_000).unref?.()
});

/**
 * close server
 */
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT signal received');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

export default app;
import { app } from 'electron';
import path from 'path';

import { getSharedStore } from './modules/config';
import { startWaveApi } from './wave';
import { initializeWaveAuth, secretBox } from './wave/auth';

const store = getSharedStore();

/**
 * 检查端口是否可用
 */
function checkPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const net = require('net');
    const tester = net
      .createServer()
      .once('error', () => {
        resolve(false);
      })
      .once('listening', () => {
        tester.close(() => resolve(true));
      })
      .listen(port);
  });
}

async function startMusicApi(): Promise<void> {
  console.log('MUSIC API STARTING...');

  const settings = store.get('set') as any;
  let port = settings?.musicApiPort || 30488;
  const maxRetries = 10;

  // 检查端口是否可用，如果不可用则尝试下一个端口
  for (let i = 0; i < maxRetries; i++) {
    const isAvailable = await checkPortAvailable(port);
    if (isAvailable) {
      break;
    }
    console.log(`端口 ${port} 被占用，尝试切换到端口 ${port + 1}`);
    port++;
  }

  // 如果端口发生变化，保存新端口到配置
  const originalPort = settings?.musicApiPort || 30488;
  if (port !== originalPort) {
    console.log(`端口从 ${originalPort} 切换到 ${port}`);
    store.set('set', { ...settings, musicApiPort: port });
  }

  try {
    await startWaveApi({
      port,
      // 安全默认值：仅监听本机回环地址，避免对局域网暴露
      host: '127.0.0.1',
      dataDir: path.join(app.getPath('userData'), 'wave'),
      secretBox
    });
    initializeWaveAuth();
    console.log(`MUSIC API STARTED on port ${port}`);
  } catch (error) {
    console.error(`MUSIC API 启动失败:`, error);
    throw error;
  }
}

export { startMusicApi };

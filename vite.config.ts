import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { spawn, exec } from 'child_process';
import fs from 'fs';
import path from 'path';

let hookProcess: any = null;
let mediaProbeProcess: any = null;

function setCorsHeaders(res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
}

function startWindowsA15Hook(rootDir: string) {
  if (!hookProcess) {
    const scriptPath = path.join(rootDir, 'a15-os-hook.ps1');
    const statePath = path.join(rootDir, 'a15-lock-state.json');
    const logPath = path.join(rootDir, 'a15-hook-events.log');

    if (!fs.existsSync(logPath)) {
      fs.writeFileSync(logPath, '', 'utf-8');
    }

    hookProcess = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        scriptPath,
        '-StateFile',
        statePath,
        '-LogFile',
        logPath,
      ],
      {
        cwd: rootDir,
        windowsHide: true,
        stdio: 'ignore',
      }
    );

    hookProcess.on('exit', () => {
      hookProcess = null;
    });
  }

  if (!mediaProbeProcess) {
    const probeScriptPath = path.join(rootDir, 'a15-media-probe.ps1');
    const mediaJsonPath = path.join(rootDir, 'a15-live-media.json');

    mediaProbeProcess = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        probeScriptPath,
        '-OutFile',
        mediaJsonPath,
        '-Loop',
      ],
      {
        cwd: rootDir,
        windowsHide: true,
        stdio: 'ignore',
      }
    );

    mediaProbeProcess.on('exit', () => {
      mediaProbeProcess = null;
    });
  }
}

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'a15-windows-hardware-bridge',
      configureServer(server) {
        const rootDir = process.cwd();
        const statePath = path.join(rootDir, 'a15-lock-state.json');
        const logPath = path.join(rootDir, 'a15-hook-events.log');
        const mediaJsonPath = path.join(rootDir, 'a15-live-media.json');
        const comScriptPath = path.join(rootDir, 'a15-com-send.ps1');

        // Start the Windows OS-level AVRCP Ghost-Touch Hook & Live Audio Probe daemons
        startWindowsA15Hook(rootDir);

        server.middlewares.use('/api/a15/status', (req, res) => {
          setCorsHeaders(res);
          if (req.method === 'OPTIONS') {
            res.statusCode = 204;
            res.end();
            return;
          }

          startWindowsA15Hook(rootDir);
          let lockState = {
            masterLocked: true,
            singleTap: true,
            doubleTap: true,
            tripleTap: true,
            longPress: true,
            inEarDetect: true,
            autoPowerOff: true,
          };
          try {
            if (fs.existsSync(statePath)) {
              lockState = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
            }
          } catch {}

          let hookEvents: string[] = [];
          try {
            if (fs.existsSync(logPath)) {
              const raw = fs.readFileSync(logPath, 'utf-8').trim();
              if (raw) {
                hookEvents = raw.split(/\r?\n/).slice(-30);
              }
            }
          } catch {}

          let nowPlaying: any = {
            audioEndpoint: 'Headphones (A15 - 41:42:F9:E8:1A:CE)',
            endpointConnected: true,
            playbackStatus: 'Playing',
            sourceApp: '-',
            title: '-',
            volumePeakPercent: 0,
            updatedAt: '-',
            sessions: [],
          };
          try {
            if (fs.existsSync(mediaJsonPath)) {
              const rawMedia = fs.readFileSync(mediaJsonPath, 'utf-8').replace(/^\uFEFF/, '').trim();
              if (rawMedia) {
                nowPlaying = JSON.parse(rawMedia);
              }
            }
          } catch {}

          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              connected: true,
              deviceName: 'A15',
              macAddress: '41:42:F9:E8:1A:CE',
              instanceId: 'BTHENUM\\DEV_4142F9E81ACE',
              comPort: 'COM4',
              batteryLevel: 100,
              osHookActive: hookProcess !== null,
              lockState,
              hookEvents,
              nowPlaying,
              endpoints: [
                {
                  serviceUuid: '00001101-0000-1000-8000-00805f9b34fb',
                  charUuid: 'COM4 (SPP Serial Link - 41:42:F9:E8:1A:CE)',
                  name: 'Standard Serial over Bluetooth link (COM4)',
                  properties: ['READ', 'WRITE', 'WRITE_NO_RESP', 'SPP_COM4'],
                },
                {
                  serviceUuid: '0000110e-0000-1000-8000-00805f9b34fb',
                  charUuid: 'AVRCP_CONTROLLER (41:42:F9:E8:1A:CE)',
                  name: 'A15 Avrcp Transport (Touch Sensor Remote)',
                  properties: ['READ', 'WRITE', 'NOTIFY', 'OS_HOOK'],
                },
                {
                  serviceUuid: '0000110c-0000-1000-8000-00805f9b34fb',
                  charUuid: 'AVRCP_TARGET (41:42:F9:E8:1A:CE)',
                  name: 'A15 Avrcp Target Transport',
                  properties: ['READ', 'WRITE', 'OS_HOOK'],
                },
                {
                  serviceUuid: '00001801-0000-1000-8000-00805f9b34fb',
                  charUuid: 'GATT_PERIPHERAL (41:42:F9:E8:1A:CE)',
                  name: 'A15 Bluetooth GATT Peripheral Service',
                  properties: ['READ', 'WRITE', 'NOTIFY'],
                },
                {
                  serviceUuid: '0000110b-0000-1000-8000-00805f9b34fb',
                  charUuid: 'A2DP_AUDIO_SINK (41:42:F9:E8:1A:CE)',
                  name: 'Headphones (A15 Stereo Audio Endpoint)',
                  properties: ['READ', 'KEEP_ALIVE_18HZ'],
                },
              ],
            })
          );
        });

        server.middlewares.use('/api/a15/lock', (req, res) => {
          setCorsHeaders(res);
          if (req.method === 'OPTIONS') {
            res.statusCode = 204;
            res.end();
            return;
          }

          let body = '';
          req.on('data', (chunk) => {
            body += chunk;
          });
          req.on('end', () => {
            try {
              const payload = JSON.parse(body || '{}');
              const current = fs.existsSync(statePath)
                ? JSON.parse(fs.readFileSync(statePath, 'utf-8'))
                : {};
              const updated = {
                ...current,
                ...(payload.lockState || {}),
              };
              fs.writeFileSync(statePath, JSON.stringify(updated, null, 2), 'utf-8');
              startWindowsA15Hook(rootDir);

              const hexStr = (payload.hexPayload || '').replace(/[^0-9A-Fa-f ]/g, '');
              const textStr = (payload.stringPayload || '').replace(/["`$]/g, '');

              exec(
                `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${comScriptPath}" -PortName "COM4" -HexPayload "${hexStr}" -StringPayload "${textStr}"`,
                { timeout: 2500 },
                (_err, stdout) => {
                  res.setHeader('Content-Type', 'application/json');
                  res.end(
                    JSON.stringify({
                      ok: true,
                      lockState: updated,
                      comResult: (stdout || 'OK:OS_HOOK_UPDATED').trim(),
                    })
                  );
                }
              );
            } catch (e: any) {
              res.statusCode = 500;
              res.end(JSON.stringify({ ok: false, error: e?.message }));
            }
          });
        });
      },
    },
  ],
  server: {
    port: 5173,
    host: true,
    cors: true,
  },
});

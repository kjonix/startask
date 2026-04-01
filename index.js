const sql     = require('mssql');
const webpush = require('web-push');
const crypto  = require('crypto');

webpush.setVapidDetails(
  process.env.VAPID_EMAIL      || 'mailto:startask@example.com',
  process.env.VAPID_PUBLIC_KEY  || '',
  process.env.VAPID_PRIVATE_KEY || ''
);

const dbConfig = {
  server:   process.env.SQL_SERVER,
  database: process.env.SQL_DATABASE,
  user:     process.env.SQL_USER,
  password: process.env.SQL_PASSWORD,
  options:  { encrypt: true, trustServerCertificate: false }
};

let pool = null;
async function db() {
  if (!pool) pool = await sql.connect(dbConfig);
  return pool;
}

const CORS = {
  'Content-Type':                'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods':'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers':'Content-Type',
};

function hashPin(pin) {
  return crypto.createHash('sha256').update('startask_salt_' + pin).digest('hex');
}

function genChildKey(roomId) {
  const rand = crypto.randomBytes(12).toString('base64url').substring(0, 16).toUpperCase();
  return roomId + '_' + rand;
}

module.exports = async function (context, req) {
  context.res = { headers: CORS };
  if (req.method === 'OPTIONS') { context.res.status = 204; context.res.body = ''; return; }

  const action   = req.query.action;
  const roomId   = req.query.room;
  const childKey = req.query.childKey;
  const body     = req.body || {};

  try {
    const p = await db();

    // ── SJEKK OM ROM FINNES ───────────────────────────────────
    if (action === 'checkRoom') {
      const r = await p.request()
        .input('r', sql.NVarChar(20), roomId)
        .query('SELECT id, pin_hash FROM rooms WHERE id=@r');
      context.res.status = 200;
      context.res.body = JSON.stringify(
        r.recordset.length
          ? { exists: true, hasPin: !!r.recordset[0].pin_hash }
          : { exists: false }
      );
    }

    // ── LOGG INN ──────────────────────────────────────────────
    else if (action === 'login') {
      const { pin } = body;
      if (!roomId || !pin) { context.res.status = 400; context.res.body = JSON.stringify({ error: 'Mangler rom eller PIN' }); return; }
      const r = await p.request()
        .input('r', sql.NVarChar(20), roomId)
        .query('SELECT pin_hash, child_key FROM rooms WHERE id=@r');
      if (!r.recordset.length) { context.res.status = 401; context.res.body = JSON.stringify({ error: 'Fant ikke rom med denne koden.' }); return; }
      const row = r.recordset[0];
      if (row.pin_hash && row.pin_hash !== hashPin(pin)) { context.res.status = 401; context.res.body = JSON.stringify({ error: 'Feil PIN. Prøv igjen.' }); return; }
      context.res.status = 200;
      context.res.body = JSON.stringify({ ok: true, childKey: row.child_key });
    }

    // ── HENT ROM ──────────────────────────────────────────────
    else if (action === 'getRoom') {
      let query;
      if (childKey) {
        query = await p.request()
          .input('ck', sql.NVarChar(50), childKey)
          .query(`
            SELECT r.id, r.child_name, r.deadline,
                   t.id AS task_id, t.name, t.emoji, t.mins, t.sort_order,
                   c.checked_at
            FROM rooms r
            LEFT JOIN tasks t  ON t.room_id    = r.id
            LEFT JOIN checks c ON c.task_id    = t.id
                               AND c.checked_at = CAST(GETDATE() AS DATE)
            WHERE r.child_key = @ck
            ORDER BY t.sort_order`);
      } else if (roomId) {
        query = await p.request()
          .input('r', sql.NVarChar(20), roomId)
          .query(`
            SELECT r.id, r.child_name, r.deadline,
                   t.id AS task_id, t.name, t.emoji, t.mins, t.sort_order,
                   c.checked_at
            FROM rooms r
            LEFT JOIN tasks t  ON t.room_id    = r.id
            LEFT JOIN checks c ON c.task_id    = t.id
                               AND c.checked_at = CAST(GETDATE() AS DATE)
            WHERE r.id = @r
            ORDER BY t.sort_order`);
      } else {
        context.res.status = 400; context.res.body = JSON.stringify({ error: 'Mangler rom eller barnekode' }); return;
      }
      context.res.status = 200;
      context.res.body = JSON.stringify(query.recordset);
    }

    // ── LAGRE ROM ─────────────────────────────────────────────
    else if (action === 'saveRoom') {
      const { childName, tasks, pin, childKey: ck, deadline } = body;
      if (!childName) { context.res.status = 400; context.res.body = JSON.stringify({ error: 'Mangler barnets navn' }); return; }

      const pinHash = pin ? hashPin(pin) : null;
      const cKey    = ck || genChildKey(roomId);
      const dl      = deadline || null;

      await p.request()
        .input('r',  sql.NVarChar(20),  roomId)
        .input('n',  sql.NVarChar(100), childName)
        .input('ph', sql.NVarChar(64),  pinHash)
        .input('ck', sql.NVarChar(50),  cKey)
        .input('dl', sql.NVarChar(5),   dl)
        .query(`
          MERGE rooms AS t
          USING (SELECT @r id, @n child_name, @ph pin_hash, @ck child_key, @dl deadline) s ON t.id=s.id
          WHEN MATCHED THEN
            UPDATE SET child_name=s.child_name,
                       pin_hash=COALESCE(s.pin_hash, t.pin_hash),
                       child_key=COALESCE(t.child_key, s.child_key),
                       deadline=s.deadline
          WHEN NOT MATCHED THEN
            INSERT(id, child_name, pin_hash, child_key, deadline)
            VALUES(s.id, s.child_name, s.pin_hash, s.child_key, s.deadline);`);

      await p.request().input('r', sql.NVarChar(20), roomId)
        .query('DELETE FROM tasks WHERE room_id=@r');

      for (let i = 0; i < tasks.length; i++) {
        const t = tasks[i];
        await p.request()
          .input('id', sql.NVarChar(50),  t.id)
          .input('r',  sql.NVarChar(20),  roomId)
          .input('n',  sql.NVarChar(200), t.name)
          .input('e',  sql.NVarChar(10),  t.emoji || '⭐')
          .input('m',  sql.Int,           t.mins  || 5)
          .input('s',  sql.Int,           i)
          .query('INSERT INTO tasks(id,room_id,name,emoji,mins,sort_order) VALUES(@id,@r,@n,@e,@m,@s)');
      }

      context.res.status = 200;
      context.res.body = JSON.stringify({ ok: true, childKey: cKey });
    }

    // ── HUK AV ───────────────────────────────────────────────
    else if (action === 'check') {
      const { taskId, checked } = body;
      if (checked) {
        await p.request().input('t', sql.NVarChar(50), taskId).query(`
          MERGE checks AS x USING (SELECT @t task_id, CAST(GETDATE() AS DATE) checked_at) s
          ON x.task_id=s.task_id AND x.checked_at=s.checked_at
          WHEN NOT MATCHED THEN INSERT VALUES(s.task_id, s.checked_at);`);
      } else {
        await p.request().input('t', sql.NVarChar(50), taskId)
          .query('DELETE FROM checks WHERE task_id=@t AND checked_at=CAST(GETDATE() AS DATE)');
      }
      context.res.status = 200;
      context.res.body = JSON.stringify({ ok: true });
    }

    // ── LAGRE PUSH-ABONNEMENT ─────────────────────────────────
    else if (action === 'savePushSub') {
      const { subscription, childKey: ck } = body;
      const endpoint = subscription.endpoint;
      const cr = await p.request()
        .input('ck', sql.NVarChar(50), ck || '')
        .input('r',  sql.NVarChar(20), roomId || '')
        .query('SELECT id FROM rooms WHERE child_key=@ck OR id=@r');
      if (!cr.recordset.length) { context.res.status = 404; context.res.body = JSON.stringify({ error: 'Rom ikke funnet' }); return; }
      const rId = cr.recordset[0].id;
      await p.request()
        .input('r',   sql.NVarChar(20),   rId)
        .input('ep',  sql.NVarChar(500),  endpoint)
        .input('sub', sql.NVarChar(4000), JSON.stringify(subscription))
        .query(`
          MERGE push_subs AS t
          USING (SELECT @r room_id, @ep endpoint, @sub subscription) s
          ON t.room_id=s.room_id AND t.endpoint=s.endpoint
          WHEN MATCHED THEN UPDATE SET subscription=s.subscription, updated_at=GETDATE()
          WHEN NOT MATCHED THEN INSERT(room_id,endpoint,subscription) VALUES(s.room_id,s.endpoint,s.subscription);`);
      context.res.status = 200;
      context.res.body = JSON.stringify({ ok: true });
    }

    // ── UKENTLIG STATISTIKK ───────────────────────────────────
    else if (action === 'weekStats') {
      let rId = roomId;
      if (childKey) {
        const cr = await p.request().input('ck', sql.NVarChar(50), childKey)
          .query('SELECT id FROM rooms WHERE child_key=@ck');
        if (!cr.recordset.length) { context.res.status = 404; context.res.body = JSON.stringify([]); return; }
        rId = cr.recordset[0].id;
      }
      const r = await p.request().input('r', sql.NVarChar(20), rId).query(`
        SELECT c.checked_at, COUNT(*) AS stars
        FROM checks c JOIN tasks t ON c.task_id=t.id
        WHERE t.room_id=@r AND c.checked_at>=DATEADD(day,-6,CAST(GETDATE() AS DATE))
        GROUP BY c.checked_at ORDER BY c.checked_at`);
      context.res.status = 200;
      context.res.body = JSON.stringify(r.recordset);
    }

    else {
      context.res.status = 400;
      context.res.body = JSON.stringify({ error: 'Ukjent action: ' + action });
    }

  } catch (err) {
    context.log.error('StarTask API feil:', err.message);
    context.res.status = 500;
    context.res.body = JSON.stringify({ error: err.message });
  }
};

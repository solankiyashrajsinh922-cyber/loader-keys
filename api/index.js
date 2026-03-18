const { Octokit } = require("@octokit/rest");

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

const OWNER = "solankiyashrajsinh922-cyber";
const REPO  = "loader-keys";
const KEYS_FILE    = "keys.json";
const VERSION_FILE = "version.json";

// ── GitHub helpers ─────────────────────────
async function getFile(path) {
  const { data } = await octokit.repos.getContent({
    owner: OWNER, repo: REPO, path
  });
  const content = Buffer.from(data.content, 'base64').toString('utf8');
  return { data: JSON.parse(content), sha: data.sha };
}

async function updateFile(path, data, sha, message) {
  const content = Buffer.from(JSON.stringify(data, null, 2)).toString('base64');
  await octokit.repos.createOrUpdateFileContents({
    owner: OWNER, repo: REPO, path,
    message, content, sha
  });
}

// ── Main handler ───────────────────────────
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-token');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const { action } = req.query;

  try {

    // ══ VALIDATE KEY (App use karta hai) ═══
    if (action === 'validate') {
      const { key, device_id } = req.body || {};
      if (!key) { res.json({ success: false, message: "Key required!" }); return; }

      // Check maintenance
      try {
        const { data: vData } = await getFile(VERSION_FILE);
        if (vData.maintenance) {
          res.json({
            success: false,
            message: vData.maintenance_msg || "App is under maintenance!"
          });
          return;
        }
      } catch(e) {}

      const { data: keys, sha } = await getFile(KEYS_FILE);

      if (!keys[key]) { res.json({ success: false, message: "Invalid key!" }); return; }

      const entry = keys[key];

      if (entry.active === false) {
        res.json({ success: false, message: "Key has been disabled!" }); return;
      }

      if (entry.expires_at && entry.expires_at !== 'null') {
        if (new Date() > new Date(entry.expires_at)) {
          res.json({ success: false, message: "Key has expired!" }); return;
        }
      }

      if (entry.device_id && entry.device_id !== 'null') {
        if (entry.device_id !== device_id) {
          res.json({ success: false, message: "Key is locked to another device!" }); return;
        }
      } else if (device_id) {
        keys[key].device_id = device_id;
        keys[key].locked_at = new Date().toISOString();
        await updateFile(KEYS_FILE, keys, sha, "Device locked: " + device_id);
      }

      res.json({
        success: true,
        message: "Valid!",
        label: entry.label || "User",
        expires_at: entry.expires_at
      });
      return;
    }

    // ══ ADMIN ONLY — Token check ════════════
    const adminToken = req.headers['x-admin-token'];
    if (adminToken !== process.env.ADMIN_TOKEN) {
      res.json({ success: false, message: "Unauthorized!" }); return;
    }

    // ══ GET ALL KEYS ════════════════════════
    if (action === 'get_keys') {
      const { data: keys } = await getFile(KEYS_FILE);
      res.json({ success: true, keys });
      return;
    }

    // ══ ADD KEY ═════════════════════════════
    if (action === 'add_key') {
      const { key, label, expires_at } = req.body || {};
      const { data: keys, sha } = await getFile(KEYS_FILE);

      // Generate key if not provided
      const finalKey = key || generateKey();

      keys[finalKey] = {
        label: label || "No Label",
        created_at: new Date().toISOString(),
        expires_at: expires_at || null,
        duration: expires_at ? '' : 'Lifetime',
        device_id: null,
        locked_at: null,
        active: true
      };

      await updateFile(KEYS_FILE, keys, sha, "Key added: " + finalKey);
      res.json({ success: true, key: finalKey, message: "Key added!" });
      return;
    }

    // ══ DELETE KEY ══════════════════════════
    if (action === 'delete_key') {
      const { key } = req.body || {};
      const { data: keys, sha } = await getFile(KEYS_FILE);
      if (!keys[key]) { res.json({ success: false, message: "Key not found!" }); return; }
      delete keys[key];
      await updateFile(KEYS_FILE, keys, sha, "Key deleted: " + key);
      res.json({ success: true, message: "Key deleted!" });
      return;
    }

    // ══ RESET DEVICE ════════════════════════
    if (action === 'reset_device') {
      const { key } = req.body || {};
      const { data: keys, sha } = await getFile(KEYS_FILE);
      if (!keys[key]) { res.json({ success: false, message: "Key not found!" }); return; }
      keys[key].device_id = null;
      keys[key].locked_at = null;
      await updateFile(KEYS_FILE, keys, sha, "Device reset: " + key);
      res.json({ success: true, message: "Device reset!" });
      return;
    }

    // ══ GET MAINTENANCE ═════════════════════
    if (action === 'get_maintenance') {
      const { data: vData } = await getFile(VERSION_FILE);
      res.json({ success: true, maintenance: vData.maintenance || false });
      return;
    }

    // ══ SET MAINTENANCE ═════════════════════
    if (action === 'set_maintenance') {
      const { maintenance, message: msg } = req.body || {};
      const { data: vData, sha } = await getFile(VERSION_FILE);
      vData.maintenance = maintenance;
      if (msg) vData.maintenance_msg = msg;
      await updateFile(VERSION_FILE, vData, sha,
        maintenance ? "Maintenance ON" : "Maintenance OFF");
      res.json({ success: true, maintenance });
      return;
    }

    res.json({ success: false, message: "Invalid action!" });

  } catch (error) {
    res.status(500).json({ success: false, message: "Server error: " + error.message });
  }
};

function generateKey() {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const part = () => Array.from({length:5}, ()=>c[Math.floor(Math.random()*c.length)]).join('');
  return [part(),part(),part(),part()].join('-');
}

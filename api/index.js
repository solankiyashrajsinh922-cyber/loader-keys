const { Octokit } = require("@octokit/rest");

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN
});

const OWNER = "solankiyashrajsinh922-cyber";
const REPO = "loader-keys";
const FILE = "keys.json";

async function getKeys() {
  const { data } = await octokit.repos.getContent({
    owner: OWNER, repo: REPO, path: FILE
  });
  const content = Buffer.from(data.content, 'base64').toString('utf8');
  return { keys: JSON.parse(content), sha: data.sha };
}

async function updateKeys(keys, sha, message) {
  const content = Buffer.from(
    JSON.stringify(keys, null, 2)).toString('base64');
  await octokit.repos.createOrUpdateFileContents({
    owner: OWNER, repo: REPO, path: FILE,
    message, content, sha
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const { action } = req.query;

  try {
    // ── Validate Key ──────────────────────────
    if (action === 'validate') {
      const { key, device_id } = req.body || {};
      if (!key) {
        res.json({ success: false, message: "Key required!" });
        return;
      }

      const { keys, sha } = await getKeys();

      if (!keys[key]) {
        res.json({ success: false, message: "Invalid key!" });
        return;
      }

      const entry = keys[key];

      // Active check
      if (entry.active === false) {
        res.json({ success: false, message: "Key has been disabled!" });
        return;
      }

      // Expiry check
      if (entry.expires_at && entry.expires_at !== 'null') {
        const expDate = new Date(entry.expires_at);
        if (new Date() > expDate) {
          res.json({ success: false, message: "Key has expired!" });
          return;
        }
      }

      // Device lock check
      if (entry.device_id && entry.device_id !== 'null'
          && entry.device_id !== null) {
        if (entry.device_id !== device_id) {
          res.json({
            success: false,
            message: "Key is locked to another device!"
          });
          return;
        }
      } else {
        // First use — lock device
        if (device_id) {
          keys[key].device_id = device_id;
          keys[key].locked_at = new Date().toISOString();
          await updateKeys(keys, sha,
            "Device locked: " + device_id);
        }
      }

      res.json({
        success: true,
        message: "Key valid!",
        label: entry.label || "User",
        expires_at: entry.expires_at
      });
      return;
    }

    // ── Get All Keys (Admin) ──────────────────
    if (action === 'get_keys') {
      const token = req.headers['x-admin-token'];
      if (token !== process.env.ADMIN_TOKEN) {
        res.json({ success: false, message: "Unauthorized!" });
        return;
      }
      const { keys } = await getKeys();
      res.json({ success: true, keys });
      return;
    }

    // ── Add Key (Admin) ───────────────────────
    if (action === 'add_key') {
      const token = req.headers['x-admin-token'];
      if (token !== process.env.ADMIN_TOKEN) {
        res.json({ success: false, message: "Unauthorized!" });
        return;
      }

      const { key, label, expires_at } = req.body || {};
      const { keys, sha } = await getKeys();

      keys[key] = {
        label: label || "No Label",
        created_at: new Date().toISOString(),
        expires_at: expires_at || null,
        device_id: null,
        active: true
      };

      await updateKeys(keys, sha, "Key added: " + key);
      res.json({ success: true, message: "Key added!" });
      return;
    }

    // ── Delete Key (Admin) ────────────────────
    if (action === 'delete_key') {
      const token = req.headers['x-admin-token'];
      if (token !== process.env.ADMIN_TOKEN) {
        res.json({ success: false, message: "Unauthorized!" });
        return;
      }

      const { key } = req.body || {};
      const { keys, sha } = await getKeys();

      if (!keys[key]) {
        res.json({ success: false, message: "Key not found!" });
        return;
      }

      delete keys[key];
      await updateKeys(keys, sha, "Key deleted: " + key);
      res.json({ success: true, message: "Key deleted!" });
      return;
    }

    // ── Reset Device (Admin) ──────────────────
    if (action === 'reset_device') {
      const token = req.headers['x-admin-token'];
      if (token !== process.env.ADMIN_TOKEN) {
        res.json({ success: false, message: "Unauthorized!" });
        return;
      }

      const { key } = req.body || {};
      const { keys, sha } = await getKeys();

      if (!keys[key]) {
        res.json({ success: false, message: "Key not found!" });
        return;
      }

      keys[key].device_id = null;
      keys[key].locked_at = null;
      await updateKeys(keys, sha, "Device reset: " + key);
      res.json({ success: true, message: "Device reset!" });
      return;
    }

    res.json({ success: false, message: "Invalid action!" });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error: " + error.message
    });
  }
};

const { Octokit } = require("@octokit/rest");
const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

const OWNER = "solankiyashrajsinh922-cyber";
const REPO  = "loader-keys";

async function getFile(path) {
  const { data } = await octokit.repos.getContent({ owner:OWNER, repo:REPO, path });
  return { data: JSON.parse(Buffer.from(data.content,'base64').toString('utf8')), sha: data.sha };
}

async function updateFile(path, data, sha, msg) {
  await octokit.repos.createOrUpdateFileContents({
    owner:OWNER, repo:REPO, path,
    message: msg,
    content: Buffer.from(JSON.stringify(data,null,2)).toString('base64'),
    sha
  });
}

async function getResellers() {
  try {
    return await getFile('resellers.json');
  } catch(e) {
    await octokit.repos.createOrUpdateFileContents({
      owner:OWNER, repo:REPO, path:'resellers.json',
      message:'Init resellers.json',
      content: Buffer.from(JSON.stringify({},null,2)).toString('base64'),
    });
    return { data: {}, sha: null };
  }
}

function rp(){ const c='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s=''; for(let i=0;i<4;i++) s+=c[Math.floor(Math.random()*c.length)]; return s; }
function makeKey(){ return 'Yash_X_Prime_' + rp() + '_' + rp(); }

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type,x-admin-token');
  if(req.method==='OPTIONS'){res.status(200).end();return;}

  const action = req.query.action || req.body?.action;

  try {

    // ═══════════════════════════════════════════
    // VALIDATE KEY (App)
    // ═══════════════════════════════════════════
    if(action==='validate'){
      const { key, device_id } = req.body||{};
      if(!key){res.json({success:false,message:"Key required!"});return;}
      
      if(!key.startsWith('Yash_X_Prime_')){
        res.json({success:false,message:"Invalid key format! Use new branded key."});
        return;
      }

      const { data: v } = await getFile('version.json');
      if(v.maintenance){
        res.json({success:false,message:v.maintenance_msg||"App under maintenance!"});return;
      }

      const { data: keys, sha } = await getFile('keys.json');
      if(!keys[key]){res.json({success:false,message:"Invalid key!"});return;}

      const e = keys[key];
      if(e.active===false){res.json({success:false,message:"Key disabled!"});return;}

      if(e.expires_at && e.expires_at!=='null'){
        if(new Date() > new Date(e.expires_at)){
          res.json({success:false,message:"Key expired!"});return;
        }
      }

      // ── Multi-Device Logic ──────────────────
      const maxDev = e.max_devices || 1;
      if(!e.connected_devices) e.connected_devices = [];
      e.connected_devices = e.connected_devices.filter(d => d && d !== 'null');

      if(e.connected_devices.length >= maxDev && !e.connected_devices.includes(device_id)){
        res.json({success:false,message:"Max devices reached! ("+maxDev+")"});return;
      }

      if(device_id && !e.connected_devices.includes(device_id)){
        e.connected_devices.push(device_id);
        e.device_id = device_id;
        e.locked_at = new Date().toISOString();
        await updateFile('keys.json', keys, sha, "Device locked: "+device_id);
      }

      // ✅ Sending mod_features along with response
      res.json({
        success: true,
        label: e.label||"User",
        expires_at: e.expires_at,
        mods: v.mods || {},
        locked_mods: v.locked_mods || [],
        mod_features: v.mod_features || {}    // 🔥 New field
      });
      return;
    }

    // ═══════════════════════════════════════════
    // RESELLER LOGIN
    // ═══════════════════════════════════════════
    if(action==='reseller_login'){
      const { username, password } = req.body||{};
      if(!username||!password){res.json({success:false,message:"Required!"});return;}
      const { data: resellers } = await getResellers();
      const slug = username.toLowerCase();
      if(!resellers[slug]){res.json({success:false,message:"Reseller not found!"});return;}
      if(resellers[slug].password!==password){res.json({success:false,message:"Wrong password!"});return;}
      res.json({success:true,reseller:{username:slug,name:resellers[slug].name||slug,credits:resellers[slug].credits||0}});
      return;
    }

    // ═══════════════════════════════════════════
    // RESELLER GENERATE KEY
    // ═══════════════════════════════════════════
    if(action==='reseller_generate_key'){
      const { username, password, expires_at, label, max_devices } = req.body||{};
      if(!username||!password){res.json({success:false,message:"Unauthorized!"});return;}
      const { data: resellers, sha: rSha } = await getResellers();
      const slug = username.toLowerCase();
      if(!resellers[slug]||resellers[slug].password!==password){res.json({success:false,message:"Unauthorized!"});return;}
      if((resellers[slug].credits||0)<=0){res.json({success:false,message:"No credits! Contact admin."});return;}
      resellers[slug].credits = (resellers[slug].credits||0)-1;
      resellers[slug].total_keys_generated = (resellers[slug].total_keys_generated||0)+1;
      await updateFile('resellers.json',resellers,rSha,"Credit used by: "+slug);
      const { data: keys, sha: kSha } = await getFile('keys.json');
      const key = makeKey();
      keys[key] = {
        label: label||resellers[slug].name||slug,
        created_at: new Date().toISOString(),
        expires_at: expires_at||null,
        duration: '',
        device_id: null,
        locked_at: null,
        active: true,
        reseller: slug,
        max_devices: parseInt(max_devices)||1,
        connected_devices: []
      };
      await updateFile('keys.json',keys,kSha,"Key by reseller: "+slug);
      res.json({success:true, key, credits_left: resellers[slug].credits});
      return;
    }

    // ═══════════════════════════════════════════
    // RESELLER GET KEYS
    // ═══════════════════════════════════════════
    if(action==='reseller_get_keys'){
      const { username, password } = req.body||{};
      if(!username||!password){res.json({success:false,message:"Unauthorized!"});return;}
      const { data: resellers } = await getResellers();
      const slug = username.toLowerCase();
      if(!resellers[slug]||resellers[slug].password!==password){res.json({success:false,message:"Unauthorized!"});return;}
      const { data: keys } = await getFile('keys.json');
      const myKeys = {};
      Object.entries(keys).forEach(([k,v])=>{ if(v.reseller===slug) myKeys[k]=v; });
      res.json({success:true, keys: myKeys, credits: resellers[slug].credits||0});
      return;
    }

    // ═══════════════════════════════════════════
    // RESELLER RESET DEVICE
    // ═══════════════════════════════════════════
    if(action==='reseller_reset_device'){
      const { username, password, key } = req.body||{};
      if(!username||!password||!key){res.json({success:false,message:"Required!"});return;}
      const { data: resellers } = await getResellers();
      const slug = username.toLowerCase();
      if(!resellers[slug]||resellers[slug].password!==password){res.json({success:false,message:"Unauthorized!"});return;}
      const { data: keys, sha } = await getFile('keys.json');
      if(!keys[key]){res.json({success:false,message:"Key not found!"});return;}
      if(keys[key].reseller!==slug){res.json({success:false,message:"Not your key!"});return;}
      keys[key].device_id = null;
      keys[key].locked_at = null;
      keys[key].connected_devices = [];
      await updateFile('keys.json',keys,sha,"Device reset by reseller: "+slug);
      res.json({success:true,message:"Device reset!"});
      return;
    }

    // ═══════════════════════════════════════════
    // RESELLER DELETE KEY
    // ═══════════════════════════════════════════
    if(action==='reseller_delete_key'){
      const { username, password, key } = req.body||{};
      if(!username||!password||!key){res.json({success:false,message:"Required!"});return;}
      const { data: resellers } = await getResellers();
      const slug = username.toLowerCase();
      if(!resellers[slug]||resellers[slug].password!==password){res.json({success:false,message:"Unauthorized!"});return;}
      const { data: keys, sha } = await getFile('keys.json');
      if(!keys[key]){res.json({success:false,message:"Key not found!"});return;}
      if(keys[key].reseller!==slug){res.json({success:false,message:"Not your key!"});return;}
      delete keys[key];
      await updateFile('keys.json',keys,sha,"Key deleted by reseller: "+slug);
      res.json({success:true,message:"Deleted!"});
      return;
    }

    // ═══════════════════════════════════════════
    // ADMIN AUTH CHECK
    // ═══════════════════════════════════════════
    const token = req.headers['x-admin-token'];
    if(!token || token!==process.env.ADMIN_TOKEN){
      res.json({success:false,message:"Unauthorized!"});return;
    }

    // ═══════════════════════════════════════════
    // GET KEYS
    // ═══════════════════════════════════════════
    if(action==='get_keys'){
      const { data: keys } = await getFile('keys.json');
      res.json({success:true, keys});return;
    }

    // ═══════════════════════════════════════════
    // ADD KEY
    // ═══════════════════════════════════════════
    if(action==='add_key'){
      const { key, label, expires_at, max_devices } = req.body||{};
      const { data: keys, sha } = await getFile('keys.json');
      keys[key] = {
        label: label||"No Label",
        created_at: new Date().toISOString(),
        expires_at: expires_at||null,
        duration: '',
        device_id: null,
        locked_at: null,
        active: true,
        max_devices: parseInt(max_devices)||1,
        connected_devices: []
      };
      await updateFile('keys.json',keys,sha,"Key added: "+key);
      res.json({success:true,message:"Key added!"});return;
    }

    // ═══════════════════════════════════════════
    // DELETE KEY
    // ═══════════════════════════════════════════
    if(action==='delete_key'){
      const { key } = req.body||{};
      const { data: keys, sha } = await getFile('keys.json');
      if(!keys[key]){res.json({success:false,message:"Not found!"});return;}
      delete keys[key];
      await updateFile('keys.json',keys,sha,"Key deleted: "+key);
      res.json({success:true,message:"Deleted!"});return;
    }

    // ═══════════════════════════════════════════
    // RESET DEVICE
    // ═══════════════════════════════════════════
    if(action==='reset_device'){
      const { key } = req.body||{};
      const { data: keys, sha } = await getFile('keys.json');
      if(!keys[key]){res.json({success:false,message:"Not found!"});return;}
      keys[key].device_id = null;
      keys[key].locked_at = null;
      keys[key].connected_devices = [];
      await updateFile('keys.json',keys,sha,"Device reset: "+key);
      res.json({success:true,message:"Reset!"});return;
    }

    // ═══════════════════════════════════════════
    // GET MAINTENANCE
    // ═══════════════════════════════════════════
    if(action==='get_maintenance'){
      const { data: v } = await getFile('version.json');
      res.json({success:true, maintenance: v.maintenance||false});return;
    }

    // ═══════════════════════════════════════════
    // SET MAINTENANCE
    // ═══════════════════════════════════════════
    if(action==='set_maintenance'){
      const { maintenance } = req.body||{};
      const { data: v, sha } = await getFile('version.json');
      v.maintenance = maintenance;
      await updateFile('version.json', v, sha, maintenance ? "Maintenance ON" : "Maintenance OFF");
      res.json({success:true, maintenance});return;
    }

    // ═══════════════════════════════════════════
    // GET RESELLERS
    // ═══════════════════════════════════════════
    if(action==='get_resellers'){
      const { data: resellers } = await getResellers();
      res.json({success:true, resellers});return;
    }

    // ═══════════════════════════════════════════
    // CREATE RESELLER
    // ═══════════════════════════════════════════
    if(action==='create_reseller'){
      const { username, password, credits, name } = req.body||{};
      if(!username||!password){res.json({success:false,message:"Username and password required!"});return;}
      const slug = username.toLowerCase().replace(/[^a-z0-9]/g,'');
      if(!slug){res.json({success:false,message:"Invalid username!"});return;}
      const { data: resellers, sha } = await getResellers();
      if(resellers[slug]){res.json({success:false,message:"Reseller already exists!"});return;}
      resellers[slug] = {
        name: name||username,
        password,
        credits: parseInt(credits)||0,
        created_at: new Date().toISOString(),
        total_keys_generated: 0,
        active: true
      };
      await updateFile('resellers.json',resellers,sha,"Reseller created: "+slug);
      res.json({success:true,message:"Reseller created!",slug});return;
    }

    // ═══════════════════════════════════════════
    // DELETE RESELLER
    // ═══════════════════════════════════════════
    if(action==='delete_reseller'){
      const { username } = req.body||{};
      const slug = (username||'').toLowerCase();
      const { data: resellers, sha } = await getResellers();
      if(!resellers[slug]){res.json({success:false,message:"Not found!"});return;}
      delete resellers[slug];
      await updateFile('resellers.json',resellers,sha,"Reseller deleted: "+slug);
      res.json({success:true,message:"Reseller deleted!"});return;
    }

    // ═══════════════════════════════════════════
    // ADD CREDITS
    // ═══════════════════════════════════════════
    if(action==='add_credits'){
      const { username, credits } = req.body||{};
      const slug = (username||'').toLowerCase();
      const { data: resellers, sha } = await getResellers();
      if(!resellers[slug]){res.json({success:false,message:"Reseller not found!"});return;}
      resellers[slug].credits = (resellers[slug].credits||0)+parseInt(credits||0);
      await updateFile('resellers.json',resellers,sha,"Credits added to: "+slug);
      res.json({success:true,message:"Credits added!",credits:resellers[slug].credits});return;
    }

    // ═══════════════════════════════════════════
    // REMOVE CREDITS
    // ═══════════════════════════════════════════
    if(action==='remove_credits'){
      const { username, credits } = req.body||{};
      const slug = (username||'').toLowerCase();
      const { data: resellers, sha } = await getResellers();
      if(!resellers[slug]){res.json({success:false,message:"Reseller not found!"});return;}
      resellers[slug].credits = Math.max(0,(resellers[slug].credits||0)-parseInt(credits||0));
      await updateFile('resellers.json',resellers,sha,"Credits removed from: "+slug);
      res.json({success:true,message:"Credits removed!",credits:resellers[slug].credits});return;
    }

    // ═══════════════════════════════════════════
    // CHANGE RESELLER PASSWORD
    // ═══════════════════════════════════════════
    if(action==='change_reseller_password'){
      const { username, new_password } = req.body||{};
      const slug = (username||'').toLowerCase();
      if(!slug||!new_password){res.json({success:false,message:"Required!"});return;}
      const { data: resellers, sha } = await getResellers();
      if(!resellers[slug]){res.json({success:false,message:"Reseller not found!"});return;}
      resellers[slug].password = new_password;
      await updateFile('resellers.json',resellers,sha,"Password changed for: "+slug);
      res.json({success:true,message:"Password changed!"});return;
    }

    // ═══════════════════════════════════════════
    // GET MOD LOCKS
    // ═══════════════════════════════════════════
    if(action==='get_mod_locks'){
      const { data: v } = await getFile('version.json');
      res.json({success:true, locked_mods: v.locked_mods||[]});return;
    }

    // ═══════════════════════════════════════════
    // SET MOD LOCK
    // ═══════════════════════════════════════════
    if(action==='set_mod_lock'){
      const { mod_key, locked } = req.body||{};
      if(!mod_key){res.json({success:false,message:"mod_key required!"});return;}
      const { data: v, sha } = await getFile('version.json');
      if(!v.locked_mods) v.locked_mods = [];
      if(locked && !v.locked_mods.includes(mod_key)){
        v.locked_mods.push(mod_key);
      } else if(!locked){
        v.locked_mods = v.locked_mods.filter(m => m !== mod_key);
      }
      await updateFile('version.json', v, sha, "Mod lock updated: "+mod_key);
      res.json({success:true, locked_mods: v.locked_mods});return;
    }

    // ═══════════════════════════════════════════
    // 🔥 NEW: SET MOD FEATURES
    // ═══════════════════════════════════════════
    if(action==='set_mod_features'){
      const { mod_features } = req.body||{};
      if(!mod_features){ res.json({success:false,message:"mod_features required!"}); return; }
      const { data: v, sha } = await getFile('version.json');
      v.mod_features = mod_features;
      await updateFile('version.json', v, sha, "Mod features updated");
      res.json({success:true}); return;
    }

    // ═══════════════════════════════════════════
    // 🔥 NEW: GET MOD FEATURES (for admin panel load)
    // ═══════════════════════════════════════════
    if(action==='get_mod_features'){
      const { data: v } = await getFile('version.json');
      res.json({success:true, mod_features: v.mod_features||{}}); return;
    }

    res.json({success:false,message:"Unknown action!"});

  } catch(err) {
    res.status(500).json({success:false,message:"Error: "+err.message});
  }
};
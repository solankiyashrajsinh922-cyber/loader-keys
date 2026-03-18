const { Octokit } = require("@octokit/rest");

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

const OWNER = "solankiyashrajsinh922-cyber";
const REPO  = "loader-keys";

async function getFile(path) {
  const { data } = await octokit.repos.getContent({ owner:OWNER, repo:REPO, path });
  return {
    data: JSON.parse(Buffer.from(data.content,'base64').toString('utf8')),
    sha: data.sha
  };
}

async function updateFile(path, data, sha, msg) {
  await octokit.repos.createOrUpdateFileContents({
    owner:OWNER, repo:REPO, path,
    message:msg,
    content: Buffer.from(JSON.stringify(data,null,2)).toString('base64'),
    sha
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type,x-admin-token');
  if(req.method==='OPTIONS'){res.status(200).end();return;}

  const action = req.query.action || req.body?.action;

  try {

    // ── VALIDATE KEY (App) ──────────────────
    if(action==='validate'){
      const { key, device_id } = req.body||{};
      if(!key){res.json({success:false,message:"Key required!"});return;}

      // Maintenance check
      try{
        const {data:v} = await getFile('version.json');
        if(v.maintenance){
          res.json({success:false,message:v.maintenance_msg||"App under maintenance!"});
          return;
        }
      }catch(e){}

      const {data:keys,sha} = await getFile('keys.json');
      if(!keys[key]){res.json({success:false,message:"Invalid key!"});return;}

      const e = keys[key];
      if(e.active===false){res.json({success:false,message:"Key disabled!"});return;}

      if(e.expires_at && e.expires_at!=='null'){
        if(new Date()>new Date(e.expires_at)){
          res.json({success:false,message:"Key expired!"});return;
        }
      }

      if(e.device_id && e.device_id!=='null'){
        if(e.device_id!==device_id){
          res.json({success:false,message:"Key locked to another device!"});return;
        }
      } else if(device_id){
        keys[key].device_id = device_id;
        keys[key].locked_at = new Date().toISOString();
        await updateFile('keys.json',keys,sha,"Device locked: "+device_id);
      }

      res.json({success:true,label:e.label||"User",expires_at:e.expires_at});
      return;
    }

    // ── ADMIN CHECK ─────────────────────────
    const token = req.headers['x-admin-token'];
    if(!token || token!==process.env.ADMIN_TOKEN){
      res.json({success:false,message:"Unauthorized!"});return;
    }

    // ── GET KEYS ────────────────────────────
    if(action==='get_keys'){
      const {data:keys} = await getFile('keys.json');
      res.json({success:true,keys});return;
    }

    // ── ADD KEY ─────────────────────────────
    if(action==='add_key'){
      const {key,label,expires_at} = req.body||{};
      const {data:keys,sha} = await getFile('keys.json');
      keys[key] = {
        label:label||"No Label",
        created_at:new Date().toISOString(),
        expires_at:expires_at||null,
        duration:'',
        device_id:null,
        locked_at:null,
        active:true
      };
      await updateFile('keys.json',keys,sha,"Key added: "+key);
      res.json({success:true,message:"Key added!"});return;
    }

    // ── DELETE KEY ──────────────────────────
    if(action==='delete_key'){
      const {key} = req.body||{};
      const {data:keys,sha} = await getFile('keys.json');
      if(!keys[key]){res.json({success:false,message:"Not found!"});return;}
      delete keys[key];
      await updateFile('keys.json',keys,sha,"Key deleted: "+key);
      res.json({success:true,message:"Deleted!"});return;
    }

    // ── RESET DEVICE ────────────────────────
    if(action==='reset_device'){
      const {key} = req.body||{};
      const {data:keys,sha} = await getFile('keys.json');
      if(!keys[key]){res.json({success:false,message:"Not found!"});return;}
      keys[key].device_id=null;
      keys[key].locked_at=null;
      await updateFile('keys.json',keys,sha,"Device reset: "+key);
      res.json({success:true,message:"Reset!"});return;
    }

    // ── GET MAINTENANCE ─────────────────────
    if(action==='get_maintenance'){
      const {data:v} = await getFile('version.json');
      res.json({success:true,maintenance:v.maintenance||false});return;
    }

    // ── SET MAINTENANCE ─────────────────────
    if(action==='set_maintenance'){
      const {maintenance} = req.body||{};
      const {data:v,sha} = await getFile('version.json');
      v.maintenance = maintenance;
      await updateFile('version.json',v,sha,
        maintenance?"Maintenance ON":"Maintenance OFF");
      res.json({success:true,maintenance});return;
    }

    res.json({success:false,message:"Unknown action!"});

  }catch(err){
    res.status(500).json({success:false,message:"Error: "+err.message});
  }
};

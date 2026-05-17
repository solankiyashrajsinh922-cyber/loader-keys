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
  res.setHeader('Access-Control-Allow-Headers','Content-Type,x-admin-token,x-reseller-token');
  if(req.method==='OPTIONS'){res.status(200).end();return;}

  const action = req.query.action || req.body?.action;

  try {

    // VALIDATE KEY (App)
    if(action==='validate'){
      const { key, device_id } = req.body||{};
      if(!key){res.json({success:false,message:"Key required!"});return;}

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

      const maxDevices = e.max_devices || 1;
      const connectedDevices = e.connected_devices || [];

      if(connectedDevices.length >= maxDevices && !connectedDevices.includes(device_id)){
        res.json({success:false,message:"Key locked to "+maxDevices+" device(s)!"});return;
      }

      if(device_id && !connectedDevices.includes(device_id)){
        keys[key].connected_devices = [...connectedDevices, device_id];
        keys[key].locked_at = new Date().toISOString();
        await updateFile('keys.json',keys,sha,"Device added: "+device_id);
      }

      res.json({success:true,label:e.label||"User",expires_at:e.expires_at});
      return;
    }

    // ADMIN CHECK
    const adminToken = req.headers['x-admin-token'];
    const isAdmin = adminToken && adminToken===process.env.ADMIN_TOKEN;

    // RESELLER CHECK
    const resellerToken = req.headers['x-reseller-token'];
    let currentReseller = null;
    if(resellerToken){
      try{
        const {data:resellers} = await getFile('resellers.json');
        for(const [username,r] of Object.entries(resellers)){
          if(r.password===resellerToken){ currentReseller=username; break; }
        }
      }catch(e){}
    }

    // RESELLER LOGIN
    if(action==='reseller_login'){
      const {username,password} = req.body||{};
      if(!username||!password){res.json({success:false,message:"Username & password required!"});return;}

      try{
        const {data:resellers} = await getFile('resellers.json');
        const r = resellers[username];
        if(!r){res.json({success:false,message:"Reseller not found!"});return;}
        if(r.password!==password){res.json({success:false,message:"Wrong password!"});return;}
        res.json({success:true,name:r.name,username:r.username,credits:r.credits});
      }catch(e){
        res.json({success:false,message:"Error: "+e.message});
      }
      return;
    }

    // GET RESELLER INFO
    if(action==='get_reseller'){
      if(!currentReseller){res.json({success:false,message:"Unauthorized!"});return;}
      const {data:resellers} = await getFile('resellers.json');
      const r = resellers[currentReseller];
      if(!r){res.json({success:false,message:"Not found!"});return;}
      res.json({success:true,reseller:{name:r.name,username:r.username,credits:r.credits,total_keys:r.total_keys_generated||0,active_keys:r.active_keys||0}});
      return;
    }

    // ADMIN: GET ALL RESELLERS
    if(action==='get_resellers'){
      if(!isAdmin){res.json({success:false,message:"Admin only!"});return;}
      const {data:resellers} = await getFile('resellers.json');
      const safe = {};
      for(const [k,v] of Object.entries(resellers)){
        safe[k] = {...v, password: '***HIDDEN***'};
      }
      res.json({success:true,resellers:safe});return;
    }

    // ADMIN: ADD RESELLER
    if(action==='add_reseller'){
      if(!isAdmin){res.json({success:false,message:"Admin only!"});return;}
      const {name,username,password,credits} = req.body||{};
      if(!name||!username||!password){res.json({success:false,message:"Name, username & password required!"});return;}

      const {data:resellers,sha} = await getFile('resellers.json');
      if(resellers[username]){res.json({success:false,message:"Username already exists!"});return;}

      resellers[username] = {
        name, username, password,
        credits: parseInt(credits)||0,
        created_at: new Date().toISOString(),
        total_keys_generated: 0,
        active_keys: 0,
        credit_history: [{
          type: "add", amount: parseInt(credits)||0,
          by: "admin", reason: "Initial credits",
          at: new Date().toISOString()
        }]
      };
      await updateFile('resellers.json',resellers,sha,"Reseller added: "+username);
      res.json({success:true,message:"Reseller created!"});return;
    }

    // ADMIN: UPDATE RESELLER
    if(action==='update_reseller'){
      if(!isAdmin){res.json({success:false,message:"Admin only!"});return;}
      const {username,name,password,credits} = req.body||{};
      if(!username){res.json({success:false,message:"Username required!"});return;}

      const {data:resellers,sha} = await getFile('resellers.json');
      if(!resellers[username]){res.json({success:false,message:"Not found!"});return;}

      if(name) resellers[username].name = name;
      if(password) resellers[username].password = password;
      if(credits!==undefined) {
        const oldCredits = resellers[username].credits;
        const newCredits = parseInt(credits);
        const diff = newCredits - oldCredits;
        resellers[username].credits = newCredits;
        resellers[username].credit_history.push({
          type: diff>=0?"add":"remove",
          amount: Math.abs(diff),
          by: "admin",
          reason: diff>=0?"Credit added":"Credit removed",
          at: new Date().toISOString()
        });
      }
      await updateFile('resellers.json',resellers,sha,"Reseller updated: "+username);
      res.json({success:true,message:"Updated!"});return;
    }

    // ADMIN: DELETE RESELLER
    if(action==='delete_reseller'){
      if(!isAdmin){res.json({success:false,message:"Admin only!"});return;}
      const {username} = req.body||{};
      if(!username){res.json({success:false,message:"Username required!"});return;}

      const {data:resellers,sha} = await getFile('resellers.json');
      if(!resellers[username]){res.json({success:false,message:"Not found!"});return;}
      delete resellers[username];
      await updateFile('resellers.json',resellers,sha,"Reseller deleted: "+username);
      res.json({success:true,message:"Deleted!"});return;
    }

    // ADMIN: ADD/REMOVE CREDITS
    if(action==='manage_credits'){
      if(!isAdmin){res.json({success:false,message:"Admin only!"});return;}
      const {username,amount,reason} = req.body||{};
      if(!username||amount===undefined){res.json({success:false,message:"Username & amount required!"});return;}

      const {data:resellers,sha} = await getFile('resellers.json');
      if(!resellers[username]){res.json({success:false,message:"Not found!"});return;}

      const amt = parseInt(amount);
      resellers[username].credits += amt;
      resellers[username].credit_history.push({
        type: amt>=0?"add":"remove",
        amount: Math.abs(amt),
        by: "admin",
        reason: reason||(amt>=0?"Credit added":"Credit removed"),
        at: new Date().toISOString()
      });
      await updateFile('resellers.json',resellers,sha,"Credits updated: "+username);
      res.json({success:true,credits:resellers[username].credits});return;
    }

    // GET KEYS
    if(action==='get_keys'){
      if(!isAdmin && !currentReseller){res.json({success:false,message:"Unauthorized!"});return;}
      const {data:keys} = await getFile('keys.json');

      let filtered = keys;
      if(currentReseller){
        filtered = {};
        for(const [k,v] of Object.entries(keys)){ if(v.reseller===currentReseller) filtered[k]=v; }
      }
      if(isAdmin && req.query.reseller){
        const r = req.query.reseller;
        filtered = {};
        for(const [k,v] of Object.entries(keys)){ 
          if(r==='admin' && !v.reseller) filtered[k]=v;
          else if(v.reseller===r) filtered[k]=v;
        }
      }
      res.json({success:true,keys:filtered});return;
    }

    // ADD KEY
    if(action==='add_key'){
      const {key,label,expires_at,max_devices,reseller} = req.body||{};

      let targetReseller = null;
      let creditCost = 0;
      let isLifetime = !expires_at;

      if(isAdmin){
        targetReseller = reseller || null;
        creditCost = 0;
      } else if(currentReseller){
        targetReseller = currentReseller;
        creditCost = isLifetime ? 2 : 1;

        const {data:resellers} = await getFile('resellers.json');
        const r = resellers[currentReseller];
        if(!r || r.credits < creditCost){
          res.json({success:false,message:"Insufficient credits! Need "+creditCost+" credits"});return;
        }
        const md = parseInt(max_devices)||1;
        if(md > 1){res.json({success:false,message:"Reseller can only create single-device keys!"});return;}
      } else {
        res.json({success:false,message:"Unauthorized!"});return;
      }

      const {data:keys,sha} = await getFile('keys.json');
      keys[key] = {
        label:label||"No Label",
        created_at:new Date().toISOString(),
        expires_at:expires_at||null,
        duration:'',
        device_id:null,
        locked_at:null,
        active:true,
        reseller: targetReseller,
        max_devices: parseInt(max_devices)||1,
        connected_devices: []
      };
      await updateFile('keys.json',keys,sha,"Key added: "+key);

      if(currentReseller && creditCost > 0){
        const {data:resellers,sha:rsha} = await getFile('resellers.json');
        resellers[currentReseller].credits -= creditCost;
        resellers[currentReseller].total_keys_generated = (resellers[currentReseller].total_keys_generated||0)+1;
        resellers[currentReseller].active_keys = (resellers[currentReseller].active_keys||0)+1;
        resellers[currentReseller].credit_history.push({
          type: "deduct", amount: creditCost,
          by: "system", reason: isLifetime?"Lifetime key":"Time-based key",
          at: new Date().toISOString()
        });
        await updateFile('resellers.json',resellers,rsha,"Credits deducted: "+currentReseller);
      }

      res.json({success:true,message:"Key added!",credits_deducted:creditCost});return;
    }

    // DELETE KEY
    if(action==='delete_key'){
      const {key} = req.body||{};
      if(!key){res.json({success:false,message:"Key required!"});return;}

      const {data:keys,sha} = await getFile('keys.json');
      if(!keys[key]){res.json({success:false,message:"Not found!"});return;}

      const k = keys[key];
      if(!isAdmin){
        if(!currentReseller || k.reseller!==currentReseller){
          res.json({success:false,message:"You can only delete your own keys!"});return;
        }
      }

      delete keys[key];
      await updateFile('keys.json',keys,sha,"Key deleted: "+key);

      if(k.reseller){
        try{
          const {data:resellers,sha:rsha} = await getFile('resellers.json');
          if(resellers[k.reseller]){
            resellers[k.reseller].active_keys = Math.max(0,(resellers[k.reseller].active_keys||0)-1);
            await updateFile('resellers.json',resellers,rsha,"Key deleted stat: "+k.reseller);
          }
        }catch(e){}
      }

      res.json({success:true,message:"Deleted!"});return;
    }

    // RESET DEVICE
    if(action==='reset_device'){
      const {key} = req.body||{};
      if(!key){res.json({success:false,message:"Key required!"});return;}

      if(!isAdmin){res.json({success:false,message:"Admin only!"});return;}

      const {data:keys,sha} = await getFile('keys.json');
      if(!keys[key]){res.json({success:false,message:"Not found!"});return;}
      keys[key].device_id=null;
      keys[key].locked_at=null;
      keys[key].connected_devices=[];
      await updateFile('keys.json',keys,sha,"Device reset: "+key);
      res.json({success:true,message:"Reset!"});return;
    }

    // GET MAINTENANCE
    if(action==='get_maintenance'){
      const {data:v} = await getFile('version.json');
      res.json({success:true,maintenance:v.maintenance||false});return;
    }

    // SET MAINTENANCE
    if(action==='set_maintenance'){
      if(!isAdmin){res.json({success:false,message:"Admin only!"});return;}
      const {maintenance} = req.body||{};
      const {data:v,sha} = await getFile('version.json');
      v.maintenance = maintenance;
      await updateFile('version.json',v,sha,maintenance?"Maintenance ON":"Maintenance OFF");
      res.json({success:true,maintenance});return;
    }

    // GET CREDIT RATES
    if(action==='get_credit_rates'){
      const {data:v} = await getFile('version.json');
      res.json({success:true,rates:v.credit_rates||{time_based:1,lifetime:2}});return;
    }

    res.json({success:false,message:"Unknown action!"});

  }catch(err){
    res.status(500).json({success:false,message:"Error: "+err.message});
  }
};
                       
